use axum::{Router, routing::{get, post}, extract::{State, Query}, Json};
use chrono::Utc;
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
///
/// Body: `{ "repoPath": "...", "files": [...] }` (both optional).
/// Reads diff context, creates a review session directory, and returns a basic
/// review result.
async fn launch(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let review_id = uuid::Uuid::new_v4().to_string();
    let repo_path = body
        .get("repoPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let files: Vec<String> = body
        .get("files")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // Determine working directory for git commands
    let cwd = repo_path.clone().unwrap_or_else(|| state.config.engine_root.to_string_lossy().to_string());
    let repo_dir = std::path::Path::new(&cwd);
    if !repo_dir.is_dir() {
        return Err(ApiError::NotFound(format!("Repository path not found: {}", cwd)));
    }

    // Read diff context
    let diff_output = if files.is_empty() {
        run_git_cmd(&cwd, &["diff", "--cached"]).unwrap_or_default()
    } else {
        let mut args = vec!["diff", "--cached", "--"];
        for f in &files {
            args.push(f.as_str());
        }
        run_git_cmd(&cwd, &args).unwrap_or_default()
    };

    // Also get changed files list
    let changed_files: Vec<String> = if files.is_empty() {
        run_git_cmd(&cwd, &["diff", "--cached", "--name-only"])
            .unwrap_or_default()
            .lines()
            .map(|l| l.to_string())
            .filter(|l| !l.is_empty())
            .collect()
    } else {
        files.clone()
    };

    // Get current branch
    let branch = run_git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    // Create review session directory
    let review_dir = state
        .config
        .elegy_home
        .join("code-reviews")
        .join(&review_id);
    std::fs::create_dir_all(&review_dir).map_err(|e| ApiError::Internal(e.into()))?;

    // Write review context to session directory
    let session_data = serde_json::json!({
        "reviewId": review_id,
        "repoPath": repo_path,
        "branch": branch,
        "files": changed_files,
        "createdAt": Utc::now().to_rfc3339(),
        "diffLines": diff_output.lines().count(),
    });
    let session_path = review_dir.join("review.json");
    let session_content =
        serde_json::to_string_pretty(&session_data).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&session_path, session_content).map_err(|e| ApiError::Internal(e.into()))?;

    // Write diff to a file for reference
    let diff_path = review_dir.join("diff.patch");
    std::fs::write(&diff_path, &diff_output).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "reviewId": review_id,
        "findings": [],
        "message": "Review session created",
        "session": {
            "repoPath": repo_path,
            "branch": branch,
            "files": changed_files,
            "fileCount": changed_files.len(),
            "diffLines": diff_output.lines().count(),
            "createdAt": Utc::now().to_rfc3339(),
        },
    })))
}
