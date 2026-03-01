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
  researchNotes?: ResearchNote[];
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

  // Legacy aliases kept optional for backward compatibility.
  noteId?: string;
  summary?: string;
  source?: string;
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

  // Legacy alias kept optional for backward compatibility.
  diagramId?: string;
  updatedAt?: string;
}

/** Planning persistence health check result. */
export interface PlanningPersistenceHealth {
  healthy: boolean;
  migrationVersion: number;
  lastCheckedAt: string;
  error?: string;
}

/** Supported runtime provider identifiers. */
export type RuntimeProvider = 'non-docker' | 'docker';
