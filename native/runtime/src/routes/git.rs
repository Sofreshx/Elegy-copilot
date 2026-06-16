use axum::{Router, routing::get, extract::{State, Query}, Json};
use serde::Deserialize;
use std::process::Command;
use crate::app::AppState;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/git/status", get(git_status))
        .route("/api/git/branches", get(git_branches))
        .with_state(state)
}

#[derive(Deserialize)]
struct GitQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

/// GET /api/git/status?repoPath=... — git status --porcelain=v1
async fn git_status(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = query.repo_path.unwrap_or_else(|| state.config.engine_root.to_string_lossy().to_string());
    let output = Command::new("git")
        .args(["-C", &cwd, "status", "--porcelain=v1", "--branch"])
        .output()
        .map_err(|e| ApiError::Internal(e.into()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let files: Vec<String> = stdout.lines().filter(|l| !l.starts_with("## ")).map(|l| l.to_string()).collect();
    let branch_line = stdout.lines().find(|l| l.starts_with("## ")).unwrap_or("## No branch");

    Ok(Json(serde_json::json!({
        "branch": branch_line.strip_prefix("## ").unwrap_or(branch_line),
        "files": files,
        "changedCount": files.len(),
    })))
}

/// GET /api/git/branches?repoPath=... — list branches
async fn git_branches(
    State(state): State<AppState>,
    Query(query): Query<GitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cwd = query.repo_path.unwrap_or_else(|| state.config.engine_root.to_string_lossy().to_string());

    // Current branch
    let current = Command::new("git")
        .args(["-C", &cwd, "branch", "--show-current"])
        .output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // All local branches
    let local = Command::new("git")
        .args(["-C", &cwd, "branch", "--format=%(refname:short)"])
        .output().ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines().map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
        }).unwrap_or_default();

    Ok(Json(serde_json::json!({
        "current": current,
        "branches": local,
    })))
}
