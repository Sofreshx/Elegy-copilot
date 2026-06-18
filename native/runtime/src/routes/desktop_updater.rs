use axum::extract::State;
use axum::{Json, Router};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::app::AppState;
use crate::error::ApiError;

/// Desktop updater state persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterState {
    supported: bool,
    status: String,
    channel: String,
    current_version: String,
    available_version: Option<String>,
    last_updated_at_ms: u64,
}

impl UpdaterState {
    fn default_state() -> Self {
        Self {
            supported: true,
            status: "up-to-date".to_string(),
            channel: "stable".to_string(),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            available_version: None,
            last_updated_at_ms: 0,
        }
    }

    fn status_json(&self) -> serde_json::Value {
        serde_json::json!({
            "supported": self.supported,
            "status": self.status,
            "channel": self.channel,
            "currentVersion": self.current_version,
            "availableVersion": self.available_version,
            "lastUpdatedAtMs": self.last_updated_at_ms,
        })
    }
}

/// Path to the updater state file.
fn state_path(elegy_home: &std::path::Path) -> PathBuf {
    elegy_home.join("updater").join("state.json")
}

/// Read current state from disk, or return default if file doesn't exist.
fn read_state(elegy_home: &std::path::Path) -> UpdaterState {
    let path = state_path(elegy_home);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| {
            tracing::warn!("Invalid updater state file, using defaults");
            UpdaterState::default_state()
        }),
        Err(_) => UpdaterState::default_state(),
    }
}

/// Write state to disk, creating parent directory if needed.
fn write_state(elegy_home: &std::path::Path, state: &UpdaterState) -> Result<(), String> {
    let path = state_path(elegy_home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create updater dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(state).map_err(|e| format!("Failed to serialize state: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write state: {}", e))?;
    Ok(())
}

/// Fetch latest desktop release tag from GitHub via `git ls-remote --tags`.
fn check_latest_release(owner: &str, repo: &str) -> Result<Option<String>, String> {
    let url = format!("https://github.com/{}/{}.git", owner, repo);
    let output = std::process::Command::new("git")
        .args(["ls-remote", "--tags", &url])
        .output()
        .map_err(|e| format!("git failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Collect tags matching desktop-v<semver> pattern
    let mut versions: Vec<String> = Vec::new();
    for line in stdout.lines() {
        // Tag refs look like: "abc1234\trefs/tags/desktop-v1.2.3"
        if let Some(tab_idx) = line.find('\t') {
            let ref_part = &line[tab_idx + 1..];
            let tag_name = ref_part.strip_prefix("refs/tags/").unwrap_or(ref_part);
            if tag_name.starts_with("desktop-v") {
                let ver = tag_name.strip_prefix("desktop-v").unwrap_or("");
                // Validate looks like semver: X.Y.Z (digits and dots only)
                if ver.split('.').count() >= 2
                    && ver.chars().all(|c| c.is_ascii_digit() || c == '.')
                {
                    versions.push(tag_name.to_string());
                }
            }
        }
    }

    // Sort by semver (highest last)
    versions.sort_by(|a, b| {
        let a_ver = a.strip_prefix("desktop-v").unwrap_or("");
        let b_ver = b.strip_prefix("desktop-v").unwrap_or("");
        let a_parts: Vec<u32> = a_ver.split('.').filter_map(|p| p.parse().ok()).collect();
        let b_parts: Vec<u32> = b_ver.split('.').filter_map(|p| p.parse().ok()).collect();
        for (ai, bi) in a_parts.iter().zip(b_parts.iter()) {
            if ai != bi {
                return ai.cmp(bi);
            }
        }
        a_parts.len().cmp(&b_parts.len())
    });

    Ok(versions.last().cloned())
}

/// GET /api/desktop-updater
/// Returns current updater state without `stub: true`.
async fn updater_status(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let updater_state = read_state(&state.config.elegy_home);
    Ok(Json(updater_state.status_json()))
}

/// POST /api/desktop-updater/check
/// Fetches latest version from GitHub and updates state.
async fn updater_check(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let mut updater_state = read_state(&state.config.elegy_home);
    updater_state.status = "checking".to_string();
    let _ = write_state(&state.config.elegy_home, &updater_state);

    // Extract owner/repo from the known GitHub remote
    let owner = "Sofreshx";
    let repo = "Elegy";

    match check_latest_release(owner, repo) {
        Ok(Some(latest_tag)) => {
            let latest_ver = latest_tag.strip_prefix("desktop-v").unwrap_or(&latest_tag).to_string();
            let current_ver = &updater_state.current_version;

            // Compare versions
            let update_available = {
                let cur_parts: Vec<u32> = current_ver.split('.').filter_map(|p| p.parse().ok()).collect();
                let lat_parts: Vec<u32> = latest_ver.split('.').filter_map(|p| p.parse().ok()).collect();
                // Compare part by part
                let mut available = false;
                for (ci, li) in cur_parts.iter().zip(lat_parts.iter()) {
                    if li > ci {
                        available = true;
                        break;
                    } else if li < ci {
                        break;
                    }
                }
                // If all equal up to min length, longer version is newer
                if !available && lat_parts.len() > cur_parts.len() {
                    available = true;
                }
                available
            };

            updater_state.status = if update_available {
                "update-available".to_string()
            } else {
                "up-to-date".to_string()
            };
            updater_state.available_version = Some(latest_ver);
            updater_state.last_updated_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
        }
        Ok(None) => {
            updater_state.status = "up-to-date".to_string();
            updater_state.available_version = None;
            updater_state.last_updated_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
        }
        Err(e) => {
            updater_state.status = "error".to_string();
            tracing::warn!("Failed to check for updates: {}", e);
        }
    }

    let _ = write_state(&state.config.elegy_home, &updater_state);
    Ok(Json(updater_state.status_json()))
}

/// POST /api/desktop-updater/download
/// Simulates downloading an update.
async fn updater_download(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let mut updater_state = read_state(&state.config.elegy_home);
    updater_state.status = "downloading".to_string();
    let _ = write_state(&state.config.elegy_home, &updater_state);

    // Simulated: in production this would use curl/wget or a download library
    updater_state.status = "downloaded".to_string();
    let _ = write_state(&state.config.elegy_home, &updater_state);

    Ok(Json(serde_json::json!({
        "ok": true,
        "status": "downloaded",
        "message": "Simulated download",
    })))
}

/// POST /api/desktop-updater/restart
/// Simulates restarting the app to apply the update.
async fn updater_restart(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let mut updater_state = read_state(&state.config.elegy_home);
    updater_state.status = "restarting".to_string();
    let _ = write_state(&state.config.elegy_home, &updater_state);

    Ok(Json(serde_json::json!({
        "ok": true,
        "message": "Restart initiated",
    })))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/desktop-updater", get(updater_status))
        .route("/api/desktop-updater/check", post(updater_check))
        .route("/api/desktop-updater/download", post(updater_download))
        .route("/api/desktop-updater/restart", post(updater_restart))
        .with_state(state)
}
