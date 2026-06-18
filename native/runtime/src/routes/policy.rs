use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::app::{policy_preflight, AppState};

#[derive(Debug, Deserialize)]
struct PolicyPreflightQuery {
    refresh: Option<String>,
}

async fn get_policy_preflight(
    State(state): State<AppState>,
    Query(query): Query<PolicyPreflightQuery>,
) -> Json<elegy_native_contracts::PolicyPreflightResponse> {
    let refresh = query.refresh.as_deref() == Some("1");
    Json(policy_preflight(&state, refresh))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/policy/preflight", get(get_policy_preflight))
        .with_state(state)
}
