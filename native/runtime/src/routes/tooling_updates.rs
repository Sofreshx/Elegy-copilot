use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::path::Path;

use crate::app::AppState;
use crate::error::ApiError;

/// Path to the tooling update state file.
fn state_path(elegy_home: &Path) -> std::path::PathBuf {
    elegy_home.join("tooling").join("update-state.json")
}

/// Read tooling state from disk, or return empty default.
#[allow(dead_code)]
fn read_tooling_state(elegy_home: &Path) -> serde_json::Value {
    let path = state_path(elegy_home);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

/// Write tooling state to disk.
fn write_tooling_state(elegy_home: &Path, state: &serde_json::Value) -> Result<(), String> {
    let path = state_path(elegy_home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create tooling dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize tooling state: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write tooling state: {}", e))?;
    Ok(())
}

/// Run a command and return its stdout as a trimmed string.
fn run_command(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", cmd, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} failed: {}", cmd, stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if a CLI tool is available and return its version string.
fn check_tool_version(tool: &str, version_flag: &str) -> (bool, Option<String>) {
    match run_command(tool, &[version_flag]) {
        Ok(version) => {
            let first_line = version.lines().next().unwrap_or("").to_string();
            (true, Some(first_line))
        }
        Err(_) => (false, None),
    }
}

/// Fetch latest elegy-planning tag from GitHub.
fn check_latest_tooling_release() -> Result<Option<String>, String> {
    let url = "https://github.com/Sofreshx/Elegy.git";
    let output = std::process::Command::new("git")
        .args(["ls-remote", "--tags", url])
        .output()
        .map_err(|e| format!("git ls-remote failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut versions: Vec<String> = Vec::new();
    for line in stdout.lines() {
        if let Some(tab_idx) = line.find('\t') {
            let ref_part = &line[tab_idx + 1..];
            let tag_name = ref_part.strip_prefix("refs/tags/").unwrap_or(ref_part);
            // Accept any semver-like tag (e.g. v1.2.3, elegy-planning-v1.2.3)
            if let Some(ver) = tag_name
                .strip_prefix("v")
                .or_else(|| tag_name.strip_prefix("elegy-planning-v"))
            {
                if ver.split('.').count() >= 2
                    && ver.chars().all(|c| c.is_ascii_digit() || c == '.')
                {
                    versions.push(ver.to_string());
                }
            }
        }
    }

    // Sort semver (highest last)
    versions.sort_by(|a, b| {
        let a_parts: Vec<u32> = a.split('.').filter_map(|p| p.parse().ok()).collect();
        let b_parts: Vec<u32> = b.split('.').filter_map(|p| p.parse().ok()).collect();
        for (ai, bi) in a_parts.iter().zip(b_parts.iter()) {
            if ai != bi {
                return ai.cmp(bi);
            }
        }
        a_parts.len().cmp(&b_parts.len())
    });

    Ok(versions.last().cloned())
}

/// Check whether npm is available.
fn check_npm_available() -> bool {
    run_command("npm", &["--version"]).is_ok()
}

/// Check whether git is available.
fn check_git_available() -> bool {
    run_command("git", &["--version"]).is_ok()
}

/// Build the tooling status response without fetching latest.
async fn build_tooling_status(_state: &AppState) -> Result<serde_json::Value, ApiError> {
    let now_iso = chrono::Utc::now().to_rfc3339();

    // Check elegy-planning
    let (planning_installed, planning_current_version) =
        check_tool_version("elegy-planning", "--version");

    // Check elegy-skills (look for it in opencode home)
    let opencode_home = dirs::config_dir()
        .map(|p| p.join("opencode"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/opencode"));
    let skills_path = opencode_home.join("skills");
    let elegy_skills_installed = skills_path.join("elegy-skills").exists()
        || skills_path.join("elegy_skills").exists();

    // Check elegy-skills-codex
    let codex_home = dirs::config_dir()
        .map(|p| p.join("codex"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/codex"));
    let codex_skills_installed = codex_home.join("skills").exists();

    // git availability (hardcoded true since we use it)
    let git_available = check_git_available();
    let npm_available = check_npm_available();

    Ok(serde_json::json!({
        "ok": true,
        "tools": {
            "elegy-planning": {
                "installed": planning_installed,
                "currentVersion": planning_current_version,
                "latestVersion": null,
                "updateAvailable": false,
            },
            "elegy-skills": {
                "installed": elegy_skills_installed,
                "updateAvailable": false,
            },
            "elegy-skills-codex": {
                "installed": codex_skills_installed,
                "updateAvailable": false,
            },
        },
        "npmAvailable": npm_available,
        "gitAvailable": git_available,
        "checkedAt": now_iso,
    }))
}

/// Build the full tooling status with latest versions fetched.
async fn build_tooling_status_with_latest(_state: &AppState) -> Result<serde_json::Value, ApiError> {
    let now_iso = chrono::Utc::now().to_rfc3339();

    // Check elegy-planning
    let (planning_installed, planning_current_version) =
        check_tool_version("elegy-planning", "--version");

    // Fetch latest version
    let planning_latest = check_latest_tooling_release().ok().flatten();
    let planning_update_available = match (&planning_current_version, &planning_latest) {
        (Some(current), Some(latest)) => {
            let cur_parts: Vec<u32> = current.split('.').filter_map(|p| p.parse().ok()).collect();
            let lat_parts: Vec<u32> = latest.split('.').filter_map(|p| p.parse().ok()).collect();
            let mut newer = false;
            for (ci, li) in cur_parts.iter().zip(lat_parts.iter()) {
                if li > ci {
                    newer = true;
                    break;
                } else if li < ci {
                    break;
                }
            }
            newer || lat_parts.len() > cur_parts.len()
        }
        _ => false,
    };

    // Check elegy-skills
    let opencode_home = dirs::config_dir()
        .map(|p| p.join("opencode"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/opencode"));
    let skills_path = opencode_home.join("skills");
    let elegy_skills_installed = skills_path.join("elegy-skills").exists()
        || skills_path.join("elegy_skills").exists();

    // Check elegy-skills-codex
    let codex_home = dirs::config_dir()
        .map(|p| p.join("codex"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/codex"));
    let codex_skills_installed = codex_home.join("skills").exists();

    let git_available = check_git_available();
    let npm_available = check_npm_available();

    Ok(serde_json::json!({
        "ok": true,
        "tools": {
            "elegy-planning": {
                "installed": planning_installed,
                "currentVersion": planning_current_version,
                "latestVersion": planning_latest,
                "updateAvailable": planning_update_available,
            },
            "elegy-skills": {
                "installed": elegy_skills_installed,
                "updateAvailable": false,
            },
            "elegy-skills-codex": {
                "installed": codex_skills_installed,
                "updateAvailable": false,
            },
        },
        "npmAvailable": npm_available,
        "gitAvailable": git_available,
        "checkedAt": now_iso,
    }))
}

/// Run `git pull` in a given repo path and return the short HEAD hash.
fn run_git_pull(repo_path: &str) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["-C", repo_path, "pull", "origin", "main"])
        .output()
        .map_err(|e| format!("git pull failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    // Get HEAD hash
    let hash = run_command("git", &["-C", repo_path, "rev-parse", "--short", "HEAD"])
        .unwrap_or_default();
    Ok(hash)
}

/// GET /api/tooling-updates/status
/// Returns current tooling status without triggering a remote check.
async fn tooling_status(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let status = build_tooling_status(&state).await?;
    Ok(Json(status))
}

/// POST /api/tooling-updates/check
/// Returns tooling status with a remote version check included.
async fn tooling_check(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let status = build_tooling_status_with_latest(&state).await?;
    // Persist the check result
    let _ = write_tooling_state(&state.config.elegy_home, &status);
    Ok(Json(status))
}

/// POST /api/tooling-updates/update/elegy-planning
/// Git pull + cargo build the elegy-planning CLI, then copy to managed-cli.
async fn update_elegy_planning(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let managed_cli_dir = state.config.elegy_home.join("managed-cli").join("planning");

    // Determine source repo path: check if there's a configured source
    let source_repo = state.config.elegy_home.join("src").join("elegy-planning");
    let source_repo_str = source_repo.to_string_lossy().to_string();

    if !source_repo.exists() {
        return Err(ApiError::BadRequest(format!(
            "Source repository not found at {}. Configure a git source first.",
            source_repo_str
        )));
    }

    // Git pull
    let hash = run_git_pull(&source_repo_str)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Git pull failed: {}", e)))?;

    // Cargo build (release)
    let build_output = std::process::Command::new("cargo")
        .args([
            "build",
            "-p",
            "elegy-planning",
            "--release",
            "--manifest-path",
            &source_repo.join("Cargo.toml").to_string_lossy().to_string(),
        ])
        .output()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("cargo build failed: {}", e)))?;

    if !build_output.status.success() {
        let stderr = String::from_utf8_lossy(&build_output.stderr);
        return Err(ApiError::Internal(anyhow::anyhow!(
            "cargo build failed: {}",
            stderr
        )));
    }

    // Copy binary to managed-cli directory
    std::fs::create_dir_all(&managed_cli_dir)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to create managed-cli dir: {}", e)))?;

    // Find the built binary
    let release_binary = source_repo
        .join("target")
        .join("release")
        .join("elegy-planning");
    let target_binary = managed_cli_dir.join("elegy-planning");

    if release_binary.exists() {
        std::fs::copy(&release_binary, &target_binary)
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to copy binary: {}", e)))?;
    } else {
        // On Windows, try with .exe extension
        let release_binary_exe = source_repo
            .join("target")
            .join("release")
            .join("elegy-planning.exe");
        let target_binary_exe = managed_cli_dir.join("elegy-planning.exe");
        if release_binary_exe.exists() {
            std::fs::copy(&release_binary_exe, &target_binary_exe)
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to copy binary: {}", e)))?;
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "updated": true,
        "version": hash,
        "message": "Update complete",
    })))
}

/// POST /api/tooling-updates/update/elegy-skills
/// Sync skill assets from source to opencode home.
async fn update_elegy_skills(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let source_skills = state.config.engine_root.join("opencode-assets").join("skills");
    let opencode_home = dirs::config_dir()
        .map(|p| p.join("opencode"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/opencode"));
    let target_dir = opencode_home.join("skills");

    if source_skills.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to create skills dir: {}", e)))?;

        // Copy each skill from source
        if let Ok(entries) = std::fs::read_dir(&source_skills) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let target_path = target_dir.join(&file_name);
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    copy_dir_recursive(&entry.path(), &target_path)
                        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to copy skill: {}", e)))?;
                } else {
                    let _ = std::fs::copy(entry.path(), &target_path);
                }
            }
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "updated": true,
        "message": "Skills synced from source",
    })))
}

/// POST /api/tooling-updates/update/elegy-skills-codex
/// Sync skill assets from source to codex home.
async fn update_elegy_skills_codex(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let source_skills = state.config.engine_root.join("codex-assets").join("skills");
    let codex_home = dirs::config_dir()
        .map(|p| p.join("codex"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/codex"));
    let target_dir = codex_home.join("skills");

    if source_skills.exists() {
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to create codex skills dir: {}", e)))?;

        if let Ok(entries) = std::fs::read_dir(&source_skills) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let target_path = target_dir.join(&file_name);
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    copy_dir_recursive(&entry.path(), &target_path)
                        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to copy codex skill: {}", e)))?;
                } else {
                    let _ = std::fs::copy(entry.path(), &target_path);
                }
            }
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "updated": true,
        "message": "Codex skills synced from source",
    })))
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if dst.exists() {
        std::fs::remove_dir_all(dst)?;
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tooling-updates/status", get(tooling_status))
        .route("/api/tooling-updates/check", post(tooling_check))
        .route(
            "/api/tooling-updates/update/elegy-planning",
            post(update_elegy_planning),
        )
        .route(
            "/api/tooling-updates/update/elegy-skills",
            post(update_elegy_skills),
        )
        .route(
            "/api/tooling-updates/update/elegy-skills-codex",
            post(update_elegy_skills_codex),
        )
        .with_state(state)
}
