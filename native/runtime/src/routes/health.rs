use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use elegy_native_contracts::{RuntimeHealthResponse, VersionResponse};
use serde_json::json;

use crate::app::{policy_preflight, AppState};
use crate::runtime::build_runtime_health;

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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(get_health))
        .with_state(state)
}
