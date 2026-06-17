use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use axum::{
    Router,
    response::{IntoResponse, Json},
    http::{StatusCode, Uri},
};
use chrono::Utc;
use elegy_native_contracts::{PolicyPreflightResponse, VersionResponse};
use tower_http::cors::CorsLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use axum::http::HeaderName;

pub use crate::auth::AuthContext;
use crate::auth::AuthConfig;
use crate::config::RuntimeConfig;
use crate::policy::evaluate_policy_preflight;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: RuntimeConfig,
    pub auth: AuthConfig,
    pub(crate) version_state: Arc<Mutex<VersionResponse>>,
    pub(crate) policy_cache: Arc<Mutex<Option<CachedPolicyPreflight>>>,
    pub(crate) planning_pool: Arc<crate::db::PlanningPool>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedPolicyPreflight {
    pub value: PolicyPreflightResponse,
    pub expires_at_ms: u64,
}

impl AppState {
    pub fn new(config: RuntimeConfig, auth: AuthConfig) -> Self {
        let pool = crate::db::init_planning_pool(&config.elegy_home.join("planning.db"))
            .unwrap_or_else(|e| {
                tracing::warn!("Failed to initialize planning pool: {e}; planning persistence disabled");
                crate::db::init_planning_pool(std::path::Path::new(":memory:"))
                    .expect("in-memory pool should always succeed")
            });
        Self {
            config,
            auth,
            version_state: Arc::new(Mutex::new(VersionResponse {
                version: 0,
                last_changed_ms: None,
            })),
            policy_cache: Arc::new(Mutex::new(None)),
            planning_pool: Arc::new(pool),
        }
    }

    pub fn update_version(&self, version: u64, last_changed_ms: Option<u64>) {
        if let Ok(mut state) = self.version_state.lock() {
            *state = VersionResponse {
                version,
                last_changed_ms,
            };
        }
    }
}

pub(crate) fn policy_preflight(state: &AppState, refresh: bool) -> PolicyPreflightResponse {
    let now_ms = Utc::now().timestamp_millis() as u64;
    if !refresh {
        if let Ok(cache) = state.policy_cache.lock() {
            if let Some(cached) = cache.as_ref() {
                if now_ms < cached.expires_at_ms {
                    return cached.value.clone();
                }
            }
        }
    }

    let value = evaluate_policy_preflight(&state.config.engine_root);
    if let Ok(mut cache) = state.policy_cache.lock() {
        *cache = Some(CachedPolicyPreflight {
            value: value.clone(),
            expires_at_ms: now_ms + 10_000,
        });
    }
    value
}

pub fn build_router(state: AppState) -> Router {
    let auth_layer = axum::middleware::from_fn_with_state(
        state.auth.clone(),
        crate::auth::auth_middleware,
    );

    let ui_path = state.config.engine_root.join("copilot-ui").join("ui-dist");

    let trace_layer = TraceLayer::new_for_http().make_span_with(move |request: &axum::extract::Request| {
        let x_request_id = HeaderName::from_static("x-request-id");
        let request_id = request
            .headers()
            .get(&x_request_id)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");
        tracing::info_span!(
            "request",
            method = %request.method(),
            uri = %request.uri(),
            request_id = %request_id,
        )
    });

    Router::new()
        .merge(crate::routes::build_routes(state.clone()))
        .fallback(move |uri: Uri| {
            let ui_path = ui_path.clone();
            async move {
                let path = uri.path();
                if path.starts_with("/api/") {
                    return Json(serde_json::json!({"ok": true, "stub": true})).into_response();
                }
                let file_path = if path == "/" {
                    ui_path.join("index.html")
                } else {
                    let trimmed = path.trim_start_matches('/');
                    let candidate = ui_path.join(trimmed);
                    if candidate.exists() && !candidate.is_dir() {
                        candidate
                    } else {
                        ui_path.join("index.html")
                    }
                };
                match tokio::fs::read(&file_path).await {
                    Ok(bytes) => {
                        let mime = match file_path.extension().and_then(|e| e.to_str()) {
                            Some("html") => "text/html; charset=utf-8",
                            Some("js") => "application/javascript",
                            Some("css") => "text/css",
                            Some("png") => "image/png",
                            Some("svg") => "image/svg+xml",
                            Some("ico") => "image/x-icon",
                            Some("json") => "application/json",
                            Some("woff2") => "font/woff2",
                            _ => "application/octet-stream",
                        };
                        (
                            StatusCode::OK,
                            [("content-type", mime)],
                            bytes,
                        )
                            .into_response()
                    }
                    Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
                }
            }
        })
        .layer(auth_layer)
        .layer(trace_layer)
        .layer(PropagateRequestIdLayer::new(HeaderName::from_static("x-request-id")))
        .layer(SetRequestIdLayer::new(HeaderName::from_static("x-request-id"), MakeRequestUuid))
        .layer(CorsLayer::permissive())
}

pub async fn serve(state: AppState) -> anyhow::Result<()> {
    let address: SocketAddr = format!("{}:{}", state.config.host, state.config.port)
        .parse()
        .context("invalid bind address")?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .context("failed to bind Rust runtime listener")?;
    serve_on(state, listener).await
}

pub async fn serve_on(state: AppState, listener: tokio::net::TcpListener) -> anyhow::Result<()> {
    let shutdown = graceful_shutdown_signal();
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown)
        .await
        .context("Rust runtime server exited unexpectedly")
}

async fn graceful_shutdown_signal() {
    let (tx, mut rx) = tokio::sync::watch::channel(());

    let stdio_tx = tx.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let reader = tokio::io::BufReader::new(tokio::io::stdin());
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim() == "shutdown" {
                tracing::info!("received shutdown via stdin");
                let _ = stdio_tx.send(());
                break;
            }
        }
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("received shutdown via Ctrl+C");
        }
        _ = rx.changed() => {}
    }

    drop(tx);
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use axum::body::Body;
    use axum::http::Request;
    use tower::util::ServiceExt;

    use crate::auth::AuthConfig;
    use crate::config::RuntimeConfig;
    use crate::response_shape::capture_shape;

    use super::*;

    fn test_state() -> AppState {
        let temp = std::env::temp_dir().join("instruction-engine-rust-runtime-tests");
        let config = RuntimeConfig {
            engine_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(std::path::Path::parent)
                .expect("repo root should exist")
                .to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 0,
            elegy_home: temp.join(".elegy"),
            sandboxes_home: temp.join(".elegy").join("sandboxes"),
        };
        let _ = std::fs::create_dir_all(config.elegy_home.join("session-state"));
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

    #[tokio::test]
    async fn route_shapes_match_initial_contracts() {
        let app = build_router(test_state());

        let policy = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/policy/preflight")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let policy_shape = capture_shape(policy).await;
        assert_eq!(policy_shape.status, 200);
        assert_eq!(
            policy_shape.content_type.as_deref(),
            Some("application/json")
        );
        // Policy response shape varies: exitCode and reason appear when lockfile exists
        assert!(policy_shape.body_keys.as_ref().map_or(false, |keys| {
            keys.contains(&"checkedAt".to_string())
                && keys.contains(&"message".to_string())
                && keys.contains(&"ok".to_string())
                && keys.contains(&"status".to_string())
                && keys.contains(&"validatorPath".to_string())
        }));

        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let health_shape = capture_shape(health).await;
        assert_eq!(health_shape.status, 200);
        assert_eq!(
            health_shape.body_keys,
            Some(vec![
                "autonomousDecisionLog".to_string(),
                "changes".to_string(),
                "elegyHome".to_string(),
                "engineRoot".to_string(),
                "now".to_string(),
                "ok".to_string(),
                "planningDurabilityDependencyGate".to_string(),
                "planningPersistence".to_string(),
                "policy".to_string(),
                "runtime".to_string(),
                "startupManagedAssetSync".to_string(),
            ])
        );

        let version = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let version_shape = capture_shape(version).await;
        assert_eq!(version_shape.status, 200);
        assert_eq!(
            version_shape.body_keys,
            Some(vec!["lastChangedMs".to_string(), "version".to_string()])
        );

        let summary = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard/summary")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let summary_shape = capture_shape(summary).await;
        assert_eq!(summary_shape.status, 200);
        assert_eq!(
            summary_shape.body_keys,
            Some(vec![
                "activeSessionCount".to_string(),
                "healthIndicator".to_string(),
                "recentActivity".to_string(),
                "totalSessionCount".to_string(),
            ])
        );

        let projects = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/projects")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let projects_shape = capture_shape(projects).await;
        assert_eq!(projects_shape.status, 200);
        assert_eq!(projects_shape.body_keys, Some(vec!["[array]".to_string()]));

        let project_sessions = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/projects/test-project-id/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let project_sessions_shape = capture_shape(project_sessions).await;
        assert_eq!(project_sessions_shape.status, 200);
        assert_eq!(
            project_sessions_shape.body_keys,
            Some(vec!["[array]".to_string()])
        );

        let project_activity = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/projects/test-project-id/activity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let project_activity_shape = capture_shape(project_activity).await;
        assert_eq!(project_activity_shape.status, 200);
        assert_eq!(
            project_activity_shape.body_keys,
            Some(vec!["[array]".to_string()])
        );

        let patch_project = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/projects/test-project-id")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        let patch_project_shape = capture_shape(patch_project).await;
        assert_eq!(patch_project_shape.status, 404);
        assert_eq!(
            patch_project_shape.body_keys,
            Some(vec![
                "deterministic".to_string(),
                "error".to_string(),
                "kind".to_string(),
            ])
        );
    }
}
