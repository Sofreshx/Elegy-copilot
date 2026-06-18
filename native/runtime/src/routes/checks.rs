use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post};
use chrono::Utc;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
#[allow(dead_code)]
struct ChecksQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/git/checks/discover", get(checks_discover))
        .route("/api/git/checks/run", post(checks_run))
        .route("/api/git/checks/state", get(checks_state))
        .route("/api/git/checks/ci-sync", get(checks_ci_sync))
        .with_state(state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn resolve_root(state: &AppState, repo_path: Option<String>) -> PathBuf {
    repo_path
        .map(PathBuf::from)
        .unwrap_or_else(|| state.config.engine_root.clone())
}

/// Recursively find all YAML files in a directory
fn find_yml_files(dir: &Path) -> Vec<String> {
    let mut files = vec![];
    if !dir.is_dir() {
        return files;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "yml" || ext == "yaml" {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            files.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    files
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/// GET /api/git/checks/discover?repoPath=...
/// Look for .copilot/commit-checks.json or .github/commit-checks.json
async fn checks_discover(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let check_configs = [
        (".copilot/commit-checks.json", "copilot"),
        (".github/commit-checks.json", "github"),
    ];

    let mut checks = vec![];

    for (rel_path, source) in &check_configs {
        let full_path = root.join(rel_path);
        if full_path.is_file() {
            let content = std::fs::read_to_string(&full_path).ok();
            let parsed = content.as_deref().and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok());
            checks.push(serde_json::json!({
                "path": rel_path,
                "source": source,
                "exists": true,
                "config": parsed,
            }));
        } else {
            checks.push(serde_json::json!({
                "path": rel_path,
                "source": source,
                "exists": false,
            }));
        }
    }

    Ok(Json(serde_json::json!({
        "checks": checks,
        "count": checks.len(),
    })))
}

/// POST /api/git/checks/run
///
/// Body: `{ "repoPath": "..." }` (optional).
/// Discovers check config files, runs each check script, and persists results.
async fn checks_run(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let repo_path = body
        .get("repoPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let root = resolve_root(&state, repo_path.clone());
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    // Discover check config files (same paths as checks_discover)
    let check_configs = [
        root.join(".copilot").join("commit-checks.json"),
        root.join(".github").join("commit-checks.json"),
    ];

    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut all_passed = true;

    for config_path in &check_configs {
        if !config_path.is_file() {
            continue;
        }

        let content =
            std::fs::read_to_string(config_path).map_err(|e| ApiError::Internal(e.into()))?;
        let config: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                results.push(serde_json::json!({
                    "check": config_path.to_string_lossy(),
                    "passed": false,
                    "output": format!("Failed to parse config: {}", e),
                }));
                all_passed = false;
                continue;
            }
        };

        // Extract check entries — support multiple formats
        let entries: Vec<(String, String)> = {
            let mut entries = Vec::new();

            // Format 1: { "checks": [{ "name": "...", "command": "..." }] }
            if let Some(checks) = config.get("checks").and_then(|v| v.as_array()) {
                for check in checks {
                    let name = check
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unnamed")
                        .to_string();
                    let command = check
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            check
                                .get("script")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        })
                        .or_else(|| {
                            check
                                .get("run")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        });
                    if let Some(cmd) = command {
                        entries.push((name, cmd));
                    }
                }
            }

            // Format 2: { "scripts": ["cmd1", "cmd2"] }
            if let Some(scripts) = config.get("scripts").and_then(|v| v.as_array()) {
                for (i, script) in scripts.iter().enumerate() {
                    if let Some(cmd) = script.as_str() {
                        entries.push((format!("script_{}", i + 1), cmd.to_string()));
                    }
                }
            }

            // Format 3: { "commands": [{ "name": ..., "run": ... }] }
            if let Some(commands) = config.get("commands").and_then(|v| v.as_array()) {
                for cmd_entry in commands {
                    let name = cmd_entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unnamed")
                        .to_string();
                    let command = cmd_entry
                        .get("run")
                        .and_then(|v| v.as_str())
                        .or_else(|| cmd_entry.get("command").and_then(|v| v.as_str()))
                        .map(|s| s.to_string());
                    if let Some(cmd) = command {
                        entries.push((name, cmd));
                    }
                }
            }

            entries
        };

        for (name, cmd) in &entries {
            let start = std::time::Instant::now();
            let timeout = Duration::from_secs(60);

            // Run the command
            let output = Command::new(if cfg!(target_os = "windows") {
                "cmd"
            } else {
                "sh"
            })
            .arg(if cfg!(target_os = "windows") { "/C" } else { "-c" })
            .arg(cmd)
            .current_dir(&root)
            .output()
            .map_err(|e| ApiError::Internal(e.into()))?;

            let elapsed = start.elapsed();
            let passed = output.status.success();
            if !passed {
                all_passed = false;
            }

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let output_text = if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n{}", stdout, stderr)
            };

            let timed_out = elapsed > timeout;
            if timed_out {
                all_passed = false;
            }

            results.push(serde_json::json!({
                "check": name,
                "passed": passed && !timed_out,
                "output": if output_text.is_empty() && passed {
                    "OK".to_string()
                } else {
                    output_text
                },
                "durationMs": elapsed.as_millis(),
                "command": cmd,
            }));
        }
    }

    // Write results to .copilot/check-state.json
    let state_dir = root.join(".copilot");
    std::fs::create_dir_all(&state_dir).map_err(|e| ApiError::Internal(e.into()))?;
    let state_path = state_dir.join("check-state.json");
    let state_value = serde_json::json!({
        "ok": all_passed,
        "passed": all_passed,
        "results": results,
        "completedAt": Utc::now().to_rfc3339(),
    });
    let state_content =
        serde_json::to_string_pretty(&state_value).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&state_path, state_content).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": all_passed,
        "results": results,
        "stateFile": ".copilot/check-state.json",
    })))
}

/// GET /api/git/checks/state?repoPath=...
/// Read checks state from .copilot/check-state.json
async fn checks_state(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let state_path = root.join(".copilot").join("check-state.json");
    if state_path.is_file() {
        match std::fs::read_to_string(&state_path) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(state_value) => {
                        Ok(Json(serde_json::json!({
                            "state": state_value,
                            "path": ".copilot/check-state.json",
                            "exists": true,
                        })))
                    }
                    Err(_) => {
                        // Return raw content if not valid JSON
                        Ok(Json(serde_json::json!({
                            "state": "invalid",
                            "path": ".copilot/check-state.json",
                            "exists": true,
                            "raw": content,
                        })))
                    }
                }
            }
            Err(e) => Err(ApiError::Internal(e.into())),
        }
    } else {
        Ok(Json(serde_json::json!({
            "state": "unknown",
            "exists": false,
        })))
    }
}

/// GET /api/git/checks/ci-sync?repoPath=...
/// Check CI config files (.github/workflows/)
async fn checks_ci_sync(
    State(state): State<AppState>,
    Query(query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let root = resolve_root(&state, query.repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let workflows_dir = root.join(".github").join("workflows");
    let workflow_files = find_yml_files(&workflows_dir);

    Ok(Json(serde_json::json!({
        "ciSync": {
            "hasWorkflowsDir": workflows_dir.is_dir(),
            "workflowCount": workflow_files.len(),
            "workflowFiles": workflow_files,
        }
    })))
}
