/**
 * Explainable Routing and Asset Policy Types
 * 
 * Defines the type contract for the catalog policy service: capability kinds,
 * routing intents, candidate status, block codes, route explanation decisions,
 * and suggested actions.
 * 
 * These types power the POST /api/catalog/route/explain endpoint and the
 * integrated routing policy layer that unifies catalog search, activation
 * state, and external source management.
 */

import type { ExtensibleString } from './assetCatalog';

// ---------------------------------------------------------------------------
// Capability kinds covered by the policy service
// ---------------------------------------------------------------------------

/**
 * Managed capability kind for policy decisions.
 * 
 * - 'skill' and 'agent' can be recommended for task-routing intents.
 * - 'mcp' and 'cli-tool' can be recommended for tool-routing or install gaps.
 */
export type RoutingCapabilityKind = 'skill' | 'agent' | 'mcp' | 'cli-tool';

// ---------------------------------------------------------------------------
// Routing intents
// ---------------------------------------------------------------------------

/**
 * Intent that drives routing policy selection and candidate prioritization.
 */
export type RoutingIntent =
  | 'task-routing'
  | 'tool-routing'
  | 'install-recommendation'
  | 'source-diagnostics';

// ---------------------------------------------------------------------------
// Block codes (deterministic, machine-readable)
// ---------------------------------------------------------------------------

/**
 * Deterministic block codes returned when a candidate is ineligible.
 * Consumers can map these to user-facing messages and suggested actions.
 */
export type RouteBlockCode =
  | 'disabled'
  | 'not-installed'
  | 'unsupported-harness'
  | 'not-in-active-bundle'
  | 'external-source-not-activated'
  | 'deprecated'
  | 'projection-unavailable'
  | 'kind-not-applicable'
  | 'activation-layer-mismatch'
  | 'stale-source'
  | 'missing-install-surface';

// ---------------------------------------------------------------------------
// Route explanation request
// ---------------------------------------------------------------------------

/**
 * Client request for an explainable routing decision.
 */
export interface RouteExplanationRequest {
  /** Search/route query string (e.g., "python linting", "git commit") */
  query: string;

  /** Absolute path to the repo on disk */
  repoPath?: string;

  /** Registered repo identifier */
  repoId?: string;

  /** Target harness identifier (e.g., "copilot", "codex", "opencode", "antigravity") */
  targetHarness?: string;

  /** Routing intent that drives prioritization and filtering */
  intent: RoutingIntent;

  /** Capability kinds to consider (defaults to all four) */
  kinds?: RoutingCapabilityKind[];

  /** When true, bypasses routing policy restrictions and returns all candidates */
  overrideRoutingPolicy?: boolean;
}

// ---------------------------------------------------------------------------
// Candidate status within a route decision
// ---------------------------------------------------------------------------

/**
 * Deterministic status for a single candidate in the routing decision.
 */
export interface RouteCandidateStatus {
  /** Asset or installable identifier */
  id: string;

  /** Display key (e.g., skill key, agent name, MCP server id) */
  key: string;

  /** Capability kind */
  kind: RoutingCapabilityKind;

  /** Human-readable title */
  title?: string;

  /** Short description */
  description?: string;

  /** Source identifier (provider id, source id, or "built-in") */
  sourceId?: string;

  /** Source type: "catalog" for effective assets, "external" for source installables */
  sourceType: 'catalog' | 'external';

  // Status booleans
  available: boolean;
  installed: boolean;
  enabled: boolean;
  eligible: boolean;

  /** Numeric relevance score (0-100) */
  score?: number;

  /** Explanation codes describing why this candidate was scored as it was */
  explanations?: RouteExplanation[];

  /** When eligible=false, these block codes explain why */
  blockedReasons?: RouteBlockCode[];

  /** When blocked, these are actionable steps to make the candidate eligible */
  actions?: RouteSuggestedAction[];

  /** Layer that provides the primary content for this candidate */
  contentLayer?: string;

  /** Active bundle IDs this candidate belongs to (if any) */
  bundleIds?: string[];

  /** Load mode (always, on-demand, manual) */
  loadMode?: string;

  /** Whether this candidate is recommended by the current activation profile */
  recommended?: boolean;

  /** Whether this candidate is deprecated */
  deprecated?: boolean;
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

/**
 * A single explanation for why a candidate was scored/ranked a certain way.
 */
export interface RouteExplanation {
  /** Machine-readable code (e.g., "exact-name", "framework-match", "repo-local") */
  code: string;

  /** Human-readable message */
  message: string;

  /** Numeric weight contributed to the overall score */
  weight: number;
}

// ---------------------------------------------------------------------------
// Suggested action
// ---------------------------------------------------------------------------

/**
 * Action a user or system can take to make a blocked candidate eligible.
 */
export interface RouteSuggestedAction {
  /** Machine-readable operation (e.g., "enable-asset", "activate-source-installable", "refresh-source", "install-harness-surface", "rebuild-projection") */
  operation: string;

  /** Human-readable label for the action */
  label: string;

  /** Target resource identifier */
  targetId: string;

  /** Target resource kind */
  targetKind: string;

  /** Optional route/path to invoke the action */
  route?: string;
}

// ---------------------------------------------------------------------------
// Route explanation decision (the primary output)
// ---------------------------------------------------------------------------

/**
 * Full routing decision returned by the policy service.
 */
export interface RouteExplanationDecision {
  /** Deterministic envelope */
  kind: 'catalog.route.explanation';
  deterministic: true;

  /** Opaque correlation id for joining with search, selection, and audit events */
  correlationId: string;

  /** The recommend route / selected candidate */
  decision?: RouteCandidateStatus;

  /** All candidates considered (eligible + blocked), ordered by preference */
  candidates: RouteCandidateStatus[];

  /** Active policy configuration used for this decision */
  policy: RouteExplanationPolicy;

  /** Blocked candidates with reasons and suggested actions */
  blocks?: RouteBlockEntry[];

  /** Summary actions the user could take to improve routing coverage */
  suggestedActions?: RouteSuggestedAction[];

  /** Timestamp of the decision (ISO 8601) */
  decidedAt: string;
}

// ---------------------------------------------------------------------------
// Block entry (used in the blocks array)
// ---------------------------------------------------------------------------

/**
 * A blocked candidate with reasons and actionable steps.
 */
export interface RouteBlockEntry {
  candidateId: string;
  candidateKey: string;
  kind: RoutingCapabilityKind;
  blockedReasons: RouteBlockCode[];
  suggestedActions: RouteSuggestedAction[];
}

// ---------------------------------------------------------------------------
// Policy snapshot
// ---------------------------------------------------------------------------

/**
 * Active policy configuration used for a routing decision.
 */
export interface RouteExplanationPolicy {
  /** Policy schema version */
  schemaVersion: number;

  /** Active planner profile id */
  profile: string;

  /** Orchestration policy id */
  orchestrationPolicy: string;

  /** Active bundle ids */
  activeBundleIds: string[];

  /** Total candidates evaluated */
  totalCandidates: number;

  /** Number of eligible candidates */
  eligibleCount: number;

  /** Number of blocked candidates */
  blockedCount: number;

  /** Whether the policy is in fail-closed mode */
  failClosed: boolean;

  /** Target harness for this decision */
  targetHarness?: string;

  /** Routing intent for this decision */
  intent: RoutingIntent;

  /** Whether routing policy was explicitly overridden */
  overrideApplied: boolean;
}
