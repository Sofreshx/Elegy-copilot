use axum::{Router, routing::{get, post}, extract::State, Json};
use std::path::Path;
use crate::app::AppState;
use crate::config_service::ConfigService;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/config/remote-sessions", get(get_remote_sessions).put(set_remote_sessions))
        .route("/api/config/codex-provider", get(get_codex_provider).put(set_codex_provider))
        .route("/api/config/codex-provider/reset", post(reset_codex_provider))
        .route("/api/config/codex-provider/factory-reset", post(factory_reset_codex_provider))
        .route("/api/config/codex-provider/deepseek", get(get_deepseek).put(set_deepseek))
        .route("/api/config/codex-provider/deepseek/start", post(start_deepseek))
        .route("/api/config/codex-provider/deepseek/stop", post(stop_deepseek))
        .route("/api/config/codex-provider/deepseek/status", post(deepseek_status))
        .route("/api/config/codex-provider/deepseek/bootstrap", get(get_deepseek_bootstrap).post(post_deepseek_bootstrap))
        .with_state(state)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn codex_provider_path(elegy_home: &Path) -> std::path::PathBuf {
    elegy_home.join("config").join("codex-provider.json")
}

fn deepseek_config_path(elegy_home: &Path) -> std::path::PathBuf {
    elegy_home.join("config").join("deepseek.json")
}

fn read_config_file(path: &Path, default: serde_json::Value) -> serde_json::Value {
    if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(default)
    } else {
        default
    }
}

fn write_config_file(path: &Path, value: &serde_json::Value) -> Json<serde_json::Value> {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(serde_json::json!({"ok": false, "error": e.to_string()}));
        }
    }
    match serde_json::to_string_pretty(value) {
        Ok(content) => match std::fs::write(path, content) {
            Ok(()) => Json(serde_json::json!({"ok": true})),
            Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

// ── GET/PUT /api/config/remote-sessions ─────────────────────────────────────

async fn get_remote_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let svc = ConfigService::new(&state.config.elegy_home);
    Json(serde_json::json!({"enabled": svc.get_remote_sessions()}))
}

async fn set_remote_sessions(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let svc = ConfigService::new(&state.config.elegy_home);
    let enabled = body["enabled"].as_bool().unwrap_or(false);
    match svc.set_remote_sessions(enabled) {
        Ok(()) => Json(serde_json::json!({"ok": true})),
        Err(e) => Json(serde_json::json!({"ok": false, "error": e})),
    }
}

// ── GET /api/config/codex-provider ─────────────────────────────────────────

async fn get_codex_provider(State(state): State<AppState>) -> Json<serde_json::Value> {
    let path = codex_provider_path(&state.config.elegy_home);
    let default = serde_json::json!({"provider": "openai", "model": "gpt-4", "key": null});
    let config = read_config_file(&path, default);
    Json(config)
}

// ── PUT /api/config/codex-provider ─────────────────────────────────────────

async fn set_codex_provider(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let path = codex_provider_path(&state.config.elegy_home);
    write_config_file(&path, &body)
}

// ── POST /api/config/codex-provider/reset ──────────────────────────────────

async fn reset_codex_provider(State(state): State<AppState>) -> Json<serde_json::Value> {
    let path = codex_provider_path(&state.config.elegy_home);
    if path.exists() {
        match std::fs::remove_file(&path) {
            Ok(()) => Json(serde_json::json!({"ok": true})),
            Err(e) => Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        }
    } else {
        Json(serde_json::json!({"ok": true}))
    }
}

// ── POST /api/config/codex-provider/factory-reset ──────────────────────────

async fn factory_reset_codex_provider(State(state): State<AppState>) -> Json<serde_json::Value> {
    let path = codex_provider_path(&state.config.elegy_home);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    // Also remove deepseek config as part of factory reset
    let deepseek_path = deepseek_config_path(&state.config.elegy_home);
    if deepseek_path.exists() {
        let _ = std::fs::remove_file(&deepseek_path);
    }
    Json(serde_json::json!({"ok": true}))
}

// ── GET /api/config/codex-provider/deepseek ────────────────────────────────

async fn get_deepseek(State(state): State<AppState>) -> Json<serde_json::Value> {
    let path = deepseek_config_path(&state.config.elegy_home);
    let default = serde_json::json!({"enabled": false});
    let config = read_config_file(&path, default);
    Json(config)
}

// ── PUT /api/config/codex-provider/deepseek ────────────────────────────────

async fn set_deepseek(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let path = deepseek_config_path(&state.config.elegy_home);
    write_config_file(&path, &body)
}

// ── POST /api/config/codex-provider/deepseek/start (stub) ──────────────────

async fn start_deepseek() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "pid": 0, "stub": true}))
}

// ── POST /api/config/codex-provider/deepseek/stop (stub) ───────────────────

async fn stop_deepseek() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

// ── POST /api/config/codex-provider/deepseek/status (stub) ─────────────────

async fn deepseek_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({"running": false, "stub": true}))
}

// ── GET /api/config/codex-provider/deepseek/bootstrap (stub) ───────────────

async fn get_deepseek_bootstrap() -> Json<serde_json::Value> {
    Json(serde_json::json!({"bootstrapped": false, "stub": true}))
}

// ── POST /api/config/codex-provider/deepseek/bootstrap (stub) ──────────────

async fn post_deepseek_bootstrap() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
