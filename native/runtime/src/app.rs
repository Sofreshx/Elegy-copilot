use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use axum::extract::Path;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use chrono::Utc;
use elegy_native_contracts::{
    DashboardSummaryResponse, PolicyPreflightResponse, ProjectActivityResponse, ProjectResponse,
    ProjectSessionResponse, RuntimeHealthResponse, VersionResponse,
};
use serde::Deserialize;
use serde_json::json;

use crate::config::RuntimeConfig;
use crate::dashboard::build_dashboard_summary;
use crate::policy::evaluate_policy_preflight;
use crate::projects::{
    list_project_activity, list_project_sessions, list_projects, update_project_fields,
};
use crate::runtime::build_runtime_health;

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: RuntimeConfig,
    version_state: Arc<Mutex<VersionResponse>>,
    policy_cache: Arc<Mutex<Option<CachedPolicyPreflight>>>,
}

#[derive(Debug, Clone)]
struct CachedPolicyPreflight {
    value: PolicyPreflightResponse,
    expires_at_ms: u64,
}

#[derive(Debug, Deserialize)]
struct PolicyPreflightQuery {
    refresh: Option<String>,
}

impl AppState {
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
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

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/policy/preflight", get(get_policy_preflight))
        .route("/api/health", get(get_health))
        .route("/api/version", get(get_version))
        .route("/api/dashboard/summary", get(get_dashboard_summary))
        .route("/api/projects", get(get_projects))
        .route("/api/projects/{project_id}", patch(patch_project))
        .route(
            "/api/projects/{project_id}/sessions",
            get(get_project_sessions),
        )
        .route(
            "/api/projects/{project_id}/activity",
            get(get_project_activity),
        )
        .with_state(state)
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

async fn get_policy_preflight(
    State(state): State<AppState>,
    Query(query): Query<PolicyPreflightQuery>,
) -> Json<PolicyPreflightResponse> {
    let refresh = query.refresh.as_deref() == Some("1");
    Json(policy_preflight(&state, refresh))
}

async fn get_health(State(state): State<AppState>) -> Json<RuntimeHealthResponse> {
    let version = state
        .version_state
        .lock()
        .map(|value| value.clone())
        .unwrap_or(VersionResponse {
            version: 0,
            last_changed_ms: None,
        });
    let policy = policy_preflight(&state, false);
    let planning_persistence = json!({
        "kind": "planning.persistence.health",
        "contractVersion": "planning_api_v1",
        "ready": false,
        "status": "disabled",
        "required": false,
        "configured": false,
        "usable": false,
        "initSupported": false,
        "initRequired": false,
        "error": null,
    });
    let runtime = build_runtime_health(&state.config.engine_root, &state.config.sandboxes_home);

    Json(RuntimeHealthResponse {
        ok: true,
        now: Utc::now().timestamp_millis() as u64,
        engine_root: state.config.engine_root.display().to_string(),
        elegy_home: state.config.elegy_home.display().to_string(),
        changes: Some(version),
        runtime,
        policy: serde_json::to_value(policy).expect("policy response should serialize"),
        planning_persistence,
        planning_durability_dependency_gate: Some(json!({
            "status": "open",
            "reason": "rust_runtime_bootstrap",
            "deterministic": true,
        })),
        startup_managed_asset_sync: Some(json!({
            "startedAt": Utc::now().to_rfc3339(),
            "status": "not_started",
            "mode": "rust_bootstrap_additive",
        })),
        autonomous_decision_log: Some(json!({
            "available": false,
            "reason": "not_ported",
        })),
    })
}

async fn get_version(State(state): State<AppState>) -> Json<VersionResponse> {
    let version = state
        .version_state
        .lock()
        .map(|value| value.clone())
        .unwrap_or(VersionResponse {
            version: 0,
            last_changed_ms: None,
        });
    Json(version)
}

async fn get_dashboard_summary(State(state): State<AppState>) -> Json<DashboardSummaryResponse> {
    Json(build_dashboard_summary(&state.config.elegy_home))
}

async fn get_projects(State(state): State<AppState>) -> Json<Vec<ProjectResponse>> {
    Json(list_projects(&state.config.elegy_home))
}

async fn get_project_sessions(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Json<Vec<ProjectSessionResponse>> {
    Json(list_project_sessions(
        &state.config.elegy_home,
        &project_id,
    ))
}

async fn get_project_activity(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Json<Vec<ProjectActivityResponse>> {
    Json(list_project_activity(
        &state.config.elegy_home,
        &project_id,
    ))
}

async fn patch_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let normalized_project_id = project_id.trim();
    if normalized_project_id.is_empty() {
        return project_error(
            StatusCode::BAD_REQUEST,
            "projects.update",
            "Project ID is required",
        );
    }

    match update_project_fields(&state.config.elegy_home, normalized_project_id, &payload) {
        Some(project) => (
            StatusCode::OK,
            Json(serde_json::to_value(project).expect("project response should serialize")),
        ),
        None => project_error(
            StatusCode::NOT_FOUND,
            "projects.update",
            &format!("Project not found: {normalized_project_id}"),
        ),
    }
}

fn project_error(status: StatusCode, kind: &str, error: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(json!({
            "kind": kind,
            "deterministic": true,
            "error": error,
        })),
    )
}

fn policy_preflight(state: &AppState, refresh: bool) -> PolicyPreflightResponse {
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
        let state = AppState::new(config);
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
        assert_eq!(
            policy_shape.body_keys,
            Some(vec![
                "checkedAt".to_string(),
                "message".to_string(),
                "ok".to_string(),
                "status".to_string(),
                "validatorPath".to_string(),
            ])
        );

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
