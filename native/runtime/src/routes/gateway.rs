use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/gateway/state", get(gateway_state))
        .route("/api/gateway/connect", post(gateway_connect))
        .route(
            "/api/gateway/config",
            get(gateway_config_get).post(gateway_config_set),
        )
        .route("/api/gateway/scan-repos", post(gateway_scan_repos))
        .with_state(state)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn gateway_dir(state: &AppState) -> std::path::PathBuf {
    state.config.elegy_home.join("gateway")
}

fn read_gateway_file(
    state: &AppState,
    name: &str,
    default: serde_json::Value,
) -> serde_json::Value {
    let path = gateway_dir(state).join(format!("{}.json", name));
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(default)
    } else {
        default
    }
}

fn write_gateway_file(
    state: &AppState,
    name: &str,
    value: &serde_json::Value,
) -> Json<serde_json::Value> {
    let path = gateway_dir(state).join(format!("{}.json", name));
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(json!({"ok": false, "error": e.to_string()}));
        }
    }
    match serde_json::to_string_pretty(value) {
        Ok(content) => match std::fs::write(&path, content) {
            Ok(()) => Json(json!({"ok": true})),
            Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
    }
}

// ── GET /api/gateway/state ──────────────────────────────────────────────────

async fn gateway_state(State(state): State<AppState>) -> Json<serde_json::Value> {
    let default = json!({
        "connected": false,
        "type": null,
        "lastConnection": null,
    });
    let state_value = read_gateway_file(&state, "state", default);
    Json(state_value)
}

// ── POST /api/gateway/connect ───────────────────────────────────────────────

async fn gateway_connect(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let conn = json!({
        "type": body.get("type"),
        "token": body.get("token"),
        "channelId": body.get("channelId"),
    });
    let _ = write_gateway_file(&state, "connection", &conn);
    Json(json!({
        "ok": true,
        "connected": false,
        "message": "Gateway configuration saved. Start local-tracker to connect."
    }))
}

// ── GET /api/gateway/config ─────────────────────────────────────────────────

async fn gateway_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let default = json!({"enabled": false});
    let config = read_gateway_file(&state, "config", default);
    Json(config)
}

// ── POST /api/gateway/config ────────────────────────────────────────────────

async fn gateway_config_set(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    write_gateway_file(&state, "config", &body)
}

// ── Helpers for repo inventory ──────────────────────────────────────────────

fn repo_inventory_path(state: &AppState) -> std::path::PathBuf {
    state.config.elegy_home.join("repo-inventory.json")
}

fn list_registered_repos(state: &AppState) -> Vec<serde_json::Value> {
    let path = repo_inventory_path(state);
    if !path.exists() {
        return vec![];
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

// ── POST /api/gateway/scan-repos ────────────────────────────────────────────

async fn gateway_scan_repos(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let repos = list_registered_repos(&state);
    let mut results = Vec::new();
    for repo in &repos {
        let repo_id = repo.get("repoId").and_then(|v| v.as_str()).unwrap_or("");
        let repo_path = repo.get("repoPath").and_then(|v| v.as_str()).unwrap_or("");
        let gateway_config_path =
            std::path::Path::new(repo_path).join(".copilot").join("gateway.json");
        let has_gateway = gateway_config_path.exists();
        let gateway_config = if has_gateway {
            std::fs::read_to_string(&gateway_config_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        } else {
            None
        };
        results.push(json!({
            "repoId": repo_id,
            "repoPath": repo_path,
            "hasGateway": has_gateway,
            "gatewayConfig": gateway_config,
        }));
    }
    Json(json!({
        "ok": true,
        "repos": results,
        "count": results.len()
    }))
}
