use axum::{Router, routing::{get, post}, extract::{State, Query}, Json};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
struct RepoPathQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

#[derive(Deserialize)]
struct InstallBody {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    #[serde(rename = "assetId")]
    asset_id: Option<String>,
    #[serde(rename = "sourcePath")]
    source_path: Option<String>,
    harness: Option<String>,
}

// Known harness names
const HARNESS_NAMES: &[&str] = &["opencode", "codex", "copilot", "antigravity"];

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/repo-assets/discover", get(discover))
        .route("/api/repo-assets/install", post(install))
        .with_state(state)
}

fn scan_assets_dir(repo_root: &Path, base_dir: &Path, results: &mut Vec<serde_json::Value>, depth: u32) {
    if depth > 8 || !base_dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "node_modules" || name == ".git" {
                continue;
            }
            let relative = path.strip_prefix(repo_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string()
                .replace('\\', "/");

            if let Ok(ftype) = entry.file_type() {
                if ftype.is_dir() {
                    scan_assets_dir(repo_root, &path, results, depth + 1);
                } else if ftype.is_file() {
                    // Match known asset patterns
                    let matched = match relative.as_str() {
                        "AGENTS.md" | "guidelines.md" => Some(("config", None)),
                        _ => {
                            // Check glob-style patterns
                            if relative.starts_with(".opencode/agents/") && relative.ends_with(".agent.md") {
                                Some(("agent", Some("opencode")))
                            } else if relative.starts_with(".opencode/skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("opencode")))
                            } else if relative.starts_with(".codex/agents/") && (relative.ends_with(".md") || relative.ends_with(".agent.md")) {
                                Some(("agent", Some("codex")))
                            } else if relative.starts_with(".codex/skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("codex")))
                            } else if relative.starts_with(".copilot/agents/") && relative.ends_with(".agent.md") {
                                Some(("agent", Some("copilot")))
                            } else if relative.starts_with(".copilot/skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("copilot")))
                            } else if (relative.starts_with(".gemini/agents/") || relative.starts_with(".antigravity/agents/")) &&
                                      (relative.ends_with(".md") || relative.ends_with(".agent.md")) {
                                Some(("agent", Some("antigravity")))
                            } else if (relative.starts_with(".gemini/skills/") || relative.starts_with(".antigravity/skills/")) &&
                                      relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("antigravity")))
                            } else if relative.starts_with("skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", None))
                            } else if relative.starts_with("agents/") && relative.ends_with(".agent.md") {
                                Some(("agent", None))
                            } else if relative.starts_with(".agents/skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("agents")))
                            } else if relative.starts_with(".github/skills/") && relative.ends_with("/SKILL.md") {
                                Some(("skill", Some("copilot")))
                            } else {
                                None
                            }
                        }
                    };

                    if let Some((kind, source_harness)) = matched {
                        if let Ok(meta) = std::fs::metadata(&path) {
                            results.push(serde_json::json!({
                                "id": relative,
                                "name": name,
                                "kind": kind,
                                "path": relative,
                                "sourceHarness": source_harness,
                                "filePath": path.to_string_lossy(),
                                "size": meta.len(),
                                "modifiedAt": meta.modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis())
                                    .unwrap_or(0),
                            }));
                        }
                    }
                }
            }
        }
    }
}

/// GET /api/repo-assets/discover?repoPath=...
/// Scan repo for .copilot directory and its contents
async fn discover(
    State(state): State<AppState>,
    Query(query): Query<RepoPathQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let repo_path = query.repo_path.unwrap_or_else(|| {
        state.config.engine_root.to_string_lossy().to_string()
    });
    let root = PathBuf::from(&repo_path);

    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let mut assets = vec![];

    // Scan root files
    for root_file in &["AGENTS.md", "guidelines.md"] {
        let full_path = root.join(root_file);
        if full_path.is_file() {
            if let Ok(meta) = std::fs::metadata(&full_path) {
                assets.push(serde_json::json!({
                    "id": root_file,
                    "name": *root_file,
                    "kind": "config",
                    "path": root_file,
                    "sourceHarness": serde_json::Value::Null,
                    "filePath": full_path.to_string_lossy(),
                    "size": meta.len(),
                    "modifiedAt": meta.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or(0),
                    "harnesses": HARNESS_NAMES.iter().map(|h| serde_json::json!({
                        "harness": h,
                        "installed": false,
                        "installedAt": null,
                    })).collect::<Vec<_>>(),
                }));
            }
        }
    }

    // Scan recursive directories
    scan_assets_dir(&root, &root, &mut assets, 0);

    // Deduplicate by id
    let mut seen = std::collections::HashSet::new();
    let unique_assets: Vec<serde_json::Value> = assets.into_iter()
        .filter(|a| {
            let id = a["id"].as_str().unwrap_or("").to_string();
            if seen.contains(&id) {
                false
            } else {
                seen.insert(id);
                true
            }
        })
        .collect();

    // Sort by path
    let mut sorted = unique_assets;
    sorted.sort_by(|a, b| {
        a["path"].as_str().unwrap_or("").cmp(b["path"].as_str().unwrap_or(""))
    });

    Ok(Json(serde_json::json!({
        "repoPath": repo_path,
        "assets": sorted,
        "availableHarnesses": HARNESS_NAMES,
        "count": sorted.len(),
    })))
}

/// POST /api/repo-assets/install
/// Read body, copy asset files from catalog to repo
async fn install(
    State(state): State<AppState>,
    Json(body): Json<InstallBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let repo_path = body.repo_path.unwrap_or_default();
    let asset_id = body.asset_id.unwrap_or_default();
    let source_path = body.source_path.unwrap_or_default();

    if repo_path.is_empty() {
        return Err(ApiError::BadRequest("repoPath is required".to_string()));
    }
    if asset_id.is_empty() {
        return Err(ApiError::BadRequest("assetId is required".to_string()));
    }

    let root = PathBuf::from(&repo_path);
    if !root.is_dir() {
        return Err(ApiError::NotFound("Repository path not found".to_string()));
    }

    let dest_path = root.join(&asset_id);

    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    if !source_path.is_empty() {
        let src = PathBuf::from(&source_path);
        if src.is_file() {
            std::fs::copy(&src, &dest_path)
                .map_err(|e| ApiError::Internal(e.into()))?;
        } else if src.is_dir() {
            // Copy directory contents recursively (simple version)
            copy_dir_recursive(&src, &dest_path)?;
        } else {
            // Create empty file as placeholder
            std::fs::write(&dest_path, "")
                .map_err(|e| ApiError::Internal(e.into()))?;
        }
    } else {
        // Use catalog source from engine_root
        let catalog_path = state.config.engine_root.join("catalog-assets").join(&asset_id);
        if catalog_path.is_file() {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| ApiError::Internal(e.into()))?;
            }
            std::fs::copy(&catalog_path, &dest_path)
                .map_err(|e| ApiError::Internal(e.into()))?;
        } else {
            // Create empty file
            std::fs::write(&dest_path, "")
                .map_err(|e| ApiError::Internal(e.into()))?;
        }
    }

    let meta = std::fs::metadata(&dest_path)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "assetId": asset_id,
        "harness": body.harness,
        "path": dest_path.to_string_lossy(),
        "size": meta.len(),
    })))
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), ApiError> {
    std::fs::create_dir_all(dest).map_err(|e| ApiError::Internal(e.into()))?;
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name();
            let dest_entry = dest.join(&name);
            if let Ok(ftype) = entry.file_type() {
                if ftype.is_dir() {
                    copy_dir_recursive(&entry_path, &dest_entry)?;
                } else if ftype.is_file() {
                    std::fs::copy(&entry_path, &dest_entry)
                        .map_err(|e| ApiError::Internal(e.into()))?;
                }
            }
        }
    }
    Ok(())
}
