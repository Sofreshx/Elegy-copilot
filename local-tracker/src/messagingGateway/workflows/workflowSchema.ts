import { z } from 'zod';

const WorkflowStreamingMetadataSchema = z.object({
    mode: z.string().min(1).max(32).optional(),
    channel: z.string().min(1).max(128).optional(),
    eventType: z.string().min(1).max(128).optional(),
}).optional();

const WorkflowStepUiMetadataSchema = z.object({
    label: z.string().min(1).max(128).optional(),
    group: z.string().min(1).max(64).optional(),
    order: z.number().int().min(0).optional(),
    icon: z.string().min(1).max(64).optional(),
}).optional();

const WorkflowUiMetadataSchema = z.object({
    category: z.string().min(1).max(64).optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
}).optional();

/**
 * A single step in a workflow.
 * - id: unique step identifier
 * - name: human-readable name
 * - action: the action to execute (string identifier for now)
 * - params: optional key-value parameters
 * - dependsOn: step IDs that must complete before this step runs
 */
export const WorkflowStepSchema = z.object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string().min(1).max(128),
    action: z.string().min(1).max(128),
    type: z.string().default('action'),
    condition: z.string().optional(),
    outputs: z.record(z.string(), z.unknown()).optional(),
    streaming: z.boolean().default(false),
    streamingMetadata: WorkflowStreamingMetadataSchema,
    ui: WorkflowStepUiMetadataSchema,
    params: z.record(z.string(), z.unknown()).optional(),
    dependsOn: z.array(z.string()).optional().default([]),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/**
 * A workflow definition.
 * - id: unique workflow identifier
 * - name: human-readable name
 * - description: optional description
 * - version: semver-like version string
 * - steps: ordered list of steps (DAG edges defined via dependsOn)
 */
export const WorkflowDefinitionSchema = z.object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string().min(1).max(128),
    description: z.string().max(512).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
    schemaVersion: z.string().default('1.0'),
    ui: WorkflowUiMetadataSchema,
    steps: z.array(WorkflowStepSchema).min(1),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * Result of a single step execution.
 */
export interface WorkflowStepResult {
    stepId: string;
    status: 'success' | 'failed' | 'skipped';
    durationMs: number;
    output?: unknown;
    error?: string;
}

/**
 * Result of a full workflow run.
 */
export interface WorkflowRunResult {
    workflowId: string;
    status: 'completed' | 'failed' | 'partial';
    startedAtMs: number;
    completedAtMs: number;
    steps: WorkflowStepResult[];
}

/**
 * Parse and validate a workflow definition from a plain object.
 */
export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
    return WorkflowDefinitionSchema.parse(input);
}
