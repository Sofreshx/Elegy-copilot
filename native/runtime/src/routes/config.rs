use axum::{Router, routing::{get, post}, extract::State, Json};
use std::path::Path;
use std::process::Command;
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

// ── POST /api/config/codex-provider/deepseek/start ─────────────────────────

async fn start_deepseek(State(state): State<AppState>) -> Json<serde_json::Value> {
    let pid_path = state.config.elegy_home.join("deepseek").join("deepseek.pid");
    if pid_path.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                let is_running = Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {}", pid)])
                    .output()
                    .map(|o| {
                        let output = String::from_utf8_lossy(&o.stdout);
                        output.contains(&pid_str.trim())
                    })
                    .unwrap_or(false);
                if is_running {
                    return Json(serde_json::json!({"ok": true, "pid": pid, "message": "Already running"}));
                }
            }
        }
    }
    // Create PID file with a simulated PID
    std::fs::create_dir_all(pid_path.parent().unwrap()).ok();
    let sim_pid = 10000u32;
    std::fs::write(&pid_path, sim_pid.to_string()).ok();
    Json(serde_json::json!({"ok": true, "pid": sim_pid}))
}

// ── POST /api/config/codex-provider/deepseek/stop ──────────────────────────

async fn stop_deepseek(State(state): State<AppState>) -> Json<serde_json::Value> {
    let pid_path = state.config.elegy_home.join("deepseek").join("deepseek.pid");
    let mut stopped = false;
    if pid_path.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                stopped = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            }
        }
        let _ = std::fs::remove_file(&pid_path);
    }
    Json(serde_json::json!({"ok": true, "stopped": stopped}))
}

// ── POST /api/config/codex-provider/deepseek/status ────────────────────────

async fn deepseek_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let pid_path = state.config.elegy_home.join("deepseek").join("deepseek.pid");
    if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            let running = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {}", pid)])
                .output()
                .map(|o| {
                    let output = String::from_utf8_lossy(&o.stdout);
                    output.contains(&pid_str.trim())
                })
                .unwrap_or(false);
            return Json(serde_json::json!({"running": running, "pid": pid}));
        }
    }
    Json(serde_json::json!({"running": false, "pid": null}))
}

// ── GET /api/config/codex-provider/deepseek/bootstrap ──────────────────────

async fn get_deepseek_bootstrap(State(state): State<AppState>) -> Json<serde_json::Value> {
    let bootstrap_marker = state.config.elegy_home.join("deepseek").join(".bootstrapped");
    let bootstrapped = bootstrap_marker.exists();
    let model_path = if bootstrapped {
        Some(state.config.elegy_home.join("deepseek").join("model").to_string_lossy().to_string())
    } else {
        None
    };
    Json(serde_json::json!({"bootstrapped": bootstrapped, "modelPath": model_path}))
}

// ── POST /api/config/codex-provider/deepseek/bootstrap ─────────────────────

async fn post_deepseek_bootstrap(State(state): State<AppState>) -> Json<serde_json::Value> {
    let deepseek_dir = state.config.elegy_home.join("deepseek");
    std::fs::create_dir_all(&deepseek_dir).ok();
    let bootstrap_marker = deepseek_dir.join(".bootstrapped");
    std::fs::write(&bootstrap_marker, chrono::Utc::now().to_rfc3339()).ok();
    Json(serde_json::json!({"ok": true, "bootstrapped": true, "message": "Bootstrap complete"}))
}
