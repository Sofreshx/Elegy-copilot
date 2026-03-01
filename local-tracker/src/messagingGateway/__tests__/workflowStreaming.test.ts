import { executeWorkflow, type StepExecutor } from '../workflows/workflowRuntime';
import type { WorkflowDefinition, WorkflowStep } from '../workflows/workflowSchema';
import {
    WORKFLOW_STREAM_PROTOCOL_VERSION,
    createWorkflowStreamingModule,
} from '../workflows/workflowStreaming';

function step(id: string, dependsOn: string[] = []): WorkflowStep {
    return {
        id,
        name: `Step ${id}`,
        action: `action-${id}`,
        type: 'action',
        streaming: false,
        dependsOn,
    };
}

function workflow(id: string, steps: WorkflowStep[]): WorkflowDefinition {
    return {
        id,
        name: `Workflow ${id}`,
        version: '1.0.0',
        schemaVersion: '1.0',
        steps,
    };
}

describe('workflowStreaming', () => {
    it('caps per-run backlog at 100 events and tracks dropped count', async () => {
        let now = 0;
        const streaming = createWorkflowStreamingModule({
            maxEventsPerRun: 100,
            runIdFactory: () => 'run-buffer-1',
            nowMs: () => {
                now += 1;
                return now;
            },
        });

        const runContext = streaming.createRunContext(workflow('wf-buffer', [step('A')]));

        await runContext.observer.onRunStarted?.({
            workflowId: 'wf-buffer',
            workflowName: 'Workflow wf-buffer',
            stepCount: 1,
            startedAtMs: 0,
        });

        for (let index = 0; index < 105; index += 1) {
            await runContext.observer.onStepStarted?.({
                workflowId: 'wf-buffer',
                stepId: `s-${index}`,
                stepName: `Step ${index}`,
                action: 'do',
            });
        }

        const backlog = streaming.getBacklogSnapshot('run-buffer-1');

        expect(backlog.events).toHaveLength(100);
        expect(backlog.droppedCount).toBe(6);
        expect(backlog.events[0].type).toBe('step.started');
        if (backlog.events[0].type === 'step.started') {
            expect(backlog.events[0].stepId).toBe('s-5');
        }
    });

    it('emits ordered lifecycle events for a simple workflow run', async () => {
        let now = 10;
        const streaming = createWorkflowStreamingModule({
            runIdFactory: () => 'run-ordered-1',
            nowMs: () => {
                now += 1;
                return now;
            },
        });

        const observedEvents: string[] = [];
        const listener = (event: { type: string }) => {
            observedEvents.push(event.type);
        };
        streaming.subscribe(listener);

        const definition = workflow('wf-ordered', [step('A'), step('B', ['A'])]);
        const runContext = streaming.createRunContext(definition);

        const executor: StepExecutor = async () => ({ ok: true });
        await executeWorkflow(definition, executor, {}, runContext.observer);

        streaming.unsubscribe(listener);

        const backlog = streaming.getBacklogSnapshot('run-ordered-1');

        expect(observedEvents).toEqual([
            'run.started',
            'step.started',
            'step.completed',
            'step.started',
            'step.completed',
            'run.completed',
        ]);

        expect(backlog.events).toHaveLength(6);
        expect(backlog.events.every((event) => event.protocolVersion === WORKFLOW_STREAM_PROTOCOL_VERSION)).toBe(true);
        expect(backlog.events.every((event) => event.runId === 'run-ordered-1')).toBe(true);
    });
});
