use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub storage_id: String,
    pub repo: Option<String>,
    pub repo_id: Option<String>,
    pub project_id: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub sandbox_parent_repo: Option<String>,
    pub repository_full_name: Option<String>,
    pub start_time: Option<u64>,
    pub last_event_time: Option<u64>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventRecord {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    event: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    time: Option<serde_json::Value>,
    #[serde(default)]
    timestamp: Option<serde_json::Value>,
    #[serde(default)]
    ts: Option<serde_json::Value>,
    #[serde(default)]
    created_at: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(alias = "createdAt")]
    created_at_camel: Option<serde_json::Value>,
    #[serde(default)]
    at: Option<serde_json::Value>,
    #[serde(default)]
    date: Option<serde_json::Value>,
    #[serde(default)]
    meta: Option<serde_json::Value>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    session: Option<serde_json::Value>,
    #[serde(default)]
    context: Option<serde_json::Value>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StartContext {
    session_id: Option<String>,
    repo: Option<String>,
    repo_id: Option<String>,
    project_id: Option<String>,
    branch: Option<String>,
    cwd: Option<String>,
    sandbox_parent_repo: Option<String>,
    repository_full_name: Option<String>,
    start_time: Option<u64>,
}

pub fn list_sessions(elegy_home: &Path) -> Vec<SessionSummary> {
    let session_root = elegy_home.join("session-state");
    let Ok(entries) = fs::read_dir(&session_root) else {
        return Vec::new();
    };

    let mut sessions = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            read_session_summary(&entry.path(), &entry.file_name().to_string_lossy())
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| {
        let left_time = left.last_event_time.or(left.start_time).unwrap_or(0);
        let right_time = right.last_event_time.or(right.start_time).unwrap_or(0);
        right_time
            .cmp(&left_time)
            .then_with(|| left.id.cmp(&right.id))
    });
    sessions
}

fn read_session_summary(session_dir: &Path, id: &str) -> Option<SessionSummary> {
    let metadata = fs::metadata(session_dir).ok()?;
    if !metadata.is_dir() {
        return None;
    }

    let fallback_start = metadata.created().ok().and_then(system_time_to_ms);
    let events_path = session_dir.join("events.jsonl");
    let events = read_recent_events(&events_path, 200);
    let start = read_start_context(&events_path).unwrap_or_default();

    let mut last_event_time = None;

    for event in events.iter().rev() {
        if last_event_time.is_none() {
            last_event_time = event_time(event);
        }
        if last_event_time.is_some() {
            break;
        }
    }

    if last_event_time.is_none() {
        last_event_time = metadata.modified().ok().and_then(system_time_to_ms);
    }

    let status = compute_status(last_event_time);

    Some(SessionSummary {
        id: start.session_id.unwrap_or_else(|| id.to_string()),
        storage_id: id.to_string(),
        repo: start.repo,
        repo_id: start.repo_id,
        project_id: start.project_id,
        branch: start.branch,
        cwd: start.cwd,
        sandbox_parent_repo: start.sandbox_parent_repo,
        repository_full_name: start.repository_full_name,
        start_time: start.start_time.or(fallback_start),
        last_event_time,
        status,
    })
}

fn read_start_context(events_path: &Path) -> Option<StartContext> {
    let file = File::open(events_path).ok()?;
    let mut reader = BufReader::new(file);
    let mut bytes_read = 0usize;
    let max_bytes = 5 * 1024 * 1024;
    let mut line = String::new();

    loop {
        line.clear();
        let Ok(read) = reader.read_line(&mut line) else {
            return None;
        };
        if read == 0 {
            return None;
        }
        bytes_read = bytes_read.saturating_add(read);
        if bytes_read > max_bytes {
            return None;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(event) = serde_json::from_str::<EventRecord>(trimmed) else {
            continue;
        };
        if event_type(&event).as_deref() != Some("session.start") {
            continue;
        }

        return Some(parse_start_context(&event));
    }
}

fn parse_start_context(event: &EventRecord) -> StartContext {
    let Some(payload) = payload_object(event) else {
        return StartContext {
            start_time: payload_time(event).or_else(|| event_time(event)),
            ..StartContext::default()
        };
    };

    StartContext {
        session_id: payload_string(payload, "sessionId").or_else(|| payload_string(payload, "id")),
        repo: payload_repo(payload),
        repo_id: payload_string(payload, "repoId"),
        project_id: payload_string(payload, "projectId"),
        branch: payload_branch(payload),
        cwd: payload_cwd(payload),
        sandbox_parent_repo: payload_string(payload, "sandboxParentRepo"),
        repository_full_name: payload_repository_full_name(payload),
        start_time: payload_time(event).or_else(|| event_time(event)),
    }
}

pub fn read_recent_events(events_path: &Path, limit: usize) -> Vec<EventRecord> {
    let Ok(text) = fs::read_to_string(events_path) else {
        return Vec::new();
    };

    let lines = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    let start_index = lines.len().saturating_sub(limit);
    lines[start_index..]
        .iter()
        .filter_map(|line| serde_json::from_str::<EventRecord>(line).ok())
        .collect()
}

fn event_type(event: &EventRecord) -> Option<String> {
    event
        .r#type
        .clone()
        .or_else(|| event.event.clone())
        .or_else(|| event.name.clone())
        .or_else(|| event.kind.clone())
}

fn event_time(event: &EventRecord) -> Option<u64> {
    parse_time(event.time.as_ref())
        .or_else(|| parse_time(event.timestamp.as_ref()))
        .or_else(|| parse_time(event.ts.as_ref()))
        .or_else(|| parse_time(event.created_at.as_ref()))
        .or_else(|| parse_time(event.created_at_camel.as_ref()))
        .or_else(|| parse_time(event.at.as_ref()))
        .or_else(|| parse_time(event.date.as_ref()))
        .or_else(|| meta_time(event.meta.as_ref()))
}

fn payload_time(event: &EventRecord) -> Option<u64> {
    let payload = payload_value(event)?;

    match payload {
        serde_json::Value::Object(map) => parse_time(map.get("startTime"))
            .or_else(|| parse_time(map.get("startedAtMs")))
            .or_else(|| parse_time(map.get("startedAt")))
            .or_else(|| parse_time(map.get("time"))),
        _ => None,
    }
}

fn payload_value(event: &EventRecord) -> Option<&serde_json::Value> {
    event
        .payload
        .as_ref()
        .or(event.data.as_ref())
        .or(event.session.as_ref())
        .or(event.context.as_ref())
}

fn payload_object(event: &EventRecord) -> Option<&serde_json::Map<String, serde_json::Value>> {
    payload_value(event)
        .and_then(serde_json::Value::as_object)
        .or_else(|| (!event.extra.is_empty()).then_some(&event.extra))
}

fn payload_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn nested_payload_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    object_key: &str,
    key: &str,
) -> Option<String> {
    payload
        .get(object_key)
        .and_then(serde_json::Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn payload_repo(payload: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    payload_string(payload, "repo")
        .or_else(|| payload_string(payload, "repository"))
        .or_else(|| nested_payload_string(payload, "git", "repo"))
        .or_else(|| nested_payload_string(payload, "git", "repository"))
}

fn payload_branch(payload: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    payload_string(payload, "branch").or_else(|| nested_payload_string(payload, "git", "branch"))
}

fn payload_cwd(payload: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    payload_string(payload, "cwd")
        .or_else(|| payload_string(payload, "workingDirectory"))
        .or_else(|| payload_string(payload, "workdir"))
        .or_else(|| nested_payload_string(payload, "git", "cwd"))
}

fn payload_repository_full_name(
    payload: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    payload_string(payload, "repositoryFullName")
        .or_else(|| nested_payload_string(payload, "repository", "fullName"))
        .or_else(|| nested_payload_string(payload, "git", "fullName"))
}

fn meta_time(value: Option<&serde_json::Value>) -> Option<u64> {
    let meta = value.and_then(serde_json::Value::as_object)?;
    parse_time(meta.get("time"))
        .or_else(|| parse_time(meta.get("timestamp")))
        .or_else(|| parse_time(meta.get("ts")))
}

fn parse_time(value: Option<&serde_json::Value>) -> Option<u64> {
    let value = value?;
    match value {
        serde_json::Value::Number(number) => number.as_u64(),
        serde_json::Value::String(string) => {
            let trimmed = string.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc3339(trimmed)
                    .ok()
                    .map(|dt| dt.timestamp_millis() as u64)
            })
        }
        _ => None,
    }
}

fn system_time_to_ms(time: std::time::SystemTime) -> Option<u64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn compute_status(last_event_time: Option<u64>) -> String {
    let Some(last_event_time) = last_event_time else {
        return "missing".to_string();
    };
    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
    let active_window_ms = 30_u64 * 60 * 1000;
    if now_ms.saturating_sub(last_event_time) <= active_window_ms {
        "active".to_string()
    } else {
        "idle".to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn compute_status_marks_missing_when_no_timestamp() {
        assert_eq!(compute_status(None), "missing");
    }

    #[test]
    fn read_session_summary_uses_start_context_and_latest_event_time() {
        let temp_root = std::env::temp_dir().join(format!(
            "instruction-engine-native-runtime-session-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should be after unix epoch")
                .as_nanos()
        ));
        let session_dir = temp_root.join("session-storage-id");
        fs::create_dir_all(&session_dir).expect("session dir should exist");
        fs::write(
            session_dir.join("events.jsonl"),
            [
                r#"{"type":"session.start","payload":{"sessionId":"session-logical-id","repo":"/tmp/repo-a","repoId":"proj-a","projectId":"proj-a","branch":"main","cwd":"/tmp/repo-a","sandboxParentRepo":"/tmp/repo-a","startTime":1000,"repository":{"fullName":"owner/repo-a"}}}"#,
                r#"{"type":"session.message","time":2000}"#,
                r#"{"type":"session.message","time":3000}"#,
            ]
            .join("\n"),
        )
        .expect("events should be written");

        let summary = read_session_summary(&session_dir, "session-storage-id")
            .expect("session summary should parse");

        assert_eq!(summary.id, "session-logical-id");
        assert_eq!(summary.storage_id, "session-storage-id");
        assert_eq!(summary.repo.as_deref(), Some("/tmp/repo-a"));
        assert_eq!(summary.repo_id.as_deref(), Some("proj-a"));
        assert_eq!(summary.project_id.as_deref(), Some("proj-a"));
        assert_eq!(summary.branch.as_deref(), Some("main"));
        assert_eq!(summary.cwd.as_deref(), Some("/tmp/repo-a"));
        assert_eq!(summary.sandbox_parent_repo.as_deref(), Some("/tmp/repo-a"));
        assert_eq!(
            summary.repository_full_name.as_deref(),
            Some("owner/repo-a")
        );
        assert_eq!(summary.start_time, Some(1000));
        assert_eq!(summary.last_event_time, Some(3000));

        let _ = fs::remove_dir_all(temp_root);
    }
}
