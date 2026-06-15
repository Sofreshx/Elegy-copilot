use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use elegy_native_contracts::DashboardSummaryResponse;

use crate::app::AppState;
use crate::dashboard::build_dashboard_summary;

async fn get_dashboard_summary(State(state): State<AppState>) -> Json<DashboardSummaryResponse> {
    Json(build_dashboard_summary(&state.config.elegy_home))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/dashboard/summary", get(get_dashboard_summary))
        .with_state(state)
}
