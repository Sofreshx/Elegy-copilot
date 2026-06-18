use axum::{Router, routing::{get, post}, extract::{State, Query}, Json};
use crate::app::AppState;
use crate::error::ApiError;
use serde::Deserialize;
use std::path::PathBuf;
use uuid::Uuid;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/agent/definitions", get(list_definitions))
        .route("/api/agent/status", get(agent_status))
        .route("/api/agent/health", get(agent_status))
        .route("/api/agent/runs", get(list_runs))
        .route("/api/agent/runs/get", get(get_run))
        .route("/api/agent/runs/create", post(create_run))
        .route("/api/agent/runs/abort", post(abort_run))
        .route("/api/agent/completions", get(get_completions))
        .route("/api/agent/runs/stream", get(run_stream_stub))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn agent_runs_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("agent-runs")
}

fn run_json_path(state: &AppState, run_id: &str) -> PathBuf {
    agent_runs_dir(state).join(run_id).join("run.json")
}

// ---------------------------------------------------------------------------
// Query / body types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GetRunQuery {
    run_id: Option<String>,
    #[serde(rename = "runId")]
    run_id_camel: Option<String>,
    id: Option<String>,
}

#[derive(Deserialize)]
struct CreateRunBody {
    agent: Option<String>,
    agent_name: Option<String>,
    model: Option<String>,
    model_id: Option<String>,
    goal: Option<String>,
    action: Option<String>,
    parent_kind: Option<String>,
    parent_id: Option<String>,
    note_id: Option<String>,
    provider_id: Option<String>,
    extra_instructions: Option<String>,
    repo_access_enabled: Option<bool>,
}

#[derive(Deserialize)]
struct AbortRunBody {
    run_id: Option<String>,
    #[serde(rename = "runId")]
    run_id_camel: Option<String>,
    id: Option<String>,
}

/// GET /api/agent/definitions — list agent definition files
async fn list_definitions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mut agents = Vec::new();

    // Scan engine-assets/ agents
    for dir in &["engine-assets/agents", "opencode-assets/agents", "codex-assets/agents", "antigravity-assets/agents"] {
        let path = state.config.engine_root.join(dir);
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map_or(false, |e| e == "md") || p.extension().map_or(false, |e| e == "toml") {
                    let name = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let content = std::fs::read_to_string(&p).unwrap_or_default();
                    agents.push(serde_json::json!({
                        "name": name,
                        "path": p.to_string_lossy(),
                        "size": content.len(),
                    }));
                }
            }
        }
    }

    Json(serde_json::json!({ "agents": agents, "count": agents.len() }))
}

/// GET /api/agent/status — runtime agent health
/// GET /api/agent/health — aliased to same handler
async fn agent_status(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "engineRoot": state.config.engine_root.to_string_lossy(),
        "message": "Agent runtime active",
    }))
}

// ---------------------------------------------------------------------------
// GET /api/agent/runs — list agent runs from agent-runs/ directory
// ---------------------------------------------------------------------------

async fn list_runs(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let runs_dir = agent_runs_dir(&state);
    let mut runs = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&runs_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let run_file = entry.path().join("run.json");
                if let Ok(content) = std::fs::read_to_string(&run_file) {
                    if let Ok(run) = serde_json::from_str::<serde_json::Value>(&content) {
                        runs.push(run);
                    }
                }
            }
        }
    }

    Json(serde_json::json!({ "runs": runs, "count": runs.len() }))
}

// ---------------------------------------------------------------------------
// GET /api/agent/runs/get — read a single run.json
// ---------------------------------------------------------------------------

async fn get_run(
    State(state): State<AppState>,
    Query(params): Query<GetRunQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let run_id = params.run_id.or(params.run_id_camel).or(params.id).ok_or_else(|| {
        ApiError::BadRequest("runId or id query parameter is required".into())
    })?;

    let path = run_json_path(&state, &run_id);
    let content = std::fs::read_to_string(&path).map_err(|_| {
        ApiError::NotFound(format!("Agent run not found: {}", run_id))
    })?;

    let run: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(run))
}

// ---------------------------------------------------------------------------
// POST /api/agent/runs/create — create a new agent run
// ---------------------------------------------------------------------------

async fn create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let agent_name = body.agent.or(body.agent_name).ok_or_else(|| {
        ApiError::BadRequest("agent is required".into())
    })?;

    let run_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let model = body.model_id.or(body.model);

    let run = serde_json::json!({
        "id": run_id,
        "sessionId": null,
        "parentKind": body.parent_kind,
        "parentId": body.parent_id,
        "noteId": body.note_id,
        "action": body.action,
        "agentName": agent_name,
        "agent": agent_name,
        "providerId": body.provider_id,
        "modelId": model,
        "model": model,
        "goal": body.goal,
        "promptSummary": null,
        "extraInstructions": body.extra_instructions,
        "repoAccessEnabled": body.repo_access_enabled.unwrap_or(false),
        "status": "queued",
        "startedAt": now,
        "created": now,
        "updated": now,
        "endedAt": null,
        "durationMs": null,
        "promptTokens": null,
        "outputTokens": null,
        "reasoningTokens": null,
        "cacheRead": null,
        "cacheWrite": null,
        "costUsd": null,
        "errorCode": null,
        "errorMessage": null,
        "outputText": null,
        "resultBlockId": null,
        "metadataJson": null,
        "createdBy": "user",
        "workspaceId": null,
    });

    let dir = agent_runs_dir(&state).join(&run_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| ApiError::Internal(e.into()))?;

    let content = serde_json::to_string_pretty(&run)
        .map_err(|e| ApiError::Internal(e.into()))?;

    std::fs::write(dir.join("run.json"), &content)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "runId": run_id,
        "run": run,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/agent/runs/abort — mark a run as aborted
// ---------------------------------------------------------------------------

async fn abort_run(
    State(state): State<AppState>,
    Json(body): Json<AbortRunBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let run_id = body.run_id.or(body.run_id_camel).or(body.id).ok_or_else(|| {
        ApiError::BadRequest("runId is required".into())
    })?;

    let path = run_json_path(&state, &run_id);
    let content = std::fs::read_to_string(&path).map_err(|_| {
        ApiError::NotFound(format!("Agent run not found: {}", run_id))
    })?;

    let mut run: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| ApiError::Internal(e.into()))?;

    let now = chrono::Utc::now().to_rfc3339();
    if let Some(obj) = run.as_object_mut() {
        obj.insert("status".into(), serde_json::Value::String("aborted".into()));
        obj.insert("updated".into(), serde_json::Value::String(now.clone()));
        obj.insert("endedAt".into(), serde_json::Value::String(now));
    }

    let content = serde_json::to_string_pretty(&run)
        .map_err(|e| ApiError::Internal(e.into()))?;

    std::fs::write(&path, &content)
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "aborted": true,
        "id": run_id,
    })))
}

// ---------------------------------------------------------------------------
// GET /api/agent/completions — list completed runs
// ---------------------------------------------------------------------------

async fn get_completions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let runs_dir = agent_runs_dir(&state);
    let mut completions = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&runs_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let run_file = entry.path().join("run.json");
                if let Ok(content) = std::fs::read_to_string(&run_file) {
                    if let Ok(run) = serde_json::from_str::<serde_json::Value>(&content) {
                        if run.get("status").and_then(|s| s.as_str()) == Some("completed") {
                            completions.push(run);
                        }
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "completions": completions,
        "count": completions.len(),
        "stub": true,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/agent/runs/stream — SSE stub (not available via REST)
// ---------------------------------------------------------------------------

async fn run_stream_stub() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "stub": true,
        "message": "SSE not available via REST stub",
    }))
}
