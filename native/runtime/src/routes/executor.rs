use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;
use crate::executor::ExecutorService;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/executor/health", get(executor_health))
        .route("/api/executor/jobs", get(list_jobs))
        .route("/api/executor/runs", get(list_runs))
        .route("/api/executor/worktrees", get(list_worktrees))
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
