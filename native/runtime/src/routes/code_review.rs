use axum::{Router, routing::{get, post}, extract::{State, Query}, Json};
use serde::Deserialize;
use std::process::Command;
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
struct PrepareQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
    #[serde(rename = "prUrl")]
    pr_url: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/code-review/prepare", get(prepare))
        .route("/api/code-review/launch", post(launch))
        .with_state(state)
}

fn run_git_cmd(cwd: &str, args: &[&str]) -> Result<String, ApiError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// GET /api/code-review/prepare
/// Scan repo for review data (branch info, diff stats, changed files)
async fn prepare(
    State(_state): State<AppState>,
    Query(query): Query<PrepareQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let repo_path = query.repo_path.unwrap_or_default();
    if repo_path.is_empty() {
        return Err(ApiError::BadRequest("repoPath is required".to_string()));
    }

    let repo = std::path::Path::new(&repo_path);
    if !repo.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let cwd = query.worktree_path.as_deref().unwrap_or(&repo_path);

    // Get current branch
    let branch = run_git_cmd(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    // Try to determine base branch
    let base_branch = run_git_cmd(cwd, &["remote", "show", "origin"])
        .ok()
        .and_then(|output| {
            output.lines()
                .find(|l| l.contains("HEAD branch:"))
                .and_then(|l| l.split("HEAD branch:").nth(1))
                .map(|s| s.trim().to_string())
        });

    // Get diff stat
    let diff_stat = if let Some(ref base) = base_branch {
        run_git_cmd(cwd, &["diff", "--stat", &format!("{}...HEAD", base)]).ok()
    } else {
        run_git_cmd(cwd, &["diff", "--stat", "HEAD~1..HEAD"]).ok()
            .or_else(|| run_git_cmd(cwd, &["diff", "--stat", "--cached"]).ok())
    };

    // Get changed files list
    let changed_files: Vec<String> = if let Some(ref base) = base_branch {
        run_git_cmd(cwd, &["diff", "--name-only", &format!("{}...HEAD", base)]).ok()
            .map(|s| s.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default()
    } else {
        run_git_cmd(cwd, &["diff", "--name-only", "HEAD~1..HEAD"]).ok()
            .or_else(|| run_git_cmd(cwd, &["diff", "--name-only", "--cached"]).ok())
            .map(|s| s.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default()
    };

    Ok(Json(serde_json::json!({
        "repoPath": repo_path,
        "worktreePath": query.worktree_path,
        "branch": if branch.is_empty() { serde_json::Value::Null } else { serde_json::json!(branch) },
        "baseBranch": base_branch,
        "diffStat": diff_stat,
        "changedFiles": changed_files,
        "changedFileCount": changed_files.len(),
        "prUrl": query.pr_url,
    })))
}

/// POST /api/code-review/launch
/// Stub — review launch is complex (requires spawning CLI)
async fn launch() -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "ok": true,
        "reviewId": null,
        "message": "Code review launch not yet implemented in Rust backend",
    })))
}
