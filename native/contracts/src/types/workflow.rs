use serde::{Deserialize, Serialize};

/// Risk levels for executor policy gating.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutorRiskLevel {
    ReadOnly,
    Mutating,
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStreamingMetadata {
    pub mode: Option<String>,
    pub channel: Option<String>,
    pub event_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepUiMetadata {
    pub label: Option<String>,
    pub group: Option<String>,
    pub order: Option<i32>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowUiMetadata {
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// A single step in a workflow DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub action: String,
    pub params: Option<serde_json::Value>,
    pub depends_on: Vec<String>,
    /// v2: Step type classification. Default: 'action'
    #[serde(rename = "type")]
    pub step_type: Option<String>,
    /// v2: Condition expression evaluated before execution.
    pub condition: Option<String>,
    /// v2: Named output declarations for output chaining.
    pub outputs: Option<serde_json::Value>,
    /// v2: Whether this step emits streaming events. Default: false
    pub streaming: Option<bool>,
    /// v3: Optional streaming metadata for event protocol routing.
    pub streaming_metadata: Option<WorkflowStreamingMetadata>,
    /// v3: Optional per-step UI metadata for DAG/view rendering.
    pub ui: Option<WorkflowStepUiMetadata>,
}

/// A workflow definition describing a DAG of steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub steps: Vec<WorkflowStep>,
    /// v2: Schema version for migration support. Default: '1.0'
    pub schema_version: Option<String>,
    /// v3: Optional workflow-level UI metadata for listing and grouping.
    pub ui: Option<WorkflowUiMetadata>,
}

/// Result of a single step execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepResult {
    pub step_id: String,
    pub status: String,
    pub duration_ms: f64,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Result of a full workflow run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResult {
    pub workflow_id: String,
    pub status: String,
    pub started_at_ms: f64,
    pub completed_at_ms: f64,
    pub steps: Vec<WorkflowStepResult>,
}
