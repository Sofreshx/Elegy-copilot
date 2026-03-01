import { EventEmitter } from 'events';

import type { WorkflowDefinition, WorkflowRunResult, WorkflowStepResult } from './workflowSchema';
import type {
    WorkflowRuntimeObserver,
    WorkflowRunCompletedObserverEvent,
    WorkflowRunStartedObserverEvent,
    WorkflowStepCompletedObserverEvent,
    WorkflowStepStartedObserverEvent,
} from './workflowRuntime';

export const WORKFLOW_STREAM_PROTOCOL_VERSION = 'workflow-stream-v1';
const WORKFLOW_STREAM_EVENT_CHANNEL = 'workflow';
const DEFAULT_MAX_EVENTS_PER_RUN = 100;

interface WorkflowStreamEventBase {
    protocolVersion: typeof WORKFLOW_STREAM_PROTOCOL_VERSION;
    runId: string;
    workflowId: string;
    emittedAtMs: number;
}

export interface WorkflowRunStartedStreamEvent extends WorkflowStreamEventBase {
    type: 'run.started';
    workflowName: string;
    stepCount: number;
    startedAtMs: number;
}

export interface WorkflowStepStartedStreamEvent extends WorkflowStreamEventBase {
    type: 'step.started';
    stepId: string;
    stepName: string;
    action: string;
}

export interface WorkflowStepCompletedStreamEvent extends WorkflowStreamEventBase {
    type: 'step.completed';
    stepId: string;
    status: WorkflowStepResult['status'];
    durationMs: number;
    error?: string;
}

export interface WorkflowRunCompletedStreamEvent extends WorkflowStreamEventBase {
    type: 'run.completed';
    status: WorkflowRunResult['status'];
    startedAtMs: number;
    completedAtMs: number;
}

export interface WorkflowRunFailedStreamEvent extends WorkflowStreamEventBase {
    type: 'run.failed';
    error: string;
}

export type WorkflowStreamEvent =
    | WorkflowRunStartedStreamEvent
    | WorkflowStepStartedStreamEvent
    | WorkflowStepCompletedStreamEvent
    | WorkflowRunCompletedStreamEvent
    | WorkflowRunFailedStreamEvent;

export type WorkflowStreamListener = (event: WorkflowStreamEvent) => void;

export interface WorkflowBacklogSnapshot {
    events: WorkflowStreamEvent[];
    droppedCount: number;
}

export interface WorkflowStreamRunContext {
    runId: string;
    observer: WorkflowRuntimeObserver;
}

export interface WorkflowRunFailureInput {
    runId: string;
    workflowId: string;
    error: unknown;
}

interface WorkflowStreamingRunState {
    workflowId: string;
    events: WorkflowStreamEvent[];
    droppedCount: number;
}

export interface WorkflowStreamingModule {
    createRunContext: (definition: WorkflowDefinition) => WorkflowStreamRunContext;
    publishRunFailure: (input: WorkflowRunFailureInput) => void;
    getBacklogSnapshot: (runId: string) => WorkflowBacklogSnapshot;
    subscribe: (listener: WorkflowStreamListener) => void;
    unsubscribe: (listener: WorkflowStreamListener) => void;
}

export interface WorkflowStreamingOptions {
    maxEventsPerRun?: number;
    nowMs?: () => number;
    runIdFactory?: () => string;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return String(error);
}

export function createWorkflowStreamingModule(options: WorkflowStreamingOptions = {}): WorkflowStreamingModule {
    const nowMs = options.nowMs ?? (() => Date.now());
    const maxEventsPerRun = options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;
    const emitter = new EventEmitter();
    const runStateByRunId = new Map<string, WorkflowStreamingRunState>();
    let runCounter = 0;

    const runIdFactory =
        options.runIdFactory
        ?? (() => {
            runCounter += 1;
            return `run-${nowMs().toString(36)}-${runCounter.toString(36).padStart(4, '0')}`;
        });

    const getOrCreateRunState = (runId: string, workflowId: string): WorkflowStreamingRunState => {
        const existing = runStateByRunId.get(runId);
        if (existing) return existing;

        const created: WorkflowStreamingRunState = {
            workflowId,
            events: [],
            droppedCount: 0,
        };
        runStateByRunId.set(runId, created);
        return created;
    };

    const publishEvent = (event: WorkflowStreamEvent): void => {
        const state = getOrCreateRunState(event.runId, event.workflowId);
        state.events.push(event);

        if (state.events.length > maxEventsPerRun) {
            const overflowCount = state.events.length - maxEventsPerRun;
            state.events.splice(0, overflowCount);
            state.droppedCount += overflowCount;
        }

        emitter.emit(WORKFLOW_STREAM_EVENT_CHANNEL, event);
    };

    const onRunStarted = (runId: string, event: WorkflowRunStartedObserverEvent): void => {
        const streamEvent: WorkflowRunStartedStreamEvent = {
            type: 'run.started',
            protocolVersion: WORKFLOW_STREAM_PROTOCOL_VERSION,
            runId,
            workflowId: event.workflowId,
            emittedAtMs: nowMs(),
            workflowName: event.workflowName,
            stepCount: event.stepCount,
            startedAtMs: event.startedAtMs,
        };
        publishEvent(streamEvent);
    };

    const onStepStarted = (runId: string, workflowId: string, event: WorkflowStepStartedObserverEvent): void => {
        const streamEvent: WorkflowStepStartedStreamEvent = {
            type: 'step.started',
            protocolVersion: WORKFLOW_STREAM_PROTOCOL_VERSION,
            runId,
            workflowId,
            emittedAtMs: nowMs(),
            stepId: event.stepId,
            stepName: event.stepName,
            action: event.action,
        };
        publishEvent(streamEvent);
    };

    const onStepCompleted = (runId: string, workflowId: string, event: WorkflowStepCompletedObserverEvent): void => {
        const streamEvent: WorkflowStepCompletedStreamEvent = {
            type: 'step.completed',
            protocolVersion: WORKFLOW_STREAM_PROTOCOL_VERSION,
            runId,
            workflowId,
            emittedAtMs: nowMs(),
            stepId: event.stepId,
            status: event.status,
            durationMs: event.durationMs,
            ...(event.error ? { error: event.error } : {}),
        };
        publishEvent(streamEvent);
    };

    const onRunCompleted = (runId: string, workflowId: string, event: WorkflowRunCompletedObserverEvent): void => {
        const streamEvent: WorkflowRunCompletedStreamEvent = {
            type: 'run.completed',
            protocolVersion: WORKFLOW_STREAM_PROTOCOL_VERSION,
            runId,
            workflowId,
            emittedAtMs: nowMs(),
            status: event.result.status,
            startedAtMs: event.result.startedAtMs,
            completedAtMs: event.result.completedAtMs,
        };
        publishEvent(streamEvent);
    };

    return {
        createRunContext: (definition: WorkflowDefinition): WorkflowStreamRunContext => {
            const runId = runIdFactory();
            getOrCreateRunState(runId, definition.id);

            return {
                runId,
                observer: {
                    onRunStarted: (event) => onRunStarted(runId, event),
                    onStepStarted: (event) => onStepStarted(runId, definition.id, event),
                    onStepCompleted: (event) => onStepCompleted(runId, definition.id, event),
                    onRunCompleted: (event) => onRunCompleted(runId, definition.id, event),
                },
            };
        },
        publishRunFailure: (input: WorkflowRunFailureInput): void => {
            const streamEvent: WorkflowRunFailedStreamEvent = {
                type: 'run.failed',
                protocolVersion: WORKFLOW_STREAM_PROTOCOL_VERSION,
                runId: input.runId,
                workflowId: input.workflowId,
                emittedAtMs: nowMs(),
                error: normalizeError(input.error),
            };
            publishEvent(streamEvent);
        },
        getBacklogSnapshot: (runId: string): WorkflowBacklogSnapshot => {
            const state = runStateByRunId.get(runId);
            if (!state) {
                return {
                    events: [],
                    droppedCount: 0,
                };
            }
            return {
                events: [...state.events],
                droppedCount: state.droppedCount,
            };
        },
        subscribe: (listener: WorkflowStreamListener): void => {
            emitter.on(WORKFLOW_STREAM_EVENT_CHANNEL, listener);
        },
        unsubscribe: (listener: WorkflowStreamListener): void => {
            emitter.off(WORKFLOW_STREAM_EVENT_CHANNEL, listener);
        },
    };
}
