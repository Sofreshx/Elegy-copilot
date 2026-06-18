use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTrigger {
    pub pattern: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillConstraint {
    pub constraint_id: String,
    pub description: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub triggers: Vec<SkillTrigger>,
    pub constraints: Vec<SkillConstraint>,
    pub lifecycle_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapability {
    pub capability_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRule {
    pub rule_id: String,
    pub pattern: String,
    pub priority: i32,
    pub target_capability_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub capabilities: Vec<AgentCapability>,
    pub routing_rules: Vec<RoutingRule>,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicSkillActivation {
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringEvent {
    pub event_id: String,
    pub timestamp: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub category: String,
    pub severity: String,
    pub message: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillForgeRequest {
    pub name: String,
    pub description: Option<String>,
    pub triggers: Option<Vec<SkillTrigger>>,
    pub constraints: Option<Vec<SkillConstraint>>,
    pub discovery_keywords: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateRequest {
    pub name: String,
    pub description: Option<String>,
    pub capabilities: Option<Vec<AgentCapability>>,
    pub routing_rules: Option<Vec<RoutingRule>>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillDiscoveryLoadMode {
    Always,
    OnDemand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryEntryManifest {
    pub id: String,
    pub load_mode: SkillDiscoveryLoadMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryEntry {
    pub skill: String,
    pub name: String,
    pub description: String,
    pub triggers_on: Vec<String>,
    pub alias_keys: Option<Vec<String>>,
    pub frameworks: Option<Vec<String>>,
    pub stacks: Option<Vec<String>>,
    pub languages: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub manifest: Option<SkillDiscoveryEntryManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryIndex {
    pub schema_version: i32,
    pub entries: Vec<SkillDiscoveryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDefinitionContract {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}
