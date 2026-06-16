use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::app::AppState;

// ---------------------------------------------------------------------------
// Planning Live route stubs (elegy-planning CLI bridge)
//
// These return stubs for now. When real implementation is added, they'll run
// the elegy-planning CLI binary at:
//   state.config.elegy_home.join("managed-cli").join("planning").join("elegy-planning")
// with --json --non-interactive --scope "repo:..." and the appropriate subcommand.
// ---------------------------------------------------------------------------

async fn task_board() -> Json<Value> {
    Json(serde_json::json!({"taskBoard": { "lanes": [] }, "stub": true}))
}

async fn live_roadmaps() -> Json<Value> {
    Json(serde_json::json!({"roadmaps": [], "stub": true}))
}

async fn live_goals() -> Json<Value> {
    Json(serde_json::json!({"goals": [], "stub": true}))
}

async fn authority_status() -> Json<Value> {
    Json(serde_json::json!({"authority": "unknown", "stub": true}))
}

async fn live_roadmap_detail() -> Json<Value> {
    Json(serde_json::json!({"roadmap": {}, "stub": true}))
}

async fn live_goal_detail() -> Json<Value> {
    Json(serde_json::json!({"goal": {}, "stub": true}))
}

async fn live_plans() -> Json<Value> {
    Json(serde_json::json!({"plans": [], "stub": true}))
}

async fn live_plan_detail() -> Json<Value> {
    Json(serde_json::json!({"plan": {}, "stub": true}))
}

async fn live_todos() -> Json<Value> {
    Json(serde_json::json!({"todos": [], "stub": true}))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/planning/task-board",
            get(task_board),
        )
        .route(
            "/api/planning/live/roadmaps",
            get(live_roadmaps),
        )
        .route(
            "/api/planning/live/goals",
            get(live_goals),
        )
        .route(
            "/api/planning/live/authority-status",
            get(authority_status),
        )
        .route(
            "/api/planning/live/roadmaps/{roadmap_id}",
            get(live_roadmap_detail),
        )
        .route(
            "/api/planning/live/goals/{goal_id}",
            get(live_goal_detail),
        )
        .route(
            "/api/planning/live/plans",
            get(live_plans),
        )
        .route(
            "/api/planning/live/plans/{plan_id}",
            get(live_plan_detail),
        )
        .route(
            "/api/planning/live/todos",
            get(live_todos),
        )
        .with_state(state)
}
