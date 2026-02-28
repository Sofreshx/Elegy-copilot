/** A single step in a workflow DAG. */
export interface WorkflowStep {
  id: string;
  name: string;
  action: string;
  params?: Record<string, unknown>;
  dependsOn: string[];
  /** v2: Step type classification. Default: 'action' */
  type?: string;
  /** v2: Condition expression evaluated before execution. */
  condition?: string;
  /** v2: Named output declarations for output chaining. */
  outputs?: Record<string, unknown>;
  /** v2: Whether this step emits streaming events. Default: false */
  streaming?: boolean;
}

/** A workflow definition describing a DAG of steps. */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  steps: WorkflowStep[];
  /** v2: Schema version for migration support. Default: '1.0' */
  schemaVersion?: string;
}

/** Result of a single step execution. */
export interface WorkflowStepResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  output?: unknown;
  error?: string;
}

/** Result of a full workflow run. */
export interface WorkflowRunResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'partial';
  startedAtMs: number;
  completedAtMs: number;
  steps: WorkflowStepResult[];
}

/** Risk levels for executor policy gating. */
export type ExecutorRiskLevel = 'read-only' | 'mutating' | 'destructive';
