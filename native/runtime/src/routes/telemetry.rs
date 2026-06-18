use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/telemetry/harnesses", get(harnesses))
        .with_state(state)
}

/// GET /api/telemetry/harnesses
/// Scan elegy_home for harness config directories.
/// Looks for directories matching harness patterns (*-home, *-assets).
async fn harnesses(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let elegy_home = &state.config.elegy_home;
    let mut harness_list = vec![];

    // Known harness patterns to look for
    let harness_patterns = [
        ("opencode", "opencode-home"),
        ("codex", "codex-home"),
        ("copilot", "copilot-home"),
        ("antigravity", "antigravity-home"),
    ];

    // Check elegy_home subdirectories
    if elegy_home.is_dir() {
        if let Ok(entries) = std::fs::read_dir(elegy_home) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path();

                // Look for directories matching patterns
                for (harness_id, pattern) in &harness_patterns {
                    if name.contains(pattern) || name == *harness_id {
                        harness_list.push(serde_json::json!({
                            "id": harness_id,
                            "path": path.to_string_lossy(),
                            "type": if name.contains("-assets") { "assets" } else if name.contains("-home") { "home" } else { "config" },
                        }));
                    }
                }

                // Also detect by common dir names
                let name_lower = name.to_lowercase();
                if name_lower == "opencode" || name_lower == ".opencode" {
                    harness_list.push(serde_json::json!({
                        "id": "opencode",
                        "path": path.to_string_lossy(),
                        "type": "config",
                    }));
                }
                if name_lower == "codex" || name_lower == ".codex" {
                    harness_list.push(serde_json::json!({
                        "id": "codex",
                        "path": path.to_string_lossy(),
                        "type": "config",
                    }));
                }
            }
        }
    }

    // Also check home directory for standard config dirs
    if let Some(home) = dirs::home_dir() {
        let known_harness_dirs = [
            (home.join(".config").join("opencode"), "opencode", "home"),
            (home.join(".codex"), "codex", "home"),
            (home.join(".copilot"), "copilot", "home"),
        ];

        for (dir_path, id, dir_type) in &known_harness_dirs {
            if dir_path.is_dir() {
                // Check if already added
                let already = harness_list.iter().any(|h| h["id"].as_str() == Some(id));
                if !already {
                    harness_list.push(serde_json::json!({
                        "id": id,
                        "path": dir_path.to_string_lossy(),
                        "type": dir_type,
                    }));
                }
            }
        }
    }

    Ok(Json(serde_json::json!({
        "harnesses": harness_list,
        "count": harness_list.len(),
    })))
}
