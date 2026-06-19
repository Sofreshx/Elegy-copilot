use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::*;
use crate::auth::AuthConfig;
use crate::config::OrchestratorPilotConfig;

fn state(root: &Path) -> AppState {
    state_with_pilot(root, true, false)
}

fn state_with_pilot(root: &Path, enabled: bool, merge_requested: bool) -> AppState {
    std::fs::create_dir_all(root.join(".elegy/sandboxes")).expect("elegy home");
    AppState::new(
        RuntimeConfig {
            engine_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .expect("root")
                .to_path_buf(),
            host: "127.0.0.1".into(),
            port: 0,
            elegy_home: root.join(".elegy"),
            sandboxes_home: root.join(".elegy/sandboxes"),
            orchestrator_pilot: OrchestratorPilotConfig {
                enabled,
                merge_requested,
            },
            node_executable: None,
            kimaki_entrypoint: None,
        },
        AuthConfig {
            token: None,
            allow_loopback_bypass: true,
        },
    )
}

async fn send(
    app: Router,
    method: &str,
    uri: &str,
    key: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("idempotency-key", key);
    }
    let response = app
        .oneshot(
            request
                .body(Body::from(serde_json::to_vec(&body).expect("body")))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("bytes");
    (status, serde_json::from_slice(&bytes).expect("json"))
}

#[tokio::test]
async fn mutations_require_idempotency_and_replay_identical_payloads() {
    let root = tempfile::tempdir().expect("root");
    let app = router(state(root.path()));
    let body = json!({
        "sessionId": "session-1",
        "repoId": "repo-1",
        "adapterId": "native"
    });
    let (missing, error) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        None,
        body.clone(),
    )
    .await;
    assert_eq!(missing, StatusCode::BAD_REQUEST);
    assert_eq!(error["code"], "idempotency_key_required");

    let (created, first) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("create-1"),
        body.clone(),
    )
    .await;
    let (replayed, second) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("create-1"),
        body,
    )
    .await;
    assert_eq!(created, StatusCode::CREATED);
    assert_eq!(replayed, StatusCode::CREATED);
    assert_eq!(first, second);

    let (conflict, error) = send(
        app,
        "POST",
        "/api/orchestrator/sessions",
        Some("create-1"),
        json!({
            "sessionId": "session-2",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    assert_eq!(conflict, StatusCode::CONFLICT);
    assert_eq!(error["code"], "idempotency_conflict");
}

#[tokio::test]
async fn stale_revision_is_deterministic_and_events_replay_in_order() {
    let root = tempfile::tempdir().expect("root");
    let state = state(root.path());
    let app = router(state.clone());
    send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("create"),
        json!({
            "sessionId": "session-1",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    let (updated, _) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions/session-1/work-points",
        Some("work-1"),
        json!({ "workPointId": "wp-1", "expectedRevision": 1 }),
    )
    .await;
    assert_eq!(updated, StatusCode::OK);
    let (stale, error) = send(
        app,
        "POST",
        "/api/orchestrator/sessions/session-1/cancel",
        Some("cancel-1"),
        json!({ "expectedRevision": 1 }),
    )
    .await;
    assert_eq!(stale, StatusCode::CONFLICT);
    assert_eq!(error["code"], "stale_state");
    assert_eq!(error["details"]["actualRevision"], 2);

    let session = state
        .orchestrator_api
        .read_session("session-1")
        .expect("session");
    let replay = session
        .events
        .iter()
        .filter(|event| event.event_id > 1)
        .map(|event| event.event_id)
        .collect::<Vec<_>>();
    assert_eq!(replay, vec![2]);
}

#[tokio::test]
async fn idempotency_and_event_replay_survive_api_restart() {
    let root = tempfile::tempdir().expect("root");
    let body = json!({
        "sessionId": "session-1",
        "repoId": "repo-1",
        "adapterId": "native"
    });
    let first_app = router(state(root.path()));
    let (created, first) = send(
        first_app,
        "POST",
        "/api/orchestrator/sessions",
        Some("create"),
        body.clone(),
    )
    .await;
    assert_eq!(created, StatusCode::CREATED);

    let restarted = state(root.path());
    let (replayed, second) = send(
        router(restarted.clone()),
        "POST",
        "/api/orchestrator/sessions",
        Some("create"),
        body,
    )
    .await;
    assert_eq!(replayed, StatusCode::CREATED);
    assert_eq!(first, second);
    assert_eq!(
        restarted
            .orchestrator_api
            .events_after("session-1", 0)
            .expect("events")
            .len(),
        1
    );
}

#[tokio::test]
async fn health_and_sse_replay_expose_stable_contracts() {
    let root = tempfile::tempdir().expect("root");
    let state = state(root.path());
    let app = router(state.clone());
    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/orchestrator/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("health");
    assert_eq!(health.status(), StatusCode::OK);

    send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("create"),
        json!({
            "sessionId": "session-1",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    let replay = state
        .orchestrator_api
        .events_after("session-1", 0)
        .expect("replay");
    assert_eq!(replay.len(), 1);
    assert_eq!(replay[0].event_id, 1);
}

#[tokio::test]
async fn bounded_pilot_defaults_off_and_rejects_dispatch() {
    let root = tempfile::tempdir().expect("root");
    let app = router(state_with_pilot(root.path(), false, false));
    let (status, error) = send(
        app,
        "POST",
        "/api/orchestrator/sessions",
        Some("disabled"),
        json!({
            "sessionId": "session-disabled",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error["code"], "pilot_disabled");
}

#[tokio::test]
async fn bounded_pilot_allows_native_and_codex_with_one_active_run_per_repo() {
    let root = tempfile::tempdir().expect("root");
    let state = state(root.path());
    let app = router(state.clone());
    let (created, _) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("native"),
        json!({
            "sessionId": "native-session",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    assert_eq!(created, StatusCode::CREATED);

    let (duplicate, error) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("duplicate"),
        json!({
            "sessionId": "duplicate-session",
            "repoId": "repo-1",
            "adapterId": "codex-exec"
        }),
    )
    .await;
    assert_eq!(duplicate, StatusCode::CONFLICT);
    assert_eq!(error["code"], "conflict");

    let (blocked_adapter, error) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("opencode"),
        json!({
            "sessionId": "opencode-session",
            "repoId": "repo-2",
            "adapterId": "opencode-acp"
        }),
    )
    .await;
    assert_eq!(blocked_adapter, StatusCode::FORBIDDEN);
    assert_eq!(error["code"], "pilot_policy_rejected");

    let (cancelled, _) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions/native-session/cancel",
        Some("cancel"),
        json!({ "expectedRevision": 1 }),
    )
    .await;
    assert_eq!(cancelled, StatusCode::OK);
    let (cancel_replay, _) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions/native-session/cancel",
        Some("cancel"),
        json!({ "expectedRevision": 1 }),
    )
    .await;
    assert_eq!(cancel_replay, StatusCode::OK);
    let (codex, _) = send(
        app,
        "POST",
        "/api/orchestrator/sessions",
        Some("codex"),
        json!({
            "sessionId": "codex-session",
            "repoId": "repo-1",
            "adapterId": "codex-exec"
        }),
    )
    .await;
    assert_eq!(codex, StatusCode::CREATED);
    assert_eq!(
        state
            .orchestrator_api
            .telemetry
            .event_count()
            .expect("count"),
        2
    );
}

#[tokio::test]
async fn merge_requires_explicit_request_and_persisted_promotion_gates() {
    let root = tempfile::tempdir().expect("root");
    let state = state_with_pilot(root.path(), true, true);
    let app = router(state);
    send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions",
        Some("create"),
        json!({
            "sessionId": "session-merge",
            "repoId": "repo-1",
            "adapterId": "native"
        }),
    )
    .await;
    let (blocked, error) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/sessions/session-merge/approvals",
        Some("merge-blocked"),
        json!({ "operation": "merge", "decision": "approved" }),
    )
    .await;
    assert_eq!(blocked, StatusCode::FORBIDDEN);
    assert_eq!(error["code"], "pilot_policy_rejected");

    let pilot_dir = root.path().join(".elegy/orchestrator/pilot");
    std::fs::create_dir_all(&pilot_dir).expect("pilot");
    std::fs::write(
        pilot_dir.join("promotion-gates.json"),
        br#"{"staleApprovalGatePassed":true,"crashInjectionGatePassed":true}"#,
    )
    .expect("gates");
    let (approved, _) = send(
        app,
        "POST",
        "/api/orchestrator/sessions/session-merge/approvals",
        Some("merge-approved"),
        json!({ "operation": "merge", "decision": "approved" }),
    )
    .await;
    assert_eq!(approved, StatusCode::OK);
}

#[tokio::test]
async fn pilot_event_endpoint_records_worker_and_recovery_outcomes() {
    let root = tempfile::tempdir().expect("root");
    let state = state(root.path());
    let app = router(state.clone());
    for (index, category) in [
        "adapter-parse-failure",
        "recovery-failure",
        "scope-violation",
    ]
    .into_iter()
    .enumerate()
    {
        let key = format!("pilot-{index}");
        let (status, event) = send(
            app.clone(),
            "POST",
            "/api/orchestrator/pilot/events",
            Some(&key),
            json!({
                "category": category,
                "repoId": "repo-1",
                "outcome": "rejected"
            }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(event["category"], category);
    }
    let replay_body = json!({
        "category": "recovery-failure",
        "repoId": "repo-1",
        "outcome": "rejected"
    });
    let (_, first) = send(
        app.clone(),
        "POST",
        "/api/orchestrator/pilot/events",
        Some("pilot-replay"),
        replay_body.clone(),
    )
    .await;
    let (_, replay) = send(
        app,
        "POST",
        "/api/orchestrator/pilot/events",
        Some("pilot-replay"),
        replay_body,
    )
    .await;
    assert_eq!(first["eventId"], replay["eventId"]);
    assert_eq!(
        state
            .orchestrator_api
            .telemetry
            .event_count()
            .expect("count"),
        4
    );
}
