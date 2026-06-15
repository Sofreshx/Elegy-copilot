use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use elegy_native_contracts::{
    ProjectActivityResponse, ProjectResponse, ProjectSessionResponse,
};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;
use crate::projects::{
    list_project_activity, list_project_sessions, list_projects, register_repo, select_repo,
    unregister_repo, update_project_fields,
};

async fn get_projects(State(state): State<AppState>) -> Json<Vec<ProjectResponse>> {
    Json(list_projects(&state.config.elegy_home))
}

async fn get_project_sessions(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Json<Vec<ProjectSessionResponse>> {
    Json(list_project_sessions(&state.config.elegy_home, &project_id))
}

async fn get_project_activity(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Json<Vec<ProjectActivityResponse>> {
    Json(list_project_activity(&state.config.elegy_home, &project_id))
}

async fn patch_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let normalized_project_id = project_id.trim();
    if normalized_project_id.is_empty() {
        return project_error(
            StatusCode::BAD_REQUEST,
            "projects.update",
            "Project ID is required",
        );
    }

    match update_project_fields(&state.config.elegy_home, normalized_project_id, &payload) {
        Some(project) => (
            StatusCode::OK,
            Json(serde_json::to_value(project).expect("project response should serialize")),
        ),
        None => project_error(
            StatusCode::NOT_FOUND,
            "projects.update",
            &format!("Project not found: {normalized_project_id}"),
        ),
    }
}

fn project_error(
    status: StatusCode,
    kind: &str,
    error: &str,
) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "kind": kind,
            "deterministic": true,
            "error": error,
        })),
    )
}

// POST /api/catalog/repos/register
async fn post_register_repo(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let repo_path = body["repoPath"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest("repoPath required".into()))?;
    let repo_label = body["repoLabel"].as_str();
    let select = body["select"].as_bool().unwrap_or(false);

    match register_repo(&state.config.elegy_home, repo_path, repo_label, select) {
        Ok(result) => Ok(Json(json!({
            "ok": true,
            "repoId": result.repo_id,
            "repoPath": result.repo_path,
            "repoLabel": result.repo_label,
            "wasSelected": result.was_selected,
        }))),
        Err(e) => Err(ApiError::BadRequest(e)),
    }
}

// POST /api/catalog/repos/unregister
async fn post_unregister_repo(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let repo_id = body["repoId"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest("repoId required".into()))?;
    let clear_selection = body["clearSelection"].as_bool().unwrap_or(true);

    match unregister_repo(&state.config.elegy_home, repo_id, clear_selection) {
        Ok(removed_path) => Ok(Json(json!({
            "ok": true,
            "removedPath": removed_path,
        }))),
        Err(e) => Err(ApiError::NotFound(e)),
    }
}

// POST /api/catalog/repos/select
async fn post_select_repo(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let repo_id = body["repoId"].as_str(); // None means clear selection

    match select_repo(&state.config.elegy_home, repo_id) {
        Ok(selected_id) => Ok(Json(json!({
            "ok": true,
            "selectedRepoId": selected_id,
        }))),
        Err(e) => Err(ApiError::NotFound(e)),
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/projects", get(get_projects))
        .route("/api/projects/{project_id}", patch(patch_project))
        .route(
            "/api/projects/{project_id}/sessions",
            get(get_project_sessions),
        )
        .route(
            "/api/projects/{project_id}/activity",
            get(get_project_activity),
        )
        .route("/api/catalog/repos/register", post(post_register_repo))
        .route("/api/catalog/repos/unregister", post(post_unregister_repo))
        .route("/api/catalog/repos/select", post(post_select_repo))
        .with_state(state)
}
