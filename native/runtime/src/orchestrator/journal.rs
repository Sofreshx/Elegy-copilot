use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use elegy_native_contracts::types::orchestrator::ExecutionIdentity;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const JOURNAL_SCHEMA_VERSION: &str = "orchestrator-journal-event/v1";
pub const SNAPSHOT_SCHEMA_VERSION: &str = "orchestrator-projection/v1";
pub const COMPACTION_SUPPORTED: bool = false;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionState {
    Claimed,
    Dispatched,
    Running,
    Completed,
    Failed,
    Cancelled,
    Verifying,
    Verified,
    VerificationFailed,
    AwaitingApproval,
    Approved,
    Rejected,
    Committing,
    Committed,
    CommitFailed,
    Merging,
    Merged,
    MergeConflict,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryClass {
    Restartable,
    Replayable,
    Terminal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub schema_version: String,
    pub event_id: String,
    pub sequence: u64,
    pub identity: ExecutionIdentity,
    pub state: ExecutionState,
    pub occurred_at: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionProjection {
    pub schema_version: String,
    pub identity: ExecutionIdentity,
    pub state: ExecutionState,
    pub recovery_class: RecoveryClass,
    pub last_sequence: u64,
    pub event_ids: Vec<String>,
}

pub struct ExecutionJournal {
    path: PathBuf,
    writer: Mutex<()>,
}

impl ExecutionJournal {
    pub fn open(root: &Path, repo_id: &str) -> Result<Self, JournalError> {
        let directory = root.join("orchestrator").join("journals");
        fs::create_dir_all(&directory)?;
        Ok(Self {
            path: directory.join(format!("{repo_id}.jsonl")),
            writer: Mutex::new(()),
        })
    }

    pub fn append(&self, event: &JournalEvent) -> Result<ExecutionProjection, JournalError> {
        if event.schema_version != JOURNAL_SCHEMA_VERSION {
            return Err(JournalError::UnsupportedSchema(
                event.schema_version.clone(),
            ));
        }
        let _guard = self.writer.lock().map_err(|_| JournalError::LockPoisoned)?;
        let events = self.read_events()?;
        if events
            .iter()
            .any(|existing| existing.event_id == event.event_id)
        {
            return Err(JournalError::DuplicateEventId(event.event_id.clone()));
        }
        if event.identity.repo_id
            != events
                .first()
                .map(|existing| existing.identity.repo_id.as_str())
                .unwrap_or(event.identity.repo_id.as_str())
        {
            return Err(JournalError::IdentityMismatch);
        }
        let expected_sequence = events.last().map_or(1, |existing| existing.sequence + 1);
        if event.sequence != expected_sequence {
            return Err(JournalError::UnexpectedSequence {
                expected: expected_sequence,
                received: event.sequence,
            });
        }
        if let Some(previous) = events.last() {
            if previous.identity != event.identity {
                return Err(JournalError::IdentityMismatch);
            }
            if !transition_allowed(previous.state, event.state) {
                return Err(JournalError::IllegalTransition {
                    from: previous.state,
                    to: event.state,
                });
            }
        } else if event.state != ExecutionState::Claimed {
            return Err(JournalError::IllegalInitialState(event.state));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        serde_json::to_writer(&mut file, event)?;
        file.write_all(b"\n")?;
        file.sync_data()?;

        let mut updated = events;
        updated.push(event.clone());
        project(&updated)
    }

    pub fn replay(&self) -> Result<Option<ExecutionProjection>, JournalError> {
        let events = self.read_events()?;
        if events.is_empty() {
            Ok(None)
        } else {
            project(&events).map(Some)
        }
    }

    pub fn normalized_projection_json(&self) -> Result<Option<Vec<u8>>, JournalError> {
        self.replay()?
            .map(|projection| serde_json::to_vec(&projection).map_err(JournalError::from))
            .transpose()
    }

    pub fn has_event(&self, event_id: &str) -> Result<bool, JournalError> {
        Ok(self
            .read_events()?
            .iter()
            .any(|event| event.event_id == event_id))
    }

    fn read_events(&self) -> Result<Vec<JournalEvent>, JournalError> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut events = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            if !line.trim().is_empty() {
                events.push(serde_json::from_str(&line)?);
            }
        }
        Ok(events)
    }
}

fn project(events: &[JournalEvent]) -> Result<ExecutionProjection, JournalError> {
    let first = events.first().ok_or(JournalError::EmptyProjection)?;
    let mut ids = HashSet::new();
    let mut previous: Option<&JournalEvent> = None;
    for event in events {
        if event.schema_version != JOURNAL_SCHEMA_VERSION {
            return Err(JournalError::UnsupportedSchema(
                event.schema_version.clone(),
            ));
        }
        if !ids.insert(event.event_id.as_str()) {
            return Err(JournalError::DuplicateEventId(event.event_id.clone()));
        }
        if event.identity != first.identity {
            return Err(JournalError::IdentityMismatch);
        }
        if let Some(prior) = previous {
            if event.sequence != prior.sequence + 1 {
                return Err(JournalError::UnexpectedSequence {
                    expected: prior.sequence + 1,
                    received: event.sequence,
                });
            }
            if !transition_allowed(prior.state, event.state) {
                return Err(JournalError::IllegalTransition {
                    from: prior.state,
                    to: event.state,
                });
            }
        } else if event.sequence != 1 || event.state != ExecutionState::Claimed {
            return Err(JournalError::IllegalInitialState(event.state));
        }
        previous = Some(event);
    }
    let last = events.last().expect("non-empty events");
    Ok(ExecutionProjection {
        schema_version: SNAPSHOT_SCHEMA_VERSION.to_string(),
        identity: first.identity.clone(),
        state: last.state,
        recovery_class: recovery_class(last.state),
        last_sequence: last.sequence,
        event_ids: events.iter().map(|event| event.event_id.clone()).collect(),
    })
}

fn transition_allowed(from: ExecutionState, to: ExecutionState) -> bool {
    use ExecutionState::*;
    matches!(
        (from, to),
        (Claimed, Dispatched)
            | (Claimed, Cancelled)
            | (Dispatched, Running)
            | (Dispatched, Failed)
            | (Dispatched, Cancelled)
            | (Running, Completed)
            | (Running, Failed)
            | (Running, Cancelled)
            | (Completed, Verifying)
            | (Verifying, Verified)
            | (Verifying, VerificationFailed)
            | (Verified, AwaitingApproval)
            | (AwaitingApproval, Approved)
            | (AwaitingApproval, Rejected)
            | (Approved, Committing)
            | (Committing, Committed)
            | (Committing, CommitFailed)
            | (Committed, Merging)
            | (Merging, Merged)
            | (Merging, MergeConflict)
    )
}

fn recovery_class(state: ExecutionState) -> RecoveryClass {
    use ExecutionState::*;
    match state {
        Claimed | Dispatched | Running | Verifying | Committing | Merging => {
            RecoveryClass::Restartable
        }
        Completed | Verified | AwaitingApproval | Approved | Committed => RecoveryClass::Replayable,
        Failed | Cancelled | VerificationFailed | Rejected | CommitFailed | Merged
        | MergeConflict => RecoveryClass::Terminal,
    }
}

#[derive(Debug, Error)]
pub enum JournalError {
    #[error("journal I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("journal JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported journal schema {0}")]
    UnsupportedSchema(String),
    #[error("duplicate event id {0}")]
    DuplicateEventId(String),
    #[error("journal identity mismatch")]
    IdentityMismatch,
    #[error("unexpected sequence: expected {expected}, received {received}")]
    UnexpectedSequence { expected: u64, received: u64 },
    #[error("illegal initial state {0:?}")]
    IllegalInitialState(ExecutionState),
    #[error("illegal transition from {from:?} to {to:?}")]
    IllegalTransition {
        from: ExecutionState,
        to: ExecutionState,
    },
    #[error("cannot project an empty event history")]
    EmptyProjection,
    #[error("journal writer lock poisoned")]
    LockPoisoned,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> ExecutionIdentity {
        ExecutionIdentity {
            repo_id: "repo-1".into(),
            goal_id: "goal-1".into(),
            roadmap_id: "roadmap-1".into(),
            work_point_id: "work-1".into(),
            run_id: "run-1".into(),
        }
    }

    fn event(id: &str, sequence: u64, state: ExecutionState) -> JournalEvent {
        JournalEvent {
            schema_version: JOURNAL_SCHEMA_VERSION.into(),
            event_id: id.into(),
            sequence,
            identity: identity(),
            state,
            occurred_at: "2026-06-19T00:00:00Z".into(),
            payload: serde_json::json!({}),
        }
    }

    #[test]
    fn replay_is_byte_deterministic_after_restart() {
        let temp = tempfile::tempdir().expect("tempdir");
        let journal = ExecutionJournal::open(temp.path(), "repo-1").expect("journal");
        journal
            .append(&event("event-1", 1, ExecutionState::Claimed))
            .expect("claimed");
        journal
            .append(&event("event-2", 2, ExecutionState::Dispatched))
            .expect("dispatched");
        let before = journal
            .normalized_projection_json()
            .expect("projection")
            .expect("present");
        drop(journal);
        let reopened = ExecutionJournal::open(temp.path(), "repo-1").expect("reopen");
        let after = reopened
            .normalized_projection_json()
            .expect("projection")
            .expect("present");
        assert_eq!(before, after);
        assert_eq!(
            reopened
                .replay()
                .expect("replay")
                .expect("present")
                .recovery_class,
            RecoveryClass::Restartable
        );
    }

    #[test]
    fn duplicate_event_id_fails_closed_without_duplicate_side_effect() {
        let temp = tempfile::tempdir().expect("tempdir");
        let journal = ExecutionJournal::open(temp.path(), "repo-1").expect("journal");
        let claimed = event("event-1", 1, ExecutionState::Claimed);
        journal.append(&claimed).expect("first append");
        assert!(matches!(
            journal.append(&claimed),
            Err(JournalError::DuplicateEventId(_))
        ));
        assert!(journal.has_event("event-1").expect("event lookup"));
        assert_eq!(
            journal
                .replay()
                .expect("replay")
                .expect("present")
                .last_sequence,
            1
        );
    }

    #[test]
    fn illegal_transition_and_sequence_fail_closed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let journal = ExecutionJournal::open(temp.path(), "repo-1").expect("journal");
        journal
            .append(&event("event-1", 1, ExecutionState::Claimed))
            .expect("claimed");
        assert!(matches!(
            journal.append(&event("event-2", 2, ExecutionState::Completed)),
            Err(JournalError::IllegalTransition { .. })
        ));
        assert!(matches!(
            journal.append(&event("event-3", 3, ExecutionState::Dispatched)),
            Err(JournalError::UnexpectedSequence { .. })
        ));
    }

    #[test]
    fn planning_identity_is_referenced_without_planning_payload() {
        let serialized =
            serde_json::to_value(event("event-1", 1, ExecutionState::Claimed)).expect("serialize");
        assert_eq!(serialized["identity"]["workPointId"], "work-1");
        assert!(serialized.get("workPoint").is_none());
        assert!(!COMPACTION_SUPPORTED);
    }

    #[test]
    fn restart_at_each_happy_path_boundary_preserves_progress() {
        let temp = tempfile::tempdir().expect("tempdir");
        let states = [
            ExecutionState::Claimed,
            ExecutionState::Dispatched,
            ExecutionState::Running,
            ExecutionState::Completed,
            ExecutionState::Verifying,
            ExecutionState::Verified,
            ExecutionState::AwaitingApproval,
            ExecutionState::Approved,
            ExecutionState::Committing,
            ExecutionState::Committed,
            ExecutionState::Merging,
            ExecutionState::Merged,
        ];
        for (index, state) in states.into_iter().enumerate() {
            let journal = ExecutionJournal::open(temp.path(), "repo-1").expect("reopen");
            journal
                .append(&event(
                    &format!("event-{}", index + 1),
                    (index + 1) as u64,
                    state,
                ))
                .expect("append after restart");
            let projection = journal.replay().expect("replay").expect("projection");
            assert_eq!(projection.state, state);
            assert_eq!(projection.last_sequence, (index + 1) as u64);
        }
    }
}
