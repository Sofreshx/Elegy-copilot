/** Agentic type stubs matching the repository's shared agent and session-state schemas. */

export interface SkillTrigger {
  pattern: string;
  description?: string | null;
}

export interface SkillConstraint {
  constraintId: string;
  description?: string | null;
  required: boolean;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description?: string | null;
  triggers: SkillTrigger[];
  constraints: SkillConstraint[];
  lifecycleState: 'draft' | 'active' | 'deprecated' | 'archived';
}

export interface AgentCapability {
  capabilityId: string;
  name: string;
  description?: string | null;
}

export interface RoutingRule {
  ruleId: string;
  pattern: string;
  priority: number;
  targetCapabilityId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string | null;
  capabilities: AgentCapability[];
  routingRules: RoutingRule[];
  scope: 'session' | 'workspace' | 'global';
}

export interface DynamicSkillActivation {
  isEnabled: boolean;
}

export interface MonitoringEvent {
  eventId: string;
  timestamp: string;
  entityKind: 'skill' | 'agent' | 'dynamicSkill';
  entityId: string;
  category: 'lifecycle' | 'activation' | 'validation' | 'routing';
  severity: 'trace' | 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metadata?: Record<string, string> | null;
}

export interface SkillForgeRequest {
  name: string;
  description?: string;
  triggers?: SkillTrigger[];
  constraints?: SkillConstraint[];
  discoveryKeywords?: string[];
}

export interface AgentCreateRequest {
  name: string;
  description?: string;
  capabilities?: AgentCapability[];
  routingRules?: RoutingRule[];
  scope?: 'Session' | 'Workspace' | 'Global';
}

export type SkillDiscoveryLoadMode = 'always' | 'on-demand';

export interface SkillDiscoveryEntryManifest {
  id: string;
  loadMode: SkillDiscoveryLoadMode;
}

export interface SkillDiscoveryEntry {
  skill: string;
  name: string;
  description: string;
  triggersOn: string[];
  aliasKeys?: string[];
  frameworks?: string[];
  stacks?: string[];
  languages?: string[];
  tags?: string[];
  manifest?: SkillDiscoveryEntryManifest;
}

export interface SkillDiscoveryIndex {
  schemaVersion: number;
  entries: SkillDiscoveryEntry[];
}

export interface McpToolDefinitionContract {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
