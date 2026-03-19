/** Planning record as persisted by the planning API. */
export interface PlanningRecord {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
  metadata?: Record<string, unknown>;
  /**
   * @deprecated Legacy record-scoped research artifacts retained for backward compatibility with older
   * planning records. Prefer repo-backed backlog and roadmap docs for new planning workflows.
   */
  researchNotes?: ResearchNote[];
  /**
   * @deprecated Legacy record-scoped diagram artifacts retained for backward compatibility with older
   * planning records. Prefer repo-backed backlog and roadmap docs for new planning workflows.
   */
  diagrams?: PlanningDiagram[];
}

/** Structured research note attached to a planning record. */
export interface ResearchNote {
  id: string;
  phase: string;
  title: string;
  content: string;
  sources?: string[];
  createdAt: string;

  /** @deprecated Legacy alias for `id`; retained for backward compatibility. */
  noteId?: string;
  /** @deprecated Legacy compatibility field retained for older planning note payloads. */
  summary?: string;
  /** @deprecated Legacy single-source field; use `sources` instead when writing new data. */
  source?: string;
  /** @deprecated Legacy compatibility timestamp retained for older planning note payloads. */
  updatedAt?: string;
}

/** Structured diagram metadata attached to a planning record. */
export interface PlanningDiagram {
  id: string;
  type: string;
  title: string;
  format: string;
  content: string;
  createdAt: string;

  /** @deprecated Legacy alias for `id`; retained for backward compatibility. */
  diagramId?: string;
  /** @deprecated Legacy compatibility timestamp retained for older planning diagram payloads. */
  updatedAt?: string;
}

/** Planning persistence health check result. */
export interface PlanningPersistenceHealth {
  healthy: boolean;
  migrationVersion: number;
  lastCheckedAt: string;
  error?: string;
}

export const PLANNING_INTAKE_CATEGORIES = [
  'idea',
  'research',
  'refactor-candidate',
  'design-complaint',
  'audit-request',
  'roadmap-request',
  'review-prep',
  'commit-prep',
] as const;

export type PlanningIntakeCategory = typeof PLANNING_INTAKE_CATEGORIES[number];

export const PLANNING_INTAKE_ARTIFACT_KIND = 'planning.intake.artifact';
export const PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION = 1;

export interface PlanningIntakeArtifact {
  kind: typeof PLANNING_INTAKE_ARTIFACT_KIND;
  schemaVersion: typeof PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION;
  id: string;
  category: PlanningIntakeCategory;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  targetRepoIds: string[];
  planningState?: string;
  createdAt: string;
  updatedAt: string;
}

/** Supported runtime provider identifiers. */
export type RuntimeProvider = 'non-docker' | 'docker';

export const PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';

export interface PlanningApiEnvelope {
  contractVersion: typeof PLANNING_API_CONTRACT_VERSION;
  kind: string;
  deterministic: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildPlanningApiEnvelope<T extends Record<string, unknown>>(
  kind: string,
  extras?: T,
): PlanningApiEnvelope & T {
  const payload = isRecord(extras) ? extras : ({} as T);
  return {
    ...payload,
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind,
    deterministic: true,
  };
}

export function buildPlanningApiErrorEnvelope<
  T extends Record<string, unknown>,
  E extends string | Record<string, unknown>,
>(
  kind: string,
  error: E,
  extras?: T,
): PlanningApiEnvelope & T & { error: E } {
  return buildPlanningApiEnvelope(kind, {
    ...(isRecord(extras) ? extras : {}),
    error,
  } as T & { error: E });
}
