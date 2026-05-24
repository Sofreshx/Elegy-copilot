use std::fs;
use std::path::{Path, PathBuf};

use elegy_native_contracts::{
    ProjectActivityResponse, ProjectAssetSummary, ProjectResponse, ProjectSessionResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sessions::{list_sessions, SessionSummary};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoInventoryState {
    #[serde(default)]
    manual_repos: Vec<ManualRepoEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualRepoEntry {
    repo_id: String,
    repo_path: String,
    repo_label: String,
    #[serde(default)]
    added_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    last_activity_ms: Option<u64>,
    #[serde(default)]
    canonical_remote: Option<String>,
}

pub fn list_projects(copilot_home: &Path) -> Vec<ProjectResponse> {
    let state = load_repo_inventory_state(copilot_home);
    let sessions = list_sessions(copilot_home);

    state
        .manual_repos
        .into_iter()
        .map(|entry| build_project_response(&entry, &sessions))
        .collect()
}

pub fn list_project_sessions(copilot_home: &Path, project_id: &str) -> Vec<ProjectSessionResponse> {
    let requested_project_id = project_id.trim();
    if requested_project_id.is_empty() {
        return Vec::new();
    }
    let project = find_project_entry(copilot_home, requested_project_id);

    list_sessions(copilot_home)
        .into_iter()
        .filter(|session| {
            matches_requested_project_session(session, requested_project_id, project.as_ref())
        })
        .map(|session| ProjectSessionResponse {
            id: session.id.clone(),
            title: Some(session.id.clone()),
            objective: None,
            status: Some(session.status.clone()),
            source: Some("cli".to_string()),
            started_at_ms: session.start_time,
            updated_at_ms: session.last_event_time,
            elapsed_ms: session
                .start_time
                .zip(session.last_event_time)
                .map(|(start, end)| end.saturating_sub(start)),
        })
        .collect()
}

pub fn list_project_activity(
    copilot_home: &Path,
    project_id: &str,
) -> Vec<ProjectActivityResponse> {
    let requested_project_id = project_id.trim();
    if requested_project_id.is_empty() {
        return Vec::new();
    }
    let project = find_project_entry(copilot_home, requested_project_id);

    let mut items = list_sessions(copilot_home)
        .into_iter()
        .filter(|session| {
            matches_requested_project_session(session, requested_project_id, project.as_ref())
        })
        .map(|session| ProjectActivityResponse {
            r#type: "session".to_string(),
            timestamp: session.last_event_time.or(session.start_time),
            summary: format!("Session {} [{}]", session.id, session.status),
        })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        right
            .timestamp
            .unwrap_or(0)
            .cmp(&left.timestamp.unwrap_or(0))
    });
    items.truncate(20);
    items
}

pub fn update_project_fields(
    copilot_home: &Path,
    project_id: &str,
    fields: &Value,
) -> Option<ProjectResponse> {
    let normalized_project_id = project_id.trim();
    if normalized_project_id.is_empty() {
        return None;
    }

    let inventory_path = resolve_repo_inventory_path(copilot_home);
    let mut state = load_repo_inventory_state(copilot_home);
    let entry_index = state
        .manual_repos
        .iter()
        .position(|entry| entry.repo_id == normalized_project_id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let entry = &mut state.manual_repos[entry_index];
    apply_allowed_project_fields(entry, fields);
    entry.updated_at = Some(now);

    save_repo_inventory_state(&inventory_path, &state);
    let refreshed_state = load_repo_inventory_state(copilot_home);
    let refreshed = refreshed_state
        .manual_repos
        .into_iter()
        .find(|entry| entry.repo_id == normalized_project_id)?;

    Some(build_project_response(&refreshed, &list_sessions(copilot_home)))
}

fn build_project_response(entry: &ManualRepoEntry, sessions: &[SessionSummary]) -> ProjectResponse {
    let matched_sessions = sessions
        .iter()
        .filter(|session| matches_tracked_project_session(session, entry))
        .collect::<Vec<_>>();
    let active_session_count = matched_sessions
        .iter()
        .filter(|session| session.status == "active")
        .count() as u64;
    let last_activity_ms = matched_sessions
        .iter()
        .filter_map(|session| session.last_event_time.or(session.start_time))
        .max()
        .or(entry.last_activity_ms);

    ProjectResponse {
        project_id: entry.repo_id.clone(),
        repo_id: entry.repo_id.clone(),
        repo_path: entry.repo_path.clone(),
        repo_label: entry.repo_label.clone(),
        canonical_remote: entry.canonical_remote.clone(),
        pinned: entry.pinned,
        last_activity_ms,
        session_count: matched_sessions.len() as u64,
        active_session_count,
        installed_asset_summary: ProjectAssetSummary {
            agents: 0,
            skills: 0,
        },
        created_at: entry.added_at.clone(),
        updated_at: entry.updated_at.clone(),
    }
}

fn load_repo_inventory_state(copilot_home: &Path) -> RepoInventoryState {
    let inventory_path = resolve_repo_inventory_path(copilot_home);
    let Ok(text) = fs::read_to_string(inventory_path) else {
        return RepoInventoryState {
            manual_repos: Vec::new(),
        };
    };
    serde_json::from_str(&text).unwrap_or(RepoInventoryState {
        manual_repos: Vec::new(),
    })
}

fn resolve_repo_inventory_path(copilot_home: &Path) -> PathBuf {
    copilot_home.join("catalog").join("repo-inventory.json")
}

fn save_repo_inventory_state(inventory_path: &Path, state: &RepoInventoryState) {
    if let Some(parent) = inventory_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_string_pretty(state)
        .expect("repo inventory state should serialize")
        + "\n";
    let _ = fs::write(inventory_path, serialized);
}

fn apply_allowed_project_fields(entry: &mut ManualRepoEntry, fields: &Value) {
    let Some(record) = fields.as_object() else {
        return;
    };

    if let Some(pinned) = record.get("pinned").and_then(Value::as_bool) {
        entry.pinned = pinned;
    }

    if let Some(last_activity_ms) = record.get("lastActivityMs") {
        if last_activity_ms.is_null() {
            entry.last_activity_ms = None;
        } else if let Some(value) = last_activity_ms.as_u64() {
            entry.last_activity_ms = Some(value);
        }
    }

    if let Some(canonical_remote) = record.get("canonicalRemote") {
        if canonical_remote.is_null() {
            entry.canonical_remote = None;
        } else if let Some(value) = canonical_remote.as_str() {
            let trimmed = value.trim();
            entry.canonical_remote = (!trimmed.is_empty()).then(|| trimmed.to_string());
        }
    }
}

fn find_project_entry(copilot_home: &Path, project_id: &str) -> Option<ManualRepoEntry> {
    let normalized_project_id = project_id.trim();
    if normalized_project_id.is_empty() {
        return None;
    }

    load_repo_inventory_state(copilot_home)
        .manual_repos
        .into_iter()
        .find(|entry| entry.repo_id == normalized_project_id)
}

fn matches_requested_project_session(
    session: &SessionSummary,
    requested_project_id: &str,
    project: Option<&ManualRepoEntry>,
) -> bool {
    session.project_id.as_deref() == Some(requested_project_id)
        || session.repo_id.as_deref() == Some(requested_project_id)
        || session.repo.as_deref() == Some(requested_project_id)
        || project.is_some_and(|project| matches_tracked_project_session(session, project))
}

fn matches_tracked_project_session(session: &SessionSummary, project: &ManualRepoEntry) -> bool {
    if session.project_id.as_deref() == Some(project.repo_id.as_str())
        || session.repo_id.as_deref() == Some(project.repo_id.as_str())
    {
        return true;
    }

    let project_path = normalize_path(&project.repo_path);
    let session_repo = session.repo.as_deref().map(normalize_path);
    let session_cwd = session.cwd.as_deref().map(normalize_path);
    let sandbox_parent_repo = session.sandbox_parent_repo.as_deref().map(normalize_path);

    session_repo.as_deref() == Some(project_path.as_str())
        || session_cwd.as_deref() == Some(project_path.as_str())
        || is_worktree_session_path(session_repo.as_deref(), &project_path)
        || is_worktree_session_path(session_cwd.as_deref(), &project_path)
        || sandbox_parent_repo.as_deref() == Some(project_path.as_str())
        || matches_canonical_remote(
            session.repository_full_name.as_deref(),
            project.canonical_remote.as_deref(),
        )
}

fn normalize_path(value: &str) -> String {
    let resolved = Path::new(value)
        .components()
        .collect::<PathBuf>()
        .display()
        .to_string();
    if cfg!(windows) {
        resolved.to_lowercase()
    } else {
        resolved
    }
}

fn is_worktree_session_path(session_path: Option<&str>, project_path: &str) -> bool {
    let Some(session_path) = session_path else {
        return false;
    };
    let worktree_root = normalize_path(PathBuf::from(project_path).join(".worktrees").to_string_lossy().as_ref());
    let worktree_prefix = format!("{worktree_root}{}", std::path::MAIN_SEPARATOR);
    session_path.starts_with(&worktree_prefix)
}

fn matches_canonical_remote(
    repository_full_name: Option<&str>,
    canonical_remote: Option<&str>,
) -> bool {
    let Some(repository_full_name) = repository_full_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Some(canonical_remote) = canonical_remote
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };

    let repository_full_name = repository_full_name.to_lowercase();
    let canonical_remote = canonical_remote.to_lowercase();
    canonical_remote == repository_full_name
        || canonical_remote.ends_with(&format!("/{repository_full_name}"))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::sessions::SessionSummary;

    fn project(repo_id: &str, repo_path: &str) -> ManualRepoEntry {
        ManualRepoEntry {
            repo_id: repo_id.to_string(),
            repo_path: repo_path.to_string(),
            repo_label: "Repo".to_string(),
            added_at: None,
            updated_at: None,
            pinned: false,
            last_activity_ms: None,
            canonical_remote: None,
        }
    }

    fn session(id: &str) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            storage_id: id.to_string(),
            repo: None,
            repo_id: None,
            project_id: None,
            branch: None,
            cwd: None,
            sandbox_parent_repo: None,
            repository_full_name: None,
            start_time: Some(1),
            last_event_time: Some(2),
            status: "active".to_string(),
        }
    }

    #[test]
    fn matches_project_session_by_repo_path() {
        let project = project("proj-a", "/tmp/repo-a");
        let session = SessionSummary {
            repo: Some("/tmp/repo-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_tracked_project_session(&session, &project));
    }

    #[test]
    fn matches_requested_project_session_by_direct_repo_path_without_inventory() {
        let session = SessionSummary {
            repo: Some("/tmp/repo-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_requested_project_session(
            &session,
            "/tmp/repo-a",
            None,
        ));
    }

    #[test]
    fn matches_requested_project_session_by_project_id_without_inventory() {
        let session = SessionSummary {
            project_id: Some("proj-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_requested_project_session(&session, "proj-a", None));
    }

    #[test]
    fn matches_tracked_project_session_by_worktree_path() {
        let project = project("proj-a", "/tmp/repo-a");
        let session = SessionSummary {
            cwd: Some("/tmp/repo-a/.worktrees/feature-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_tracked_project_session(&session, &project));
    }

    #[test]
    fn matches_tracked_project_session_by_sandbox_parent_repo() {
        let project = project("proj-a", "/tmp/repo-a");
        let session = SessionSummary {
            sandbox_parent_repo: Some("/tmp/repo-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_tracked_project_session(&session, &project));
    }

    #[test]
    fn matches_tracked_project_session_by_canonical_remote() {
        let mut project = project("proj-a", "/tmp/repo-a");
        project.canonical_remote = Some("github.com/owner/repo-a".to_string());
        let session = SessionSummary {
            repository_full_name: Some("owner/repo-a".to_string()),
            ..session("sess-1")
        };

        assert!(matches_tracked_project_session(&session, &project));
    }

    #[test]
    fn update_project_fields_only_applies_allowed_fields() {
        let temp_root = std::env::temp_dir().join(format!(
            "instruction-engine-native-runtime-project-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should be after unix epoch")
                .as_nanos()
        ));
        let copilot_home = temp_root.join(".copilot");
        let inventory_path = copilot_home.join("catalog").join("repo-inventory.json");
        fs::create_dir_all(
            inventory_path
                .parent()
                .expect("inventory path should have parent"),
        )
        .expect("inventory dir should exist");
        fs::write(
            &inventory_path,
            [
                "{",
                "  \"manualRepos\": [",
                "    {",
                "      \"repoId\": \"proj-a\",",
                "      \"repoPath\": \"/tmp/repo-a\",",
                "      \"repoLabel\": \"Repo A\",",
                "      \"addedAt\": \"2026-01-01T00:00:00.000Z\",",
                "      \"updatedAt\": \"2026-01-02T00:00:00.000Z\",",
                "      \"pinned\": false,",
                "      \"lastActivityMs\": null,",
                "      \"canonicalRemote\": null",
                "    }",
                "  ]",
                "}",
            ]
            .join("\n"),
        )
        .expect("inventory should be written");

        let updated = update_project_fields(
            &copilot_home,
            "proj-a",
            &serde_json::json!({
                "pinned": true,
                "canonicalRemote": "owner/repo-a",
                "repoLabel": "SHOULD NOT CHANGE",
            }),
        )
        .expect("project should update");

        assert!(updated.pinned);
        assert_eq!(updated.canonical_remote.as_deref(), Some("owner/repo-a"));
        assert_eq!(updated.repo_label, "Repo A");

        let persisted = load_repo_inventory_state(&copilot_home);
        let persisted_entry = persisted
            .manual_repos
            .into_iter()
            .find(|entry| entry.repo_id == "proj-a")
            .expect("persisted entry should exist");
        assert!(persisted_entry.pinned);
        assert_eq!(persisted_entry.canonical_remote.as_deref(), Some("owner/repo-a"));
        assert_eq!(persisted_entry.repo_label, "Repo A");
        assert!(persisted_entry.updated_at.is_some());

        let _ = fs::remove_dir_all(temp_root);
    }
}
