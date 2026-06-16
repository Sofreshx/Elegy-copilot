use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use elegy_native_contracts::DashboardSummaryResponse;

use crate::app::AppState;
use crate::dashboard::build_dashboard_summary;
use crate::sessions;

// GET /api/dashboard/harness-sessions — return sessions list for dashboard
async fn harness_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions = sessions::list_sessions(&state.config.elegy_home);
    let result: Vec<serde_json::Value> = sessions.iter().map(|s| {
        serde_json::json!({
            "id": s.id,
            "storageId": s.storage_id,
            "repo": s.repo,
            "status": s.status,
            "startTime": s.start_time,
            "lastEventTime": s.last_event_time,
        })
    }).collect();
    Json(serde_json::json!({ "sessions": result, "count": result.len() }))
}

async fn get_dashboard_summary(State(state): State<AppState>) -> Json<DashboardSummaryResponse> {
    Json(build_dashboard_summary(&state.config.elegy_home))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/dashboard/summary", get(get_dashboard_summary))
        .route("/api/dashboard/harness-sessions", get(harness_sessions))
        .with_state(state)
}
