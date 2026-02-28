import { loadWorkflowTemplate, loadAllWorkflowTemplates } from '../workflows/workflowLoader';

const TEMPLATE_IDS = [
    'code-state-review',
    'failed-session-recovery',
    'feature-research-plan',
    'finalization-validation',
    'incident-escalation',
] as const;

describe('loadWorkflowTemplate', () => {
    it('loads failed-session-recovery.json and validates schema', () => {
        const def = loadWorkflowTemplate('failed-session-recovery.json');
        expect(def.id).toBe('failed-session-recovery');
        expect(def.name).toBe('Failed Session Recovery');
        expect(def.version).toBe('1.0.0');
        expect(def.steps).toHaveLength(5);
        expect(def.steps[0].id).toBe('check-status');
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

    it('throws on non-existent filename', () => {
        expect(() => loadWorkflowTemplate('does-not-exist.json')).toThrow('Template not found');
    });

    it('throws on invalid filename (path traversal)', () => {
        expect(() => loadWorkflowTemplate('../../etc/passwd')).toThrow('Invalid template filename');
    });
});

describe('loadAllWorkflowTemplates', () => {
    it('loads all 5 templates', () => {
        const templates = loadAllWorkflowTemplates();
        expect(templates.size).toBe(5);
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
