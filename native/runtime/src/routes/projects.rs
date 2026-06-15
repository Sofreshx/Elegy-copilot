use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use elegy_native_contracts::{
    ProjectActivityResponse, ProjectResponse, ProjectSessionResponse,
};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::projects::{
    list_project_activity, list_project_sessions, list_projects, update_project_fields,
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
        .with_state(state)
}
