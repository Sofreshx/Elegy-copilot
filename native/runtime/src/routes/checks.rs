use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
#[allow(dead_code)]
struct ChecksQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/git/checks/discover", get(checks_discover))
        .route("/api/git/checks/run", post(checks_run))
        .route("/api/git/checks/state", get(checks_state))
        .route("/api/git/checks/ci-sync", get(checks_ci_sync))
        .with_state(state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn resolve_root(state: &AppState, repo_path: Option<String>) -> PathBuf {
    repo_path
        .map(PathBuf::from)
        .unwrap_or_else(|| state.config.engine_root.clone())
}

/// Recursively find all YAML files in a directory
fn find_yml_files(dir: &Path) -> Vec<String> {
    let mut files = vec![];
    if !dir.is_dir() {
        return files;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "yml" || ext == "yaml" {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            files.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    files
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/// GET /api/git/checks/discover?repoPath=...
/// Look for .copilot/commit-checks.json or .github/commit-checks.json
async fn checks_discover(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let check_configs = [
        (".copilot/commit-checks.json", "copilot"),
        (".github/commit-checks.json", "github"),
    ];

    let mut checks = vec![];

    for (rel_path, source) in &check_configs {
        let full_path = root.join(rel_path);
        if full_path.is_file() {
            let content = std::fs::read_to_string(&full_path).ok();
            let parsed = content.as_deref().and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok());
            checks.push(serde_json::json!({
                "path": rel_path,
                "source": source,
                "exists": true,
                "config": parsed,
            }));
        } else {
            checks.push(serde_json::json!({
                "path": rel_path,
                "source": source,
                "exists": false,
            }));
        }
    }

    Ok(Json(serde_json::json!({
        "checks": checks,
        "count": checks.len(),
    })))
}

/// POST /api/git/checks/run
/// Stub — check execution is complex (would require spawning process)
async fn checks_run() -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "ok": true,
        "results": [],
        "message": "Check execution not yet implemented in Rust backend",
    })))
}

/// GET /api/git/checks/state?repoPath=...
/// Read checks state from .copilot/check-state.json
async fn checks_state(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let state_path = root.join(".copilot").join("check-state.json");
    if state_path.is_file() {
        match std::fs::read_to_string(&state_path) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(state_value) => {
                        Ok(Json(serde_json::json!({
                            "state": state_value,
                            "path": ".copilot/check-state.json",
                            "exists": true,
                        })))
                    }
                    Err(_) => {
                        // Return raw content if not valid JSON
                        Ok(Json(serde_json::json!({
                            "state": "invalid",
                            "path": ".copilot/check-state.json",
                            "exists": true,
                            "raw": content,
                        })))
                    }
                }
            }
            Err(e) => Err(ApiError::Internal(e.into())),
        }
    } else {
        Ok(Json(serde_json::json!({
            "state": "unknown",
            "exists": false,
        })))
    }
}

/// GET /api/git/checks/ci-sync?repoPath=...
/// Check CI config files (.github/workflows/)
async fn checks_ci_sync(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let workflows_dir = root.join(".github").join("workflows");
    let workflow_files = find_yml_files(&workflows_dir);

    Ok(Json(serde_json::json!({
        "ciSync": {
            "hasWorkflowsDir": workflows_dir.is_dir(),
            "workflowCount": workflow_files.len(),
            "workflowFiles": workflow_files,
        }
    })))
}
