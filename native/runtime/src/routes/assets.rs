use axum::{Router, routing::get, extract::{State, Query}, Json};
use crate::app::AppState;
use crate::error::ApiError;
use serde::Deserialize;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/assets/view", get(view_asset))
        .route("/api/assets/delete", axum::routing::post(delete_asset))
        .with_state(state)
}

#[derive(Deserialize)]
struct ViewQuery {
    path: String,
}

/// GET /api/assets/view?path=... — read file content with path traversal protection
async fn view_asset(
    State(state): State<AppState>,
    Query(query): Query<ViewQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let requested = query.path.trim_start_matches('/').trim_start_matches('\\');
    
    // Path traversal guard
    if requested.contains("..") || requested.contains('\\') {
        return Err(ApiError::BadRequest("Invalid path".into()));
    }
    
    // Only allow access to specific engine subdirectories
    let valid_prefixes = ["engine-assets/", "opencode-assets/", "codex-assets/", "antigravity-assets/", "claude-assets/", "catalog-assets/"];
    let mut allowed = false;
    for prefix in &valid_prefixes {
        if requested.starts_with(prefix) {
            allowed = true;
            break;
        }
    }
    if !allowed {
        return Err(ApiError::BadRequest("Path not in allowed directories".into()));
    }
    
    let full_path = state.config.engine_root.join(requested);
    if !full_path.exists() {
        return Err(ApiError::NotFound(format!("File not found: {}", requested)));
    }
    if !full_path.is_file() {
        return Err(ApiError::BadRequest("Path is not a file".into()));
    }
    
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    
    Ok(Json(serde_json::json!({
        "path": requested,
        "content": content,
    })))
}

#[derive(Deserialize)]
struct DeleteBody {
    path: String,
}

/// POST /api/assets/delete — delete asset file/directory with guard
async fn delete_asset(
    State(state): State<AppState>,
    Json(body): Json<DeleteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let requested = body.path.trim_start_matches('/').trim_start_matches('\\');
    
    // Path traversal guard
    if requested.contains("..") || requested.contains('\\') {
        return Err(ApiError::BadRequest("Invalid path".into()));
    }
    
    // Only allow deleting from specific patterns
    let is_agent_md = requested.starts_with(".github/agents/") && requested.ends_with(".agent.md");
    let is_skill_dir = requested.starts_with(".github/skills/") && requested.contains("/SKILL.md");
    
    if !is_agent_md && !is_skill_dir {
        return Err(ApiError::BadRequest("Can only delete agents/*.agent.md or skills/*/SKILL.md files".into()));
    }
    
    let full_path = state.config.engine_root.join(requested);
    if !full_path.exists() {
        return Err(ApiError::NotFound(format!("File not found: {}", requested)));
    }
    
    if full_path.is_dir() {
        std::fs::remove_dir_all(&full_path).map_err(|e| ApiError::Internal(e.into()))?;
    } else {
        std::fs::remove_file(&full_path).map_err(|e| ApiError::Internal(e.into()))?;
    }
    
    Ok(Json(serde_json::json!({ "ok": true, "deleted": requested })))
}
