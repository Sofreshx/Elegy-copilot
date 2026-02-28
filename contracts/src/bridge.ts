import type { WorkflowRunResult, ExecutorRiskLevel } from './workflow';
import type { PlanningRecord } from './planning';

/** Maps a completed workflow run to planning record updates. */
export interface WorkflowPlanningBridge {
  /** The workflow run this bridge event originates from. */
  workflowRunId: string;
  /** The planning record to update. */
  planningRecordId: string;
  /** Outcome classification. */
  outcome: 'success' | 'partial' | 'failed';
  /** Summary of what the workflow accomplished. */
  summary: string;
  /** Timestamp of bridge event. */
  bridgedAt: string;
}

/** Policy evaluation request for executor gating. */
export interface ExecutorPolicyRequest {
  executorName: string;
  riskLevel: ExecutorRiskLevel;
  params: Record<string, unknown>;
  dryRun: boolean;
}

/** Policy evaluation response. */
export interface ExecutorPolicyResponse {
  allowed: boolean;
  reason?: string;
  requiredApprovals?: string[];
}
