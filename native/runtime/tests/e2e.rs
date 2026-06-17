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
async fn lifecycle_full_sandboxes() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/lifecycle/sandboxes").await;
    assert_ok(status);
}

#[tokio::test]
async fn sandboxes_list() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/sandboxes").await;
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
async fn gateway_config() {
    let dir = tmp();
    let (status, _) = get_json(app(&dir), "/api/gateway/config").await;
    assert_ok(status);
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
