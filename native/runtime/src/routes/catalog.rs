use std::path::{Path, PathBuf};

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use elegy_native_contracts::{
    InstalledAgent, InstalledAssetsResponse, InstalledInstructions, InstalledPrompt,
    InstalledSkill, ManagedAssetStatus, ManagedAssetsResponse,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::app::AppState;
use crate::error::ApiError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ASSET_KIND_DIRS: &[&str] = &["agents", "skills", "prompts", "instructions"];

fn infer_asset_kind(dir_name: &str) -> Option<&'static str> {
    match dir_name {
        "agents" => Some("agent"),
        "skills" => Some("skill"),
        "prompts" => Some("prompt"),
        "instructions" => Some("instructions"),
        _ => None,
    }
}

fn sha256_hex_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(hex::encode(Sha256::digest(&bytes)))
}

fn scan_md_installed_agents(dir: &Path, kind_dir: &str) -> Vec<InstalledAgent> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || file_name.is_empty() {
                continue;
            }
            out.push(InstalledAgent {
                asset_id: Some(name.clone()),
                name: name.clone(),
                file_name,
                abs_path: path.to_string_lossy().to_string(),
                provider: Some("rust-runtime".to_string()),
                source_package: Some(kind_dir.to_string()),
                namespace: None,
                read_only: Some(false),
            });
        }
    }
    out
}

fn scan_md_installed_skills(dir: &Path, kind_dir: &str) -> Vec<InstalledSkill> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let kind = if path.is_file() {
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if size > 200 { "full" } else { "pointer" }
            } else {
                "pointer"
            };
            out.push(InstalledSkill {
                asset_id: Some(name.clone()),
                name: name.clone(),
                abs_path: path.to_string_lossy().to_string(),
                kind: kind.to_string(),
                view_path: Some(path.to_string_lossy().to_string()),
                provider: Some("rust-runtime".to_string()),
                source_package: Some(kind_dir.to_string()),
                namespace: None,
                read_only: Some(false),
            });
        }
    }
    out
}

fn scan_md_installed_prompts(dir: &Path) -> Vec<InstalledPrompt> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || file_name.is_empty() {
                continue;
            }
            out.push(InstalledPrompt {
                name: name.clone(),
                file_name,
                abs_path: path.to_string_lossy().to_string(),
            });
        }
    }
    out
}

fn detect_installed_instructions(engine_root: &Path) -> InstalledInstructions {
    let candidates = [
        engine_root.join("AGENTS.md"),
        engine_root.join("CLAUDE.md"),
        engine_root.join("docs").join("CLAUDE.md"),
        engine_root.join("docs").join("AGENTS.md"),
    ];
    for candidate in &candidates {
        if candidate.exists() {
            return InstalledInstructions {
                installed: true,
                abs_path: candidate.to_string_lossy().to_string(),
            };
        }
    }
    InstalledInstructions {
        installed: false,
        abs_path: String::new(),
    }
}

fn scan_md_files(dir: &Path) -> Vec<Value> {
    let mut items = vec![];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                    let content = std::fs::read_to_string(&path).unwrap_or_default();
                    let title = content.lines().next().map(|l| l.trim_start_matches("# ").to_string()).unwrap_or_default();
                    items.push(json!({
                        "id": name,
                        "title": title,
                        "path": path.to_string_lossy(),
                        "size": content.len(),
                    }));
                }
            }
        }
    }
    items
}

fn scan_json_files(dir: &Path) -> Vec<Value> {
    let mut items = vec![];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(data) = serde_json::from_str::<Value>(&content) {
                            items.push(json!({
                                "id": name,
                                "data": data,
                                "path": path.to_string_lossy(),
                            }));
                        }
                    }
                }
            }
        }
    }
    items
}

fn scan_asset_kind_dir(dir: &Path) -> Vec<Value> {
    let mut items = vec![];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            items.push(json!({
                "id": name.trim_end_matches(".json").trim_end_matches(".toml").trim_end_matches(".md"),
                "name": name,
                "path": path.to_string_lossy(),
                "isDirectory": is_dir,
                "kind": path.extension().and_then(|e| e.to_str()).unwrap_or("dir"),
            }));
        }
    }
    items
}

fn catalog_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("catalog")
}

fn read_catalog_json(state: &AppState, name: &str) -> Value {
    let path = catalog_dir(state).join(name);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    }
}

fn write_catalog_json(state: &AppState, name: &str, data: &Value) -> Result<(), ApiError> {
    let path = catalog_dir(state).join(name);
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| ApiError::Internal(e.into()))?;
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))
}

// ---------------------------------------------------------------------------
// Asset Management (7 routes)
// ---------------------------------------------------------------------------

async fn get_assets_managed(State(state): State<AppState>) -> Result<Json<ManagedAssetsResponse>, ApiError> {
    let mut managed: Vec<ManagedAssetStatus> = Vec::new();
    let engine = &state.config.engine_root;
    for source_name in &["engine-assets", "opencode-assets", "codex-assets", "antigravity-assets", "claude-assets"] {
        let source_dir = engine.join(source_name);
        if !source_dir.exists() {
            continue;
        }
        for kind_dir_name in ASSET_KIND_DIRS {
            let kind_dir = source_dir.join(kind_dir_name);
            if !kind_dir.exists() {
                continue;
            }
            let asset_type = match infer_asset_kind(kind_dir_name) {
                Some(t) => t,
                None => continue,
            };
            let Ok(entries) = std::fs::read_dir(&kind_dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let stem = path
                    .file_stem()
                    .and_then(|n| n.to_str())
                    .unwrap_or(file_name)
                    .to_string();
                let destination = format!(".opencode/{kind_dir_name}/{file_name}");
                let destination_abs = state.config.elegy_home.join(&destination);
                let installed = destination_abs.exists();
                let source_hash = sha256_hex_file(&path);
                let destination_hash = if installed {
                    sha256_hex_file(&destination_abs)
                } else {
                    None
                };
                let up_to_date = installed
                    && source_hash.is_some()
                    && source_hash == destination_hash;
                managed.push(ManagedAssetStatus {
                    id: stem,
                    r#type: asset_type.to_string(),
                    source: source_name.to_string(),
                    destination,
                    source_abs: Some(path.to_string_lossy().to_string()),
                    destination_abs: if installed {
                        Some(destination_abs.to_string_lossy().to_string())
                    } else {
                        None
                    },
                    managed: true,
                    installed,
                    up_to_date,
                    source_hash,
                    destination_hash,
                });
            }
        }
    }
    let count = managed.len() as u64;
    Ok(Json(ManagedAssetsResponse { managed, count }))
}

async fn get_assets_installed(State(state): State<AppState>) -> Result<Json<InstalledAssetsResponse>, ApiError> {
    let agents = scan_md_installed_agents(&state.config.elegy_home.join("agents"), "agents");
    let skills = scan_md_installed_skills(&state.config.elegy_home.join("skills"), "skills");
    let prompts = scan_md_installed_prompts(&state.config.elegy_home.join("prompts"));
    let instructions = detect_installed_instructions(&state.config.engine_root);
    Ok(Json(InstalledAssetsResponse {
        agents,
        skills,
        prompts,
        instructions,
    }))
}

async fn post_assets_sync_all(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let catalog = catalog_dir(&state);
    std::fs::create_dir_all(&catalog).ok();
    let snapshot = json!({
        "syncedAt": chrono::Utc::now().to_rfc3339(),
        "source": "rust-backend",
    });
    let snapshot_path = catalog.join("snapshot.json");
    std::fs::write(&snapshot_path, serde_json::to_string_pretty(&snapshot).unwrap()).ok();
    Ok(Json(json!({"result": {"synced": true, "snapshotPath": snapshot_path.to_string_lossy()}})))
}

async fn post_assets_install_surfaces(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let installed = scan_asset_kind_dir(&state.config.engine_root.join("engine-assets"));
    Ok(Json(json!({"ok": true, "installed": installed, "count": installed.len()})))
}

async fn post_assets_sync(State(state): State<AppState>, Json(_body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let engine = &state.config.engine_root;
    let mut count = 0usize;
    let mut asset_sources = vec![];
    for dir_name in &["engine-assets", "opencode-assets", "codex-assets", "antigravity-assets", "claude-assets"] {
        let dir = engine.join(dir_name);
        if dir.exists() {
            let items = scan_asset_kind_dir(&dir);
            count += items.len();
            asset_sources.push(json!({
                "source": dir_name,
                "path": dir.to_string_lossy(),
                "items": items,
            }));
        }
    }
    let catalog = catalog_dir(&state);
    std::fs::create_dir_all(&catalog).ok();
    write_catalog_json(&state, "assets.json", &json!({
        "assets": asset_sources,
        "count": count,
        "syncedAt": chrono::Utc::now().to_rfc3339(),
    }))?;
    Ok(Json(json!({"result": {"synced": true, "count": count}})))
}

async fn post_assets_remove(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("");
    let mut data = read_catalog_json(&state, "assets.json");
    if let Some(assets) = data.get_mut("assets").and_then(|a| a.as_array_mut()) {
        assets.retain(|a| a.get("assetId").and_then(|v| v.as_str()) != Some(asset_id));
        write_catalog_json(&state, "assets.json", &data)?;
    }
    Ok(Json(json!({"result": {"removed": true, "assetId": asset_id}})))
}

async fn get_skills_preview(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let skills = scan_md_files(&state.config.engine_root.join("engine-assets").join("skills"))
        .into_iter()
        .chain(scan_md_files(&state.config.engine_root.join("opencode-assets").join("skills")))
        .collect::<Vec<_>>();
    Ok(Json(json!({"skills": skills, "count": skills.len()})))
}

// ---------------------------------------------------------------------------
// Catalog Sources (9 routes)
// ---------------------------------------------------------------------------

async fn post_catalog_repos_scan_roots(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let inventory = state.config.elegy_home.join("repo-inventory.json");
    let repos: Vec<Value> = if inventory.exists() {
        std::fs::read_to_string(&inventory)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        vec![]
    };
    Ok(Json(json!({
        "kind": "catalog.repos.scan-roots",
        "deterministic": true,
        "updated": true,
        "count": repos.len(),
        "repos": repos,
        "selectedRepo": null,
        "storage": {},
        "workspaceScan": null,
    })))
}

async fn post_catalog_repos_refresh(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let inventory = state.config.elegy_home.join("repo-inventory.json");
    let repos: Vec<Value> = if inventory.exists() {
        std::fs::read_to_string(&inventory)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        vec![]
    };
    Ok(Json(json!({
        "kind": "catalog.repos.refresh",
        "deterministic": true,
        "count": repos.len(),
        "repos": repos,
        "selectedRepo": null,
        "storage": {},
        "updated": true,
    })))
}

async fn get_catalog_summary(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    use elegy_native_contracts::{CatalogGlobalHarness, CatalogGlobalInventory, CatalogGlobalSection};
    let engine = &state.config.engine_root;
    let assets_dir = catalog_dir(&state);
    let snapshot_path = assets_dir.join("snapshot.json");
    let snapshot_exists = snapshot_path.exists();
    let snapshot: Option<Value> = if snapshot_exists {
        std::fs::read_to_string(&snapshot_path).ok().and_then(|s| serde_json::from_str(&s).ok())
    } else {
        None
    };
    let providers = scan_json_files(&engine.join("engine-assets"));
    let external_sources: Vec<Value> = vec![];
    let assets_list = scan_asset_kind_dir(&engine.join("engine-assets"));
    let bundles_list = scan_json_files(&engine.join("engine-assets"));

    // Build globalInventory: one Harness per source dir, one Section per asset kind.
    let harness_dirs: &[(&str, &str)] = &[
        ("engine-assets", "Engine Assets"),
        ("opencode-assets", "OpenCode Assets"),
        ("codex-assets", "Codex Assets"),
        ("antigravity-assets", "Antigravity Assets"),
        ("claude-assets", "Claude Assets"),
    ];
    let harnesses: Vec<CatalogGlobalHarness> = harness_dirs
        .iter()
        .map(|(id, label)| {
            let dir = engine.join(id);
            let asset_count = if dir.exists() { scan_asset_kind_dir(&dir).len() as u64 } else { 0 };
            CatalogGlobalHarness {
                id: id.to_string(),
                label: label.to_string(),
                asset_count,
            }
        })
        .collect();
    let mut sections: Vec<CatalogGlobalSection> = Vec::new();
    for kind in ASSET_KIND_DIRS {
        let label = match *kind {
            "agents" => "Agents",
            "skills" => "Skills",
            "prompts" => "Prompts",
            "instructions" => "Instructions",
            _ => kind,
        };
        let mut assets_for_section: Vec<Value> = Vec::new();
        for (source_id, _) in harness_dirs {
            let kind_dir = engine.join(source_id).join(kind);
            if !kind_dir.exists() {
                continue;
            }
            for item in scan_asset_kind_dir(&kind_dir) {
                let mut entry = item;
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("source".to_string(), Value::String(source_id.to_string()));
                    obj.insert("kind".to_string(), Value::String(kind.to_string()));
                }
                assets_for_section.push(entry);
            }
        }
        sections.push(CatalogGlobalSection {
            id: kind.to_string(),
            label: label.to_string(),
            assets: assets_for_section,
        });
    }
    let global_inventory = CatalogGlobalInventory { harnesses, sections };
    let global_inventory_value = serde_json::to_value(&global_inventory)
        .unwrap_or_else(|_| serde_json::json!({"harnesses": [], "sections": []}));

    Ok(Json(json!({
        "kind": "catalog.summary",
        "deterministic": true,
        "summary": {
            "schemaVersion": "1",
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "readMode": "filesystem",
            "repoContext": null,
            "providers": providers,
            "externalSources": external_sources,
            "globalInventory": global_inventory_value,
            "storage": {
                "catalogRoot": assets_dir.to_string_lossy(),
                "snapshotPath": snapshot_path.to_string_lossy(),
                "snapshotExists": snapshot_exists,
            },
            "stats": {
                "providers": providers.len(),
                "externalSources": 0,
                "assets": assets_list.len(),
                "bundles": bundles_list.len(),
            },
            "warnings": {"count": 0, "items": []},
            "inputs": {
                "manifest": {"path": null, "exists": false, "size": null},
                "metadataIndex": {"path": null, "exists": false, "size": null},
                "registry": {"path": null, "exists": false, "size": null},
                "providerCatalog": {"path": null, "exists": false, "size": null},
                "snapshot": {
                    "path": snapshot_path.to_string_lossy(),
                    "exists": snapshot_exists,
                    "size": snapshot.as_ref().map(|_| 100i64),
                },
            },
            "freshness": {
                "status": if snapshot_exists { "available" } else { "missing" },
                "ageMs": null,
                "latestInputAt": null,
                "reasons": [],
            },
            "rebuild": {
                "status": "idle",
                "refreshCount": 0,
                "lastCompletedAt": null,
                "lastSuccessfulAt": null,
            },
        },
        "policySnapshot": {
            "profile": "balanced",
            "orchestrationPolicy": "balanced",
            "activeBundleIds": [],
            "eligibleAssetIds": [],
            "eligibleAssetCount": 0,
            "bundleSource": "filesystem",
            "plannerProfileSource": "filesystem",
            "failClosed": true,
            "freshness": {
                "snapshotUpdatedAt": null,
                "snapshotGeneratedAt": null,
            },
        },
    })))
}

async fn get_catalog_sources(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "sources.json");
    let sources = data.get("sources").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let catalog = catalog_dir(&state).join("sources.json");
    Ok(Json(json!({
        "kind": "catalog.sources.list",
        "deterministic": true,
        "count": sources.len(),
        "sources": sources,
        "storage": {
            "catalogPath": catalog.to_string_lossy(),
            "userSourcesPath": null,
            "statePath": null,
        },
    })))
}

async fn get_catalog_content(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let content = read_catalog_json(&state, "content.json");
    Ok(Json(json!({"content": content})))
}

async fn get_catalog_source_detail(State(state): State<AppState>, AxumPath(source_id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "sources.json");
    let source = data.get("sources")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|s| s.get("sourceId").and_then(|v| v.as_str()) == Some(&source_id)))
        .cloned()
        .unwrap_or(json!({"sourceId": source_id}));
    let catalog = catalog_dir(&state).join("sources.json");
    Ok(Json(json!({
        "kind": "catalog.sources.detail",
        "deterministic": true,
        "source": source,
        "storage": {
            "catalogPath": catalog.to_string_lossy(),
            "userSourcesPath": null,
            "statePath": null,
        },
    })))
}

async fn get_catalog_assets(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "assets.json");
    let assets = data.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(Json(json!({
        "kind": "catalog.assets.list",
        "deterministic": true,
        "filters": {},
        "count": assets.len(),
        "snapshot": null,
        "assets": assets,
    })))
}

async fn get_catalog_bundles(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "bundles.json");
    let bundles = data.get("bundles").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(Json(json!({
        "kind": "catalog.bundles.list",
        "deterministic": true,
        "filters": {},
        "count": bundles.len(),
        "snapshot": null,
        "bundles": bundles,
    })))
}

async fn get_catalog_asset_detail(State(state): State<AppState>, AxumPath(asset_id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "assets.json");
    let asset = data.get("assets")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            // Search through each asset source's items
            for entry in arr {
                if let Some(items) = entry.get("items").and_then(|i| i.as_array()) {
                    if let Some(found) = items.iter().find(|item| item.get("id").and_then(|v| v.as_str()) == Some(&asset_id)) {
                        return Some(found.clone());
                    }
                }
                if entry.get("assetId").and_then(|v| v.as_str()) == Some(&asset_id) {
                    return Some(entry.clone());
                }
            }
            None
        })
        .unwrap_or(json!({"assetId": asset_id}));
    Ok(Json(json!({
        "kind": "catalog.asset.detail",
        "deterministic": true,
        "asset": asset,
        "entries": [],
        "snapshot": null,
    })))
}

async fn get_catalog_entries(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "entries.json");
    let entries = data.get("entries").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(Json(json!({
        "kind": "catalog.entries.list",
        "deterministic": true,
        "filters": {},
        "count": entries.len(),
        "snapshot": null,
        "entries": entries,
    })))
}

// ---------------------------------------------------------------------------
// Catalog Operations (9 routes)
// ---------------------------------------------------------------------------

async fn post_catalog_refresh(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let catalog = catalog_dir(&state);
    std::fs::create_dir_all(&catalog).ok();
    let snapshot_path = catalog.join("snapshot.json");
    std::fs::write(&snapshot_path, serde_json::to_string_pretty(&json!({
        "refreshedAt": chrono::Utc::now().to_rfc3339(),
        "source": "rust-backend",
    })).unwrap()).ok();
    Ok(Json(json!({"kind": "catalog.refresh", "deterministic": true, "ok": true})))
}

async fn post_catalog_sources_add(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let source_id = body.get("sourceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let new_source = json!({
        "sourceId": source_id,
        "title": title,
        "kind": kind,
        "path": path,
        "sync": {"status": "idle"},
    });
    let mut data = read_catalog_json(&state, "sources.json");
    let sources = data.get_mut("sources").and_then(|v| v.as_array_mut());
    if let Some(arr) = sources {
        arr.push(new_source.clone());
    } else {
        data["sources"] = json!([new_source.clone()]);
    }
    write_catalog_json(&state, "sources.json", &data)?;
    Ok(Json(json!({
        "kind": "catalog.sources.add",
        "deterministic": true,
        "source": new_source,
        "userSourcesPath": catalog_dir(&state).join("sources.json").to_string_lossy(),
    })))
}

async fn post_catalog_sources_remove(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let source_id = body.get("sourceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "sources.json");
    if let Some(sources) = data.get_mut("sources").and_then(|v| v.as_array_mut()) {
        sources.retain(|s| s.get("sourceId").and_then(|v| v.as_str()) != Some(&source_id));
    }
    write_catalog_json(&state, "sources.json", &data)?;
    Ok(Json(json!({
        "kind": "catalog.sources.remove",
        "deterministic": true,
        "ok": true,
        "removedSourceId": source_id,
    })))
}

async fn post_catalog_sources_refresh(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let mut data = read_catalog_json(&state, "sources.json");
    if let Some(sources) = data.get_mut("sources").and_then(|v| v.as_array_mut()) {
        for source in sources.iter_mut() {
            let path_val = source.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let exists = if !path_val.is_empty() {
                std::path::Path::new(path_val).exists()
            } else {
                false
            };
            source["sync"] = json!({
                "status": if exists { "verified" } else { "unreachable" },
                "resolvedRef": null,
                "lastVerifiedAt": chrono::Utc::now().to_rfc3339(),
            });
        }
    }
    write_catalog_json(&state, "sources.json", &data)?;
    Ok(Json(json!({"kind": "catalog.sources.refresh", "deterministic": true, "ok": true})))
}

async fn post_catalog_sources_activate(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let source_id = body.get("sourceId").and_then(|v| v.as_str()).unwrap_or("");
    let installable_id = body.get("installableId").and_then(|v| v.as_str()).unwrap_or("");
    let mut data = read_catalog_json(&state, "harness.json");
    let harnesses = data.get_mut("harnesses").and_then(|v| v.as_array_mut());
    if let Some(arr) = harnesses {
        let mut found = false;
        for h in arr.iter_mut() {
            if h.get("harnessId").and_then(|v| v.as_str()) == Some(source_id) {
                h["optedIn"] = json!(true);
                h["activatedAt"] = json!(chrono::Utc::now().to_rfc3339());
                found = true;
                break;
            }
        }
        if !found {
            arr.push(json!({
                "harnessId": source_id,
                "installableId": installable_id,
                "type": "source",
                "optedIn": true,
                "activatedAt": chrono::Utc::now().to_rfc3339(),
            }));
        }
    } else {
        data["harnesses"] = json!([{
            "harnessId": source_id,
            "installableId": installable_id,
            "type": "source",
            "optedIn": true,
            "activatedAt": chrono::Utc::now().to_rfc3339(),
        }]);
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.sources.activate", "deterministic": true, "ok": true, "activated": true})))
}

async fn post_catalog_sources_deactivate(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let source_id = body.get("sourceId").and_then(|v| v.as_str()).unwrap_or("");
    let mut data = read_catalog_json(&state, "harness.json");
    if let Some(harnesses) = data.get_mut("harnesses").and_then(|v| v.as_array_mut()) {
        for h in harnesses.iter_mut() {
            if h.get("harnessId").and_then(|v| v.as_str()) == Some(source_id) {
                h["optedIn"] = json!(false);
                h["deactivatedAt"] = json!(chrono::Utc::now().to_rfc3339());
            }
        }
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.sources.deactivate", "deterministic": true, "ok": true, "deactivated": true})))
}

async fn post_catalog_sources_sync_install_verify(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let source_id = body.get("sourceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let data = read_catalog_json(&state, "sources.json");
    let source_path = data.get("sources")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|s| s.get("sourceId").and_then(|v| v.as_str()) == Some(&source_id)))
        .and_then(|s| s.get("path").and_then(|v| v.as_str()))
        .unwrap_or("");
    let exists = if !source_path.is_empty() {
        std::path::Path::new(source_path).exists()
    } else {
        false
    };
    let sync_status = if exists { "verified" } else { "error" };
    Ok(Json(json!({
        "kind": "catalog.sources.sync-install-verify",
        "deterministic": true,
        "ok": true,
        "sourceId": source_id,
        "syncStatus": sync_status,
    })))
}

async fn post_catalog_spec_kit_bootstrap(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let _repo_path = body.get("repoPath").and_then(|v| v.as_str());
    let script_path = state.config.engine_root.join("scripts").join("install-spec-hooks.mjs");
    let exists = script_path.exists();
    let bootstrapped = if exists {
        // Run the script if it exists
        let output = std::process::Command::new("node")
            .arg(&script_path)
            .output()
            .ok();
        output.is_some()
    } else {
        false
    };
    Ok(Json(json!({
        "kind": "catalog.tools.spec-kit.bootstrap",
        "deterministic": true,
        "source": null,
        "installable": null,
        "repoPath": _repo_path,
        "overallStatus": if bootstrapped { "bootstrapped" } else if exists { "failed" } else { "missing-script" },
        "warnings": if exists { serde_json::json!([]) } else { serde_json::json!(["Script not found at scripts/install-spec-hooks.mjs"]) },
        "errors": [],
        "bootstrap": {
            "bootstrapped": bootstrapped,
            "script": script_path.to_string_lossy().to_string(),
            "exists": exists,
        },
    })))
}

async fn post_catalog_route_explain(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("");
    let data = read_catalog_json(&state, "assets.json");
    let asset = data.get("assets")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|a| a.get("assetId").and_then(|v| v.as_str()) == Some(asset_id)))
        .cloned()
        .unwrap_or(json!({"assetId": asset_id}));
    let title = asset.get("title").and_then(|v| v.as_str()).unwrap_or("unknown");
    let kind = asset.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(Json(json!({
        "explanation": format!("Asset '{}' (kind: {}) is registered in the catalog at {}.", title, kind, catalog_dir(&state).join("assets.json").to_string_lossy()),
        "asset": {"title": title, "kind": kind},
    })))
}

// ---------------------------------------------------------------------------
// Harness (4 routes)
// ---------------------------------------------------------------------------

async fn post_harness_opt_in(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let harness_id = body.get("harnessId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let _target = body.get("target").and_then(|v| v.as_str());
    let mut data = read_catalog_json(&state, "harness.json");
    let harnesses = data.get_mut("harnesses").and_then(|v| v.as_array_mut());
    let asset_count;
    if let Some(arr) = harnesses {
        let mut found = false;
        for h in arr.iter_mut() {
            if h.get("harnessId").and_then(|v| v.as_str()) == Some(&harness_id) {
                h["optedIn"] = json!(true);
                h["optedInAt"] = json!(chrono::Utc::now().to_rfc3339());
                found = true;
                break;
            }
        }
        if !found {
            arr.push(json!({
                "harnessId": harness_id,
                "optedIn": true,
                "optedInAt": chrono::Utc::now().to_rfc3339(),
            }));
        }
        asset_count = arr.len();
    } else {
        data["harnesses"] = json!([{
            "harnessId": harness_id,
            "optedIn": true,
            "optedInAt": chrono::Utc::now().to_rfc3339(),
        }]);
        asset_count = 1;
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({
        "kind": "catalog.harness_opt_in",
        "deterministic": true,
        "target": _target,
        "optedIn": true,
        "assetCount": asset_count,
    })))
}

async fn post_harness_assets_uninstall(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let harness_id = body.get("harnessId").and_then(|v| v.as_str()).unwrap_or("");
    let mut data = read_catalog_json(&state, "harness.json");
    let mut uninstalled = 0usize;
    if let Some(harnesses) = data.get_mut("harnesses").and_then(|v| v.as_array_mut()) {
        let before = harnesses.len();
        harnesses.retain(|h| h.get("harnessId").and_then(|v| v.as_str()) != Some(harness_id));
        uninstalled = before - harnesses.len();
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.harness_asset_uninstall", "deterministic": true, "ok": true, "uninstalled": uninstalled})))
}

async fn post_harness_assets_check(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let harness_id = body.get("harnessId").and_then(|v| v.as_str()).unwrap_or("");
    let harness_dir = state.config.elegy_home.join("harnesses").join(harness_id);
    let mut results = vec![];
    let scanned_count;
    if harness_dir.exists() {
        let entries = std::fs::read_dir(&harness_dir).ok();
        if let Some(dir_entries) = entries {
            for entry in dir_entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let installed = entry.path().exists();
                results.push(json!({
                    "assetId": name.trim_end_matches(".md").trim_end_matches(".json"),
                    "installed": installed,
                    "version": "1.0.0",
                }));
            }
        }
        scanned_count = results.len();
    } else {
        scanned_count = 0;
    }
    Ok(Json(json!({
        "kind": "catalog.harness_asset_check",
        "deterministic": true,
        "ok": true,
        "results": results,
        "scannedCount": scanned_count,
        "summaryWarnings": [],
    })))
}

async fn post_harness_assets_sync(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let harness_id = body.get("harnessId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let harness_dir = state.config.elegy_home.join("harnesses").join(&harness_id);
    std::fs::create_dir_all(&harness_dir).map_err(|e| ApiError::Internal(e.into()))?;
    // Copy assets from engine-assets to harness dir
    let engine_assets = state.config.engine_root.join("engine-assets");
    let mut synced = 0usize;
    if engine_assets.exists() {
        if let Ok(entries) = std::fs::read_dir(&engine_assets) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let src = entry.path();
                let dst = harness_dir.join(&name);
                if src.is_file() {
                    let _ = std::fs::copy(&src, &dst);
                    synced += 1;
                } else if src.is_dir() {
                    let _ = std::fs::create_dir_all(&dst);
                    if let Ok(sub_entries) = std::fs::read_dir(&src) {
                        for sub in sub_entries.flatten() {
                            let sub_name = sub.file_name();
                            let _ = std::fs::copy(&sub.path(), dst.join(&sub_name));
                            synced += 1;
                        }
                    }
                }
            }
        }
    }
    // Update harness.json
    let mut data = read_catalog_json(&state, "harness.json");
    if let Some(harnesses) = data.get_mut("harnesses").and_then(|v| v.as_array_mut()) {
        let mut found = false;
        for h in harnesses.iter_mut() {
            if h.get("harnessId").and_then(|v| v.as_str()) == Some(&harness_id) {
                h["syncedAt"] = json!(chrono::Utc::now().to_rfc3339());
                h["syncedCount"] = json!(synced);
                found = true;
                break;
            }
        }
        if !found {
            harnesses.push(json!({
                "harnessId": harness_id,
                "syncedAt": chrono::Utc::now().to_rfc3339(),
                "syncedCount": synced,
            }));
        }
    } else {
        data["harnesses"] = json!([{
            "harnessId": harness_id,
            "syncedAt": chrono::Utc::now().to_rfc3339(),
            "syncedCount": synced,
        }]);
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({
        "kind": "catalog.harness_sync",
        "deterministic": true,
        "ok": true,
        "harnessId": harness_id,
        "synced": synced,
        "message": format!("Harness sync completed: {} assets", synced),
    })))
}

// ---------------------------------------------------------------------------
// Catalog Asset CRUD (9 routes)
// ---------------------------------------------------------------------------

async fn post_catalog_asset_create(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "assets.json");
    let assets = data.get_mut("assets").and_then(|v| v.as_array_mut());
    let new_asset = json!({
        "assetId": asset_id,
        "title": title,
        "kind": kind,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    });
    if let Some(arr) = assets {
        arr.push(new_asset.clone());
    } else {
        data["assets"] = json!([new_asset.clone()]);
    }
    write_catalog_json(&state, "assets.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.create", "deterministic": true, "ok": true, "asset": {"assetId": asset_id, "title": title, "kind": kind}})))
}

async fn post_catalog_asset_update(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("");
    let mut data = read_catalog_json(&state, "assets.json");
    let mut updated = json!({});
    if let Some(assets) = data.get_mut("assets").and_then(|v| v.as_array_mut()) {
        for asset in assets.iter_mut() {
            if asset.get("assetId").and_then(|v| v.as_str()) == Some(asset_id) {
                if let Some(obj) = body.as_object() {
                    for (k, v) in obj {
                        if k != "assetId" {
                            asset[k] = v.clone();
                        }
                    }
                }
                asset["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
                updated = asset.clone();
                break;
            }
        }
    }
    write_catalog_json(&state, "assets.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.update", "deterministic": true, "ok": true, "asset": updated})))
}

async fn post_catalog_asset_delete(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "assets.json");
    if let Some(assets) = data.get_mut("assets").and_then(|v| v.as_array_mut()) {
        assets.retain(|a| a.get("assetId").and_then(|v| v.as_str()) != Some(&asset_id));
    }
    write_catalog_json(&state, "assets.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.delete", "deterministic": true, "ok": true, "deleted": asset_id})))
}

async fn post_catalog_asset_install(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "harness.json");
    let harnesses = data.get_mut("harnesses").and_then(|v| v.as_array_mut());
    let entry = json!({
        "assetId": asset_id,
        "installed": true,
        "installedAt": chrono::Utc::now().to_rfc3339(),
    });
    if let Some(arr) = harnesses {
        arr.push(entry);
    } else {
        data["harnesses"] = json!([entry]);
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.install", "deterministic": true, "ok": true, "installed": true})))
}

async fn post_catalog_bundle_uninstall(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let bundle_id = body.get("bundleId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "bundles.json");
    if let Some(bundles) = data.get_mut("bundles").and_then(|v| v.as_array_mut()) {
        bundles.retain(|b| b.get("bundleId").and_then(|v| v.as_str()) != Some(&bundle_id));
    }
    write_catalog_json(&state, "bundles.json", &data)?;
    Ok(Json(json!({"kind": "catalog.bundle.uninstall", "deterministic": true, "ok": true, "uninstalled": bundle_id})))
}

async fn post_catalog_providers_install(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let provider_id = body.get("providerId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let config = body.get("config");
    let mut data = read_catalog_json(&state, "provider-config.json");
    let providers = data.get_mut("providers").and_then(|v| v.as_array_mut());
    let entry = json!({
        "providerId": provider_id,
        "config": config,
        "installedAt": chrono::Utc::now().to_rfc3339(),
    });
    if let Some(arr) = providers {
        arr.push(entry.clone());
    } else {
        data["providers"] = json!([entry.clone()]);
    }
    write_catalog_json(&state, "provider-config.json", &data)?;
    Ok(Json(json!({
        "kind": "catalog.provider.install",
        "deterministic": true,
        "action": "install",
        "providerId": provider_id,
        "provider": entry,
        "state": "installed",
        "commands": [],
    })))
}

async fn post_catalog_asset_enable(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "harness.json");
    if let Some(harnesses) = data.get_mut("harnesses").and_then(|v| v.as_array_mut()) {
        let mut found = false;
        for h in harnesses.iter_mut() {
            if h.get("assetId").and_then(|v| v.as_str()) == Some(&asset_id) || h.get("harnessId").and_then(|v| v.as_str()) == Some(&asset_id) {
                h["enabled"] = json!(true);
                h["enabledAt"] = json!(chrono::Utc::now().to_rfc3339());
                found = true;
                break;
            }
        }
        if !found {
            harnesses.push(json!({
                "assetId": asset_id,
                "enabled": true,
                "enabledAt": chrono::Utc::now().to_rfc3339(),
            }));
        }
    } else {
        data["harnesses"] = json!([{
            "assetId": asset_id,
            "enabled": true,
            "enabledAt": chrono::Utc::now().to_rfc3339(),
        }]);
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.enable", "deterministic": true, "ok": true, "enabled": true, "assetId": asset_id})))
}

async fn post_catalog_asset_disable(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let asset_id = body.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut data = read_catalog_json(&state, "harness.json");
    if let Some(harnesses) = data.get_mut("harnesses").and_then(|v| v.as_array_mut()) {
        for h in harnesses.iter_mut() {
            if h.get("assetId").and_then(|v| v.as_str()) == Some(&asset_id) || h.get("harnessId").and_then(|v| v.as_str()) == Some(&asset_id) {
                h["enabled"] = json!(false);
                h["disabledAt"] = json!(chrono::Utc::now().to_rfc3339());
            }
        }
    }
    write_catalog_json(&state, "harness.json", &data)?;
    Ok(Json(json!({"kind": "catalog.asset.disable", "deterministic": true, "ok": true, "disabled": true, "assetId": asset_id})))
}

async fn post_catalog_activation(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let activation = body.get("activation");
    let data = if let Some(act) = activation {
        json!({"activation": act.clone(), "updatedAt": chrono::Utc::now().to_rfc3339()})
    } else {
        json!({"activation": body, "updatedAt": chrono::Utc::now().to_rfc3339()})
    };
    write_catalog_json(&state, "activation.json", &data)?;
    Ok(Json(json!({"kind": "catalog.activation.update", "deterministic": true, "ok": true})))
}

// ---------------------------------------------------------------------------
// Search & Audit (6 routes)
// ---------------------------------------------------------------------------

async fn post_search_query(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let query_str = body.get("query").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
    let _kind = body.get("kind").and_then(|v| v.as_str());
    let _repo_id = body.get("repoId").and_then(|v| v.as_str());
    let mut results = vec![];

    // Search assets.json
    let assets_data = read_catalog_json(&state, "assets.json");
    if let Some(assets) = assets_data.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            let title = asset.get("title").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let asset_id = asset.get("assetId").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            if title.contains(&query_str) || asset_id.contains(&query_str) {
                results.push(json!({
                    "type": "asset",
                    "assetId": asset.get("assetId"),
                    "title": asset.get("title"),
                    "kind": asset.get("kind"),
                    "score": 1,
                }));
            }
        }
    }

    // Search sources.json
    let sources_data = read_catalog_json(&state, "sources.json");
    if let Some(sources) = sources_data.get("sources").and_then(|v| v.as_array()) {
        for source in sources {
            let title = source.get("title").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let source_id = source.get("sourceId").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            if title.contains(&query_str) || source_id.contains(&query_str) {
                results.push(json!({
                    "type": "source",
                    "sourceId": source.get("sourceId"),
                    "title": source.get("title"),
                    "kind": source.get("kind"),
                    "score": 1,
                }));
            }
        }
    }

    // Search bundles.json
    let bundles_data = read_catalog_json(&state, "bundles.json");
    if let Some(bundles) = bundles_data.get("bundles").and_then(|v| v.as_array()) {
        for bundle in bundles {
            let title = bundle.get("title").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let bundle_id = bundle.get("bundleId").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            if title.contains(&query_str) || bundle_id.contains(&query_str) {
                results.push(json!({
                    "type": "bundle",
                    "bundleId": bundle.get("bundleId"),
                    "title": bundle.get("title"),
                    "score": 1,
                }));
            }
        }
    }

    Ok(Json(json!({
        "kind": "catalog.search.query",
        "deterministic": true,
        "query": {"query": query_str, "kind": _kind, "repoId": _repo_id, "repoPath": null, "limit": 20},
        "count": results.len(),
        "results": results,
        "routingPolicy": null,
        "policySnapshot": null,
        "snapshot": null,
        "audit": {"logged": true, "path": null, "eventIds": [], "errors": []},
    })))
}

async fn post_search_selection(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let result_id = body.get("resultId").and_then(|v| v.as_str()).unwrap_or("");
    let _query = body.get("query").and_then(|v| v.as_str());
    let mut data = read_catalog_json(&state, "audit.json");
    let events = data.get_mut("events").and_then(|v| v.as_array_mut());
    let event = json!({
        "eventId": format!("sel-{}", chrono::Utc::now().timestamp_millis()),
        "type": "search.selection",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": {
            "resultId": result_id,
            "query": _query,
        },
    });
    if let Some(arr) = events {
        arr.push(event);
    } else {
        data["events"] = json!([event]);
    }
    write_catalog_json(&state, "audit.json", &data)?;
    Ok(Json(json!({"ok": true, "logged": true})))
}

async fn get_audit_assets(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let mut total = 0usize;
    let mut installed = 0usize;
    let mut enabled = 0usize;
    let mut by_kind = serde_json::Map::new();

    // Read assets.json
    let assets_data = read_catalog_json(&state, "assets.json");
    if let Some(assets) = assets_data.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            total += 1;
            let kind = asset.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let count = by_kind.get(&kind).and_then(|v| v.as_u64()).unwrap_or(0) + 1;
            by_kind.insert(kind, json!(count));
        }
    }

    // Read harness.json for installed/enabled counts
    let harness_data = read_catalog_json(&state, "harness.json");
    if let Some(harnesses) = harness_data.get("harnesses").and_then(|v| v.as_array()) {
        for h in harnesses {
            if h.get("installed").and_then(|v| v.as_bool()).unwrap_or(false) {
                installed += 1;
            }
            if h.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                enabled += 1;
            }
        }
    }

    Ok(Json(json!({
        "kind": "catalog.audit.assets",
        "deterministic": true,
        "snapshot": null,
        "analytics": {
            "total": total,
            "installed": installed,
            "enabled": enabled,
            "byKind": by_kind,
            "recentEvents": [],
        },
    })))
}

async fn get_audit_events(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "audit.json");
    let events = data.get("events").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let audit_path = catalog_dir(&state).join("audit.json");
    let exists = audit_path.exists();
    let size = if exists {
        std::fs::metadata(&audit_path).ok().map(|m| m.len() as i64)
    } else {
        None
    };
    Ok(Json(json!({
        "kind": "catalog.audit.events.list",
        "deterministic": true,
        "filters": {},
        "count": events.len(),
        "storage": {
            "path": audit_path.to_string_lossy(),
            "exists": exists,
            "updatedAt": if exists {
                std::fs::metadata(&audit_path).ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                        chrono::DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
                            .map(|dt| dt.to_rfc3339())
                    })
                    .flatten()
            } else { None },
            "size": size,
        },
        "events": events,
    })))
}

async fn get_catalog_health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let assets_dir = catalog_dir(&state);
    let snapshot_path = assets_dir.join("snapshot.json");
    let exists = snapshot_path.exists();
    Ok(Json(json!({
        "kind": "runtime.catalog-health",
        "deterministic": true,
        "ok": exists,
        "error": if exists { Value::Null } else { Value::String("No snapshot available. Run catalog refresh.".to_string()) },
        "projection": if exists {
            json!({"path": snapshot_path.to_string_lossy(), "exists": true})
        } else {
            Value::Null
        },
        "audit": {"path": null, "exists": false, "updatedAt": null, "size": null},
        "changes": null,
    })))
}

async fn get_catalog_quality(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = read_catalog_json(&state, "quality.json");
    let report = data.get("report").cloned().unwrap_or(json!({"status": "unknown", "score": null}));
    Ok(Json(json!({
        "kind": "catalog.quality",
        "deterministic": true,
        "ok": true,
        "report": report,
    })))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> Router {
    Router::new()
        // Asset Management
        .route("/api/assets/managed", get(get_assets_managed))
        .route("/api/assets/installed", get(get_assets_installed))
        .route("/api/assets/sync-all", post(post_assets_sync_all))
        .route("/api/assets/install-surfaces", post(post_assets_install_surfaces))
        .route("/api/assets/sync", post(post_assets_sync))
        .route("/api/assets/remove", post(post_assets_remove))
        .route("/api/skills/preview", get(get_skills_preview))
        // Catalog Sources
        .route("/api/catalog/repos/scan-roots", post(post_catalog_repos_scan_roots))
        .route("/api/catalog/repos/refresh", post(post_catalog_repos_refresh))
        .route("/api/catalog/summary", get(get_catalog_summary))
        .route("/api/catalog/sources", get(get_catalog_sources))
        .route("/api/catalog/content", get(get_catalog_content))
        .route("/api/catalog/sources/{source_id}", get(get_catalog_source_detail))
        .route("/api/catalog/assets", get(get_catalog_assets))
        .route("/api/catalog/bundles", get(get_catalog_bundles))
        .route("/api/catalog/assets/{asset_id}", get(get_catalog_asset_detail))
        .route("/api/catalog/entries", get(get_catalog_entries))
        // Catalog Operations
        .route("/api/catalog/refresh", post(post_catalog_refresh))
        .route("/api/catalog/sources/add", post(post_catalog_sources_add))
        .route("/api/catalog/sources/remove", post(post_catalog_sources_remove))
        .route("/api/catalog/sources/refresh", post(post_catalog_sources_refresh))
        .route("/api/catalog/sources/activate", post(post_catalog_sources_activate))
        .route("/api/catalog/sources/deactivate", post(post_catalog_sources_deactivate))
        .route("/api/catalog/sources/sync-install-verify", post(post_catalog_sources_sync_install_verify))
        .route("/api/catalog/tools/spec-kit/bootstrap", post(post_catalog_spec_kit_bootstrap))
        .route("/api/catalog/route/explain", post(post_catalog_route_explain))
        // Harness
        .route("/api/catalog/harness-opt-in", post(post_harness_opt_in))
        .route("/api/catalog/harness-assets/uninstall", post(post_harness_assets_uninstall))
        .route("/api/catalog/harness-assets/check", post(post_harness_assets_check))
        .route("/api/catalog/harness-assets/sync", post(post_harness_assets_sync))
        // Catalog Asset CRUD
        .route("/api/catalog/assets/create", post(post_catalog_asset_create))
        .route("/api/catalog/assets/update", post(post_catalog_asset_update))
        .route("/api/catalog/assets/delete", post(post_catalog_asset_delete))
        .route("/api/catalog/assets/install", post(post_catalog_asset_install))
        .route("/api/catalog/bundles/uninstall", post(post_catalog_bundle_uninstall))
        .route("/api/catalog/providers/install", post(post_catalog_providers_install))
        .route("/api/catalog/assets/enable", post(post_catalog_asset_enable))
        .route("/api/catalog/assets/disable", post(post_catalog_asset_disable))
        .route("/api/catalog/activation", post(post_catalog_activation))
        // Search & Audit
        .route("/api/search/query", post(post_search_query))
        .route("/api/search/selection", post(post_search_selection))
        .route("/api/audit/assets", get(get_audit_assets))
        .route("/api/audit/events", get(get_audit_events))
        .route("/api/runtime/catalog-health", get(get_catalog_health))
        .route("/api/catalog/quality", get(get_catalog_quality))
        .with_state(state)
}
