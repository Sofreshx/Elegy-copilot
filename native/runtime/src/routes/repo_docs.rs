use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post};
use serde::Deserialize;
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
#[allow(dead_code)]
struct RepoDocsQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    path: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/repo-docs/list", get(repo_docs_list))
        .route("/api/repo-docs/read", get(repo_docs_read))
        .route("/api/repo-docs/tree", get(repo_docs_tree))
        .route("/api/repo-docs/graph", get(repo_docs_graph))
        .route("/api/repo-docs/write", post(repo_docs_write))
        .route("/api/repo-docs/delete", axum::routing::delete(repo_docs_delete))
        .with_state(state)
}

// ── Stubs (GET routes with query params) ─────────────────────────────────────

/// GET /api/repo-docs/list?repoPath=...
async fn repo_docs_list(
    State(_state): State<AppState>,
    Query(_query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"docs": [], "stub": true})))
}

/// GET /api/repo-docs/read?repoPath=...&path=...
async fn repo_docs_read(
    State(_state): State<AppState>,
    Query(_query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"content": "", "stub": true})))
}

/// GET /api/repo-docs/tree?repoPath=...
async fn repo_docs_tree(
    State(_state): State<AppState>,
    Query(_query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"tree": [], "stub": true})))
}

/// GET /api/repo-docs/graph?repoPath=...
async fn repo_docs_graph(
    State(_state): State<AppState>,
    Query(_query): Query<RepoDocsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"graph": {"nodes": [], "edges": []}, "stub": true})))
}

// ── Stubs (POST/DELETE routes) ───────────────────────────────────────────────

/// POST /api/repo-docs/write
async fn repo_docs_write() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// DELETE /api/repo-docs/delete
async fn repo_docs_delete() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
