import { loadWorkflowTemplate, loadAllWorkflowTemplates } from '../workflows/workflowLoader';

const TEMPLATE_IDS = [
    'code-state-review',
    'failed-session-recovery',
    'feature-research-plan',
    'finalization-validation',
    'incident-escalation',
    'implementation-workflow',
    'test-and-fix',
    'multi-pr-merge',
] as const;

describe('loadWorkflowTemplate', () => {
    it('loads failed-session-recovery.json and validates schema', () => {
        const def = loadWorkflowTemplate('failed-session-recovery.json');
        expect(def.id).toBe('failed-session-recovery');
        expect(def.name).toBe('Failed Session Recovery');
        expect(def.version).toBe('1.0.0');
        expect(def.steps).toHaveLength(5);
        expect(def.steps[0].id).toBe('check-status');
        expect(def.description).toContain('recovery follow-up');
        expect(def.steps[2].params).toEqual({ sessionId: '{{collect-logs.sessionId}}' });
        expect(def.steps[3].id).toBe('start-recovery-follow-up');
    });

    it('loads finalization-validation.json and validates schema', () => {
        const def = loadWorkflowTemplate('finalization-validation.json');
        expect(def.id).toBe('finalization-validation');
        expect(def.name).toBe('Finalization Validation');
        expect(def.steps).toHaveLength(5);
        // parallel fan-in: generate-report depends on 3 steps
        expect(def.steps[3].dependsOn).toEqual(['check-pr', 'check-tests', 'check-docs']);
    });

    it('loads incident-escalation.json and validates schema', () => {
        const def = loadWorkflowTemplate('incident-escalation.json');
        expect(def.id).toBe('incident-escalation');
        expect(def.name).toBe('Incident Escalation');
        expect(def.steps).toHaveLength(4);
        expect(def.steps[3].dependsOn).toEqual(['notify-team', 'create-incident']);
    });

    it('loads feature-research-plan.json and validates schema', () => {
        const def = loadWorkflowTemplate('feature-research-plan.json');
        expect(def.id).toBe('feature-research-plan');
        expect(def.name).toBe('Feature Research Plan');
        expect(def.schemaVersion).toBe('2.0');
        expect(def.steps).toHaveLength(5);
        expect(def.steps[3].dependsOn).toEqual(['run-research']);
    });

    it('loads code-state-review.json and validates schema', () => {
        const def = loadWorkflowTemplate('code-state-review.json');
        expect(def.id).toBe('code-state-review');
        expect(def.name).toBe('Code State Review');
        expect(def.schemaVersion).toBe('2.0');
        expect(def.steps).toHaveLength(5);
        expect(def.steps[2].dependsOn).toEqual(['collect-diagnostics', 'analyze-git-diff']);
    });

    it('loads implementation-workflow.json and validates schema', () => {
        const def = loadWorkflowTemplate('implementation-workflow.json');
        expect(def.id).toBe('implementation-workflow');
        expect(def.name).toBe('Implementation Workflow');
        expect(def.schemaVersion).toBe('2.0');
        expect(def.steps).toHaveLength(5);
        expect(def.steps[3].action).toBe('dev.implement');
        expect(def.steps[2].dependsOn).toEqual(['analyze-session', 'analyze-git-state']);
    });

    it('loads test-and-fix.json and validates schema', () => {
        const def = loadWorkflowTemplate('test-and-fix.json');
        expect(def.id).toBe('test-and-fix');
        expect(def.name).toBe('Test And Fix');
        expect(def.schemaVersion).toBe('2.0');
        expect(def.steps).toHaveLength(4);
        expect(def.steps[0].action).toBe('dev.test');
        expect(def.steps[1].action).toBe('dev.implement');
        expect(def.steps[2].dependsOn).toEqual(['implement-fix']);
    });

    it('loads multi-pr-merge.json and validates schema', () => {
        const def = loadWorkflowTemplate('multi-pr-merge.json');
        expect(def.id).toBe('multi-pr-merge');
        expect(def.name).toBe('Multi PR Merge');
        expect(def.schemaVersion).toBe('2.0');
        expect(def.steps).toHaveLength(4);
        expect(def.steps[2].action).toBe('git.merge-prs');
        expect(def.steps[2].dependsOn).toEqual(['check-working-tree', 'check-current-branch']);
    });

    it('throws on non-existent filename', () => {
        expect(() => loadWorkflowTemplate('does-not-exist.json')).toThrow('Template not found');
    });

    it('throws on invalid filename (path traversal)', () => {
        expect(() => loadWorkflowTemplate('../../etc/passwd')).toThrow('Invalid template filename');
    });
});

describe('loadAllWorkflowTemplates', () => {
    it('loads all 8 templates', () => {
        const templates = loadAllWorkflowTemplates();
        expect(templates.size).toBe(8);
    });

    it('returns Map keyed by workflow ID', () => {
        const templates = loadAllWorkflowTemplates();
        for (const templateId of TEMPLATE_IDS) {
            expect(templates.has(templateId)).toBe(true);
        }
    });

    it('all loaded templates have valid structure', () => {
        const templates = loadAllWorkflowTemplates();
        for (const [id, def] of templates) {
            expect(def.id).toBe(id);
            expect(def.steps.length).toBeGreaterThan(0);
            expect(def.version).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });
});
