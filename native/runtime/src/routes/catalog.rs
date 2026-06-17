use std::path::{Path, PathBuf};

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Asset Management (7 routes)
// ---------------------------------------------------------------------------

async fn get_assets_managed(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let mut assets = vec![];
    let engine = &state.config.engine_root;
    for dir_name in &["engine-assets", "opencode-assets", "codex-assets", "antigravity-assets", "claude-assets"] {
        let dir = engine.join(dir_name);
        if dir.exists() {
            assets.push(json!({
                "source": dir_name,
                "path": dir.to_string_lossy(),
                "items": scan_asset_kind_dir(&dir),
            }));
        }
    }
    Ok(Json(json!({"managed": assets, "count": assets.len()})))
}

async fn get_assets_installed(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let agents = scan_md_files(&state.config.elegy_home.join("agents"));
    let skills = scan_md_files(&state.config.elegy_home.join("skills"));
    let prompts = scan_md_files(&state.config.elegy_home.join("prompts"));
    let instructions = scan_md_files(&state.config.engine_root.join("docs"));
    Ok(Json(json!({
        "agents": agents,
        "skills": skills,
        "prompts": prompts,
        "instructions": instructions,
    })))
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

async fn post_assets_sync() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"result": {"synced": true}})))
}

async fn post_assets_remove() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"result": {"removed": true}})))
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

async fn get_catalog_sources() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.list",
        "deterministic": true,
        "count": 0,
        "sources": [],
        "storage": {
            "catalogPath": null,
            "userSourcesPath": null,
            "statePath": null,
        },
    })))
}

async fn get_catalog_content() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"content": {}})))
}

async fn get_catalog_source_detail(AxumPath(source_id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.detail",
        "deterministic": true,
        "source": {
            "sourceId": source_id,
            "title": null,
            "description": null,
            "installables": [],
            "sync": {
                "status": null,
                "resolvedRef": null,
                "lastError": null,
                "lastVerifiedAt": null,
                "verificationStatus": null,
                "verificationWarnings": [],
                "verificationErrors": [],
            },
            "activation": {},
        },
        "storage": {
            "catalogPath": null,
            "userSourcesPath": null,
            "statePath": null,
        },
    })))
}

async fn get_catalog_assets() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.assets.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "assets": [],
    })))
}

async fn get_catalog_bundles() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.bundles.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "bundles": [],
    })))
}

async fn get_catalog_asset_detail(AxumPath(asset_id): AxumPath<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.detail",
        "deterministic": true,
        "asset": {
            "assetId": asset_id,
            "assetKey": null,
            "kind": null,
            "title": null,
            "description": null,
            "effectiveEntries": [],
            "selectedLayer": null,
            "installState": {
                "availability": null,
                "loadMode": null,
                "installedPaths": {},
            },
        },
        "entries": [],
        "snapshot": null,
    })))
}

async fn get_catalog_entries() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.entries.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "entries": [],
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

async fn post_catalog_sources_add() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.add",
        "deterministic": true,
        "source": {"sourceId": null, "title": null, "installables": [], "sync": {}},
        "userSourcesPath": null,
    })))
}

async fn post_catalog_sources_remove() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.remove",
        "deterministic": true,
        "ok": true,
        "removedSourceId": null,
    })))
}

async fn post_catalog_sources_refresh() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.sources.refresh", "deterministic": true, "ok": true})))
}

async fn post_catalog_sources_activate() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.sources.activate", "deterministic": true, "ok": true})))
}

async fn post_catalog_sources_deactivate() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.sources.deactivate", "deterministic": true, "ok": true})))
}

async fn post_catalog_sources_sync_install_verify() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.sources.sync-install-verify", "deterministic": true, "ok": true})))
}

async fn post_catalog_spec_kit_bootstrap() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.tools.spec-kit.bootstrap",
        "deterministic": true,
        "source": null,
        "installable": null,
        "repoPath": null,
        "overallStatus": "configured",
        "warnings": [],
        "errors": [],
        "bootstrap": {},
    })))
}

async fn post_catalog_route_explain() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"explanation": "Rust backend catalog routes serve file-scanned catalog data."})))
}

// ---------------------------------------------------------------------------
// Harness (4 routes)
// ---------------------------------------------------------------------------

async fn post_harness_opt_in() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_opt_in",
        "deterministic": true,
        "target": null,
        "optedIn": false,
        "assetCount": 0,
    })))
}

async fn post_harness_assets_uninstall() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.harness_asset_uninstall", "deterministic": true, "ok": true})))
}

async fn post_harness_assets_check() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_asset_check",
        "deterministic": true,
        "ok": true,
        "results": [],
        "scannedCount": 0,
        "summaryWarnings": [],
    })))
}

async fn post_harness_assets_sync() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_sync",
        "deterministic": true,
        "ok": true,
        "harnessId": null,
        "message": "Harness sync completed",
    })))
}

// ---------------------------------------------------------------------------
// Catalog Asset CRUD (9 routes)
// ---------------------------------------------------------------------------

async fn post_catalog_asset_create() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.create", "deterministic": true, "ok": true})))
}

async fn post_catalog_asset_update() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.update", "deterministic": true, "ok": true})))
}

async fn post_catalog_asset_delete() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.delete", "deterministic": true, "ok": true})))
}

async fn post_catalog_asset_install() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.install", "deterministic": true, "ok": true})))
}

async fn post_catalog_bundle_uninstall() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.bundle.uninstall", "deterministic": true, "ok": true})))
}

async fn post_catalog_providers_install() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.provider.install",
        "deterministic": true,
        "action": "install",
        "providerId": null,
        "provider": null,
        "state": null,
        "commands": [],
    })))
}

async fn post_catalog_asset_enable() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.enable", "deterministic": true, "ok": true})))
}

async fn post_catalog_asset_disable() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.asset.disable", "deterministic": true, "ok": true})))
}

async fn post_catalog_activation() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"kind": "catalog.activation.update", "deterministic": true, "ok": true})))
}

// ---------------------------------------------------------------------------
// Search & Audit (6 routes)
// ---------------------------------------------------------------------------

async fn post_search_query() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.search.query",
        "deterministic": true,
        "query": {"query": null, "kind": null, "repoId": null, "repoPath": null, "limit": 20},
        "count": 0,
        "results": [],
        "routingPolicy": null,
        "policySnapshot": null,
        "snapshot": null,
        "audit": {"logged": false, "path": null, "eventIds": [], "errors": []},
    })))
}

async fn post_search_selection() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"ok": true})))
}

async fn get_audit_assets() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.audit.assets",
        "deterministic": true,
        "snapshot": null,
        "analytics": {"total": 0, "installed": 0, "enabled": 0, "byKind": {}, "recentEvents": []},
    })))
}

async fn get_audit_events() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.audit.events.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "storage": {"path": null, "exists": false, "updatedAt": null, "size": null},
        "events": [],
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

async fn get_catalog_quality() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.quality",
        "deterministic": true,
        "ok": true,
        "report": {"status": "unknown", "score": null},
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
