use axum::{
    extract::Request, http::StatusCode, middleware::Next, response::Response, Router,
};
use axum::routing::any;
use axum::middleware as axum_middleware;

use crate::app::AppState;

mod agent;
mod assets;
mod catalog;
mod checks;
mod claude_code;
mod config;
mod dashboard;
mod desktop_updater;
mod elegy_db;
mod executor;
mod git;
mod health;
mod lifecycle;
mod notes;
mod opencode;
mod planning;
mod planning_live;
mod policy;
mod projects;
mod repo_docs;
mod sessions;
mod tooling_updates;
mod ui_runtime_overlay;
mod version;
mod workspace;
mod planning_obsidian;
mod codex;
mod lifecycle_full;
mod cli_detection;
mod cli_tooling;
mod repo_assets;
mod lexicon;
mod telemetry;
mod code_review;

pub fn build_routes(state: AppState) -> Router {
    Router::new()
        .merge(config::router(state.clone()))
        .merge(health::router(state.clone()))
        .merge(version::router(state.clone()))
        .merge(policy::router(state.clone()))
        .merge(dashboard::router(state.clone()))
        .merge(executor::router(state.clone()))
        .merge(projects::router(state.clone()))
        .merge(assets::router(state.clone()))
        .merge(catalog::router(state.clone()))
        .merge(lifecycle::router(state.clone()))
        .merge(notes::router(state.clone()))
        .merge(opencode::router(state.clone()))
        .merge(planning::router(state.clone()))
        .merge(planning_live::router(state.clone()))
        .merge(claude_code::router(state.clone()))
        .merge(git::router(state.clone()))
        .merge(agent::router(state.clone()))
        .merge(sessions::router(state.clone()))
        .merge(desktop_updater::router(state.clone()))
        .merge(elegy_db::router(state.clone()))
        .merge(tooling_updates::router(state.clone()))
        .merge(workspace::router(state.clone()))
        .merge(ui_runtime_overlay::router(state.clone()))
        .merge(repo_docs::router(state.clone()))
        .merge(checks::router(state.clone()))
        .merge(planning_obsidian::router(state.clone()))
        .merge(codex::router(state.clone()))
        .merge(lifecycle_full::router(state.clone()))
        .merge(cli_tooling::router(state.clone()))
        .merge(repo_assets::router(state.clone()))
        .merge(lexicon::router(state.clone()))
        .merge(telemetry::router(state.clone()))
        .merge(code_review::router(state.clone()))
        .fallback(any(smart_fallback))
}

/// Smart fallback: returns shape-correct empty objects for common
/// collection endpoints instead of `{ ok: true, stub: true }`.
/// This prevents the frontend from crashing on `.filter()` / `.map()`
/// / `Object.entries()` against an undefined value.
async fn smart_fallback(req: Request) -> (StatusCode, axum::Json<serde_json::Value>) {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    tracing::debug!(
        method = %method,
        path = %path,
        "unmatched route, returning shape-safe fallback"
    );

    if path.starts_with("/api/gateway")
        || path.starts_with("/api/sandboxes")
        || path.starts_with("/api/lifecycle/sandboxes")
    {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({
                "error": "retired_route",
                "path": path,
            })),
        );
    }

    let body = shape_safe_default(&path);
    (StatusCode::OK, axum::Json(body))
}

/// Infers a shape-correct default JSON value for a known endpoint path.
/// Unknown paths get a safe `{ ok: true, stub: true, path: ... }`.
fn shape_safe_default(path: &str) -> serde_json::Value {
    // Try to match a trailing segment as a collection name.
    // e.g. /api/notes/list -> { notes: [], count: 0 }
    //      /api/executor/jobs -> { jobs: [], count: 0 }
    //      /api/sessions -> { sessions: [], ... }
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();

    // /api/lexicon
    if path == "/api/lexicon" {
        return serde_json::json!({
            "entries": [],
            "total": 0,
            "filteredTotal": 0,
            "categories": {},
        });
    }

    // /api/lexicon/entries
    if path == "/api/lexicon/entries" {
        return serde_json::json!({ "entries": [], "total": 0 });
    }

    // /api/lexicon/search
    if path == "/api/lexicon/search" {
        return serde_json::json!({ "results": [], "total": 0, "filteredTotal": 0 });
    }

    // /api/notes/list, /api/notes/search -> { results: [], count: 0 }
    if path == "/api/notes/search" {
        return serde_json::json!({ "results": [], "count": 0, "query": "" });
    }

    // /api/sessions
    if path == "/api/sessions" {
        return serde_json::json!({
            "sessions": [],
            "authorityModel": null,
        });
    }

    // /api/sessions/unified
    if path == "/api/sessions/unified" {
        return serde_json::json!({ "items": [], "count": 0 });
    }

    // /api/catalog/repos/refresh
    if path == "/api/catalog/repos/refresh" {
        return serde_json::json!({
            "refreshed": false,
            "repo": null,
            "selectedRepo": null,
            "storage": { "path": "", "exists": false },
            "workspaceScan": null,
            "audit": null,
        });
    }

    // /api/catalog/sources/*
    if path == "/api/catalog/sources" {
        return serde_json::json!({
            "kind": "catalog.sources.list",
            "deterministic": true,
            "count": 0,
            "sources": [],
            "storage": { "catalogPath": "", "userSourcesPath": null, "statePath": null },
        });
    }

    // /api/catalog/quality
    if path == "/api/catalog/quality" {
        return serde_json::json!({
            "schemaVersion": 1,
            "generatedAt": null,
            "summary": { "ok": 0, "warn": 0, "fail": 0 },
            "skills": [],
            "overlapClusters": [],
        });
    }

    // /api/runtime/catalog-health
    if path == "/api/runtime/catalog-health" {
        return serde_json::json!({
            "projection": null,
            "audit": { "path": "", "exists": false, "updatedAt": null, "size": null },
            "changes": null,
        });
    }

    // /api/audit/events
    if path == "/api/audit/events" {
        return serde_json::json!({
            "events": [],
            "count": 0,
            "storage": { "path": "", "exists": false },
        });
    }

    // /api/audit/assets
    if path == "/api/audit/assets" {
        return serde_json::json!({
            "analytics": { "total": 0, "installed": 0, "enabled": 0, "byKind": {}, "recentEvents": [] },
        });
    }

    // /api/skills/preview
    if path == "/api/skills/preview" {
        return serde_json::json!({ "skills": [], "count": 0 });
    }

    // /api/policy/preflight
    if path == "/api/policy/preflight" {
        return serde_json::json!({
            "ok": true,
            "status": "unavailable",
            "reason": "no_implementation",
            "checkedAt": "1970-01-01T00:00:00Z",
            "validatorPath": "",
            "message": null,
            "exitCode": null,
        });
    }

    // /api/sessions/workspace
    if path == "/api/sessions/workspace" {
        return serde_json::json!({
            "active": [],
            "history": [],
            "authorityModel": null,
        });
    }

    // /api/catalog/entries
    if path == "/api/catalog/entries" {
        return serde_json::json!({
            "kind": "catalog.entries.list",
            "deterministic": true,
            "filters": {},
            "count": 0,
            "snapshot": null,
            "entries": [],
        });
    }

    // /api/catalog/bundles
    if path == "/api/catalog/bundles" {
        return serde_json::json!({
            "kind": "catalog.bundles.list",
            "deterministic": true,
            "count": 0,
            "bundles": [],
            "snapshot": null,
        });
    }

    // /api/catalog/assets
    if path == "/api/catalog/assets" {
        return serde_json::json!({
            "kind": "catalog.assets.list",
            "deterministic": true,
            "count": 0,
            "assets": [],
            "snapshot": null,
        });
    }

    // /api/catalog/refresh
    if path == "/api/catalog/refresh" {
        return serde_json::json!({
            "refreshed": false,
            "audit": null,
            "snapshot": null,
        });
    }

    // /api/catalog/route/explain
    if path == "/api/catalog/route/explain" {
        return serde_json::json!({
            "correlationId": null,
            "decision": "unavailable",
            "candidates": [],
            "policy": null,
            "blocks": [],
            "suggestedActions": [],
            "decidedAt": null,
            "audit": null,
        });
    }

    // /api/search/query
    if path == "/api/search/query" {
        return serde_json::json!({
            "query": "",
            "count": 0,
            "results": [],
            "snapshot": null,
            "audit": null,
        });
    }

    // /api/search/selection
    if path == "/api/search/selection" {
        return serde_json::json!({
            "recorded": false,
            "telemetry": { "path": null, "eventId": null },
            "audit": { "logged": false, "path": null, "eventId": null, "error": null },
        });
    }

    // /api/tooling-updates/status
    if path == "/api/tooling-updates/status" {
        return serde_json::json!({
            "checkedAtMs": 0,
            "elegyPlanningCli": null,
            "elegySkillsAssets": null,
            "codexSkillsAssets": null,
            "surfaces": [],
        });
    }

    // /api/dashboard/harness-sessions
    if path == "/api/dashboard/harness-sessions" {
        return serde_json::json!({
            "totalSessionCount": 0,
            "harnesses": [],
            "inventorySummary": null,
        });
    }

    // /api/workspace/pinned-commands
    if path == "/api/workspace/pinned-commands" {
        return serde_json::json!({ "commands": [], "count": 0 });
    }

    // /api/workspace/commands
    if path == "/api/workspace/commands" {
        return serde_json::json!({
            "repoPath": null,
            "commands": [],
            "detected": [],
            "hasConfig": false,
        });
    }

    // /api/workspace/launchers
    if path == "/api/workspace/launchers" {
        return serde_json::json!({ "launchers": [] });
    }

    // /api/opencode/go-workspaces
    if path == "/api/opencode/go-workspaces" {
        return serde_json::json!({
            "detected": [],
            "registered": [],
            "activeId": null,
        });
    }

    // /api/opencode/logs/requests
    if path == "/api/opencode/logs/requests" {
        return serde_json::json!({
            "requests": [],
            "total": 0,
            "logFiles": [],
        });
    }

    // /api/opencode/permissions
    if path == "/api/opencode/permissions" {
        return serde_json::json!({
            "ok": true,
            "permission": null,
        });
    }

    // /api/opencode/prompts/effective
    if path.starts_with("/api/opencode/prompts/effective") {
        return serde_json::json!({
            "ok": true,
            "agent": null,
            "layers": [],
        });
    }

    // /api/executor/worktrees
    if path == "/api/executor/worktrees" {
        return serde_json::json!({
            "worktrees": [],
            "count": 0,
            "worktreeDiscovery": null,
        });
    }

    // /api/executor/jobs
    if path == "/api/executor/jobs" {
        return serde_json::json!({ "jobs": [], "count": 0 });
    }

    // /api/executor/runs
    if path == "/api/executor/runs" {
        return serde_json::json!({ "runs": [], "count": 0 });
    }

    // /api/executor/health
    if path == "/api/executor/health" {
        return serde_json::json!({
            "enabled": false,
            "state": "unavailable",
            "jobCount": 0,
            "runCount": 0,
            "activeRunCount": 0,
        });
    }

    // /api/elegy-db/worktrees/enriched
    if path == "/api/elegy-db/worktrees/enriched" {
        return serde_json::json!({
            "repoPath": null,
            "worktrees": [],
            "count": 0,
        });
    }

    // /api/elegy-db/planning/summary
    if path == "/api/elegy-db/planning/summary" {
        return serde_json::json!({
            "repoPath": null,
            "linkedPlans": [],
        });
    }

    // /api/notes/settings
    if path == "/api/notes/settings" {
        return serde_json::json!({ "settings": [] });
    }

    // /api/notes/list
    if path == "/api/notes/list" {
        return serde_json::json!({ "notes": [], "count": 0 });
    }

    // /api/notes/get
    if path == "/api/notes/get" {
        return serde_json::json!({ "note": null, "blocks": [] });
    }

    // /api/notes/sync/status
    if path == "/api/notes/sync/status" {
        return serde_json::json!({
            "lastPush": null,
            "lastPull": null,
            "pending": 0,
            "enabled": false,
        });
    }

    // /api/projects
    if path == "/api/projects" {
        return serde_json::json!([]);
    }

    // /api/catalog/repos/scan-roots
    if path == "/api/catalog/repos/scan-roots" {
        return serde_json::json!({
            "kind": "catalog.repos.scan-roots",
            "deterministic": true,
            "updated": false,
            "count": 0,
            "repos": [],
            "selectedRepo": null,
            "storage": { "path": "", "exists": false },
            "workspaceScan": null,
        });
    }

    // /api/agent/runs
    if path == "/api/agent/runs" {
        return serde_json::json!({ "runs": [], "count": 0 });
    }

    // /api/agent/definitions
    if path == "/api/agent/definitions" {
        return serde_json::json!({ "agents": [], "count": 0 });
    }

    // /api/agent/completions
    if path == "/api/agent/completions" {
        return serde_json::json!({ "completions": [], "count": 0 });
    }

    // /api/agent/status
    if path == "/api/agent/status" {
        return serde_json::json!({
            "available": false,
            "activeRuns": 0,
        });
    }

    // /api/agent/health
    if path == "/api/agent/health" {
        return serde_json::json!({
            "ok": false,
            "status": "unavailable",
        });
    }

    // /api/lifecycle
    if path == "/api/lifecycle/status" {
        return serde_json::json!({
            "ok": true,
            "state": "active",
        });
    }

    // /api/catalog/harness-assets/check
    if path == "/api/catalog/harness-assets/check" {
        return serde_json::json!({
            "ok": true,
            "missing": [],
            "outdated": [],
        });
    }

    // /api/codex-planning-status
    if path == "/api/codex-planning-status" {
        return serde_json::json!({
            "configured": false,
            "available": false,
        });
    }

    // /api/stats/provider-usage
    if path == "/api/stats/provider-usage" {
        return serde_json::json!({
            "providers": [],
            "totals": { "requests": 0, "tokens": 0 },
        });
    }

    // /api/telemetry/harnesses
    if path == "/api/telemetry/harnesses" {
        return serde_json::json!({ "harnesses": [], "count": 0 });
    }

    // /api/codex/cli/status
    if path == "/api/codex/cli/status" {
        return serde_json::json!({
            "installed": false,
            "version": null,
            "path": null,
        });
    }

    // /api/claude-code/status
    if path == "/api/claude-code/status" {
        return serde_json::json!({
            "installed": false,
            "version": null,
            "path": null,
        });
    }

    // /api/opencode/status
    if path == "/api/opencode/status" {
        return serde_json::json!({
            "status": "unavailable",
            "configVersion": 0,
            "config": null,
            "setupChecks": [],
            "warnings": [],
            "profiles": [],
            "elegyPlanningCli": null,
            "elegySkillsAssets": null,
            "planningLiveAuthority": null,
            "worktreePermissionProfile": null,
            "opencodeCli": null,
            "availableModels": [],
            "profileMismatch": null,
        });
    }

    // /api/tooling/cli/status
    if path == "/api/tooling/cli/status" {
        return serde_json::json!({
            "ok": false,
            "tools": {},
        });
    }

    // /api/dashboard/summary (just in case the typed route is bypassed)
    if path == "/api/dashboard/summary" {
        return serde_json::json!({
            "activeSessionCount": 0,
            "totalSessionCount": 0,
            "recentActivity": [],
            "healthIndicator": "ok",
            "source": "rust-runtime",
        });
    }

    // /api/catalog/summary
    if path == "/api/catalog/summary" {
        return serde_json::json!({
            "kind": "catalog.summary",
            "deterministic": true,
            "summary": {
                "schemaVersion": "1",
                "generatedAt": "1970-01-01T00:00:00Z",
                "globalInventory": { "harnesses": [], "sections": [] },
                "providers": [],
                "externalSources": [],
                "stats": { "providers": 0, "externalSources": 0, "assets": 0, "bundles": 0 },
                "activation": null,
            },
        });
    }

    // /api/catalog/repos
    if path == "/api/catalog/repos" {
        return serde_json::json!({
            "kind": "catalog.repos.list",
            "deterministic": true,
            "count": 0,
            "selectedRepo": null,
            "storage": { "path": "", "exists": false },
            "workspaceScan": null,
            "repos": [],
        });
    }

    // /api/assets/managed
    if path == "/api/assets/managed" {
        return serde_json::json!({ "managed": [], "count": 0 });
    }

    // /api/assets/installed
    if path == "/api/assets/installed" {
        return serde_json::json!({
            "agents": [],
            "skills": [],
            "prompts": [],
            "instructions": { "installed": false, "absPath": "" },
        });
    }

    // Generic collection shape: try to infer name from second-to-last segment
    // /api/X/list -> { X: [], count: 0 }
    if let Some(last) = segments.last() {
        if *last == "list" && segments.len() >= 2 {
            let collection = segments[segments.len() - 2];
            let mut obj = serde_json::Map::new();
            obj.insert(collection.to_string(), serde_json::json!([]));
            obj.insert("count".to_string(), serde_json::json!(0));
            return serde_json::Value::Object(obj);
        }
    }

    // Generic {items, count} fallback
    if let Some(collection) = segments.get(2) {
        // /api/<resource>/<maybe-id> style
        let mut obj = serde_json::Map::new();
        let singular = collection.trim_end_matches('s');
        obj.insert(singular.to_string(), serde_json::json!(null));
        return serde_json::Value::Object(obj);
    }

    // Last resort — clearly mark as stub for transparency
    serde_json::json!({
        "ok": true,
        "stub": true,
        "path": path,
        "reason": "no_rust_implementation_yet",
    })
}
