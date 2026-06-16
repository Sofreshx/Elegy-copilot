use axum::{Router, Json};
use axum::routing::any;

use crate::app::AppState;

mod agent;
mod assets;
mod config;
mod dashboard;
mod desktop_updater;
mod executor;
mod git;
mod health;
mod lifecycle;
mod planning;
mod policy;
mod projects;
mod sessions;
mod tooling_updates;
mod version;

pub fn build_routes(state: AppState) -> Router {
    Router::new()
        .merge(config::router(state.clone()))
        .merge(health::router(state.clone()))
        .merge(version::router(state.clone()))
        .merge(policy::router(state.clone()))
        .merge(dashboard::router(state.clone()))
        .merge(executor::router(state.clone()))
        .merge(projects::router(state.clone()))
        .merge(assets::router(state.clone()))
        .merge(lifecycle::router(state.clone()))
        .merge(planning::router(state.clone()))
        .merge(git::router(state.clone()))
        .merge(agent::router(state.clone()))
        .merge(sessions::router(state.clone()))
        .merge(desktop_updater::router(state.clone()))
        .merge(tooling_updates::router(state.clone()))
        .route("/api/{*rest}", any(stub_api_handler))
}

async fn stub_api_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}
