import { loadAllWorkflowTemplates } from '../workflows/workflowLoader';
import { executeWorkflow } from '../workflows/workflowRuntime';
import { createDefaultRegistry } from '../workflows/executors';
import type { BridgeClient } from '../bridgeClient';

/**
 * Integration test: real templates × real registry × real DAG runtime.
 * Only BridgeClient is mocked (network boundary).
 */

const mockBridgeClient: BridgeClient = {
    start: jest.fn(),
    stop: jest.fn(async () => undefined),
    getStatus: jest.fn(() => 'connected' as const),
    get_sessions: jest.fn(async () => []),
    invoke_agent: jest.fn(async () => ({ sessionId: 'ses-001', status: 'started' })),
    cancel_session: jest.fn(async () => ({ cancelled: true })),
    resolve_permission: jest.fn(async () => ({ resolved: true })),
};

describe('workflow execution integration', () => {
    let templates: Map<string, any>;
    const runtimeContext = {
        allowMutatingExecutors: true,
        incidentAcknowledged: true,
        notifySink: () => undefined,
    };

    beforeAll(() => {
        templates = loadAllWorkflowTemplates();
    });

    it('loads all 5 templates', () => {
        expect(templates.size).toBe(5);
        expect([...templates.keys()].sort()).toEqual([
            'code-state-review',
            'failed-session-recovery',
            'feature-research-plan',
            'finalization-validation',
            'incident-escalation',
        ]);
    });

    for (const templateId of [
        'code-state-review',
        'feature-research-plan',
        'incident-escalation',
        'finalization-validation',
        'failed-session-recovery',
    ]) {
        it(`runs "${templateId}" to completion with all steps succeeding`, async () => {
            const definition = templates.get(templateId)!;
            const registry = createDefaultRegistry(mockBridgeClient);
            const result = await executeWorkflow(definition, registry.toStepExecutor(), runtimeContext);

            expect(result.status).toBe('completed');
            expect(result.steps.length).toBeGreaterThan(0);
            for (const sr of result.steps) {
                expect(sr.status).toBe('success');
            }
        });

        it(`"${templateId}" results contain no stub statuses`, async () => {
            const definition = templates.get(templateId)!;
            const registry = createDefaultRegistry(mockBridgeClient);
            const result = await executeWorkflow(definition, registry.toStepExecutor(), runtimeContext);

            const stubs = result.steps.filter(
                (s: any) => s.status === 'stub' || s.output === 'stub',
            );
            expect(stubs).toHaveLength(0);
        });
    }
});
