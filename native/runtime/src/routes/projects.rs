use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use elegy_native_contracts::{
    CatalogRepoAssetSummary, CatalogRepoHints, CatalogRepoInventoryEntry,
    CatalogRepoInventoryStorage, CatalogRepoInventoryWorkspaceScan, CatalogReposListResponse,
    ProjectActivityResponse, ProjectResponse, ProjectSessionResponse,
};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;
use crate::projects::{
    enrich_repo, list_project_activity, list_project_sessions, list_projects, manual_repos,
    register_repo, repo_inventory_path, repo_inventory_state, select_repo, unregister_repo,
    update_project_fields,
};

async fn get_projects(State(state): State<AppState>) -> Json<Vec<ProjectResponse>> {
    Json(list_projects(&state.config.elegy_home))
}

const ASSET_SOURCE_DIRS: &[&str] = &[
    "engine-assets",
    "opencode-assets",
    "codex-assets",
    "antigravity-assets",
    "claude-assets",
];

fn detect_sources(repo_path: &str) -> Vec<String> {
    let path = std::path::Path::new(repo_path);
    ASSET_SOURCE_DIRS
        .iter()
        .filter(|dir| path.join(dir).exists())
        .map(|s| s.to_string())
        .collect()
}

fn detect_hints(repo_path: &str) -> CatalogRepoHints {
    let path = std::path::Path::new(repo_path);
    let mut stacks = Vec::new();
    let mut languages = Vec::new();
    if path.join("package.json").exists() {
        stacks.push("node".to_string());
        languages.push("javascript".to_string());
    }
    if path.join("Cargo.toml").exists() {
        stacks.push("rust".to_string());
        languages.push("rust".to_string());
    }
    if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        stacks.push("python".to_string());
        languages.push("python".to_string());
    }
    if path.join("go.mod").exists() {
        stacks.push("go".to_string());
        languages.push("go".to_string());
    }
    CatalogRepoHints {
        stacks,
        frameworks: Vec::new(),
        languages,
        targets: Vec::new(),
    }
}

fn build_catalog_entry(
    repo: &crate::projects::ManualRepoEntry,
    selected: bool,
) -> CatalogRepoInventoryEntry {
    let info = enrich_repo(&repo.repo_path);
    let scan_status = if !info.exists {
        "missing"
    } else if !info.is_git_root {
        "no-git"
    } else {
        "ok"
    }
    .to_string();
    let assets = CatalogRepoAssetSummary {
        has_repo_assets: !detect_sources(&repo.repo_path).is_empty(),
        has_skills: info.skill_count > 0,
        has_agents: info.agent_count > 0,
        skill_count: info.skill_count,
        agent_count: info.agent_count,
        overlay_enabled_count: 0,
        overlay_disabled_count: 0,
        skills_path: if info.skill_count > 0 {
            Some(format!("{}/.github/skills", repo.repo_path))
        } else {
            None
        },
        agents_path: if info.agent_count > 0 {
            Some(format!("{}/.github/agents", repo.repo_path))
        } else {
            None
        },
    };
    CatalogRepoInventoryEntry {
        repo_id: Some(repo.repo_id.clone()),
        repo_path: Some(repo.repo_path.clone()),
        repo_label: Some(repo.repo_label.clone()),
        selected,
        registered: true,
        sources: detect_sources(&repo.repo_path),
        exists: info.exists,
        git_root_present: info.is_git_root,
        scan_status,
        last_seen_at: repo.updated_at.clone(),
        last_refresh_at: repo.updated_at.clone(),
        assets,
        hints: detect_hints(&repo.repo_path),
        snapshot: Value::Object(Default::default()),
        repo_state: Value::Object(Default::default()),
    }
}

// GET /api/catalog/repos — catalog project list matching frontend expectations
async fn get_catalog_repos(State(state): State<AppState>) -> Json<CatalogReposListResponse> {
    let inventory = repo_inventory_state(&state.config.elegy_home);
    let repos_list = manual_repos(&state.config.elegy_home);
    let selected_id = inventory.selected_repo_id.clone();
    let entries: Vec<CatalogRepoInventoryEntry> = repos_list
        .iter()
        .map(|r| {
            let selected = selected_id
                .as_deref()
                .map(|sid| sid == r.repo_id.as_str())
                .unwrap_or(false);
            build_catalog_entry(r, selected)
        })
        .collect();
    let selected_repo = selected_id
        .as_ref()
        .and_then(|sid| entries.iter().find(|e| e.repo_id.as_deref() == Some(sid)).cloned());
    let inventory_path = repo_inventory_path(&state.config.elegy_home);
    let storage_path_str = inventory_path.to_string_lossy().to_string();
    let storage_exists = inventory_path.exists();
    let storage = CatalogRepoInventoryStorage {
        path: storage_path_str.clone(),
        exists: storage_exists,
    };
    let workspace_scan = CatalogRepoInventoryWorkspaceScan {
        storage: storage.clone(),
        default_roots: Vec::new(),
        custom_scan_roots: Vec::new(),
        scan_roots: Vec::new(),
    };
    let count = entries.len() as u64;
    Json(CatalogReposListResponse {
        kind: "catalog.repos.list".to_string(),
        deterministic: true,
        count,
        selected_repo,
        storage,
        workspace_scan: Some(workspace_scan),
        repos: entries,
    })
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
            Json(serde_json::to_value(project).unwrap_or(serde_json::Value::Null)),
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
        .route("/api/catalog/repos", get(get_catalog_repos))
        .route("/api/catalog/repos/register", post(post_register_repo))
        .route("/api/catalog/repos/unregister", post(post_unregister_repo))
        .route("/api/catalog/repos/select", post(post_select_repo))
        .with_state(state)
}
