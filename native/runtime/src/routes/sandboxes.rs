use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;
use crate::error::ApiError;

/// POST /api/sandboxes/lifecycle/{action} — perform lifecycle action on sandboxes
/// Scans sandboxes_home directory and returns sandbox count.
async fn sandbox_lifecycle_action(
    State(state): State<AppState>,
    Path(action): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let sandboxes_dir = &state.config.sandboxes_home;

    // Count sandbox directories
    let mut sandbox_count = 0u64;
    let mut sandboxes = vec![];

    if sandboxes_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(sandboxes_dir) {
            for entry in entries.flatten() {
                if let Ok(ftype) = entry.file_type() {
                    if ftype.is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        sandboxes.push(name);
                        sandbox_count += 1;
                    }
                }
            }
        }
    }

    Ok(Json(json!({
        "ok": true,
        "action": action,
        "sandboxCount": sandbox_count,
        "sandboxes": sandboxes,
        "sandboxesHome": sandboxes_dir.to_string_lossy(),
    })))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/sandboxes/lifecycle/{action}", post(sandbox_lifecycle_action))
        .with_state(state)
}
