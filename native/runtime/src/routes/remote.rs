use std::{collections::HashMap, fs};

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

    let mut output = Vec::new();
    let guild_id = state.remote_runtime.status().guild_ids.first().cloned();
    for directory in directories {
        let args = vec![
            "session".to_string(),
            "list".to_string(),
            "--project".to_string(),
            directory.clone(),
            "--json".to_string(),
        ];
        let raw = match state.remote_runtime.run_cli(&args) {
            Ok(raw) => raw,
            Err(error) => {
                return remote_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "remote_cli_error",
                    &error,
                )
            }
        };
        let sessions: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
        for session in sessions {
            let thread_id = session
                .get("threadId")
                .or_else(|| session.get("thread_id"))
                .and_then(|value| value.as_str());
            if let Some(thread_id) = thread_id {
                output.push(serde_json::json!({
                    "sessionId": session.get("id").cloned().unwrap_or(serde_json::Value::Null),
                    "threadId": thread_id,
                    "threadName": session.get("title").cloned().unwrap_or(serde_json::Value::Null),
                    "source": session.get("source").cloned().unwrap_or_else(|| serde_json::json!("kimaki")),
                    "project": session.get("directory").cloned().unwrap_or_else(|| serde_json::json!(directory)),
                    "updatedAt": session.get("updated").cloned().unwrap_or(serde_json::Value::Null),
                    "guildId": guild_id.clone(),
                }));
            }
        }
    }
    if let Some(limit) = query.limit {
        output.truncate(limit);
    }
    Json(serde_json::json!({ "sessions": output })).into_response()
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
