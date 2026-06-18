use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutorState {
    pub jobs: Vec<JobRecord>,
    pub runs: Vec<RunRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub job_id: String,
    pub title: String,
    pub status: String, // idle, scheduled, starting, running, retrying
    pub repo_id: Option<String>,
    pub repo_path: Option<String>,
    pub schedule: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub run_id: String,
    pub job_id: String,
    pub status: String, // queued, starting, running, succeeded, failed, cancelled
    pub attempt: u32,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

pub struct ExecutorService {
    state_path: PathBuf,
}

impl ExecutorService {
    pub fn new(elegy_home: &Path) -> Self {
        let dir = elegy_home.join("executor");
        std::fs::create_dir_all(&dir).ok();
        Self { state_path: dir.join("state.json") }
    }

    pub fn load_state(&self) -> ExecutorState {
        if !self.state_path.exists() {
            return ExecutorState::default();
        }
        std::fs::read_to_string(&self.state_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_state(&self, state: &ExecutorState) -> Result<(), String> {
        let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
        let tmp = self.state_path.with_extension("tmp");
        std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.state_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_health(&self) -> serde_json::Value {
        let state = self.load_state();
        let active_runs = state.runs.iter().filter(|r| r.status == "running").count();
        let scheduled_jobs = state.jobs.iter().filter(|j| j.status == "scheduled").count();
        serde_json::json!({
            "totalJobs": state.jobs.len(),
            "totalRuns": state.runs.len(),
            "activeRuns": active_runs,
            "scheduledJobs": scheduled_jobs,
            "stateFile": self.state_path.to_string_lossy(),
        })
    }

    pub fn list_jobs(&self) -> Vec<JobRecord> {
        let mut state = self.load_state();
        state.jobs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        state.jobs
    }

    pub fn list_runs(&self) -> Vec<RunRecord> {
        let mut state = self.load_state();
        state.runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        state.runs
    }
}
