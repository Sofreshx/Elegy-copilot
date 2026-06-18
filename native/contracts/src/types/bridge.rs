use serde::{Deserialize, Serialize};

/// Maps a completed workflow run to planning record updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPlanningBridge {
    /// The workflow run this bridge event originates from.
    pub workflow_run_id: String,
    /// The planning record to update.
    pub planning_record_id: String,
    /// Outcome classification.
    pub outcome: String,
    /// Summary of what the workflow accomplished.
    pub summary: String,
    /// Timestamp of bridge event.
    pub bridged_at: String,
}

/// Policy evaluation request for executor gating.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorPolicyRequest {
    pub executor_name: String,
    pub risk_level: super::workflow::ExecutorRiskLevel,
    pub params: serde_json::Value,
    pub dry_run: bool,
}

/// Policy evaluation response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorPolicyResponse {
    pub allowed: bool,
    pub reason: Option<String>,
    pub required_approvals: Option<Vec<String>>,
}
