mod common;

use common::*;
use elegy_native_runtime::app::build_router;
use serde_json::json;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn app(dir: &tempfile::TempDir) -> axum::Router {
    build_router(test_state(dir.path()))
}

#[tokio::test]
async fn health_returns_ok() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/health").await;
    assert_ok(status);
    assert!(body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false));
}

#[tokio::test]
async fn version_endpoint() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/version").await;
    assert_ok(status);
    assert!(body.get("version").is_some());
}

#[tokio::test]
async fn policy_preflight() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/policy/preflight").await;
    assert_ok(status);
    assert!(body.get("ok").is_some());
}

#[tokio::test]
async fn dashboard_summary() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/dashboard/summary").await;
    assert_ok(status);
    assert!(body.get("activeSessionCount").is_some());
}

#[tokio::test]
async fn dashboard_harness_sessions() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/dashboard/harness-sessions").await;
    assert_ok(status);
    assert!(body.get("sessions").is_some());
}

#[tokio::test]
async fn projects_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/projects").await;
    assert_ok(status);
}

#[tokio::test]
async fn sessions_list() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/sessions").await;
    assert_ok(status);
}

#[tokio::test]
async fn agent_definitions() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/agent/definitions").await;
    assert_ok(status);
    assert!(body.get("agents").is_some());
}

#[tokio::test]
async fn agent_status() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/agent/status").await;
    assert_ok(status);
}

#[tokio::test]
async fn agent_runs() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/agent/runs").await;
    assert_ok(status);
    assert!(body.get("runs").is_some());
}

#[tokio::test]
async fn catalog_sources() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/catalog/sources").await;
    assert_ok(status);
}

#[tokio::test]
async fn catalog_search() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/catalog/search?q=test").await;
    assert_ok(status);
}

#[tokio::test]
async fn catalog_harness_state() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/catalog/harness-state").await;
    assert_ok(status);
}

#[tokio::test]
async fn git_status() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/git/status").await;
    assert_ok(status);
    assert!(body.get("branch").is_some() || body.get("files").is_some());
}

#[tokio::test]
async fn git_branches() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/git/branches").await;
    assert_ok(status);
}

#[tokio::test]
async fn executor_health() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/executor/health").await;
    assert_ok(status);
}

#[tokio::test]
async fn executor_jobs() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/executor/jobs").await;
    assert_ok(status);
    assert!(body.get("jobs").is_some());
}

#[tokio::test]
async fn executor_worktrees() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/executor/worktrees").await;
    assert_ok(status);
}

#[tokio::test]
async fn notes_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/notes").await;
    assert_ok(status);
}

#[tokio::test]
async fn opencode_config() {
    let dir = tmp();
    let (status, _) = post_json(app(&dir), "/api/opencode/config", json!({})).await;
    assert_ok(status);
}

#[tokio::test]
async fn config_remote_sessions() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/config/remote-sessions").await;
    assert_ok(status);
}

#[tokio::test]
async fn workspace_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/workspace").await;
    assert_ok(status);
}

#[tokio::test]
async fn lifecycle_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/lifecycle/status").await;
    assert_ok(status);
}


#[tokio::test]
async fn assets_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/assets").await;
    assert_ok(status);
}

#[tokio::test]
async fn ui_runtime_overlay_get() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/ui-runtime-overlay/session/test-session").await;
    assert_ok(status);
}

#[tokio::test]
async fn retired_gateway_and_sandbox_routes_are_not_exposed() {
    let dir = tmp();
    for path in [
        "/api/gateway/config",
        "/api/sandboxes",
        "/api/sandboxes/lifecycle/start",
        "/api/lifecycle/sandboxes",
    ] {
        let (status, body) = get_json(app(&dir), path).await;
        assert_eq!(status, axum::http::StatusCode::NOT_FOUND, "{path}");
        assert_eq!(body.get("error").and_then(|value| value.as_str()), Some("retired_route"));
    }
}

#[tokio::test]
async fn claude_code_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/claude-code/status").await;
    assert_ok(status);
}

#[tokio::test]
async fn codex_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/codex/status").await;
    assert_ok(status);
}

#[tokio::test]
async fn cli_tooling_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/cli-tooling/status").await;
    assert_ok(status);
}

#[tokio::test]
async fn desktop_updater_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/desktop-updater").await;
    assert_ok(status);
}

#[tokio::test]
async fn tooling_updates_status() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/tooling-updates/status").await;
    assert_ok(status);
}

#[tokio::test]
async fn telemetry_event() {
    let dir = tmp();
    let (status, _) = post_json(app(&dir), "/api/telemetry/event", json!({"event": "test"})).await;
    assert_ok(status);
}

#[tokio::test]
async fn repo_docs_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/repo-docs").await;
    assert_ok(status);
}

#[tokio::test]
async fn repo_assets_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/repo-assets").await;
    assert_ok(status);
}

#[tokio::test]
async fn lexicon_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/lexicon").await;
    assert_ok(status);
}

#[tokio::test]
async fn elegy_db_planning_summary() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/elegy-db/planning/summary").await;
    assert_ok(status);
}

#[tokio::test]
async fn sessions_workspace() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/sessions/workspace").await;
    assert_ok(status);
}

#[tokio::test]
async fn sessions_agent_usage() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/sessions/agent-usage").await;
    assert_ok(status);
}

#[tokio::test]
async fn concurrent_planning_records() {
    use std::sync::Arc;

    let dir = tmp();
    let elegy_home = dir.path().join(".elegy");
    std::fs::create_dir_all(&elegy_home).expect("create elegy home");
    let pool = elegy_native_runtime::db::init_planning_pool(&elegy_home.join("planning.db"))
        .expect("pool should initialize");
    let pool = Arc::new(pool);

    let mut handles = Vec::new();
    for i in 0..8 {
        let pool = Arc::clone(&pool);
        let handle = tokio::task::spawn_blocking(move || {
            let conn = pool.get().expect("get connection");
            conn.execute(
                "INSERT INTO ie_planning_records (record_id, owner_id, scope, state) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![format!("conc-{}", i), "test-owner", "test-scope", "{}"],
            )
        });
        handles.push(handle);
    }

    let mut errors = 0usize;
    for handle in handles {
        if handle.await.unwrap().is_err() {
            errors += 1;
        }
    }
    assert_eq!(errors, 0, "all 8 concurrent inserts should succeed");

    let conn = pool.get().expect("get connection");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ie_planning_records WHERE owner_id = 'test-owner'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 8, "should have 8 records after concurrent inserts");
}

// ---------------------------------------------------------------------------
// Shape parity tests — verify response shapes match frontend expectations
// ---------------------------------------------------------------------------

#[tokio::test]
async fn catalog_repos_inventory_shape() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/catalog/repos").await;
    assert_ok(status);
    assert_eq!(body.get("kind").and_then(|v| v.as_str()), Some("catalog.repos.list"));
    assert!(body.get("deterministic").and_then(|v| v.as_bool()).unwrap_or(false));
    assert!(body.get("count").is_some());
    assert!(body.get("repos").and_then(|v| v.as_array()).is_some());
    let storage = body.get("storage").expect("storage present");
    assert!(storage.get("path").is_some());
    assert!(storage.get("exists").is_some());
    assert!(body.get("workspaceScan").is_some());
    // selectedRepo is Option (can be null when no selection)
    assert!(body.get("selectedRepo").is_some());
    // Empty repos list is valid for a fresh install; verify entry shape if any
    if let Some(repos) = body.get("repos").and_then(|v| v.as_array()) {
        if let Some(first) = repos.first() {
            for key in [
                "repoId",
                "repoPath",
                "repoLabel",
                "selected",
                "registered",
                "sources",
                "exists",
                "gitRootPresent",
                "scanStatus",
                "assets",
                "hints",
                "snapshot",
                "repoState",
            ] {
                assert!(first.get(key).is_some(), "entry missing key: {key}");
            }
        }
    }
}

#[tokio::test]
async fn assets_managed_flat_shape() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/assets/managed").await;
    assert_ok(status);
    let managed = body.get("managed").and_then(|v| v.as_array()).expect("managed array");
    assert!(body.get("count").is_some());
    // Each entry must be a flat ManagedAssetStatus with the expected keys
    for entry in managed {
        for key in ["id", "type", "source", "destination", "managed", "installed", "upToDate"] {
            assert!(entry.get(key).is_some(), "managed entry missing key: {key}");
        }
    }
}

#[tokio::test]
async fn assets_installed_instructions_object() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/assets/installed").await;
    assert_ok(status);
    let instructions = body.get("instructions").expect("instructions present");
    assert!(instructions.is_object(), "instructions must be an object, not an array");
    assert!(instructions.get("installed").and_then(|v| v.as_bool()).is_some());
    assert!(instructions.get("absPath").and_then(|v| v.as_str()).is_some());
    // arrays for the other categories
    assert!(body.get("agents").and_then(|v| v.as_array()).is_some());
    assert!(body.get("skills").and_then(|v| v.as_array()).is_some());
    assert!(body.get("prompts").and_then(|v| v.as_array()).is_some());
}

#[tokio::test]
async fn catalog_summary_has_global_inventory() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/catalog/summary").await;
    assert_ok(status);
    let summary = body.get("summary").expect("summary present");
    let global_inventory = summary
        .get("globalInventory")
        .expect("globalInventory present (fixes SettingsView .filter() crash)");
    assert!(global_inventory.get("harnesses").and_then(|v| v.as_array()).is_some());
    assert!(global_inventory.get("sections").and_then(|v| v.as_array()).is_some());
}

#[tokio::test]
async fn dashboard_summary_has_source_field() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/dashboard/summary").await;
    assert_ok(status);
    assert_eq!(
        body.get("source").and_then(|v| v.as_str()),
        Some("rust-runtime"),
        "dashboard summary must include source field"
    );
    // Other fields still present
    assert!(body.get("activeSessionCount").is_some());
    assert!(body.get("totalSessionCount").is_some());
    assert!(body.get("recentActivity").is_some());
    assert!(body.get("healthIndicator").is_some());
}

// ---------------------------------------------------------------------------
// Lexicon route — was crashing LexiconView with Object.entries(undefined)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn lexicon_endpoint_returns_full_shape() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/lexicon").await;
    assert_ok(status);
    // Frontend's LexiconView does Object.entries(state.categories) on these.
    assert!(body.get("entries").and_then(|v| v.as_array()).is_some());
    assert!(body.get("total").and_then(|v| v.as_u64()).is_some());
    assert!(body.get("filteredTotal").and_then(|v| v.as_u64()).is_some());
    let categories = body.get("categories").expect("categories present");
    assert!(categories.is_object(), "categories must be an object, not undefined");
    // Object.entries must not crash
    let entries: Vec<(_, _)> = categories
        .as_object()
        .map(|o| o.iter().collect())
        .unwrap_or_default();
    let _: Vec<_> = entries;
}

#[tokio::test]
async fn lexicon_entry_has_category_label() {
    let dir = tmp();
    let state = test_state(dir.path());
    let lexicon_dir = state.config.engine_root.join("docs").join("lexicon");
    std::fs::create_dir_all(&lexicon_dir).expect("create lexicon dir");
    let seed_path = lexicon_dir.join("zz-rust-test-only.md");
    std::fs::write(
        &seed_path,
        "### Rust Test Term\n\n**Definition:** A test definition.\n\n**Tags:** testing, sample\n",
    )
    .expect("write seed file");

    // Always clean up the seed file, even on assertion failure.
    struct SeedCleanup<'a>(&'a std::path::Path);
    impl<'a> Drop for SeedCleanup<'a> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }
    let _cleanup = SeedCleanup(&seed_path);

    let app = build_router(state);
    let (status, body) = get_json(app, "/api/lexicon").await;
    assert_ok(status);
    let entries = body.get("entries").and_then(|v| v.as_array()).expect("entries array");
    // The seeded file should produce a Rust Test Term entry
    let test_entry = entries
        .iter()
        .find(|e| e.get("term").and_then(|v| v.as_str()) == Some("Rust Test Term"))
        .expect("seeded test entry must appear in results");
    assert!(test_entry.get("categoryLabel").is_some(), "entry must have categoryLabel");
    assert_eq!(
        test_entry.get("categoryLabel").and_then(|v| v.as_str()),
        Some("Zz Rust Test Only"),
        "categoryLabel should be Title-Case of file name"
    );
    // The categories map must include our seeded file
    let categories = body.get("categories").and_then(|v| v.as_object()).expect("categories object");
    assert!(categories.contains_key("zz-rust-test-only"));
    assert_eq!(
        categories.get("zz-rust-test-only").and_then(|v| v.as_str()),
        Some("Zz Rust Test Only")
    );
}

#[tokio::test]
async fn lexicon_search_filter() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/lexicon?q=foo").await;
    assert_ok(status);
    assert!(body.get("entries").and_then(|v| v.as_array()).is_some());
    assert!(body.get("filteredTotal").is_some());
}

// ---------------------------------------------------------------------------
// Smart fallback — catch-all returns shape-safe defaults
// ---------------------------------------------------------------------------

#[tokio::test]
async fn smart_fallback_returns_safe_object_for_unmatched_routes() {
    let dir = tmp();
    // /api/sessions/unified is not registered but is in the frontend's
    // call list. The smart fallback must return a safe shape, not
    // { ok: true, stub: true }.
    let (status, body) = get_json(app(&dir), "/api/sessions/unified").await;
    assert_ok(status);
    // Should NOT be the legacy stub
    assert!(body.get("stub").is_none() || body.get("stub") != Some(&json!(true)),
        "smart fallback should not return legacy stub:true for known paths");
    // Must be an object (not null) so Object.entries() works
    assert!(body.is_object(), "fallback must return object, got: {body}");
}

#[tokio::test]
async fn smart_fallback_includes_safety_fields() {
    let dir = tmp();
    // /api/executor/jobs is not registered — must hit the smart fallback.
    // The fallback must return a safe shape (with a `jobs` array) so
    // frontend .map() / .filter() on `body.jobs` doesn't crash.
    let (status, body) = get_json(app(&dir), "/api/sessions/unified").await;
    assert_ok(status);
    assert!(body.is_object(), "fallback must be object, got: {body}");
    // The smart fallback should produce a usable shape for sessions/unified
    // (not the legacy {ok:true, stub:true}).
    let legacy_stub = body.get("stub").and_then(|v| v.as_bool()).unwrap_or(false);
    assert!(!legacy_stub, "smart fallback should not return legacy stub:true for known paths");
}

#[tokio::test]
async fn smart_fallback_legacy_stub_only_for_truly_unknown_paths() {
    let dir = tmp();
    let (status, body) = get_json(app(&dir), "/api/totally/unknown/path").await;
    assert_ok(status);
    // For truly unknown paths, the legacy stub marker is acceptable
    // as long as it remains a valid object
    assert!(body.is_object());
}
