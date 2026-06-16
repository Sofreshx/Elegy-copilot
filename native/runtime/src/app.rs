use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use axum::response::IntoResponse;
use axum::Router;
use chrono::Utc;
use elegy_native_contracts::{PolicyPreflightResponse, VersionResponse};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

pub use crate::auth::AuthContext;
use crate::auth::AuthConfig;
use crate::config::RuntimeConfig;
use crate::error::ApiError;
use crate::policy::evaluate_policy_preflight;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: RuntimeConfig,
    pub auth: AuthConfig,
    pub(crate) version_state: Arc<Mutex<VersionResponse>>,
    pub(crate) policy_cache: Arc<Mutex<Option<CachedPolicyPreflight>>>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedPolicyPreflight {
    pub value: PolicyPreflightResponse,
    pub expires_at_ms: u64,
}

impl AppState {
    pub fn new(config: RuntimeConfig, auth: AuthConfig) -> Self {
        Self {
            config,
            auth,
            version_state: Arc::new(Mutex::new(VersionResponse {
                version: 0,
                last_changed_ms: None,
            })),
            policy_cache: Arc::new(Mutex::new(None)),
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

    Router::new()
        .merge(crate::routes::build_routes(state))
        .layer(auth_layer)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .fallback(handle_404)
}

async fn handle_404() -> impl IntoResponse {
    ApiError::NotFound("route not found".to_string())
}

pub async fn serve(state: AppState) -> anyhow::Result<()> {
    let address: SocketAddr = format!("{}:{}", state.config.host, state.config.port)
        .parse()
        .context("invalid bind address")?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .context("failed to bind Rust runtime listener")?;
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("Rust runtime server exited unexpectedly")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
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
