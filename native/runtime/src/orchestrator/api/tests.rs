use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::*;
use crate::auth::AuthConfig;

fn state(root: &Path) -> AppState {
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
