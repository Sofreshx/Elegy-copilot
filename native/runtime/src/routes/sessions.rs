use axum::{
    Router, routing::get,
    extract::{State, Path, Query},
    Json,
};
use std::collections::{HashSet, HashMap};
use crate::app::AppState;
use crate::sessions;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/unified", get(unified_sessions))
        .route("/api/sessions/{id}/events", get(read_events))
        .route("/api/sessions/{id}/plan", get(read_plan))
        .route("/api/sessions/{id}/archive", axum::routing::post(archive_session))
        .route("/api/sessions/{id}/delete", axum::routing::post(delete_session))
        .route("/api/sessions/workspace", get(workspace_sessions))
        .route("/api/sessions/{id}/agent-usage", get(read_agent_usage))
        .route("/api/sessions/plan", axum::routing::post(session_plan_mutation))
        .route("/api/sessions/{id}/plans", get(read_session_plans))
        .route("/api/sessions/{id}/plans/{plan_id}", get(read_session_plan_by_id))
        .route("/api/sessions/{id}/final", get(read_session_final))
        .route("/api/sessions/{id}/structured-state", get(read_structured_state))
        .route("/api/sessions/{id}/proposition", get(read_proposition))
        .route("/api/sessions/{id}/handoff", get(read_handoff))
        .route("/api/sessions/{id}/verification-guide", get(read_verification_guide))
        .route("/api/sessions/{id}/continuation-package", get(read_continuation_package))
        .route("/api/sessions/{id}/roadmap-sync", axum::routing::post(session_roadmap_sync))
        .with_state(state)
}

/// GET /api/sessions — list all sessions
async fn list_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions = sessions::list_sessions(&state.config.elegy_home);
    let result: Vec<serde_json::Value> = sessions.iter().map(|s| {
        serde_json::json!({
            "id": s.id,
            "storageId": s.storage_id,
            "repo": s.repo,
            "repoId": s.repo_id,
            "projectId": s.project_id,
            "branch": s.branch,
            "cwd": s.cwd,
            "startTime": s.start_time,
            "lastEventTime": s.last_event_time,
            "status": s.status,
        })
    }).collect();
    Json(serde_json::Value::Array(result))
}

/// GET /api/sessions/unified — merge sessions from both elegy_home and sandboxes_home
async fn unified_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions_list = sessions::list_sessions(&state.config.sandboxes_home);
    let copilot_sessions = sessions::list_sessions(&state.config.elegy_home);
    let mut seen: HashSet<&str> = HashSet::new();
    let mut result = Vec::new();
    for s in copilot_sessions.iter().chain(sessions_list.iter()) {
        if seen.insert(&s.id) {
            result.push(serde_json::json!({
                "id": s.id,
                "storageId": s.storage_id,
                "repo": s.repo,
                "repoId": s.repo_id,
                "status": s.status,
                "source": "copilot",
                "startTime": s.start_time,
                "lastEventTime": s.last_event_time,
            }));
        }
    }
    Json(serde_json::json!({ "sessions": result, "count": result.len() }))
}

/// GET /api/sessions/:id/events — read recent events
async fn read_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let dir = state.config.elegy_home.join("session-state").join(&id);
    if !dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    let events_path = dir.join("events.jsonl");
    let events = sessions::read_recent_events(&events_path, 50);
    Ok(Json(serde_json::json!({ "events": events })))
}

/// GET /api/sessions/:id/plan — read plan.md
async fn read_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let plan_path = state.config.elegy_home.join("session-state").join(&id).join("plan.md");
    if !plan_path.exists() {
        return Err(ApiError::NotFound("No plan found for session".into()));
    }
    let content = std::fs::read_to_string(&plan_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "content": content })))
}

/// POST /api/sessions/:id/archive — archive session to sessions-archive/
async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let src = state.config.elegy_home.join("session-state").join(&id);
    if !src.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    let archive_dir = state.config.elegy_home.join("sessions-archive");
    std::fs::create_dir_all(&archive_dir).map_err(|e| ApiError::Internal(e.into()))?;
    let dst = archive_dir.join(&id);
    std::fs::rename(&src, &dst).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "ok": true, "archived": id })))
}

/// POST /api/sessions/:id/delete — delete session directory
async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let dir = state.config.elegy_home.join("session-state").join(&id);
    if !dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "ok": true, "deleted": id })))
}

// ---------------------------------------------------------------------------
// NEW ROUTES
// ---------------------------------------------------------------------------

/// GET /api/sessions/workspace?repoPath=...
/// List sessions filtered by matching repo/cwd path
async fn workspace_sessions(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let repo_path = params.get("repoPath").map(|s| s.as_str()).unwrap_or("");
    let sessions = sessions::list_sessions(&state.config.elegy_home);

    let filtered: Vec<serde_json::Value> = if repo_path.is_empty() {
        sessions.iter().map(|s| {
            serde_json::json!({
                "id": s.id,
                "storageId": s.storage_id,
                "repo": s.repo,
                "repoId": s.repo_id,
                "projectId": s.project_id,
                "branch": s.branch,
                "cwd": s.cwd,
                "startTime": s.start_time,
                "lastEventTime": s.last_event_time,
                "status": s.status,
            })
        }).collect()
    } else {
        let lower_repo = repo_path.to_lowercase();
        sessions.iter()
            .filter(|s| {
                s.repo.as_deref().map_or(false, |r| r.to_lowercase().contains(&lower_repo))
                    || s.cwd.as_deref().map_or(false, |c| c.to_lowercase().contains(&lower_repo))
                    || s.repo_id.as_deref().map_or(false, |r| r.to_lowercase().contains(&lower_repo))
            })
            .map(|s| {
                serde_json::json!({
                    "id": s.id,
                    "storageId": s.storage_id,
                    "repo": s.repo,
                    "repoId": s.repo_id,
                    "projectId": s.project_id,
                    "branch": s.branch,
                    "cwd": s.cwd,
                    "startTime": s.start_time,
                    "lastEventTime": s.last_event_time,
                    "status": s.status,
                })
            })
            .collect()
    };

    Ok(Json(serde_json::json!({ "sessions": filtered, "count": filtered.len() })))
}

/// GET /api/sessions/{id}/agent-usage
/// Read agent-usage.json or derive from events.jsonl
async fn read_agent_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let dir = state.config.elegy_home.join("session-state").join(&id);
    if !dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }

    // Try agent-usage.json first
    let usage_path = dir.join("agent-usage.json");
    if usage_path.exists() {
        let content: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&usage_path).map_err(|e| ApiError::Internal(e.into()))?
        ).unwrap_or(serde_json::json!({}));
        return Ok(Json(serde_json::json!({ "agentUsage": content })));
    }

    // Fallback: parse events.jsonl for agent-related events
    let events_path = dir.join("events.jsonl");
    let mut agent_events: Vec<serde_json::Value> = Vec::new();
    let mut model_usage: Vec<serde_json::Value> = Vec::new();

    if let Ok(text) = std::fs::read_to_string(&events_path) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
                let event_type = event.get("type")
                    .or_else(|| event.get("event"))
                    .or_else(|| event.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if event_type.contains("agent") || event_type == "tool.use" || event_type == "skill.invoke" {
                    agent_events.push(serde_json::json!({
                        "type": event_type,
                        "payload": event.get("payload"),
                    }));
                }
                if event_type.contains("model") || event_type.contains("llm") || event_type == "assistant.message" {
                    model_usage.push(serde_json::json!({
                        "type": event_type,
                        "payload": event.get("payload"),
                    }));
                }
            }
        }
    }

    Ok(Json(serde_json::json!({
        "agentUsage": {
            "agentEvents": agent_events,
            "agentEventCount": agent_events.len(),
            "modelCalls": model_usage,
            "modelCallCount": model_usage.len(),
        }
    })))
}

/// POST /api/sessions/plan
/// Write a plan.md for a session (create or update)
#[derive(serde::Deserialize)]
struct PlanMutationBody {
    session_id: Option<String>,
    content: Option<String>,
}

async fn session_plan_mutation(
    State(state): State<AppState>,
    Json(body): Json<PlanMutationBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let session_id = body.session_id.unwrap_or_else(|| {
        // Generate a planning- prefixed UUID to match Node.js behavior
        format!("planning-{}", uuid::Uuid::new_v4())
    });

    if !is_valid_session_id(&session_id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }

    let content = body.content.ok_or_else(|| ApiError::BadRequest("Plan content is required".into()))?;

    let dir = state.config.elegy_home.join("session-state").join(&session_id);
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::Internal(e.into()))?;

    let plan_path = dir.join("plan.md");
    std::fs::write(&plan_path, &content).map_err(|e| ApiError::Internal(e.into()))?;

    // Also log a session.start event if this is a new session
    let events_path = dir.join("events.jsonl");
    if !events_path.exists() {
        let start_event = serde_json::json!({
            "type": "session.start",
            "time": chrono::Utc::now().to_rfc3339(),
            "payload": {
                "sessionId": &session_id,
                "source": "instruction-engine-ui",
                "mode": "planning",
            }
        });
        let line = format!("{}\n", serde_json::to_string(&start_event).unwrap_or_default());
        std::fs::write(&events_path, &line).map_err(|e| ApiError::Internal(e.into()))?;
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "sessionId": session_id,
    })))
}

/// GET /api/sessions/{id}/plans
/// List all plan files (plan*.md) in the session directory
async fn read_session_plans(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);
    if !session_dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }

    let plans = list_plan_artifacts(&session_dir);
    Ok(Json(serde_json::json!({ "plans": plans })))
}

/// GET /api/sessions/{id}/plans/{plan_id}
/// Read a specific plan file by its ID
async fn read_session_plan_by_id(
    State(state): State<AppState>,
    Path((id, plan_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);
    if !session_dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }

    let content = read_plan_artifact(&session_dir, &plan_id)
        .ok_or_else(|| ApiError::NotFound(format!("Plan not found: {}", plan_id)))?;

    Ok(Json(serde_json::json!({
        "plan": {
            "id": plan_id,
            "content": content,
        }
    })))
}

/// GET /api/sessions/{id}/final
/// Look for final.md or final-state.json and return final content
async fn read_session_final(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);
    if !session_dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }

    // Try final.md first
    let final_md = session_dir.join("final.md");
    if final_md.exists() {
        let content = std::fs::read_to_string(&final_md)
            .map_err(|e| ApiError::Internal(e.into()))?;
        return Ok(Json(serde_json::json!({ "finalContent": content })));
    }

    // Try final-state.json
    let final_json = session_dir.join("final-state.json");
    if final_json.exists() {
        let content: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&final_json).map_err(|e| ApiError::Internal(e.into()))?
        ).unwrap_or(serde_json::json!({}));
        return Ok(Json(serde_json::json!({ "finalState": content })));
    }

    Err(ApiError::NotFound("No final content found for session".into()))
}

/// GET /api/sessions/{id}/structured-state
/// Read structured-state.json from the session directory
async fn read_structured_state(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let file_path = state.config.elegy_home.join("session-state").join(&id).join("structured-state.json");
    if !file_path.exists() {
        return Ok(Json(serde_json::json!({})));
    }
    let content: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&file_path).map_err(|e| ApiError::Internal(e.into()))?
    ).unwrap_or(serde_json::json!({}));
    Ok(Json(content))
}

/// GET /api/sessions/{id}/proposition
/// Read proposition.md from the session directory
async fn read_proposition(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let file_path = state.config.elegy_home.join("session-state").join(&id).join("proposition.md");
    if !file_path.exists() {
        return Err(ApiError::NotFound("Proposition not found".into()));
    }
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "content": content })))
}

/// GET /api/sessions/{id}/handoff
/// Read handoff.md from the session directory
async fn read_handoff(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let file_path = state.config.elegy_home.join("session-state").join(&id).join("handoff.md");
    if !file_path.exists() {
        return Err(ApiError::NotFound("Handoff not found".into()));
    }
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "content": content })))
}

/// GET /api/sessions/{id}/verification-guide
/// Look for verification-guide.md or verify.md in the session directory
async fn read_verification_guide(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);

    // Try verification-guide.md first
    let guide_path = session_dir.join("verification-guide.md");
    if guide_path.exists() {
        let content = std::fs::read_to_string(&guide_path)
            .map_err(|e| ApiError::Internal(e.into()))?;
        return Ok(Json(serde_json::json!({ "content": content })));
    }

    // Fallback to verify.md
    let verify_path = session_dir.join("verify.md");
    if verify_path.exists() {
        let content = std::fs::read_to_string(&verify_path)
            .map_err(|e| ApiError::Internal(e.into()))?;
        return Ok(Json(serde_json::json!({ "content": content })));
    }

    Err(ApiError::NotFound("Verification guide not found".into()))
}

/// GET /api/sessions/{id}/continuation-package
/// Read continuation-package.json or continuation-package.md
async fn read_continuation_package(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);

    // Try continuation-package.json first
    let json_path = session_dir.join("continuation-package.json");
    if json_path.exists() {
        let content: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&json_path).map_err(|e| ApiError::Internal(e.into()))?
        ).unwrap_or(serde_json::json!({}));
        return Ok(Json(content));
    }

    // Fallback to continuation-package.md
    let md_path = session_dir.join("continuation-package.md");
    if md_path.exists() {
        let content = std::fs::read_to_string(&md_path)
            .map_err(|e| ApiError::Internal(e.into()))?;
        return Ok(Json(serde_json::json!({ "content": content })));
    }

    Ok(Json(serde_json::json!({})))
}

/// POST /api/sessions/{id}/roadmap-sync
/// Stub: create/update roadmap-sync.json in the session directory
#[derive(serde::Deserialize)]
struct RoadmapSyncBody {
    roadmap_id: Option<String>,
    action: Option<String>,
}

async fn session_roadmap_sync(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RoadmapSyncBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let session_dir = state.config.elegy_home.join("session-state").join(&id);
    std::fs::create_dir_all(&session_dir).map_err(|e| ApiError::Internal(e.into()))?;

    // Create/update roadmap-sync.json
    let sync_data = serde_json::json!({
        "sessionId": id,
        "roadmapId": body.roadmap_id,
        "action": body.action,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    let sync_path = session_dir.join("roadmap-sync.json");
    std::fs::write(&sync_path, serde_json::to_string_pretty(&sync_data).unwrap_or_default())
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "sessionId": id,
        "action": body.action.unwrap_or_default(),
    })))
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

fn is_valid_session_id(id: &str) -> bool {
    // Match Node.js: alphanumeric + hyphens, max 256, no path traversal
    id.len() <= 256
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\')
        && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// List all plan artifacts (plan*.md files) in a session directory
fn list_plan_artifacts(session_dir: &std::path::Path) -> Vec<serde_json::Value> {
    let mut plans = Vec::new();
    let Ok(entries) = std::fs::read_dir(session_dir) else {
        return plans;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("plan") && name.ends_with(".md") {
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                // Derive plan ID: strip ".md" extension
                let id = name.trim_end_matches(".md");
                plans.push(serde_json::json!({
                    "id": id,
                    "content": content,
                }));
            }
        }
    }
    plans.sort_by(|a, b| {
        let a_id = a["id"].as_str().unwrap_or("");
        let b_id = b["id"].as_str().unwrap_or("");
        a_id.cmp(b_id)
    });
    plans
}

/// Read a specific plan artifact by plan ID
fn read_plan_artifact(session_dir: &std::path::Path, plan_id: &str) -> Option<String> {
    // "latest" or "plan" maps to plan.md
    if plan_id == "latest" || plan_id == "plan" {
        let plan_md = session_dir.join("plan.md");
        if plan_md.exists() {
            return std::fs::read_to_string(&plan_md).ok();
        }
    }

    // Direct match: {plan_id}.md
    let direct = session_dir.join(format!("{}.md", plan_id));
    if direct.exists() {
        return std::fs::read_to_string(&direct).ok();
    }

    // With plan- prefix: plan-{plan_id}.md (in case the ID already has "plan-" prefix stripped)
    let prefixed = session_dir.join(format!("plan-{}.md", plan_id));
    if prefixed.exists() {
        return std::fs::read_to_string(&prefixed).ok();
    }

    None
}
