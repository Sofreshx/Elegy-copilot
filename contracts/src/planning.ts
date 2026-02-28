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
