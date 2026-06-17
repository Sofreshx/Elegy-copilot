use std::path::PathBuf;

use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::Utc;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;

// ── Helpers ──────────────────────────────────────────────────────────────────────

fn opencode_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("opencode")
}

/// Read `config.json` from the opencode directory. Returns `{}` if the file does
/// not exist or cannot be parsed.
fn read_config(state: &AppState) -> Value {
    let path = opencode_dir(state).join("config.json");
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}))
    } else {
        json!({})
    }
}

/// Write `value` as pretty-printed JSON to `config.json`, creating parent
/// directories if necessary.
fn write_config(state: &AppState, value: &Value) -> Result<(), ApiError> {
    let path = opencode_dir(state).join("config.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }
    let content =
        serde_json::to_string_pretty(value).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(())
}

/// Return the `{id}.json` path under `go-workspaces/`.
fn workspace_path(state: &AppState, id: &str) -> PathBuf {
    opencode_dir(state)
        .join("go-workspaces")
        .join(format!("{}.json", id))
}

/// List all workspace JSON files in `go-workspaces/`.
/// Returns `(id, contents)` pairs.
fn list_workspaces(state: &AppState) -> Vec<(String, Value)> {
    let dir = opencode_dir(state).join("go-workspaces");
    if !dir.exists() {
        return vec![];
    }
    let mut workspaces = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    let id = name.trim_end_matches(".json").to_string();
                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        if let Ok(json) = serde_json::from_str::<Value>(&content) {
                            workspaces.push((id, json));
                        }
                    }
                }
            }
        }
    }
    workspaces
}

/// Set a nested value inside a JSON tree using a dot-separated key path
/// (e.g. `"experimental.batch_tool"`).
///
/// Intermediate objects are created on demand. If the root value is not an
/// Object it is replaced with an empty Object.
fn set_nested_value(config: Value, key: &str, value: Value) -> Value {
    fn set_recursive(
        mut map: serde_json::Map<String, Value>,
        parts: &[&str],
        value: &Value,
    ) -> serde_json::Map<String, Value> {
        if parts.is_empty() {
            return map;
        }
        let k = parts[0].to_string();
        if parts.len() == 1 {
            map.insert(k, value.clone());
        } else {
            let child = map.remove(&k).unwrap_or(Value::Object(serde_json::Map::new()));
            let child_map = match child {
                Value::Object(m) => m,
                _ => serde_json::Map::new(),
            };
            map.insert(k, Value::Object(set_recursive(child_map, &parts[1..], value)));
        }
        map
    }

    let parts: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return config;
    }
    let map = match config {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    Value::Object(set_recursive(map, &parts, &value))
}

// ── OpenCode Status & Config (5 routes) ─────────────────────────────────────────

/// GET /api/opencode/status
async fn opencode_status(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let config = read_config(&state);
    let configured = config.as_object().map_or(false, |o| !o.is_empty());
    let config_version = config.get("version").cloned();
    Ok(Json(json!({
        "status": if configured { "configured" } else { "idle" },
        "configVersion": config_version,
        "config": config,
    })))
}

/// POST /api/opencode/config
async fn opencode_config(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    write_config(&state, &body)?;
    Ok(Json(json!({"ok": true})))
}

/// POST /api/opencode/prompts
///
/// Body shape: `{ "prompts": [{ "id": "...", "content": "..." }, ...] }`
/// Writes each prompt as `<prompts-dir>/{id}.md`.
async fn opencode_prompts(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let prompts_dir = opencode_dir(&state).join("prompts");
    std::fs::create_dir_all(&prompts_dir).map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(prompts) = body.get("prompts").and_then(|v| v.as_array()) {
        for prompt in prompts {
            if let (Some(id), Some(content)) = (
                prompt.get("id").and_then(|v| v.as_str()),
                prompt.get("content").and_then(|v| v.as_str()),
            ) {
                let file_path = prompts_dir.join(format!("{}.md", id));
                std::fs::write(&file_path, content)
                    .map_err(|e| ApiError::Internal(e.into()))?;
            }
        }
    }

    Ok(Json(json!({"ok": true})))
}

/// GET /api/opencode/prompts/effective
///
/// Reads all `.md` files from the prompts directory and returns them as a list.
async fn opencode_prompts_effective(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let prompts_dir = opencode_dir(&state).join("prompts");
    let mut prompts: Vec<Value> = Vec::new();

    if prompts_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&prompts_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".md") {
                        let id = name.trim_end_matches(".md").to_string();
                        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
                        prompts.push(json!({
                            "id": id,
                            "content": content,
                        }));
                    }
                }
            }
        }
    }

    Ok(Json(json!({"prompts": prompts})))
}

/// POST /api/opencode/config/key
///
/// Body: `{ "key": "some.nested.key", "value": ... }`
/// Resolves the dot-separated key path and sets the value.  Creates
/// intermediate objects as needed.
async fn opencode_config_key(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let key = body.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let value = body.get("value").cloned().unwrap_or(Value::Null);

    if key.is_empty() {
        return Err(ApiError::BadRequest("key is required".to_string()));
    }

    let config = read_config(&state);
    let config = set_nested_value(config, key, value);
    write_config(&state, &config)?;
    Ok(Json(json!({"ok": true})))
}

// ── OpenCode Config Reset & Assets (3 routes) ───────────────────────────────────

/// POST /api/opencode/config/reset
///
/// Deletes `config.json` — the next status request will return `"idle"`.
async fn opencode_config_reset(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let path = opencode_dir(&state).join("config.json");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| ApiError::Internal(e.into()))?;
    }
    Ok(Json(json!({"ok": true})))
}

/// POST /api/opencode/assets/install
///
/// Body: asset manifest (any JSON object/array).
/// Writes the body to `assets/manifest.json`.
async fn opencode_assets_install(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let assets_dir = opencode_dir(&state).join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| ApiError::Internal(e.into()))?;

    let manifest_path = assets_dir.join("manifest.json");
    let content =
        serde_json::to_string_pretty(&body).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&manifest_path, content).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(json!({"ok": true})))
}

/// POST /api/opencode/tooling/install
///
/// Body: tooling configuration object.
/// Merges the body into `config.json` under the `"tooling"` key.
async fn opencode_tooling_install(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut config = read_config(&state);
    if let Some(obj) = config.as_object_mut() {
        obj.insert("tooling".to_string(), body);
    }
    write_config(&state, &config)?;
    Ok(Json(json!({"ok": true})))
}

// ── CLI, Logs, Permissions (4 routes) ───────────────────────────────────────────

/// POST /api/opencode/cli/install
///
/// Checks whether `opencode-ai` is available on PATH.
/// Returns installation status (does not actually install).
async fn opencode_cli_install(
    State(_state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let found = std::process::Command::new("opencode-ai")
        .arg("--version")
        .output()
        .is_ok();

    Ok(Json(json!({
        "ok": true,
        "installed": found,
        "message": if found {
            "opencode-ai CLI is available"
        } else {
            "opencode-ai CLI not found. Install with: npm install -g opencode-ai"
        },
    })))
}

/// GET /api/opencode/logs/requests
///
/// Reads `logs/requests.jsonl` line by line and returns the last 100 entries.
async fn opencode_logs_requests(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let path = opencode_dir(&state).join("logs").join("requests.jsonl");

    if !path.exists() {
        return Ok(Json(json!({"requests": [], "count": 0})));
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| ApiError::Internal(e.into()))?;

    let requests: Vec<Value> = content
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    let count = requests.len();
    let recent = requests
        .into_iter()
        .skip(count.saturating_sub(100))
        .collect::<Vec<_>>();

    Ok(Json(json!({"requests": recent, "count": recent.len()})))
}

/// GET /api/opencode/permissions
///
/// Returns the `permission` field from `config.json`.
async fn opencode_permissions_get(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let config = read_config(&state);
    let permission = config.get("permission").cloned().unwrap_or(Value::Null);
    Ok(Json(json!({"ok": true, "permission": permission})))
}

/// POST /api/opencode/permissions
///
/// Body: `{ "permission": { ... } }`
/// Sets the `permission` field in `config.json`.
async fn opencode_permissions_set(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let permission = body.get("permission").cloned().unwrap_or(Value::Null);

    let mut config = read_config(&state);
    if let Some(obj) = config.as_object_mut() {
        obj.insert("permission".to_string(), permission.clone());
    }
    write_config(&state, &config)?;

    Ok(Json(json!({"ok": true, "permission": permission})))
}

// ── Go Workspaces (8 routes) ────────────────────────────────────────────────────

/// GET /api/opencode/go-workspaces
///
/// Lists all workspace profiles stored in `go-workspaces/`.
async fn opencode_go_workspaces_list(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let workspaces = list_workspaces(&state);
    let items: Vec<Value> = workspaces
        .into_iter()
        .map(|(id, mut cfg)| {
            if let Some(obj) = cfg.as_object_mut() {
                obj.insert("id".to_string(), Value::String(id));
            }
            cfg
        })
        .collect();
    Ok(Json(json!({"workspaces": items})))
}

/// POST /api/opencode/go-workspaces
///
/// Body: workspace configuration.  If `id` is omitted a UUID v4 is generated.
async fn opencode_go_workspaces_create(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let path = workspace_path(&state, &id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }

    let content =
        serde_json::to_string_pretty(&body).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(json!({"ok": true, "workspace": {"id": id}})))
}

/// POST /api/opencode/go-workspaces/create-flow
///
/// Body: `{ "name": "...", "label": "..." }` (label optional).
/// Creates a workspace JSON file with default profile fields.
async fn opencode_go_workspaces_create_flow(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("new-workspace")
        .to_string();
    let label = body
        .get("label")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let now = Utc::now().to_rfc3339();

    let workspace = json!({
        "name": name,
        "label": label,
        "active": false,
        "createdAt": now,
    });

    let path = workspace_path(&state, &id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }

    let content =
        serde_json::to_string_pretty(&workspace).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(json!({
        "ok": true,
        "workspace": {
            "id": id,
            "name": name,
            "label": label,
            "createdAt": now,
        },
    })))
}

/// POST /api/opencode/go-workspaces/{id}/activate
async fn opencode_go_workspaces_activate(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let path = workspace_path(&state, &id);
    if !path.exists() {
        return Err(ApiError::NotFound(format!("Workspace not found: {}", id)));
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| ApiError::Internal(e.into()))?;
    let mut workspace: Value =
        serde_json::from_str(&content).map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(obj) = workspace.as_object_mut() {
        obj.insert("active".to_string(), Value::Bool(true));
    }

    let updated =
        serde_json::to_string_pretty(&workspace).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, updated).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(json!({"ok": true})))
}

/// POST /api/opencode/go-workspaces/{id}/validate
async fn opencode_go_workspaces_validate(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let path = workspace_path(&state, &id);
    if path.exists() {
        Ok(Json(json!({"ok": true, "status": "ok"})))
    } else {
        Err(ApiError::NotFound(format!(
            "Workspace not found: {}",
            id
        )))
    }
}

/// PUT /api/opencode/go-workspaces/{id}
async fn opencode_go_workspaces_update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let path = workspace_path(&state, &id);
    if !path.exists() {
        return Err(ApiError::NotFound(format!("Workspace not found: {}", id)));
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::Internal(e.into()))?;
    }

    let content =
        serde_json::to_string_pretty(&body).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, content).map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(json!({"ok": true})))
}

/// DELETE /api/opencode/go-workspaces/{id}
async fn opencode_go_workspaces_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let path = workspace_path(&state, &id);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| ApiError::Internal(e.into()))?;
    }
    Ok(Json(json!({"ok": true})))
}

// ── Cross-cutting (2 routes) ────────────────────────────────────────────────────

/// GET /api/codex-planning-status
async fn codex_planning_status(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let config = read_config(&state);
    Ok(Json(json!({
        "ready": false,
        "config": config,
    })))
}

/// GET /api/stats/provider-usage
///
/// Reads `logs/requests.jsonl` and returns basic usage stats.
async fn provider_usage(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let path = opencode_dir(&state).join("logs").join("requests.jsonl");

    let total_requests = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .map(|s| s.lines().count())
            .unwrap_or(0)
    } else {
        0
    };

    Ok(Json(json!({
        "usage": {
            "totalRequests": total_requests,
            "byProvider": {},
        }
    })))
}

// ── Router ──────────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        // OpenCode Status & Config
        .route("/api/opencode/status", get(opencode_status))
        .route("/api/opencode/config", post(opencode_config))
        .route("/api/opencode/prompts", post(opencode_prompts))
        .route(
            "/api/opencode/prompts/effective",
            get(opencode_prompts_effective),
        )
        .route("/api/opencode/config/key", post(opencode_config_key))
        // OpenCode Config Reset & Assets
        .route("/api/opencode/config/reset", post(opencode_config_reset))
        .route("/api/opencode/assets/install", post(opencode_assets_install))
        .route(
            "/api/opencode/tooling/install",
            post(opencode_tooling_install),
        )
        // CLI, Logs, Permissions
        .route("/api/opencode/cli/install", post(opencode_cli_install))
        .route("/api/opencode/logs/requests", get(opencode_logs_requests))
        .route(
            "/api/opencode/permissions",
            get(opencode_permissions_get).post(opencode_permissions_set),
        )
        // Go Workspaces — ordering matters: literal paths before {id} paths
        .route(
            "/api/opencode/go-workspaces",
            get(opencode_go_workspaces_list).post(opencode_go_workspaces_create),
        )
        .route(
            "/api/opencode/go-workspaces/create-flow",
            post(opencode_go_workspaces_create_flow),
        )
        .route(
            "/api/opencode/go-workspaces/{id}/activate",
            post(opencode_go_workspaces_activate),
        )
        .route(
            "/api/opencode/go-workspaces/{id}/validate",
            post(opencode_go_workspaces_validate),
        )
        .route(
            "/api/opencode/go-workspaces/{id}",
            put(opencode_go_workspaces_update).delete(opencode_go_workspaces_delete),
        )
        // Cross-cutting
        .route("/api/codex-planning-status", get(codex_planning_status))
        .route("/api/stats/provider-usage", get(provider_usage))
        .with_state(state)
}
