use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod types;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionResponse {
    pub version: u64,
    pub last_changed_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

// ---------------------------------------------------------------------------
// Catalog Repo Inventory (GET /api/catalog/repos)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRepoAssetSummary {
    pub has_repo_assets: bool,
    pub has_skills: bool,
    pub has_agents: bool,
    pub skill_count: u64,
    pub agent_count: u64,
    pub overlay_enabled_count: u64,
    pub overlay_disabled_count: u64,
    pub skills_path: Option<String>,
    pub agents_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRepoHints {
    pub stacks: Vec<String>,
    pub frameworks: Vec<String>,
    pub languages: Vec<String>,
    pub targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRepoInventoryEntry {
    pub repo_id: Option<String>,
    pub repo_path: Option<String>,
    pub repo_label: Option<String>,
    pub selected: bool,
    pub registered: bool,
    pub sources: Vec<String>,
    pub exists: bool,
    pub git_root_present: bool,
    pub scan_status: String,
    pub last_seen_at: Option<String>,
    pub last_refresh_at: Option<String>,
    pub assets: CatalogRepoAssetSummary,
    pub hints: CatalogRepoHints,
    pub snapshot: Value,
    pub repo_state: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRepoInventoryStorage {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRepoInventoryWorkspaceScan {
    pub storage: CatalogRepoInventoryStorage,
    pub default_roots: Vec<String>,
    pub custom_scan_roots: Vec<String>,
    pub scan_roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReposListResponse {
    pub kind: String,
    pub deterministic: bool,
    pub count: u64,
    pub selected_repo: Option<CatalogRepoInventoryEntry>,
    pub storage: CatalogRepoInventoryStorage,
    pub workspace_scan: Option<CatalogRepoInventoryWorkspaceScan>,
    pub repos: Vec<CatalogRepoInventoryEntry>,
}

// ---------------------------------------------------------------------------
// Managed Assets (GET /api/assets/managed)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetStatus {
    pub id: String,
    pub r#type: String,
    pub source: String,
    pub destination: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_abs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_abs: Option<String>,
    pub managed: bool,
    pub installed: bool,
    pub up_to_date: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetsResponse {
    pub managed: Vec<ManagedAssetStatus>,
    pub count: u64,
}

// ---------------------------------------------------------------------------
// Installed Assets (GET /api/assets/installed)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub name: String,
    pub file_name: String,
    pub abs_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub name: String,
    pub abs_path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPrompt {
    pub name: String,
    pub file_name: String,
    pub abs_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledInstructions {
    pub installed: bool,
    pub abs_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAssetsResponse {
    pub agents: Vec<InstalledAgent>,
    pub skills: Vec<InstalledSkill>,
    pub prompts: Vec<InstalledPrompt>,
    pub instructions: InstalledInstructions,
}

// ---------------------------------------------------------------------------
// Catalog Global Inventory (subset of /api/catalog/summary)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGlobalHarness {
    pub id: String,
    pub label: String,
    pub asset_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGlobalSection {
    pub id: String,
    pub label: String,
    pub assets: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGlobalInventory {
    pub harnesses: Vec<CatalogGlobalHarness>,
    pub sections: Vec<CatalogGlobalSection>,
}

// ---------------------------------------------------------------------------
// Dashboard with source (GET /api/dashboard/summary)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummaryResponseWithSource {
    pub active_session_count: usize,
    pub total_session_count: usize,
    pub recent_activity: Vec<DashboardRecentActivityItem>,
    pub health_indicator: String,
    pub source: String,
}
