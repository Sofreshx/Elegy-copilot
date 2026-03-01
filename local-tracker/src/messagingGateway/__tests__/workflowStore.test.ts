import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowStore } from '../workflows/workflowStore';

function createWorkflow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        name: `Workflow ${id}`,
        version: '1.0.0',
        schemaVersion: '1.0',
        steps: [{ id: 'step-1', name: 'Step 1', action: 'do-thing' }],
        ...overrides,
    };
}

describe('WorkflowStore', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfstore-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('save/load roundtrip persists and returns the latest definition', () => {
        const store = new WorkflowStore({ definitionsDir: tmpDir });

        const saved = store.save(createWorkflow('wf-roundtrip'));
        const loaded = store.load('wf-roundtrip');

        expect(loaded).toEqual(saved);
        expect(loaded?.id).toBe('wf-roundtrip');
    });

    it('defaults missing schemaVersion during save and load migration path', () => {
        const store = new WorkflowStore({ definitionsDir: tmpDir });

        const saved = store.save({
            id: 'wf-migrate',
            name: 'Migrate Workflow',
            version: '1.0.0',
            steps: [{ id: 'step-1', name: 'Step 1', action: 'do-thing' }],
        });

        expect(saved.schemaVersion).toBe('1.0');

        const filePath = path.join(tmpDir, 'wf-migrate.jsonl');
        const [line] = fs.readFileSync(filePath, 'utf8').trim().split('\n');
        const parsed = JSON.parse(line) as { schemaVersion?: string };

        expect(parsed.schemaVersion).toBe('1.0');
        expect(store.load('wf-migrate')?.schemaVersion).toBe('1.0');
    });

    it('creates one-generation .bak.jsonl file on subsequent save', () => {
        const store = new WorkflowStore({ definitionsDir: tmpDir });

        store.save(createWorkflow('wf-backup', { name: 'First Name' }));
        store.save(createWorkflow('wf-backup', { name: 'Second Name' }));

        const backupPath = path.join(tmpDir, 'wf-backup.bak.jsonl');
        expect(fs.existsSync(backupPath)).toBe(true);

        const backupLines = fs.readFileSync(backupPath, 'utf8').trim().split('\n');
        expect(backupLines).toHaveLength(1);

        const backupRecord = JSON.parse(backupLines[0]) as { name?: string };
        expect(backupRecord.name).toBe('First Name');

        expect(store.load('wf-backup')?.name).toBe('Second Name');
    });

    it('list returns latest definition for each workflow id', () => {
        const store = new WorkflowStore({ definitionsDir: tmpDir });

        store.save(createWorkflow('wf-a', { name: 'Alpha v1' }));
        store.save(createWorkflow('wf-b', { name: 'Bravo v1' }));
        store.save(createWorkflow('wf-a', { name: 'Alpha v2' }));

        const list = store.list();
        const byId = new Map(list.map((def) => [def.id, def]));

        expect(list).toHaveLength(2);
        expect(byId.get('wf-a')?.name).toBe('Alpha v2');
        expect(byId.get('wf-b')?.name).toBe('Bravo v1');
    });

    it('delete removes persisted definition file when present', () => {
        const store = new WorkflowStore({ definitionsDir: tmpDir });

        store.save(createWorkflow('wf-delete'));
        const filePath = path.join(tmpDir, 'wf-delete.jsonl');
        expect(fs.existsSync(filePath)).toBe(true);

        store.delete('wf-delete');

        expect(fs.existsSync(filePath)).toBe(false);
        expect(store.load('wf-delete')).toBeUndefined();

        expect(() => store.delete('wf-delete')).not.toThrow();
    });

    it('tolerates malformed JSONL lines in load and list', () => {
        const validLine = JSON.stringify(createWorkflow('wf-malformed'));
        fs.writeFileSync(
            path.join(tmpDir, 'wf-malformed.jsonl'),
            ['not-json', '{"id":"wf-malformed"}', validLine].join('\n') + '\n',
            'utf8',
        );

        fs.writeFileSync(path.join(tmpDir, 'wf-only-bad.jsonl'), 'broken\n{not-valid}\n', 'utf8');

        const store = new WorkflowStore({ definitionsDir: tmpDir });

        expect(store.load('wf-malformed')?.id).toBe('wf-malformed');

        const list = store.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('wf-malformed');
    });
});
