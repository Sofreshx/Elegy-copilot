use axum::{Router, routing::{get, post}, extract::State, Json};
use crate::app::AppState;
use crate::error::ApiError;
use crate::executor::ExecutorService;
use std::path::PathBuf;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/executor/health", get(executor_health))
        .route("/api/executor/jobs", get(list_jobs))
        .route("/api/executor/runs", get(list_runs))
        .route("/api/executor/worktrees", get(list_worktrees))
        // Cleanup routes
        .route("/api/executor/cleanup/analyze", post(cleanup_analyze))
        .route("/api/executor/cleanup/delete", post(cleanup_delete))
        .route("/api/executor/cleanup/prune", post(cleanup_prune))
        .route("/api/executor/cleanup/trim", post(cleanup_trim))
        .with_state(state)
}

async fn executor_health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let svc = ExecutorService::new(&state.config.elegy_home);
    Json(svc.get_health())
}

async fn list_jobs(State(state): State<AppState>) -> Json<serde_json::Value> {
    let svc = ExecutorService::new(&state.config.elegy_home);
    let jobs = svc.list_jobs();
    Json(serde_json::json!({ "jobs": jobs, "count": jobs.len() }))
}

async fn list_runs(State(state): State<AppState>) -> Json<serde_json::Value> {
    let svc = ExecutorService::new(&state.config.elegy_home);
    let runs = svc.list_runs();
    Json(serde_json::json!({ "runs": runs, "count": runs.len() }))
}

async fn list_worktrees(State(state): State<AppState>) -> Json<serde_json::Value> {
    use crate::worktree_service::WorktreeService;
    let svc = WorktreeService::new(&state.config.elegy_home);
    // List worktrees across all repo directories under repo-state/
    let repo_state = state.config.elegy_home.join("repo-state");
    let mut all_worktrees = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&repo_state) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let repo_id = entry.file_name().to_string_lossy().to_string();
                let worktrees = svc.list_worktrees(&repo_id);
                for wt in worktrees {
                    all_worktrees.push(serde_json::json!({
                        "worktreeId": wt.worktree_id,
                        "repoId": wt.repo_id,
                        "path": wt.path,
                        "branch": wt.branch,
                        "status": wt.status,
                    }));
                }
            }
        }
    }
    Json(serde_json::json!({ "worktrees": all_worktrees, "count": all_worktrees.len() }))
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

fn executor_state_path(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("executor").join("state.json")
}

fn load_state(state: &AppState) -> serde_json::Value {
    let path = executor_state_path(state);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({"runs": [], "jobs": []}))
    } else {
        serde_json::json!({"runs": [], "jobs": []})
    }
}

fn save_state(state: &AppState, data: &serde_json::Value) -> Result<(), ApiError> {
    let path = executor_state_path(state);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }
    let content =
        serde_json::to_string_pretty(data).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))
}

fn parse_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn format_age_days(rfc3339: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(rfc3339) {
        let days = (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_days();
        format!("{} days", days.max(0))
    } else {
        "unknown".to_string()
    }
}

// ---------------------------------------------------------------------------
// Cleanup handlers
// ---------------------------------------------------------------------------

async fn cleanup_analyze(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let state_data = load_state(&state);
    let repo_state_dir = state.config.elegy_home.join("repo-state");

    // Identify orphaned worktrees (worktree records whose path no longer exists)
    let mut orphaned_worktrees = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&repo_state_dir) {
        for entry in entries.flatten() {
            let repo_path = entry.path();
            if !repo_path.is_dir() {
                continue;
            }
            let repo_id = entry.file_name().to_string_lossy().to_string();
            let worktrees_dir = repo_path.join("worktrees");
            if !worktrees_dir.exists() {
                continue;
            }
            if let Ok(wt_entries) = std::fs::read_dir(&worktrees_dir) {
                for wt_entry in wt_entries.flatten() {
                    let wt_path = wt_entry.path();
                    if wt_path.extension().map_or(false, |e| e == "json") {
                        if let Ok(content) = std::fs::read_to_string(&wt_path) {
                            if let Ok(record) =
                                serde_json::from_str::<serde_json::Value>(&content)
                            {
                                let worktree_path =
                                    record.get("path").and_then(|p| p.as_str());
                                let is_orphaned = worktree_path
                                    .map_or(true, |p| !std::path::Path::new(p).exists());
                                if is_orphaned {
                                    orphaned_worktrees.push(serde_json::json!({
                                        "id": record.get("worktreeId"),
                                        "path": worktree_path,
                                        "repo": repo_id,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Identify stale runs (completed runs older than 30 days)
    let thirty_days_ago = chrono::Utc::now() - chrono::Duration::days(30);
    let mut stale_runs = Vec::new();
    if let Some(runs) = state_data.get("runs").and_then(|r| r.as_array()) {
        for run in runs {
            let status = run.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if matches!(status, "succeeded" | "failed" | "cancelled") {
                if let Some(completed) = run.get("completedAt").and_then(|s| s.as_str()) {
                    if let Some(dt) = parse_utc(completed) {
                        if dt < thirty_days_ago {
                            stale_runs.push(serde_json::json!({
                                "runId": run.get("runId"),
                                "age": format_age_days(completed),
                                "status": status,
                            }));
                        }
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "ok": true,
        "candidates": {
            "orphanedWorktrees": orphaned_worktrees,
            "staleRuns": stale_runs,
            "staleJobs": []
        },
        "summary": {
            "orphanedWorktrees": orphaned_worktrees.len(),
            "staleRuns": stale_runs.len(),
            "staleJobs": 0
        }
    }))
}

async fn cleanup_delete(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let mut deleted_worktrees: usize = 0;
    let mut deleted_runs: usize = 0;

    // Delete worktree state files from repo-state/
    if let Some(worktree_ids) = body.get("worktreeIds").and_then(|v| v.as_array()) {
        let repo_state_dir = state.config.elegy_home.join("repo-state");
        let ids: Vec<&str> = worktree_ids.iter().filter_map(|v| v.as_str()).collect();
        if !ids.is_empty() {
            if let Ok(entries) = std::fs::read_dir(&repo_state_dir) {
                for entry in entries.flatten() {
                    let repo_path = entry.path();
                    if !repo_path.is_dir() {
                        continue;
                    }
                    let worktrees_dir = repo_path.join("worktrees");
                    if !worktrees_dir.exists() {
                        continue;
                    }
                    if let Ok(wt_entries) = std::fs::read_dir(&worktrees_dir) {
                        for wt_entry in wt_entries.flatten() {
                            let wt_path = wt_entry.path();
                            if wt_path.extension().map_or(false, |e| e == "json") {
                                let stem =
                                    wt_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                                if ids.contains(&stem) {
                                    let _ = std::fs::remove_file(&wt_path);
                                    deleted_worktrees += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Remove runs from executor state
    if let Some(run_ids) = body.get("runIds").and_then(|v| v.as_array()) {
        let mut state_data = load_state(&state);
        let ids_to_remove: Vec<&str> = run_ids.iter().filter_map(|v| v.as_str()).collect();
        if !ids_to_remove.is_empty() {
            if let Some(runs) = state_data.get_mut("runs").and_then(|r| r.as_array_mut()) {
                runs.retain(|run| {
                    let run_id = run.get("runId").and_then(|v| v.as_str()).unwrap_or("");
                    if ids_to_remove.contains(&run_id) {
                        deleted_runs += 1;
                        false
                    } else {
                        true
                    }
                });
            }
            let _ = save_state(&state, &state_data);
        }
    }

    Json(serde_json::json!({
        "ok": true,
        "deleted": {
            "worktrees": deleted_worktrees,
            "runs": deleted_runs
        }
    }))
}

async fn cleanup_prune(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let thirty_days_ago = chrono::Utc::now() - chrono::Duration::days(30);
    let repo_state_dir = state.config.elegy_home.join("repo-state");
    let mut pruned_worktrees: usize = 0;

    // Delete orphaned worktrees
    if let Ok(entries) = std::fs::read_dir(&repo_state_dir) {
        for entry in entries.flatten() {
            let repo_path = entry.path();
            if !repo_path.is_dir() {
                continue;
            }
            let worktrees_dir = repo_path.join("worktrees");
            if !worktrees_dir.exists() {
                continue;
            }
            if let Ok(wt_entries) = std::fs::read_dir(&worktrees_dir) {
                for wt_entry in wt_entries.flatten() {
                    let wt_path = wt_entry.path();
                    if wt_path.extension().map_or(false, |e| e == "json") {
                        if let Ok(content) = std::fs::read_to_string(&wt_path) {
                            if let Ok(record) =
                                serde_json::from_str::<serde_json::Value>(&content)
                            {
                                let worktree_path =
                                    record.get("path").and_then(|p| p.as_str());
                                let is_orphaned = worktree_path
                                    .map_or(true, |p| !std::path::Path::new(p).exists());
                                if is_orphaned {
                                    let _ = std::fs::remove_file(&wt_path);
                                    pruned_worktrees += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Remove stale runs from executor state
    let mut state_data = load_state(&state);
    let mut pruned_runs: usize = 0;
    if let Some(runs) = state_data.get_mut("runs").and_then(|r| r.as_array_mut()) {
        runs.retain(|run| {
            let status = run.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let is_stale = matches!(status, "succeeded" | "failed" | "cancelled")
                && run
                    .get("completedAt")
                    .and_then(|s| s.as_str())
                    .and_then(parse_utc)
                    .map_or(false, |dt| dt < thirty_days_ago);
            if is_stale {
                pruned_runs += 1;
                false
            } else {
                true
            }
        });
    }
    let _ = save_state(&state, &state_data);

    Json(serde_json::json!({
        "ok": true,
        "pruned": {
            "worktrees": pruned_worktrees,
            "runs": pruned_runs,
            "jobs": 0
        }
    }))
}

async fn cleanup_trim(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let max_age = body.get("maxAge").and_then(|v| v.as_u64()).unwrap_or(90);
    let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age as i64);

    let mut state_data = load_state(&state);
    let mut trimmed_runs: usize = 0;
    if let Some(runs) = state_data.get_mut("runs").and_then(|r| r.as_array_mut()) {
        runs.retain(|run| {
            let status = run.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let is_stale = matches!(status, "succeeded" | "failed" | "cancelled")
                && run
                    .get("completedAt")
                    .and_then(|s| s.as_str())
                    .and_then(parse_utc)
                    .map_or(false, |dt| dt < cutoff);
            if is_stale {
                trimmed_runs += 1;
                false
            } else {
                true
            }
        });
    }
    let _ = save_state(&state, &state_data);

    Json(serde_json::json!({
        "ok": true,
        "trimmed": {
            "runs": trimmed_runs,
            "jobs": 0
        }
    }))
}
