use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use elegy_native_contracts::types::orchestrator::{AdapterCapabilities, OrchestratorApiError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{self as stream, Stream, StreamExt};

use crate::app::AppState;
use crate::config::RuntimeConfig;
use crate::orchestrator::pilot::{
    adapter_allowed, merge_enabled, PilotEventCategory, PilotEventInput, PilotTelemetry,
    PILOT_ADAPTERS,
};
use crate::orchestrator::worker::{
    CodexExecAdapter, NativeAdapter, OpenCodeAcpAdapter, WorkerAdapter,
};

const STORE_SCHEMA: &str = "orchestrator-api-store/v1";
const SESSION_SCHEMA: &str = "orchestrator-session/v1";
const EVENT_SCHEMA: &str = "orchestrator-api-event/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEvent {
    pub schema_version: String,
    pub event_id: u64,
    pub session_id: String,
    pub event_type: String,
    pub occurred_at: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSession {
    pub schema_version: String,
    pub session_id: String,
    pub repo_id: String,
    pub title: String,
    pub adapter_id: String,
    pub state: String,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub planning: Value,
    pub work_points: Vec<Value>,
    pub approvals: Vec<Value>,
    pub input_requests: Vec<Value>,
    pub events: Vec<ApiEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdempotencyEntry {
    payload_hash: String,
    status: u16,
    response: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiStore {
    schema_version: String,
    next_event_id: u64,
    sessions: BTreeMap<String, ApiSession>,
    idempotency: BTreeMap<String, IdempotencyEntry>,
}

#[derive(Debug)]
pub struct OrchestratorApi {
    path: PathBuf,
    store: Mutex<ApiStore>,
    events: broadcast::Sender<ApiEvent>,
    config: RuntimeConfig,
    telemetry: PilotTelemetry,
}

impl OrchestratorApi {
    pub fn open(config: &RuntimeConfig) -> Result<Self, ApiFailure> {
        let directory = config.elegy_home.join("orchestrator");
        fs::create_dir_all(&directory)?;
        let path = directory.join("api-state.json");
        let store = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => ApiStore {
                schema_version: STORE_SCHEMA.into(),
                next_event_id: 1,
                ..ApiStore::default()
            },
            Err(error) => return Err(error.into()),
        };
        if store.schema_version != STORE_SCHEMA {
            return Err(ApiFailure::UnsupportedStore(store.schema_version));
        }
        let (events, _) = broadcast::channel(256);
        let telemetry = PilotTelemetry::open(&config.elegy_home)?;
        Ok(Self {
            path,
            store: Mutex::new(store),
            events,
            config: config.clone(),
            telemetry,
        })
    }

    fn read_sessions(&self) -> Result<Vec<ApiSession>, ApiFailure> {
        let store = self.store.lock().map_err(|_| ApiFailure::LockPoisoned)?;
        Ok(store.sessions.values().cloned().collect())
    }

    fn read_session(&self, id: &str) -> Result<ApiSession, ApiFailure> {
        let store = self.store.lock().map_err(|_| ApiFailure::LockPoisoned)?;
        store.sessions.get(id).cloned().ok_or(ApiFailure::NotFound)
    }

    fn events_after(&self, id: &str, last_event_id: u64) -> Result<Vec<ApiEvent>, ApiFailure> {
        Ok(self
            .read_session(id)?
            .events
            .into_iter()
            .filter(|event| event.event_id > last_event_id)
            .collect())
    }

    fn mutate(
        &self,
        method: &str,
        path: &str,
        idempotency_key: &str,
        body: &Value,
        operation: impl FnOnce(
            &mut ApiStore,
        ) -> Result<(StatusCode, Value, Option<ApiEvent>), ApiFailure>,
    ) -> Result<(StatusCode, Value), ApiFailure> {
        let mut store = self.store.lock().map_err(|_| ApiFailure::LockPoisoned)?;
        let key = format!("{method}:{path}:{idempotency_key}");
        let payload_hash = hex::encode(Sha256::digest(serde_json::to_vec(body)?));
        if let Some(existing) = store.idempotency.get(&key) {
            if existing.payload_hash != payload_hash {
                return Err(ApiFailure::IdempotencyConflict);
            }
            return Ok((
                StatusCode::from_u16(existing.status).unwrap_or(StatusCode::OK),
                existing.response.clone(),
            ));
        }
        let (status, response, event) = operation(&mut store)?;
        store.idempotency.insert(
            key,
            IdempotencyEntry {
                payload_hash,
                status: status.as_u16(),
                response: response.clone(),
            },
        );
        self.write_store(&store)?;
        drop(store);
        if let Some(event) = event {
            let _ = self.events.send(event);
        }
        Ok((status, response))
    }

    fn write_store(&self, store: &ApiStore) -> Result<(), ApiFailure> {
        let temp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut bytes = serde_json::to_vec_pretty(store)?;
        bytes.push(b'\n');
        fs::write(&temp, bytes)?;
        fs::rename(temp, &self.path)?;
        Ok(())
    }

    fn health(&self) -> Value {
        let executable = if cfg!(windows) {
            "elegy-planning.exe"
        } else {
            "elegy-planning"
        };
        let planning_path = [
            self.config
                .elegy_home
                .join("managed-cli/planning")
                .join(executable),
            self.config
                .elegy_home
                .join("managed-cli/planning/bin")
                .join(executable),
            self.config
                .engine_root
                .join("elegy-planning")
                .join(executable),
        ]
        .into_iter()
        .find(|path| path.is_file());
        let adapters: Vec<AdapterCapabilities> = vec![
            Box::new(OpenCodeAcpAdapter::new(
                PathBuf::from("opencode"),
                Duration::from_secs(300),
            )) as Box<dyn WorkerAdapter>,
            Box::new(CodexExecAdapter::new(
                PathBuf::from("codex"),
                "gpt-5.4",
                Duration::from_secs(300),
            )),
            Box::new(NativeAdapter),
        ]
        .into_iter()
        .map(|adapter| adapter.capabilities())
        .collect();
        let journal_directory = self.config.elegy_home.join("orchestrator").join("journals");
        let orphan_recovery = fs::read_dir(&journal_directory)
            .map(|entries| entries.filter_map(Result::ok).count())
            .unwrap_or(0);
        let pilot_merge_enabled =
            merge_enabled(&self.config.orchestrator_pilot, &self.config.elegy_home);
        let telemetry_count = self.telemetry.event_count();
        let telemetry_ready = telemetry_count.is_ok();
        let telemetry_error = telemetry_count.as_ref().err().map(ToString::to_string);
        serde_json::json!({
            "schemaVersion": "orchestrator-health/v1",
            "ok": planning_path.is_some()
                && (!self.config.orchestrator_pilot.enabled || telemetry_ready),
            "planning": {
                "compatible": planning_path.is_some(),
                "negotiated": false,
                "requiredResultSchema": "planning-result/v1",
                "requiredPlanningSchema": "10",
                "cliPath": planning_path
            },
            "adapters": adapters,
            "journal": {
                "ready": fs::create_dir_all(&journal_directory).is_ok(),
                "journalCount": orphan_recovery
            },
            "orphanRecovery": {
                "ready": true,
                "recoverableJournalCount": orphan_recovery
            },
            "pilot": {
                "enabled": self.config.orchestrator_pilot.enabled,
                "allowedAdapters": PILOT_ADAPTERS,
                "oneActiveRunPerRepository": true,
                "approvedOperation": "commit",
                "mergeRequested": self.config.orchestrator_pilot.merge_requested,
                "mergeEnabled": pilot_merge_enabled,
                "telemetryPath": self.telemetry.path(),
                "telemetryReady": telemetry_ready,
                "telemetryError": telemetry_error,
                "telemetryEventCount": telemetry_count.unwrap_or(0)
            }
        })
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/orchestrator/health", get(health))
        .route(
            "/api/orchestrator/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/orchestrator/sessions/{id}", get(get_session))
        .route(
            "/api/orchestrator/sessions/{id}/work-points",
            post(add_work_point),
        )
        .route(
            "/api/orchestrator/sessions/{id}/approvals",
            post(add_approval),
        )
        .route("/api/orchestrator/sessions/{id}/input", post(add_input))
        .route("/api/orchestrator/sessions/{id}/retry", post(retry))
        .route("/api/orchestrator/sessions/{id}/resume", post(resume))
        .route("/api/orchestrator/sessions/{id}/cancel", post(cancel))
        .route("/api/orchestrator/sessions/{id}/events", get(events))
        .route("/api/orchestrator/pilot/events", post(record_pilot_event))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(state.orchestrator_api.health())
}

async fn list_sessions(State(state): State<AppState>) -> Result<Json<Value>, ApiFailure> {
    Ok(Json(serde_json::json!({
        "sessions": state.orchestrator_api.read_sessions()?
    })))
}

async fn get_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ApiFailure> {
    Ok(Json(serde_json::to_value(
        state.orchestrator_api.read_session(&id)?,
    )?))
}

async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiFailure> {
    let key = idempotency_key(&headers)?;
    if !state.config.orchestrator_pilot.enabled {
        return Err(ApiFailure::PilotDisabled);
    }
    let result = state.orchestrator_api.mutate(
        "POST",
        "/api/orchestrator/sessions",
        key,
        &body,
        |store| {
            let repo_id = required_string(&body, "repoId")?;
            let adapter_id = required_string(&body, "adapterId")?;
            if !adapter_allowed(&state.config.orchestrator_pilot, adapter_id) {
                return Err(ApiFailure::PilotPolicy(format!(
                    "adapter {adapter_id} is not enabled for the bounded pilot"
                )));
            }
            if let Some(existing) = store.sessions.values().find(|session| {
                session.repo_id == repo_id && !is_terminal_session_state(&session.state)
            }) {
                state.orchestrator_api.telemetry.record_idempotent(
                    &format!("dispatch-rejected:{key}"),
                    PilotEventInput::new(
                        PilotEventCategory::DuplicateDispatchAttempt,
                        Some(repo_id),
                        Some(&existing.session_id),
                        "rejected",
                        None,
                        serde_json::json!({ "requestedAdapterId": adapter_id }),
                    ),
                )?;
                return Err(ApiFailure::Conflict(
                    "repository already has an active orchestrator session".into(),
                ));
            }
            let now = Utc::now().to_rfc3339();
            let session_id = body
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if store.sessions.contains_key(&session_id) {
                return Err(ApiFailure::Conflict("session already exists".into()));
            }
            let event = next_event(
                store,
                &session_id,
                "session-created",
                serde_json::json!({ "state": "created" }),
            );
            let session = ApiSession {
                schema_version: SESSION_SCHEMA.into(),
                session_id: session_id.clone(),
                repo_id: repo_id.into(),
                title: body
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Execution session")
                    .into(),
                adapter_id: adapter_id.into(),
                state: "created".into(),
                revision: 1,
                created_at: now.clone(),
                updated_at: now,
                planning: body.get("planning").cloned().unwrap_or(Value::Null),
                work_points: Vec::new(),
                approvals: Vec::new(),
                input_requests: Vec::new(),
                events: vec![event.clone()],
            };
            store.sessions.insert(session_id, session.clone());
            Ok((
                StatusCode::CREATED,
                serde_json::to_value(session)?,
                Some(event),
            ))
        },
    )?;
    Ok(result.into_response())
}

async fn add_work_point(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiFailure> {
    mutate_session_collection(
        &state,
        &id,
        "work-points",
        "work-point-added",
        headers,
        body,
        |session, body| session.work_points.push(body),
    )
}

async fn add_approval(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiFailure> {
    let telemetry_key = format!("approval:{id}:{}", idempotency_key(&headers)?);
    let mut telemetry = None;
    if state.config.orchestrator_pilot.enabled {
        let operation = body
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or("commit");
        if operation == "merge"
            && !merge_enabled(&state.config.orchestrator_pilot, &state.config.elegy_home)
        {
            return Err(ApiFailure::PilotPolicy(
                "merge promotion gates are not satisfied".into(),
            ));
        }
        if operation != "commit" && operation != "merge" {
            return Err(ApiFailure::PilotPolicy(
                "bounded pilot approvals support commit only".into(),
            ));
        }
        let duration_ms = body
            .get("requestedAtUnixMs")
            .and_then(Value::as_u64)
            .map(|requested| {
                (Utc::now().timestamp_millis().max(0) as u64).saturating_sub(requested)
            });
        telemetry = Some((
            state
                .orchestrator_api
                .read_session(&id)
                .ok()
                .map(|session| session.repo_id),
            body.get("decision")
                .and_then(Value::as_str)
                .unwrap_or("recorded")
                .to_string(),
            duration_ms,
            serde_json::json!({ "operation": operation }),
        ));
    }
    let response = mutate_session_collection(
        &state,
        &id,
        "approvals",
        "approval-recorded",
        headers,
        body,
        |session, body| session.approvals.push(body),
    )?;
    if let Some((repo_id, outcome, duration_ms, detail)) = telemetry {
        state.orchestrator_api.telemetry.record_idempotent(
            &telemetry_key,
            PilotEventInput::new(
                PilotEventCategory::ApprovalLatency,
                repo_id.as_deref(),
                Some(&id),
                outcome,
                duration_ms,
                detail,
            ),
        )?;
    }
    Ok(response)
}

async fn add_input(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiFailure> {
    mutate_session_collection(
        &state,
        &id,
        "input",
        "input-recorded",
        headers,
        body,
        |session, body| session.input_requests.push(body),
    )
}

fn mutate_session_collection(
    state: &AppState,
    id: &str,
    action: &str,
    event_type: &str,
    headers: HeaderMap,
    body: Value,
    update: impl FnOnce(&mut ApiSession, Value),
) -> Result<Response, ApiFailure> {
    let key = idempotency_key(&headers)?;
    let path = format!("/api/orchestrator/sessions/{id}/{action}");
    let result = state
        .orchestrator_api
        .mutate("POST", &path, key, &body, |store| {
            let expected = expected_revision(&body);
            let session = store.sessions.get_mut(id).ok_or(ApiFailure::NotFound)?;
            require_revision(session, expected)?;
            update(session, body.clone());
            session.revision += 1;
            session.updated_at = Utc::now().to_rfc3339();
            let event = next_event(store, id, event_type, body.clone());
            let session = store.sessions.get_mut(id).expect("session");
            session.events.push(event.clone());
            let response = serde_json::to_value(session.clone())?;
            Ok((StatusCode::OK, response, Some(event)))
        })?;
    Ok(result.into_response())
}

async fn retry(
    state: State<AppState>,
    id: AxumPath<String>,
    headers: HeaderMap,
    body: Json<Value>,
) -> Result<Response, ApiFailure> {
    action(state, id, headers, body, "retry", "retry-requested")
}

async fn resume(
    state: State<AppState>,
    id: AxumPath<String>,
    headers: HeaderMap,
    body: Json<Value>,
) -> Result<Response, ApiFailure> {
    action(state, id, headers, body, "running", "resume-requested")
}

async fn cancel(
    state: State<AppState>,
    id: AxumPath<String>,
    headers: HeaderMap,
    body: Json<Value>,
) -> Result<Response, ApiFailure> {
    let session_id = id.0.clone();
    let telemetry_key = format!("cancel:{session_id}:{}", idempotency_key(&headers)?);
    let repo_id = state
        .orchestrator_api
        .read_session(&session_id)
        .ok()
        .map(|session| session.repo_id);
    let response = action(
        state.clone(),
        id,
        headers,
        body,
        "cancelled",
        "cancel-requested",
    )?;
    if state.config.orchestrator_pilot.enabled {
        state.orchestrator_api.telemetry.record_idempotent(
            &telemetry_key,
            PilotEventInput::new(
                PilotEventCategory::CancellationOutcome,
                repo_id.as_deref(),
                Some(&session_id),
                "cancelled",
                None,
                Value::Null,
            ),
        )?;
    }
    Ok(response)
}

async fn record_pilot_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiFailure> {
    if !state.config.orchestrator_pilot.enabled {
        return Err(ApiFailure::PilotDisabled);
    }
    let category = body
        .get("category")
        .cloned()
        .ok_or_else(|| ApiFailure::Invalid("category is required".into()))
        .and_then(|value| {
            serde_json::from_value::<PilotEventCategory>(value)
                .map_err(|_| ApiFailure::Invalid("unsupported pilot event category".into()))
        })?;
    let event = state.orchestrator_api.telemetry.record_idempotent(
        idempotency_key(&headers)?,
        PilotEventInput::new(
            category,
            body.get("repoId").and_then(Value::as_str),
            body.get("sessionId").and_then(Value::as_str),
            body.get("outcome")
                .and_then(Value::as_str)
                .unwrap_or("observed"),
            body.get("durationMs").and_then(Value::as_u64),
            body.get("detail").cloned().unwrap_or(Value::Null),
        ),
    )?;
    Ok((StatusCode::CREATED, Json(serde_json::to_value(event)?)).into_response())
}

fn action(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
    next_state: &str,
    event_type: &str,
) -> Result<Response, ApiFailure> {
    let key = idempotency_key(&headers)?;
    let path = format!("/api/orchestrator/sessions/{id}/{event_type}");
    let result = state
        .orchestrator_api
        .mutate("POST", &path, key, &body, |store| {
            let expected = expected_revision(&body);
            let session = store.sessions.get_mut(&id).ok_or(ApiFailure::NotFound)?;
            require_revision(session, expected)?;
            session.state = next_state.into();
            session.revision += 1;
            session.updated_at = Utc::now().to_rfc3339();
            let event = next_event(
                store,
                &id,
                event_type,
                serde_json::json!({ "state": next_state }),
            );
            let session = store.sessions.get_mut(&id).expect("session");
            session.events.push(event.clone());
            let response = serde_json::to_value(session.clone())?;
            Ok((StatusCode::OK, response, Some(event)))
        })?;
    Ok(result.into_response())
}

async fn events(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiFailure> {
    let last_id = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let receiver = state.orchestrator_api.events.subscribe();
    let replay_events = state.orchestrator_api.events_after(&id, last_id)?;
    let replay_boundary = replay_events
        .last()
        .map(|event| event.event_id)
        .unwrap_or(last_id);
    let replay = replay_events
        .into_iter()
        .map(event_to_sse)
        .collect::<Vec<_>>();
    let session_id = id.clone();
    let live = BroadcastStream::new(receiver).filter_map(move |event| match event {
        Ok(event) if event.session_id == session_id && event.event_id > replay_boundary => {
            Some(event_to_sse(event))
        }
        _ => None,
    });
    Ok(Sse::new(stream::iter(replay).chain(live)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

fn event_to_sse(event: ApiEvent) -> Result<Event, Infallible> {
    Ok(Event::default()
        .id(event.event_id.to_string())
        .event(event.event_type.clone())
        .json_data(event)
        .expect("serializable event"))
}

fn next_event(store: &mut ApiStore, session_id: &str, event_type: &str, data: Value) -> ApiEvent {
    let event = ApiEvent {
        schema_version: EVENT_SCHEMA.into(),
        event_id: store.next_event_id,
        session_id: session_id.into(),
        event_type: event_type.into(),
        occurred_at: Utc::now().to_rfc3339(),
        data,
    };
    store.next_event_id += 1;
    event
}

fn idempotency_key(headers: &HeaderMap) -> Result<&str, ApiFailure> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiFailure::MissingIdempotencyKey)
}

fn required_string<'a>(body: &'a Value, field: &str) -> Result<&'a str, ApiFailure> {
    body.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiFailure::Invalid(format!("{field} is required")))
}

fn expected_revision(body: &Value) -> Option<u64> {
    body.get("expectedRevision").and_then(Value::as_u64)
}

fn require_revision(session: &ApiSession, expected: Option<u64>) -> Result<(), ApiFailure> {
    if let Some(expected) = expected {
        if session.revision != expected {
            return Err(ApiFailure::Stale {
                expected,
                actual: session.revision,
            });
        }
    }
    Ok(())
}

fn is_terminal_session_state(state: &str) -> bool {
    matches!(
        state,
        "completed" | "failed" | "cancelled" | "committed" | "merged"
    )
}

fn error_body(code: &str, message: String, retryable: bool, details: Option<Value>) -> Value {
    serde_json::to_value(OrchestratorApiError {
        schema_version: "orchestrator-api-error/v1".into(),
        kind: "api-error".into(),
        code: code.into(),
        message,
        retryable,
        details,
    })
    .expect("error serialization")
}

#[derive(Debug, thiserror::Error)]
pub enum ApiFailure {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("orchestrator API state lock poisoned")]
    LockPoisoned,
    #[error("unsupported API store schema {0}")]
    UnsupportedStore(String),
    #[error("resource not found")]
    NotFound,
    #[error("Idempotency-Key header is required")]
    MissingIdempotencyKey,
    #[error("idempotency key conflicts with a different payload")]
    IdempotencyConflict,
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("stale revision: expected {expected}, actual {actual}")]
    Stale { expected: u64, actual: u64 },
    #[error("orchestrator experimental pilot is disabled")]
    PilotDisabled,
    #[error("pilot policy rejected the request: {0}")]
    PilotPolicy(String),
    #[error(transparent)]
    Pilot(#[from] crate::orchestrator::pilot::PilotError),
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        let (status, code, retryable, details) = match &self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found", false, None),
            Self::MissingIdempotencyKey => (
                StatusCode::BAD_REQUEST,
                "idempotency_key_required",
                false,
                None,
            ),
            Self::IdempotencyConflict => {
                (StatusCode::CONFLICT, "idempotency_conflict", false, None)
            }
            Self::Invalid(_) => (StatusCode::BAD_REQUEST, "invalid_request", false, None),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict", false, None),
            Self::Stale { expected, actual } => (
                StatusCode::CONFLICT,
                "stale_state",
                false,
                Some(serde_json::json!({ "expectedRevision": expected, "actualRevision": actual })),
            ),
            Self::PilotDisabled => (
                StatusCode::SERVICE_UNAVAILABLE,
                "pilot_disabled",
                false,
                None,
            ),
            Self::PilotPolicy(_) => (StatusCode::FORBIDDEN, "pilot_policy_rejected", false, None),
            Self::Io(_)
            | Self::Json(_)
            | Self::LockPoisoned
            | Self::UnsupportedStore(_)
            | Self::Pilot(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                true,
                None,
            ),
        };
        (
            status,
            Json(error_body(code, self.to_string(), retryable, details)),
        )
            .into_response()
    }
}

trait MutationResponse {
    fn into_response(self) -> Response;
}

impl MutationResponse for (StatusCode, Value) {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

#[cfg(test)]
mod tests;
