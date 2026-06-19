use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::OrchestratorPilotConfig;

pub const PILOT_ADAPTERS: [&str; 2] = ["native", "codex-exec"];
const EVENT_SCHEMA: &str = "orchestrator-pilot-event/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PilotEventCategory {
    DuplicateDispatchAttempt,
    AdapterParseFailure,
    RecoveryFailure,
    ScopeViolation,
    ApprovalLatency,
    CancellationOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PilotEvent {
    pub schema_version: String,
    pub event_id: String,
    pub occurred_at: String,
    pub category: PilotEventCategory,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    pub repo_id: Option<String>,
    pub session_id: Option<String>,
    pub outcome: String,
    pub duration_ms: Option<u64>,
    pub detail: Value,
}

#[derive(Debug, Clone)]
pub struct PilotEventInput {
    pub category: PilotEventCategory,
    pub repo_id: Option<String>,
    pub session_id: Option<String>,
    pub outcome: String,
    pub duration_ms: Option<u64>,
    pub detail: Value,
}

impl PilotEventInput {
    pub fn new(
        category: PilotEventCategory,
        repo_id: Option<&str>,
        session_id: Option<&str>,
        outcome: impl Into<String>,
        duration_ms: Option<u64>,
        detail: Value,
    ) -> Self {
        Self {
            category,
            repo_id: repo_id.map(str::to_string),
            session_id: session_id.map(str::to_string),
            outcome: outcome.into(),
            duration_ms,
            detail,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromotionGates {
    stale_approval_gate_passed: bool,
    crash_injection_gate_passed: bool,
}

#[derive(Debug)]
pub struct PilotTelemetry {
    path: PathBuf,
    lock: Mutex<()>,
}

impl PilotTelemetry {
    pub fn open(elegy_home: &Path) -> Result<Self, PilotError> {
        let directory = elegy_home.join("orchestrator").join("pilot");
        fs::create_dir_all(&directory)?;
        Ok(Self {
            path: directory.join("events.jsonl"),
            lock: Mutex::new(()),
        })
    }

    pub fn record(&self, input: PilotEventInput) -> Result<PilotEvent, PilotError> {
        let _guard = self.lock.lock().map_err(|_| PilotError::LockPoisoned)?;
        self.append(None, input)
    }

    pub fn record_idempotent(
        &self,
        idempotency_key: &str,
        input: PilotEventInput,
    ) -> Result<PilotEvent, PilotError> {
        let _guard = self.lock.lock().map_err(|_| PilotError::LockPoisoned)?;
        if let Some(existing) = self
            .events()?
            .into_iter()
            .find(|event| event.idempotency_key.as_deref() == Some(idempotency_key))
        {
            if existing.category == input.category
                && existing.repo_id == input.repo_id
                && existing.session_id == input.session_id
                && existing.outcome == input.outcome
                && existing.duration_ms == input.duration_ms
                && existing.detail == input.detail
            {
                return Ok(existing);
            }
            return Err(PilotError::IdempotencyConflict);
        }
        self.append(Some(idempotency_key.to_string()), input)
    }

    fn append(
        &self,
        idempotency_key: Option<String>,
        input: PilotEventInput,
    ) -> Result<PilotEvent, PilotError> {
        let event = PilotEvent {
            schema_version: EVENT_SCHEMA.into(),
            event_id: uuid::Uuid::new_v4().to_string(),
            occurred_at: Utc::now().to_rfc3339(),
            category: input.category,
            idempotency_key,
            repo_id: input.repo_id,
            session_id: input.session_id,
            outcome: input.outcome,
            duration_ms: input.duration_ms,
            detail: input.detail,
        };
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        serde_json::to_writer(&mut file, &event)?;
        file.write_all(b"\n")?;
        file.flush()?;
        file.sync_data()?;
        Ok(event)
    }

    pub fn event_count(&self) -> Result<u64, PilotError> {
        let _guard = self.lock.lock().map_err(|_| PilotError::LockPoisoned)?;
        Ok(self.events()?.len() as u64)
    }

    fn events(&self) -> Result<Vec<PilotEvent>, PilotError> {
        match OpenOptions::new().read(true).open(&self.path) {
            Ok(file) => BufReader::new(file)
                .lines()
                .filter(|line| {
                    line.as_ref()
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(true)
                })
                .map(|line| Ok(serde_json::from_str(&line?)?))
                .collect(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

pub fn adapter_allowed(config: &OrchestratorPilotConfig, adapter_id: &str) -> bool {
    config.enabled && PILOT_ADAPTERS.contains(&adapter_id)
}

pub fn merge_enabled(config: &OrchestratorPilotConfig, elegy_home: &Path) -> bool {
    if !config.enabled || !config.merge_requested {
        return false;
    }
    let path = elegy_home
        .join("orchestrator")
        .join("pilot")
        .join("promotion-gates.json");
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<PromotionGates>(&bytes).ok())
        .map(|gates| gates.stale_approval_gate_passed && gates.crash_injection_gate_passed)
        .unwrap_or(false)
}

#[derive(Debug, thiserror::Error)]
pub enum PilotError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("pilot telemetry lock poisoned")]
    LockPoisoned,
    #[error("pilot telemetry idempotency key conflicts with a different payload")]
    IdempotencyConflict,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_requires_request_and_both_persisted_gates() {
        let home = tempfile::tempdir().expect("home");
        let config = OrchestratorPilotConfig {
            enabled: true,
            merge_requested: true,
        };
        assert!(!merge_enabled(&config, home.path()));
        let directory = home.path().join("orchestrator/pilot");
        fs::create_dir_all(&directory).expect("pilot directory");
        fs::write(
            directory.join("promotion-gates.json"),
            br#"{"staleApprovalGatePassed":true,"crashInjectionGatePassed":true}"#,
        )
        .expect("gates");
        assert!(merge_enabled(&config, home.path()));
    }

    #[test]
    fn telemetry_appends_every_required_category() {
        let home = tempfile::tempdir().expect("home");
        let telemetry = PilotTelemetry::open(home.path()).expect("telemetry");
        let categories = [
            PilotEventCategory::DuplicateDispatchAttempt,
            PilotEventCategory::AdapterParseFailure,
            PilotEventCategory::RecoveryFailure,
            PilotEventCategory::ScopeViolation,
            PilotEventCategory::ApprovalLatency,
            PilotEventCategory::CancellationOutcome,
        ];
        for category in categories {
            telemetry
                .record(PilotEventInput::new(
                    category,
                    Some("repo"),
                    Some("session"),
                    "observed",
                    None,
                    Value::Null,
                ))
                .expect("record");
        }
        assert_eq!(telemetry.event_count().expect("count"), 6);
        let lines = fs::read_to_string(telemetry.path()).expect("events");
        for line in lines.lines() {
            let event: PilotEvent = serde_json::from_str(line).expect("event");
            assert_eq!(event.schema_version, EVENT_SCHEMA);
        }
    }

    #[test]
    fn telemetry_idempotency_survives_reopen() {
        let home = tempfile::tempdir().expect("home");
        let first = PilotTelemetry::open(home.path()).expect("telemetry");
        let event = first
            .record_idempotent(
                "event-1",
                PilotEventInput::new(
                    PilotEventCategory::RecoveryFailure,
                    Some("repo"),
                    None,
                    "failed",
                    None,
                    Value::Null,
                ),
            )
            .expect("record");
        let reopened = PilotTelemetry::open(home.path()).expect("reopen");
        let replay = reopened
            .record_idempotent(
                "event-1",
                PilotEventInput::new(
                    PilotEventCategory::RecoveryFailure,
                    Some("repo"),
                    None,
                    "failed",
                    None,
                    Value::Null,
                ),
            )
            .expect("replay");
        assert_eq!(event.event_id, replay.event_id);
        assert_eq!(reopened.event_count().expect("count"), 1);
    }
}
