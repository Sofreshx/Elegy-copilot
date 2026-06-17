use std::path::PathBuf;

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::app::AppState;
use crate::error::ApiError;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn workspace_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("workspace")
}

fn read_workspace_file(state: &AppState, name: &str) -> Value {
    let path = workspace_dir(state).join(name);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}))
    } else {
        json!({})
    }
}

fn write_workspace_file(state: &AppState, name: &str, value: &Value) -> Result<(), ApiError> {
    let path = workspace_dir(state).join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }
    let content =
        serde_json::to_string_pretty(value).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))
}

// ── GET /api/workspace/commands ──────────────────────────────────────────────

/// List available workspace commands.
///
/// Reads workspace/commands.json and returns the commands array.
async fn list_commands(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let data = read_workspace_file(&state, "commands.json");
    let commands = data
        .get("commands")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let count = commands.len();
    Ok(Json(json!({
        "commands": commands,
        "count": count,
    })))
}

// ── POST /api/workspace/commands/run ─────────────────────────────────────────

/// Run a workspace command.
///
/// Finds the command by ID in commands.json, constructs the full command string,
/// logs it, and returns success without actually spawning a process.
async fn run_command(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let command_id = body
        .get("commandId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("commandId is required".to_string()))?;

    let data = read_workspace_file(&state, "commands.json");
    let commands = data
        .get("commands")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let entry = commands
        .iter()
        .find(|c| c.get("id").and_then(|v| v.as_str()) == Some(command_id))
        .cloned();

    match entry {
        Some(cmd) => {
            let name = cmd.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let command_str = cmd.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let extra_args = body
                .get("args")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let full_command = if extra_args.is_empty() {
                command_str.to_string()
            } else {
                format!("{} {}", command_str, extra_args)
            };

            tracing::info!(
                command_id = %command_id,
                name = %name,
                command = %full_command,
                "workspace command run request"
            );

            Ok(Json(json!({
                "ok": true,
                "command": full_command,
                "pid": null,
            })))
        }
        None => Err(ApiError::NotFound(format!(
            "Command '{}' not found",
            command_id
        ))),
    }
}

// ── GET /api/workspace/launchers ─────────────────────────────────────────────

/// List available launchers.
///
/// Reads workspace/launchers.json and returns the launchers array.
async fn list_launchers(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let data = read_workspace_file(&state, "launchers.json");
    let launchers = data
        .get("launchers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let count = launchers.len();
    Ok(Json(json!({
        "launchers": launchers,
        "count": count,
    })))
}

// ── POST /api/workspace/launch ───────────────────────────────────────────────

/// Launch an application via a launcher.
///
/// Finds the launcher by ID in launchers.json, logs the launch, and returns
/// success without actually spawning a process.
async fn launch(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let launcher_id = body
        .get("launcherId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("launcherId is required".to_string()))?;

    let data = read_workspace_file(&state, "launchers.json");
    let launchers = data
        .get("launchers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let found = launchers
        .iter()
        .any(|l| l.get("id").and_then(|v| v.as_str()) == Some(launcher_id));

    if found {
        tracing::info!(launcher_id = %launcher_id, "workspace launch request");
        Ok(Json(json!({
            "ok": true,
            "launcherId": launcher_id,
        })))
    } else {
        Err(ApiError::NotFound(format!(
            "Launcher '{}' not found",
            launcher_id
        )))
    }
}

// ── GET /api/workspace/pinned-commands ──────────────────────────────────────

/// List pinned commands.
///
/// Reads workspace/pinned.json and returns the pinnedCommands array.
async fn list_pinned_commands(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let data = read_workspace_file(&state, "pinned.json");
    let pinned_commands = data
        .get("pinnedCommands")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let count = pinned_commands.len();
    Ok(Json(json!({
        "pinnedCommands": pinned_commands,
        "count": count,
    })))
}

// ── POST /api/workspace/pinned-commands ─────────────────────────────────────

/// Add a command to the pinned list.
///
/// Reads pinned.json, appends a new pinned command with a generated UUID and
/// the next sequential order, then writes back.
async fn create_pinned_command(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let command_id = body
        .get("commandId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("commandId is required".to_string()))?;

    let mut data = read_workspace_file(&state, "pinned.json");
    if !data.is_object() {
        data = json!({"pinnedCommands": []});
    }
    if !data.get("pinnedCommands").map_or(false, |v| v.is_array()) {
        data["pinnedCommands"] = json!([]);
    }

    let new_id = Uuid::new_v4().to_string();
    let next_order = data["pinnedCommands"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.get("order").and_then(|o| o.as_i64()))
                .max()
                .unwrap_or(-1)
                + 1
        })
        .unwrap_or(0);

    data["pinnedCommands"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id": new_id,
            "commandId": command_id,
            "order": next_order,
        }));

    write_workspace_file(&state, "pinned.json", &data)?;

    tracing::info!(
        pinned_id = %new_id,
        command_id = %command_id,
        order = next_order,
        "pinned command created"
    );

    Ok(Json(json!({
        "ok": true,
        "id": new_id,
    })))
}

// ── DELETE /api/workspace/pinned-commands/{id} ─────────────────────────────

/// Remove a command from the pinned list.
///
/// Reads pinned.json, removes the entry with the matching id, and writes back.
async fn delete_pinned_command(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let mut data = read_workspace_file(&state, "pinned.json");
    if let Some(commands) = data
        .get_mut("pinnedCommands")
        .and_then(|v| v.as_array_mut())
    {
        commands.retain(|c| c.get("id").and_then(|v| v.as_str()) != Some(&id));
    }
    write_workspace_file(&state, "pinned.json", &data)?;

    tracing::info!(pinned_id = %id, "pinned command deleted");

    Ok(Json(json!({
        "ok": true,
    })))
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/workspace/commands", get(list_commands))
        .route("/api/workspace/commands/run", post(run_command))
        .route("/api/workspace/launchers", get(list_launchers))
        .route("/api/workspace/launch", post(launch))
        .route(
            "/api/workspace/pinned-commands",
            get(list_pinned_commands).post(create_pinned_command),
        )
        .route(
            "/api/workspace/pinned-commands/{id}",
            axum::routing::delete(delete_pinned_command),
        )
        .with_state(state)
}
