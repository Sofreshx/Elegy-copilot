use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRecord {
    pub contract_version: String,
    pub worktree_id: String,
    pub repo_id: String,
    pub repo_path: Option<String>,
    pub repo_label: Option<String>,
    pub mode: String, // "shared" | "dedicated"
    pub path: Option<String>,
    pub branch: Option<String>,
    pub source: Option<String>,
    pub status: String, // "shared" | "pending_preparation" | "ready" | "active" | "reusable" | "interrupted" | "removed"
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub extra: serde_json::Value,
}

pub struct WorktreeService {
    state_root: PathBuf,
}

impl WorktreeService {
    pub fn new(elegy_home: &Path) -> Self {
        Self { state_root: elegy_home.join("repo-state") }
    }

    fn worktree_path(&self, repo_id: &str, worktree_id: &str) -> PathBuf {
        self.state_root.join(repo_id).join("worktrees").join(format!("{}.json", worktree_id))
    }

    pub fn get_worktree(&self, repo_id: &str, worktree_id: &str) -> Option<WorktreeRecord> {
        let path = self.worktree_path(repo_id, worktree_id);
        if !path.exists() { return None; }
        fs::read_to_string(&path).ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn write_worktree(&self, record: &WorktreeRecord) -> Result<(), String> {
        let path = self.worktree_path(&record.repo_id, &record.worktree_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_worktrees(&self, repo_id: &str) -> Vec<WorktreeRecord> {
        let dir = self.state_root.join(repo_id).join("worktrees");
        if !dir.exists() { return vec![]; }
        let mut records = Vec::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(record) = serde_json::from_str::<WorktreeRecord>(&content) {
                            records.push(record);
                        }
                    }
                }
            }
        }
        records
    }

    /// Transition worktree to a new status
    pub fn transition_worktree(&self, repo_id: &str, worktree_id: &str, new_status: &str) -> Result<WorktreeRecord, String> {
        let mut record = self.get_worktree(repo_id, worktree_id)
            .ok_or_else(|| format!("Worktree not found: {}/{}", repo_id, worktree_id))?;
        record.status = new_status.to_string();
        record.updated_at = Some(chrono::Utc::now().to_rfc3339());
        self.write_worktree(&record)?;
        Ok(record)
    }

    pub fn mark_active(&self, repo_id: &str, worktree_id: &str) -> Result<WorktreeRecord, String> {
        self.transition_worktree(repo_id, worktree_id, "active")
    }

    pub fn mark_reusable(&self, repo_id: &str, worktree_id: &str) -> Result<WorktreeRecord, String> {
        self.transition_worktree(repo_id, worktree_id, "reusable")
    }

    pub fn mark_interrupted(&self, repo_id: &str, worktree_id: &str) -> Result<WorktreeRecord, String> {
        self.transition_worktree(repo_id, worktree_id, "interrupted")
    }

    pub fn mark_removed(&self, repo_id: &str, worktree_id: &str) -> Result<WorktreeRecord, String> {
        self.transition_worktree(repo_id, worktree_id, "removed")
    }

    pub fn create_worktree_id() -> String {
        format!("wt-{}", uuid::Uuid::new_v4())
    }
}
