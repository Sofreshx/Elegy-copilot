import { WorkflowDiscovery } from '../workflows/workflowDiscovery';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockTemplates = new Map<string, any>();

jest.mock('../workflows/workflowLoader', () => ({
	loadAllWorkflowTemplates: () => mockTemplates,
	loadWorkflowTemplate: jest.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	mockTemplates.clear();
});

function seedTemplates() {
	mockTemplates.set('deploy-prod', {
		id: 'deploy-prod',
		name: 'Deploy Production',
		description: 'Full deploy pipeline',
		version: '1.0.0',
		steps: [{ id: 's1', name: 'Build', action: 'build', dependsOn: [] }],
	});
	mockTemplates.set('test-suite', {
		id: 'test-suite',
		name: 'Test Suite',
		version: '1.0.0',
		steps: [{ id: 's1', name: 'Test', action: 'test', dependsOn: [] }],
	});
}

describe('WorkflowDiscovery', () => {
	it('listAll returns all templates', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		expect(disc.listAll()).toHaveLength(2);
	});

	it('listAll returns empty when no templates', () => {
		const disc = new WorkflowDiscovery();
		expect(disc.listAll()).toHaveLength(0);
	});

	it('get returns a template by id', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		const def = disc.get('deploy-prod');
		expect(def).toBeDefined();
		expect(def!.name).toBe('Deploy Production');
	});

	it('get returns undefined for unknown id', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		expect(disc.get('nope')).toBeUndefined();
	});

	it('has returns true for existing id', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		expect(disc.has('deploy-prod')).toBe(true);
	});

	it('has returns false for unknown id', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		expect(disc.has('nope')).toBe(false);
	});

	it('getIds returns sorted ids', () => {
		seedTemplates();
		const disc = new WorkflowDiscovery();
		expect(disc.getIds()).toEqual(['deploy-prod', 'test-suite']);
	});

	it('refresh reloads templates', () => {
		const disc = new WorkflowDiscovery();
		expect(disc.listAll()).toHaveLength(0);

		seedTemplates();
		disc.refresh();
		expect(disc.listAll()).toHaveLength(2);
	});

	it('accepts a logger', () => {
		const logger = { warn: jest.fn() };
		const disc = new WorkflowDiscovery(logger);
		expect(disc.listAll()).toHaveLength(0);
	});
});
