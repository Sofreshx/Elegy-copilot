use serde::{Deserialize, Serialize};

/// Structured research note attached to a planning record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchNote {
    pub id: String,
    pub phase: String,
    pub title: String,
    pub content: String,
    pub sources: Option<Vec<String>>,
    pub created_at: String,
}

/// Structured diagram metadata attached to a planning record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDiagram {
    pub id: String,
    #[serde(rename = "type")]
    pub diagram_type: String,
    pub title: String,
    pub format: String,
    pub content: String,
    pub created_at: String,
}

/// Planning record as persisted by the planning API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningRecord {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub research_notes: Option<Vec<ResearchNote>>,
    pub diagrams: Option<Vec<PlanningDiagram>>,
}

/// Planning persistence health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningPersistenceHealth {
    pub healthy: bool,
    pub migration_version: i32,
    pub last_checked_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PlanningIntakeCategory {
    Idea,
    Research,
    RefactorCandidate,
    DesignComplaint,
    AuditRequest,
    RoadmapRequest,
    ReviewPrep,
    CommitPrep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningIntakeArtifact {
    pub kind: String,
    pub schema_version: i32,
    pub id: String,
    pub category: PlanningIntakeCategory,
    pub title: String,
    pub summary: String,
    pub acceptance_criteria: Vec<String>,
    pub target_repo_ids: Vec<String>,
    pub planning_state: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SyncedNoteSourceProvider {
    Github,
    Gitea,
    Git,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SyncedNoteSourceProviderPolicyTier {
    Primary,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedNoteSourceProviderPolicy {
    pub provider: SyncedNoteSourceProvider,
    pub tier: SyncedNoteSourceProviderPolicyTier,
    pub backend: String,
    pub explicit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedNoteSourceLocator {
    pub provider: SyncedNoteSourceProvider,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub notes_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedNoteSourceRecord {
    pub id: String,
    pub provider: SyncedNoteSourceProvider,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub notes_path: String,
    pub local_checkout_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ObsidianSyncState {
    Ready,
    NotConfigured,
    VaultUnavailable,
    NotesUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSyncedNoteConfig {
    pub vault_path: String,
    pub notes_path_template: Option<String>,
    pub cli_path: Option<String>,
    pub sync_command: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSyncedNoteSummary {
    pub kind: String,
    pub provider: String,
    pub id: String,
    pub title: String,
    pub summary: String,
    pub repo_id: Option<String>,
    pub target_repo_ids: Vec<String>,
    pub vault_name: String,
    pub note_path: String,
    pub file_path: Option<String>,
    pub last_modified_at: Option<String>,
    pub external: bool,
    pub canonical_authority: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ObsidianPlanningRepresentationKind {
    Bullets,
    Roadmap,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ObsidianPlanningRepresentationFreshness {
    Current,
    Stale,
    Missing,
    Invalid,
    SourceMissing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianPlanningRepresentationSummary {
    pub kind: String,
    pub provider: String,
    pub id: String,
    pub representation_kind: ObsidianPlanningRepresentationKind,
    pub title: String,
    pub summary: String,
    pub repo_id: Option<String>,
    pub target_repo_ids: Vec<String>,
    pub roadmap_slug: Option<String>,
    pub source_exists: bool,
    pub source_file_path: Option<String>,
    pub source_repo_relative_path: String,
    pub source_updated_at: Option<String>,
    pub source_content_hash: Option<String>,
    pub note_path: String,
    pub file_path: Option<String>,
    pub note_exists: bool,
    pub note_updated_at: Option<String>,
    pub generated_at: Option<String>,
    pub freshness: ObsidianPlanningRepresentationFreshness,
    pub metadata_valid: bool,
    pub external: bool,
    pub canonical_authority: bool,
    pub message: String,
    pub bullet_count: Option<i32>,
    pub item_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianPlanningRepresentationsStatus {
    pub total_count: i32,
    pub write_available: bool,
    pub current_count: i32,
    pub stale_count: i32,
    pub missing_count: i32,
    pub invalid_count: i32,
    pub source_missing_count: i32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSyncedNoteStatus {
    pub state: ObsidianSyncState,
    pub configured: bool,
    pub read_available: bool,
    pub sync_available: bool,
    pub external: bool,
    pub canonical_authority: bool,
    pub message: String,
    pub code: Option<String>,
    pub config_path: Option<String>,
    pub vault_name: Option<String>,
    pub vault_path: Option<String>,
    pub notes_path_template: Option<String>,
    pub notes_directory_path: Option<String>,
    pub cli_path: Option<String>,
    pub sync_command: Option<Vec<String>>,
}

/// Supported runtime provider identifiers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeProvider {
    NonDocker,
    Docker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningApiEnvelope {
    pub contract_version: String,
    pub kind: String,
    pub deterministic: bool,
}
