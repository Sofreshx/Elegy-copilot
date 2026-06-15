use axum::Router;

use crate::app::AppState;

mod config;
mod dashboard;
mod health;
mod policy;
mod projects;
mod version;

pub fn build_routes(state: AppState) -> Router {
    Router::new()
        .merge(config::router(state.clone()))
        .merge(health::router(state.clone()))
        .merge(version::router(state.clone()))
        .merge(policy::router(state.clone()))
        .merge(dashboard::router(state.clone()))
        .merge(projects::router(state))
}
