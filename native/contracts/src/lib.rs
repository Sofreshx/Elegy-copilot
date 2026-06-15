use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionResponse {
    pub version: u64,
    pub last_changed_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPreflightResponse {
    pub ok: bool,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub checked_at: String,
    pub validator_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthResponse {
    pub ok: bool,
    pub now: u64,
    pub engine_root: String,
    pub elegy_home: String,
    pub changes: Option<VersionResponse>,
    pub runtime: Value,
    pub policy: Value,
    pub planning_persistence: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_durability_dependency_gate: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_managed_asset_sync: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autonomous_decision_log: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRecentActivityItem {
    pub r#type: String,
    pub timestamp: Option<u64>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummaryResponse {
    pub active_session_count: usize,
    pub total_session_count: usize,
    pub recent_activity: Vec<DashboardRecentActivityItem>,
    pub health_indicator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetSummary {
    pub agents: u64,
    pub skills: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResponse {
    pub project_id: String,
    pub repo_id: String,
    pub repo_path: String,
    pub repo_label: String,
    pub canonical_remote: Option<String>,
    pub pinned: bool,
    pub last_activity_ms: Option<u64>,
    pub session_count: u64,
    pub active_session_count: u64,
    pub installed_asset_summary: ProjectAssetSummary,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionResponse {
    pub id: String,
    pub title: Option<String>,
    pub objective: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: Option<u64>,
    pub elapsed_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivityResponse {
    pub r#type: String,
    pub timestamp: Option<u64>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deterministic: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RouteContractShape {
    pub status: u16,
    pub content_type: Option<String>,
    pub body_type: String,
    pub body_keys: Option<Vec<String>>,
}
