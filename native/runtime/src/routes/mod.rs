use axum::{Router, Json};
use axum::routing::any;

use crate::app::AppState;

mod agent;
mod assets;
mod catalog;
mod checks;
mod claude_code;
mod config;
mod dashboard;
mod desktop_updater;
mod elegy_db;
mod executor;
mod gateway;
mod git;
mod health;
mod lifecycle;
mod notes;
mod opencode;
mod planning;
mod planning_live;
mod policy;
mod projects;
mod repo_docs;
mod sessions;
mod tooling_updates;
mod ui_runtime_overlay;
mod version;
mod workspace;
mod planning_obsidian;
mod codex;
mod lifecycle_full;
mod sandboxes;
mod cli_detection;
mod cli_tooling;
mod repo_assets;
mod lexicon;
mod telemetry;
mod code_review;

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
        .merge(catalog::router(state.clone()))
        .merge(lifecycle::router(state.clone()))
        .merge(notes::router(state.clone()))
        .merge(opencode::router(state.clone()))
        .merge(planning::router(state.clone()))
        .merge(planning_live::router(state.clone()))
        .merge(claude_code::router(state.clone()))
        .merge(git::router(state.clone()))
        .merge(agent::router(state.clone()))
        .merge(sessions::router(state.clone()))
        .merge(desktop_updater::router(state.clone()))
        .merge(elegy_db::router(state.clone()))
        .merge(gateway::router(state.clone()))
        .merge(tooling_updates::router(state.clone()))
        .merge(workspace::router(state.clone()))
        .merge(ui_runtime_overlay::router(state.clone()))
        .merge(repo_docs::router(state.clone()))
        .merge(checks::router(state.clone()))
        .merge(planning_obsidian::router(state.clone()))
        .merge(codex::router(state.clone()))
        .merge(lifecycle_full::router(state.clone()))
        .merge(sandboxes::router(state.clone()))
        .merge(cli_tooling::router(state.clone()))
        .merge(repo_assets::router(state.clone()))
        .merge(lexicon::router(state.clone()))
        .merge(telemetry::router(state.clone()))
        .merge(code_review::router(state.clone()))
        .fallback(any(stub_api_handler))
}

async fn stub_api_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}
