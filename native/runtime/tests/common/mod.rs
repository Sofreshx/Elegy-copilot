use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use elegy_native_runtime::app::{build_router, AppState};
use elegy_native_runtime::auth::AuthConfig;
use elegy_native_runtime::config::RuntimeConfig;
use serde_json::Value;
use tower::util::ServiceExt;

pub fn test_state(tmp: &Path) -> AppState {
    let elegy_home = tmp.join(".elegy");
    let sandboxes_home = elegy_home.join("sandboxes");
    let session_state = elegy_home.join("session-state");
    std::fs::create_dir_all(&sandboxes_home).ok();
    std::fs::create_dir_all(&session_state).ok();

    let config = RuntimeConfig {
        engine_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repo root should exist")
            .to_path_buf(),
        host: "127.0.0.1".to_string(),
        port: 0,
        elegy_home,
        sandboxes_home,
    };

    let state = AppState::new(
        config,
        AuthConfig {
            token: None,
            allow_loopback_bypass: true,
        },
    );
    state.update_version(0, None);
    state
}

pub async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&body_bytes)
        .unwrap_or_else(|_| serde_json::json!({"raw": String::from_utf8_lossy(&body_bytes)}));
    (status, json)
}

pub async fn post_json(app: axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&body_bytes)
        .unwrap_or_else(|_| serde_json::json!({"raw": String::from_utf8_lossy(&body_bytes)}));
    (status, json)
}

pub fn assert_ok(status: StatusCode) {
    assert!(status.is_success(), "expected 2xx, got {}", status);
}
