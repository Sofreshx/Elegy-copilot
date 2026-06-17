use std::path::PathBuf;
use std::process::Command;

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::app::AppState;
use crate::error::ApiError;

const CONTRACT_VERSION: &str = "live_contracts_v1";

fn resolve_cli_path(state: &AppState) -> Option<PathBuf> {
    if let Ok(env_path) = std::env::var("INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH") {
        let p = PathBuf::from(&env_path);
        if p.is_file() {
            return Some(p);
        }
    }

    let exe = if cfg!(windows) { "elegy-planning.exe" } else { "elegy-planning" };
    let elegy = &state.config.elegy_home;
    let engine = &state.config.engine_root;

    let candidates = vec![
        elegy.join("managed-cli").join("planning").join(exe),
        elegy.join("managed-cli").join("planning").join("bin").join(exe),
        elegy.join("bin").join(exe),
        elegy.join("elegy-planning").join(exe),
        engine.join("elegy-planning").join(exe),
        engine.join("elegy-planning").join("bin").join(exe),
    ];

    for c in &candidates {
        if c.is_file() {
            return Some(c.clone());
        }
    }

    // Fall back to PATH
    let which = if cfg!(windows) { "where" } else { "which" };
    if Command::new(which).arg(exe).output().is_ok() {
        return Some(PathBuf::from(exe));
    }

    None
}

fn read_planning_scope(state: &AppState) -> Option<String> {
    let session_paths = vec![
        state.config.elegy_home.join("planning-session.json"),
        dirs::home_dir()
            .map(|h| h.join(".elegy").join("planning-session.json"))
            .unwrap_or_default(),
    ];

    if let Ok(var) = std::env::var("INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH") {
        let p = PathBuf::from(var);
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(&p) {
                if let Ok(json) = serde_json::from_str::<Value>(&content) {
                    if let Some(scope) = json.get("sidecar").and_then(|s| s.get("scope")).and_then(|s| s.as_str()) {
                        return Some(scope.to_string());
                    }
                }
            }
        }
    }

    for p in &session_paths {
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(p) {
                if let Ok(json) = serde_json::from_str::<Value>(&content) {
                    if let Some(scope) = json.get("sidecar").and_then(|s| s.get("scope")).and_then(|s| s.as_str()) {
                        return Some(scope.to_string());
                    }
                }
            }
        }
    }

    None
}

fn db_path(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("planning.db")
}

fn run_cli(state: &AppState, args: &[&str]) -> Result<Value, ApiError> {
    let cli_path = resolve_cli_path(state).ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!("elegy-planning CLI binary not found"))
    })?;

    let is_cmd = cli_path.to_string_lossy().ends_with(".cmd")
        || cli_path.to_string_lossy().ends_with(".bat");

    let db = db_path(state);
    let scope = read_planning_scope(state);

    let mut cmd_args: Vec<String> = Vec::new();
    cmd_args.push("--json".to_string());
    cmd_args.push("--non-interactive".to_string());
    cmd_args.push("--db".to_string());
    cmd_args.push(db.to_string_lossy().to_string());
    if let Some(s) = &scope {
        cmd_args.push("--scope".to_string());
        cmd_args.push(s.clone());
    }
    for a in args {
        cmd_args.push(a.to_string());
    }

    let output = if is_cmd {
        let mut c = Command::new("cmd");
        c.args(["/d", "/s", "/c"]);
        let full = format!(
            "{} {}",
            cli_path.to_string_lossy(),
            cmd_args
                .iter()
                .map(|a| if a.contains(' ') {
                    format!("\"{}\"", a)
                } else {
                    a.clone()
                })
                .collect::<Vec<_>>()
                .join(" ")
        );
        c.arg(&full);
        c.output().map_err(|e| ApiError::Internal(e.into()))?
    } else {
        let mut c = Command::new(&cli_path);
        c.args(&cmd_args);
        c.output().map_err(|e| ApiError::Internal(e.into()))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stderr.is_empty() {
            stderr.to_string()
        } else if !stdout.is_empty() {
            stdout.to_string()
        } else {
            format!("CLI exited with status {:?}", output.status.code())
        };
        return Err(ApiError::Internal(anyhow::anyhow!("CLI error: {}", msg)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err(ApiError::NotFound("Empty response from CLI".into()));
    }

    serde_json::from_str(&stdout).map_err(|e| ApiError::Internal(e.into()))
}

fn extract_data(result: &Value) -> Option<&Value> {
    result.get("data")
}

fn build_envelope(kind: &str, data: Value, count: Option<usize>) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("contractVersion".to_string(), Value::String(CONTRACT_VERSION.to_string()));
    map.insert("kind".to_string(), Value::String(kind.to_string()));
    map.insert("deterministic".to_string(), Value::Bool(true));
    map.insert("repo".to_string(), Value::Null);

    if let Some(c) = count {
        map.insert("count".to_string(), Value::Number(serde_json::Number::from(c)));
    }

    if let Value::Object(obj) = data {
        for (k, v) in obj {
            map.insert(k, v);
        }
    }

    Value::Object(map)
}

fn build_error_envelope(kind: &str, error: &str, code: &str) -> Value {
    serde_json::json!({
        "contractVersion": CONTRACT_VERSION,
        "kind": kind,
        "deterministic": true,
        "error": error,
        "code": code,
    })
}

// Handlers

async fn task_board(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.task-board";
    match run_cli(&state, &["plan", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let plans = data.get("plans").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            Ok(Json(build_envelope(kind, serde_json::json!({
                "lanes": [{
                    "id": "backlog",
                    "title": "Backlog",
                    "plans": data.get("plans").and_then(|v| v.as_array()).cloned().unwrap_or_default()
                }]
            }), Some(plans))))
        }
        Err(e) => {
            tracing::warn!("task_board CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "planning_live_authority_read_failed")))
        }
    }
}

async fn live_roadmaps(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.roadmaps";
    match run_cli(&state, &["roadmap", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let roadmaps = data.get("roadmaps").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let mut envelope = build_envelope(kind, data, Some(roadmaps));
            let roadmaps_fallback = envelope.get("roadmaps").cloned().unwrap_or(Value::Array(vec![]));
            if let Some(obj) = envelope.as_object_mut() {
                obj.insert("roadmaps".to_string(), roadmaps_fallback);
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_roadmaps CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "planning_live_authority_read_failed")))
        }
    }
}

async fn live_goals(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.goals";
    match run_cli(&state, &["goal", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let goals = data.get("goals").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let mut envelope = build_envelope(kind, data, Some(goals));
            let goals_val = envelope.get("goals").cloned().unwrap_or(Value::Array(vec![]));
            if let Some(obj) = envelope.as_object_mut() {
                obj.insert("goals".to_string(), goals_val);
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_goals CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "planning_live_authority_read_failed")))
        }
    }
}

async fn authority_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.authority-status";
    match run_cli(&state, &["scope", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let scopes = data.get("scopes").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let current_scope = read_planning_scope(&state);
            Ok(Json(build_envelope(kind, serde_json::json!({
                "authority": "configured",
                "scopeCount": scopes,
                "currentScope": current_scope,
                "cliAvailable": resolve_cli_path(&state).is_some(),
            }), None)))
        }
        Err(e) => {
            tracing::warn!("authority_status CLI error: {:?}", e);
            let current_scope = read_planning_scope(&state);
            Ok(Json(build_envelope(kind, serde_json::json!({
                "authority": "unavailable",
                "error": e.to_string(),
                "currentScope": current_scope,
                "cliAvailable": resolve_cli_path(&state).is_some(),
            }), None)))
        }
    }
}

async fn live_roadmap_detail(
    State(state): State<AppState>,
    Path(roadmap_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.roadmap";
    match run_cli(&state, &["roadmap", "show", "--roadmap-id", &roadmap_id]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let mut envelope = build_envelope(kind, data.clone(), None);
            if let Some(obj) = envelope.as_object_mut() {
                for key in &["roadmap", "sections", "workPoints", "todos", "reviewPoints", "validation"] {
                    if let Some(v) = data.get(*key) {
                        obj.insert(key.to_string(), v.clone());
                    }
                }
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_roadmap_detail CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "roadmap_not_found")))
        }
    }
}

async fn live_goal_detail(
    State(state): State<AppState>,
    Path(goal_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.goal";
    match run_cli(&state, &["goal", "show", "--goal-id", &goal_id]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let mut envelope = build_envelope(kind, data.clone(), None);
            if let Some(obj) = envelope.as_object_mut() {
                for key in &["goal", "acceptance", "rejection", "tags", "roadmaps"] {
                    if let Some(v) = data.get(*key) {
                        obj.insert(key.to_string(), v.clone());
                    }
                }
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_goal_detail CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "goal_not_found")))
        }
    }
}

async fn live_plans(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.plans";
    match run_cli(&state, &["plan", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let plans = data.get("plans").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let mut envelope = build_envelope(kind, data, Some(plans));
            let plans_val = envelope.get("plans").cloned().unwrap_or(Value::Array(vec![]));
            if let Some(obj) = envelope.as_object_mut() {
                obj.insert("plans".to_string(), plans_val);
                obj.insert("filters".to_string(), Value::Null);
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_plans CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "planning_live_authority_read_failed")))
        }
    }
}

async fn live_plan_detail(
    State(state): State<AppState>,
    Path(plan_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.plan";
    match run_cli(&state, &["plan", "show", "--plan-id", &plan_id]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let mut envelope = build_envelope(kind, data.clone(), None);
            if let Some(obj) = envelope.as_object_mut() {
                for key in &["plan", "todos", "workPoints", "reviewPoints", "validation", "fileScope", "effortTier"] {
                    if let Some(v) = data.get(*key) {
                        obj.insert(key.to_string(), v.clone());
                    }
                }
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_plan_detail CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "plan_not_found")))
        }
    }
}

async fn live_todos(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let kind = "planning.live.todos";
    match run_cli(&state, &["todo", "list"]) {
        Ok(result) => {
            let data = extract_data(&result).cloned().unwrap_or_default();
            let count = data.get("todos").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let mut envelope = build_envelope(kind, data, Some(count));
            let todos_val = envelope.get("todos").cloned().unwrap_or(Value::Array(vec![]));
            if let Some(obj) = envelope.as_object_mut() {
                obj.insert("todos".to_string(), todos_val);
                obj.insert("filters".to_string(), Value::Null);
            }
            Ok(Json(envelope))
        }
        Err(e) => {
            tracing::warn!("live_todos CLI error: {:?}", e);
            Ok(Json(build_error_envelope(kind, &e.to_string(), "planning_live_authority_read_failed")))
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/planning/task-board", get(task_board))
        .route("/api/planning/live/roadmaps", get(live_roadmaps))
        .route("/api/planning/live/goals", get(live_goals))
        .route("/api/planning/live/authority-status", get(authority_status))
        .route("/api/planning/live/roadmaps/{roadmap_id}", get(live_roadmap_detail))
        .route("/api/planning/live/goals/{goal_id}", get(live_goal_detail))
        .route("/api/planning/live/plans", get(live_plans))
        .route("/api/planning/live/plans/{plan_id}", get(live_plan_detail))
        .route("/api/planning/live/todos", get(live_todos))
        .with_state(state)
}
