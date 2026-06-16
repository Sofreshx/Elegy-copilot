use axum::{Router, routing::get, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lexicon/entries", get(entries))
        .route("/api/lexicon/search", get(search))
        .with_state(state)
}

async fn entries() -> Json<serde_json::Value> {
    Json(serde_json::json!({"entries": [], "stub": true}))
}

async fn search() -> Json<serde_json::Value> {
    Json(serde_json::json!({"results": [], "stub": true}))
}
