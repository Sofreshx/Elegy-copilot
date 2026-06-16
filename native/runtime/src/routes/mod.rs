use axum::Router;

use crate::app::AppState;

mod agent;
mod assets;
mod config;
mod dashboard;
mod git;
mod health;
mod lifecycle;
mod planning;
mod policy;
mod projects;
mod sessions;
mod version;

pub fn build_routes(state: AppState) -> Router {
    Router::new()
        .merge(config::router(state.clone()))
        .merge(health::router(state.clone()))
        .merge(version::router(state.clone()))
        .merge(policy::router(state.clone()))
        .merge(dashboard::router(state.clone()))
        .merge(projects::router(state.clone()))
        .merge(assets::router(state.clone()))
        .merge(lifecycle::router(state.clone()))
        .merge(planning::router(state.clone()))
        .merge(git::router(state.clone()))
        .merge(agent::router(state.clone()))
        .merge(sessions::router(state))
}
