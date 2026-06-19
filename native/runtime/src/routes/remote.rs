use std::{collections::HashMap, env, fs, path::PathBuf};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;

use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/remote/status", get(status))
        .route("/api/remote/restart", post(restart))
        .route("/api/remote/projects", get(projects))
        .route("/api/remote/sessions", get(sessions))
        .route("/api/remote/send", post(send))
        .route("/api/remote/projects/add", post(add_project))
        .route("/api/remote/logs", get(logs))
        .route("/api/remote/sessions/rename", post(session_rename))
        .with_state(state)
}

async fn status(State(state): State<AppState>) -> Json<crate::remote::RemoteStatus> {
    Json(state.remote_runtime.status())
}

async fn restart(State(state): State<AppState>) -> Response {
    match state.remote_runtime.restart() {
        Ok(()) => Json(serde_json::json!({
            "success": true,
            "state": state.remote_runtime.status().state,
        }))
        .into_response(),
        Err(error) => remote_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "remote_runtime_unavailable",
            &error,
        ),
    }
}

fn require_ready(state: &AppState) -> Result<(), Response> {
    let status = state.remote_runtime.status();
    if !status.available {
        return Err(remote_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "remote_runtime_unavailable",
            "Kimaki runtime files are unavailable.",
        ));
    }
    if !status.ready {
        return Err(remote_error(
            StatusCode::CONFLICT,
            "remote_not_ready",
            "Complete Discord setup before using remote sessions.",
        ));
    }
    Ok(())
}

async fn projects(State(state): State<AppState>) -> Response {
    if let Err(response) = require_ready(&state) {
        return response;
    }
    match read_projects(&state) {
        Ok(projects) => Json(serde_json::json!({ "projects": projects })).into_response(),
        Err(error) => remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_storage_error", &error),
    }
}

#[derive(Deserialize)]
struct SessionQuery {
    project: Option<String>,
    limit: Option<usize>,
}

async fn sessions(
    State(state): State<AppState>,
    Query(query): Query<SessionQuery>,
) -> Response {
    if let Err(response) = require_ready(&state) {
        return response;
    }
    let directories = match query.project {
        Some(directory) => vec![directory],
        None => match read_projects(&state) {
            Ok(projects) => projects
                .into_iter()
                .filter_map(|project| {
                    project
                        .get("directory")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .collect(),
            Err(error) => {
                return remote_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "remote_storage_error",
                    &error,
                )
            }
        },
    };

    let open_code_sessions = match read_open_code_sessions(&directories, query.limit.unwrap_or(50)) {
        Ok(sessions) => sessions,
        Err(error) => {
            return remote_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "remote_storage_error",
                &error,
            )
        }
    };
    let kimaki_sessions = match read_kimaki_sessions(&state) {
        Ok(sessions) => sessions,
        Err(error) => {
            return remote_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "remote_storage_error",
                &error,
            )
        }
    };
    let mappings: HashMap<String, serde_json::Value> = kimaki_sessions
        .into_iter()
        .filter_map(|session| {
            let session_id = session
                .get("sessionId")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            session_id.map(|id| (id, session))
        })
        .collect();
    fn sanitize_name(name: serde_json::Value, session_id: &serde_json::Value) -> serde_json::Value {
        if let Some(s) = name.as_str() {
            if s.starts_with("New session") || s.starts_with("new session") {
                if let Some(id) = session_id.as_str() {
                    return serde_json::Value::String(id.chars().take(8).collect());
                }
                return serde_json::Value::String("Unnamed".to_string());
            }
        }
        name
    }

    let guild_id = state.remote_runtime.status().guild_ids.first().cloned();
    let output: Vec<_> = open_code_sessions
        .into_iter()
        .map(|session| {
            let mapping = session
                .get("sessionId")
                .and_then(|value| value.as_str())
                .and_then(|id| mappings.get(id));
            let thread_id = mapping
                .and_then(|value| value.get("threadId"))
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let connected = thread_id.is_some();
            let discord_url = match (&guild_id, &thread_id) {
                (Some(guild), Some(thread)) => {
                    Some(format!("https://discord.com/channels/{guild}/{thread}"))
                }
                _ => None,
            };
            let sess_id_val = session.get("sessionId").cloned().unwrap_or(serde_json::Value::Null);
            let raw_name = mapping.and_then(|value| value.get("threadName")).cloned()
                .unwrap_or_else(|| session.get("threadName").cloned().unwrap_or(serde_json::Value::Null));
            serde_json::json!({
                "sessionId": sess_id_val,
                "threadId": thread_id,
                "threadName": sanitize_name(raw_name, &sess_id_val),
                "source": if connected { "kimaki" } else { "opencode" },
                "syncStatus": if connected { "connected" } else { "pending" },
                "project": session.get("project").cloned().unwrap_or(serde_json::Value::Null),
                "updatedAt": session.get("updatedAt").cloned().unwrap_or(serde_json::Value::Null),
                "guildId": if connected { guild_id.clone() } else { None },
                "discordUrl": discord_url,
            })
        })
        .collect();
    Json(serde_json::json!({ "sessions": output })).into_response()
}

fn open_code_db_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("OPENCODE_DB_PATH") {
        return Ok(PathBuf::from(path));
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map_err(|_| "Unable to resolve the user home directory".to_string())?;
    Ok(PathBuf::from(home).join(".local/share/opencode/opencode.db"))
}

fn read_open_code_sessions(
    directories: &[String],
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    if directories.is_empty() {
        return Ok(Vec::new());
    }
    let mut normalized_directories = Vec::new();
    for directory in directories {
        let trimmed = directory.trim_end_matches(|c| c == '/' || c == '\\');
        for candidate in [
            trimmed.to_string(),
            trimmed.replace('\\', "/"),
            trimmed.replace('/', "\\"),
            trimmed.to_lowercase(),
            trimmed.replace('\\', "/").to_lowercase(),
            trimmed.replace('/', "\\").to_lowercase(),
        ] {
            if !normalized_directories.contains(&candidate) {
                normalized_directories.push(candidate);
            }
        }
    }
    let connection = Connection::open_with_flags(
        open_code_db_path()?,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| error.to_string())?;
    let placeholders = (0..normalized_directories.len())
        .map(|index| format!("?{}", index + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT id, directory, title, time_created, time_updated
         FROM session
         WHERE directory IN ({placeholders})
           AND time_archived IS NULL
           AND parent_id IS NULL
         ORDER BY time_updated DESC
         LIMIT ?{}",
        normalized_directories.len() + 1
    );
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let mut values: Vec<rusqlite::types::Value> = normalized_directories
        .iter()
        .cloned()
        .map(rusqlite::types::Value::Text)
        .collect();
    values.push(rusqlite::types::Value::Integer(limit.clamp(1, 500) as i64));
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), |row| {
            let raw_name: String = row.get::<_, String>(2)?;
            let thread_name = if raw_name.starts_with("New session")
                || raw_name.starts_with("new session")
            {
                row.get::<_, String>(0)?.chars().take(8).collect()
            } else {
                raw_name
            };
            Ok(serde_json::json!({
                "sessionId": row.get::<_, String>(0)?,
                "project": row.get::<_, String>(1)?,
                "threadName": thread_name,
                "createdAt": row.get::<_, i64>(3)?,
                "updatedAt": row.get::<_, i64>(4)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn read_kimaki_sessions(state: &AppState) -> Result<Vec<serde_json::Value>, String> {
    let db_path = state.remote_runtime.data_dir().join("discord-sessions.db");
    let connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT thread_id, session_id, last_synced_name
             FROM thread_sessions",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(serde_json::json!({
                "threadId": row.get::<_, String>(0)?,
                "sessionId": row.get::<_, String>(1)?,
                "threadName": row.get::<_, Option<String>>(2)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    project: String,
    prompt: String,
    thread_id: Option<String>,
    permission: Option<Vec<String>>,
}

async fn send(State(state): State<AppState>, Json(body): Json<SendBody>) -> Response {
    if let Err(response) = require_ready(&state) {
        return response;
    }
    if body.project.trim().is_empty() || body.prompt.trim().is_empty() {
        return remote_error(
            StatusCode::BAD_REQUEST,
            "invalid_remote_request",
            "project and prompt are required",
        );
    }
    let mut args = vec!["send".to_string()];
    if let Some(thread_id) = body.thread_id {
        args.extend(["--thread".to_string(), thread_id]);
    } else {
        args.extend(["--project".to_string(), body.project]);
    }
    args.extend(["--prompt".to_string(), body.prompt]);
    for permission in body.permission.unwrap_or_default() {
        args.extend(["--permission".to_string(), permission]);
    }
    match state.remote_runtime.run_cli(&args) {
        Ok(result) => Json(serde_json::json!({ "success": true, "result": result })).into_response(),
        Err(error) => remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_cli_error", &error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddProjectBody {
    directory: String,
    guild_id: Option<String>,
}

async fn add_project(
    State(state): State<AppState>,
    Json(body): Json<AddProjectBody>,
) -> Response {
    if let Err(response) = require_ready(&state) {
        return response;
    }
    if body.directory.trim().is_empty() {
        return remote_error(
            StatusCode::BAD_REQUEST,
            "invalid_remote_request",
            "directory is required",
        );
    }
    let mut args = vec!["project".to_string(), "add".to_string(), body.directory];
    if let Some(guild_id) = body.guild_id {
        args.extend(["--guild".to_string(), guild_id]);
    }
    match state.remote_runtime.run_cli(&args) {
        Ok(result) => Json(serde_json::json!({ "success": true, "result": result })).into_response(),
        Err(error) => remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_cli_error", &error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameSessionBody {
    session_id: String,
    title: String,
}

async fn session_rename(
    State(state): State<AppState>,
    Json(body): Json<RenameSessionBody>,
) -> Response {
    if body.session_id.trim().is_empty() || body.title.trim().is_empty() {
        return remote_error(
            StatusCode::BAD_REQUEST,
            "invalid_remote_request",
            "sessionId and title are required",
        );
    }
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map_err(|_| "Unable to resolve home directory".to_string())
        .and_then(|h| {
            let p = PathBuf::from(h).join(".local/share/opencode/opencode.db");
            if p.exists() { Ok(p) } else { Err("opencode.db not found".to_string()) }
        });
    let db_path = match env::var("OPENCODE_DB_PATH") {
        Ok(path) => PathBuf::from(path),
        Err(_) => match home {
            Ok(p) => p,
            Err(e) => return remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_storage_error", &e),
        },
    };
    let connection = match Connection::open(&db_path) {
        Ok(conn) => conn,
        Err(e) => return remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_storage_error", &e.to_string()),
    };
    if let Err(e) = connection.execute_batch("PRAGMA busy_timeout = 3000") {
        return remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_storage_error", &e.to_string());
    }
    match connection.execute(
        "UPDATE session SET title = ?1 WHERE id = ?2",
        rusqlite::params![body.title, body.session_id],
    ) {
        Ok(0) => remote_error(
            StatusCode::NOT_FOUND,
            "remote_session_not_found",
            &format!("No session found with id {}", body.session_id),
        ),
        Ok(_) => Json(serde_json::json!({ "ok": true, "sessionId": body.session_id, "title": body.title }))
            .into_response(),
        Err(e) => remote_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_storage_error", &e.to_string()),
    }
}

async fn logs(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let limit = query
        .get("tail")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50);
    let path = state.remote_runtime.data_dir().join("kimaki.log");
    let lines = fs::read_to_string(path)
        .map(|content| {
            let lines: Vec<_> = content.lines().map(str::to_string).collect();
            lines.into_iter().rev().take(limit).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Json(serde_json::json!({ "lines": lines }))
}

fn read_projects(state: &AppState) -> Result<Vec<serde_json::Value>, String> {
    let db_path = state.remote_runtime.data_dir().join("discord-sessions.db");
    let connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT directory, channel_id, created_at
             FROM channel_directories
             WHERE channel_type = 'text'
             ORDER BY created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let guild_id = state.remote_runtime.status().guild_ids.first().cloned();
    let rows = statement
        .query_map([], |row| {
            Ok(serde_json::json!({
                "directory": row.get::<_, String>(0)?,
                "channelId": row.get::<_, Option<String>>(1)?,
                "lastActivity": row.get::<_, Option<String>>(2)?,
                "guildId": guild_id,
            }))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn remote_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({
            "error": code,
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[test]
    fn remote_error_has_stable_shape() {
        let response = remote_error(StatusCode::CONFLICT, "remote_not_ready", "Not ready");
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn unavailable_runtime_has_node_compatible_status_and_errors() {
        let temp = tempfile::tempdir().unwrap();
        let config = crate::config::RuntimeConfig {
            engine_root: temp.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 0,
            elegy_home: temp.path().join(".elegy"),
            sandboxes_home: temp.path().join(".elegy").join("sandboxes"),
            node_executable: None,
            kimaki_entrypoint: None,
            orchestrator_pilot: crate::config::OrchestratorPilotConfig {
                enabled: false,
                merge_requested: false,
            },
        };
        let state = crate::app::AppState::new(
            config,
            crate::auth::AuthConfig {
                token: None,
                allow_loopback_bypass: true,
            },
        );
        let app = router(state);

        let status = app
            .clone()
            .oneshot(Request::builder().uri("/api/remote/status").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(status.status(), StatusCode::OK);

        let projects = app
            .oneshot(Request::builder().uri("/api/remote/projects").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(projects.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
