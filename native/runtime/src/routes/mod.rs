use axum::Router;

use crate::app::AppState;

mod assets;
mod config;
mod dashboard;
mod health;
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
        .merge(planning::router(state.clone()))
        .merge(sessions::router(state))
}
