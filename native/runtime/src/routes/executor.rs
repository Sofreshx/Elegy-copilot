use axum::{Router, routing::{get, post}, extract::State, Json};
use crate::app::AppState;
use crate::executor::ExecutorService;

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
// Cleanup stub handlers
// ---------------------------------------------------------------------------

async fn cleanup_analyze() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "candidates": [], "stub": true}))
}

async fn cleanup_delete() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "deleted": 0, "stub": true}))
}

async fn cleanup_prune() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "pruned": 0, "stub": true}))
}

async fn cleanup_trim() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "trimmed": 0, "stub": true}))
}
