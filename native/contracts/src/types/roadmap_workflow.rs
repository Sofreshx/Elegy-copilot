use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum RoadmapWorkflowArtifactKind {
    #[serde(rename = "roadmap.definition")]
    RoadmapDefinition,
    #[serde(rename = "roadmap.plan.result")]
    RoadmapPlanResult,
    #[serde(rename = "roadmap.implementation.result")]
    RoadmapImplementationResult,
    #[serde(rename = "roadmap.review.result")]
    RoadmapReviewResult,
    #[serde(rename = "roadmap.reevaluation.result")]
    RoadmapReevaluationResult,
    #[serde(rename = "roadmap.session.recap")]
    RoadmapSessionRecap,
    #[serde(rename = "roadmap.completion.result")]
    RoadmapCompletionResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum RoadmapWorkflowPhase {
    Definition,
    Plan,
    Implementation,
    Review,
    Reevaluation,
    Recap,
    Completion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RoadmapWorkflowStatus {
    Draft,
    Proposed,
    InProgress,
    Pass,
    Fail,
    Blocked,
    Done,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapWorkflowAcceptanceState {
    pub all_passed: bool,
    pub failed_checks: Vec<String>,
    pub passed_checks: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapWorkflowMemoryCandidate {
    pub kind: String,
    pub summary: String,
    pub tags: Option<Vec<String>>,
    pub path_prefixes: Option<Vec<String>>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapWorkflowStructuredArtifact {
    pub schema_version: String,
    pub kind: RoadmapWorkflowArtifactKind,
    pub roadmap_id: String,
    pub slice_id: Option<String>,
    pub phase: RoadmapWorkflowPhase,
    pub status: RoadmapWorkflowStatus,
    pub repo_id: Option<String>,
    pub source_harness: Option<String>,
    pub source_model: Option<String>,
    pub session_id: Option<String>,
    pub follow_ups: Vec<String>,
    pub linked_event_ids: Option<Vec<String>>,
    pub requires_user_decision: bool,
    pub suggested_next_action: Option<String>,
    pub roadmap_impact: Option<String>,
    pub acceptance: Option<RoadmapWorkflowAcceptanceState>,
    pub memory_candidates: Option<Vec<RoadmapWorkflowMemoryCandidate>>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRoadmapWorkflowArtifact {
    pub artifact: RoadmapWorkflowStructuredArtifact,
    pub body: String,
    pub structured_block: String,
    pub checksum: String,
}
