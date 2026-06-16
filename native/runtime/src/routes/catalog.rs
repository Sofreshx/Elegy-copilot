use axum::extract::Path;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;

// ---------------------------------------------------------------------------
// Asset Management (7 routes)
// These live under /api/assets/* and /api/skills/* — no conflict with existing
// assets.rs which only has /api/assets/view and /api/assets/delete.
// ---------------------------------------------------------------------------

/// GET /api/assets/managed
async fn get_assets_managed() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"managed": [], "stub": true})))
}

/// GET /api/assets/installed
async fn get_assets_installed() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "agents": [],
        "skills": [],
        "prompts": [],
        "instructions": [],
        "stub": true
    })))
}

/// POST /api/assets/sync-all
async fn post_assets_sync_all() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"result": {"synced": []}, "stub": true})))
}

/// POST /api/assets/install-surfaces
async fn post_assets_install_surfaces() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"ok": true, "installed": [], "stub": true})))
}

/// POST /api/assets/sync
async fn post_assets_sync() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"result": {"synced": true}, "stub": true})))
}

/// POST /api/assets/remove
async fn post_assets_remove() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"result": {"removed": true}, "stub": true})))
}

/// GET /api/skills/preview
async fn get_skills_preview() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"skills": [], "stub": true})))
}

// ---------------------------------------------------------------------------
// Catalog Sources (9 routes)
// ---------------------------------------------------------------------------

/// POST /api/catalog/repos/scan-roots
async fn post_catalog_repos_scan_roots() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.repos.scan-roots",
        "deterministic": true,
        "updated": true,
        "count": 0,
        "repos": [],
        "selectedRepo": null,
        "storage": {},
        "workspaceScan": null,
        "stub": true
    })))
}

/// POST /api/catalog/repos/refresh
async fn post_catalog_repos_refresh() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.repos.refresh",
        "deterministic": true,
        "count": 0,
        "repos": [],
        "selectedRepo": null,
        "storage": {},
        "updated": true,
        "stub": true
    })))
}

/// GET /api/catalog/summary
async fn get_catalog_summary() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.summary",
        "deterministic": true,
        "summary": {
            "schemaVersion": null,
            "generatedAt": null,
            "readMode": "stub",
            "repoContext": null,
            "providers": [],
            "externalSources": [],
            "storage": {
                "catalogRoot": null,
                "snapshotPath": null,
                "snapshotExists": false
            },
            "stats": null,
            "warnings": {"count": 0, "items": []},
            "inputs": {
                "manifest": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "metadataIndex": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "registry": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "providerCatalog": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "providerState": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "externalSourcesCatalog": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "externalSourcesUserSources": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "externalSourcesState": {"path": null, "exists": false, "size": null, "updatedAt": null},
                "snapshot": {"path": null, "exists": false, "size": null, "updatedAt": null}
            },
            "freshness": {
                "status": "missing",
                "ageMs": null,
                "latestInputAt": null,
                "reasons": ["stub"]
            },
            "rebuild": {
                "status": "idle",
                "refreshCount": 0,
                "lastRequestedAt": null,
                "lastCompletedAt": null,
                "lastSuccessfulAt": null,
                "lastDurationMs": null,
                "lastReason": null,
                "lastError": null,
                "lastSnapshotPath": null
            }
        },
        "policySnapshot": {
            "profile": "balanced",
            "orchestrationPolicy": "balanced",
            "activeBundleIds": [],
            "eligibleAssetIds": [],
            "eligibleAssetCount": 0,
            "bundleSource": "stub",
            "plannerProfileSource": "stub",
            "failClosed": true,
            "freshness": {
                "snapshotUpdatedAt": null,
                "snapshotGeneratedAt": null
            }
        },
        "stub": true
    })))
}

/// GET /api/catalog/sources
async fn get_catalog_sources() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.list",
        "deterministic": true,
        "count": 0,
        "sources": [],
        "storage": {
            "catalogPath": null,
            "userSourcesPath": null,
            "statePath": null
        },
        "stub": true
    })))
}

/// GET /api/catalog/content
async fn get_catalog_content() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"content": {}, "stub": true})))
}

/// GET /api/catalog/sources/{source_id}
async fn get_catalog_source_detail(
    Path(source_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
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
                "verificationErrors": []
            },
            "activation": {}
        },
        "storage": {
            "catalogPath": null,
            "userSourcesPath": null,
            "statePath": null
        },
        "stub": true
    })))
}

/// GET /api/catalog/assets
async fn get_catalog_assets() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.assets.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "assets": [],
        "stub": true
    })))
}

/// GET /api/catalog/bundles
async fn get_catalog_bundles() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.bundles.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "bundles": [],
        "stub": true
    })))
}

/// GET /api/catalog/assets/{asset_id}
async fn get_catalog_asset_detail(
    Path(asset_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
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
                "installedPaths": {}
            }
        },
        "entries": [],
        "snapshot": null,
        "stub": true
    })))
}

/// GET /api/catalog/entries
async fn get_catalog_entries() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.entries.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "snapshot": null,
        "entries": [],
        "stub": true
    })))
}

// ---------------------------------------------------------------------------
// Catalog Operations (9 routes)
// ---------------------------------------------------------------------------

/// POST /api/catalog/refresh
async fn post_catalog_refresh() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.refresh",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/sources/add
async fn post_catalog_sources_add() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.add",
        "deterministic": true,
        "source": {
            "sourceId": null,
            "title": null,
            "installables": [],
            "sync": {}
        },
        "userSourcesPath": null,
        "stub": true
    })))
}

/// POST /api/catalog/sources/remove
async fn post_catalog_sources_remove() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.remove",
        "deterministic": true,
        "ok": true,
        "removedSourceId": null,
        "stub": true
    })))
}

/// POST /api/catalog/sources/refresh
async fn post_catalog_sources_refresh() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.refresh",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/sources/activate
async fn post_catalog_sources_activate() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.activate",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/sources/deactivate
async fn post_catalog_sources_deactivate() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.deactivate",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/sources/sync-install-verify
async fn post_catalog_sources_sync_install_verify() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.sources.sync-install-verify",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/tools/spec-kit/bootstrap
async fn post_catalog_spec_kit_bootstrap() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.tools.spec-kit.bootstrap",
        "deterministic": true,
        "source": null,
        "installable": null,
        "repoPath": null,
        "overallStatus": "stub",
        "warnings": [],
        "errors": [],
        "bootstrap": {},
        "stub": true
    })))
}

/// POST /api/catalog/route/explain
async fn post_catalog_route_explain() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "explanation": "Catalog stub",
        "stub": true
    })))
}

// ---------------------------------------------------------------------------
// Harness (5 routes)
// ---------------------------------------------------------------------------

/// POST /api/catalog/harness-opt-in
async fn post_harness_opt_in() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_opt_in",
        "deterministic": true,
        "target": null,
        "optedIn": false,
        "assetCount": 0,
        "stub": true
    })))
}

/// POST /api/catalog/harness-assets/uninstall
async fn post_harness_assets_uninstall() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_asset_uninstall",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/harness-assets/check
async fn post_harness_assets_check() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_asset_check",
        "deterministic": true,
        "ok": true,
        "results": [],
        "scannedCount": 0,
        "summaryWarnings": [],
        "stub": true
    })))
}

/// POST /api/catalog/harness-assets/sync
async fn post_harness_assets_sync() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.harness_sync",
        "deterministic": true,
        "ok": true,
        "harnessId": null,
        "message": "Harness sync stub",
        "stub": true
    })))
}

// ---------------------------------------------------------------------------
// Catalog Asset CRUD (9 routes)
// ---------------------------------------------------------------------------

/// POST /api/catalog/assets/create
async fn post_catalog_asset_create() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.create",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/assets/update
async fn post_catalog_asset_update() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.update",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/assets/delete
async fn post_catalog_asset_delete() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.delete",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/assets/install
async fn post_catalog_asset_install() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.install",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/bundles/uninstall
async fn post_catalog_bundle_uninstall() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.bundle.uninstall",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/providers/install
async fn post_catalog_providers_install() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.provider.install",
        "deterministic": true,
        "action": "install",
        "providerId": null,
        "provider": null,
        "state": null,
        "commands": [],
        "stub": true
    })))
}

/// POST /api/catalog/assets/enable
async fn post_catalog_asset_enable() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.enable",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/assets/disable
async fn post_catalog_asset_disable() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.asset.disable",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

/// POST /api/catalog/activation
async fn post_catalog_activation() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.activation.update",
        "deterministic": true,
        "ok": true,
        "stub": true
    })))
}

// ---------------------------------------------------------------------------
// Search & Audit (6 routes)
// ---------------------------------------------------------------------------

/// POST /api/search/query
async fn post_search_query() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.search.query",
        "deterministic": true,
        "query": {
            "query": null,
            "kind": null,
            "repoId": null,
            "repoPath": null,
            "limit": 20
        },
        "count": 0,
        "results": [],
        "routingPolicy": null,
        "policySnapshot": null,
        "snapshot": null,
        "audit": {
            "logged": false,
            "path": null,
            "eventIds": [],
            "errors": []
        },
        "stub": true
    })))
}

/// POST /api/search/selection
async fn post_search_selection() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"ok": true, "stub": true})))
}

/// GET /api/audit/assets
async fn get_audit_assets() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.audit.assets",
        "deterministic": true,
        "snapshot": null,
        "analytics": {
            "total": 0,
            "installed": 0,
            "enabled": 0,
            "byKind": {},
            "recentEvents": []
        },
        "stub": true
    })))
}

/// GET /api/audit/events
async fn get_audit_events() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.audit.events.list",
        "deterministic": true,
        "filters": {},
        "count": 0,
        "storage": {
            "path": null,
            "exists": false,
            "updatedAt": null,
            "size": null
        },
        "events": [],
        "stub": true
    })))
}

/// GET /api/runtime/catalog-health
async fn get_catalog_health() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "runtime.catalog-health",
        "deterministic": true,
        "ok": false,
        "error": "Catalog stub — no real projection data available",
        "projection": null,
        "audit": {
            "path": null,
            "exists": false,
            "updatedAt": null,
            "size": null
        },
        "changes": null,
        "stub": true
    })))
}

/// GET /api/catalog/quality
async fn get_catalog_quality() -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "kind": "catalog.quality",
        "deterministic": true,
        "ok": true,
        "report": {},
        "stub": true
    })))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(_state: AppState) -> Router {
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
}
