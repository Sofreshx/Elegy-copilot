import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowRunResult } from '../workflows/workflowSchema';
import { WorkflowHistory } from '../workflows/workflowHistory';

function makeRunResult(workflowId: string, overrides?: Partial<WorkflowRunResult>): WorkflowRunResult {
    return {
        workflowId,
        status: 'completed',
        startedAtMs: Date.now(),
        completedAtMs: Date.now() + 100,
        steps: [{ stepId: 'step-1', status: 'success', durationMs: 100 }],
        ...overrides,
    };
}

describe('WorkflowHistory', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfhist-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('append + readRecent', () => {
        it('appends a run result and reads it back', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir });
            const result = makeRunResult('wf-1');
            history.append(result);

            const recent = history.readRecent('wf-1');
            expect(recent).toHaveLength(1);
            expect(recent[0].workflowId).toBe('wf-1');
            expect(recent[0].status).toBe('completed');
        });

        it('multiple appends returns newest first', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir });
            const r1 = makeRunResult('wf-1', { startedAtMs: 1000, completedAtMs: 1100 });
            const r2 = makeRunResult('wf-1', { startedAtMs: 2000, completedAtMs: 2100 });
            const r3 = makeRunResult('wf-1', { startedAtMs: 3000, completedAtMs: 3100 });

            history.append(r1);
            history.append(r2);
            history.append(r3);

            const recent = history.readRecent('wf-1');
            expect(recent).toHaveLength(3);
            expect(recent[0].startedAtMs).toBe(3000);
            expect(recent[1].startedAtMs).toBe(2000);
            expect(recent[2].startedAtMs).toBe(1000);
        });

        it('readRecent with limit returns only N entries', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir });
            for (let i = 0; i < 5; i++) {
                history.append(makeRunResult('wf-1', { startedAtMs: i * 1000 }));
            }

            const recent = history.readRecent('wf-1', 2);
            expect(recent).toHaveLength(2);
            expect(recent[0].startedAtMs).toBe(4000);
            expect(recent[1].startedAtMs).toBe(3000);
        });

        it('readRecent for non-existent workflow returns empty array', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir });
            const recent = history.readRecent('no-such-wf');
            expect(recent).toEqual([]);
        });

        it('creates directory and file if they do not exist', () => {
            const nested = path.join(tmpDir, 'sub', 'dir');
            const history = new WorkflowHistory({ historyDir: nested });

            history.append(makeRunResult('wf-new'));

            expect(fs.existsSync(nested)).toBe(true);
            expect(fs.existsSync(path.join(nested, 'wf-new.jsonl'))).toBe(true);

            const recent = history.readRecent('wf-new');
            expect(recent).toHaveLength(1);
        });
    });

    describe('prune', () => {
        it('prunes old entries when exceeding maxEntries', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir, maxEntries: 3 });
            for (let i = 0; i < 5; i++) {
                history.append(makeRunResult('wf-prune', { startedAtMs: i * 1000 }));
            }

            const recent = history.readRecent('wf-prune', 10);
            expect(recent).toHaveLength(3);
            // Should keep the last 3 (newest)
            expect(recent[0].startedAtMs).toBe(4000);
            expect(recent[2].startedAtMs).toBe(2000);
        });

        it('returns count of pruned entries', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir, maxEntries: 2 });
            // Append 5 entries manually to the file to bypass auto-prune on append
            const filePath = path.join(tmpDir, 'wf-count.jsonl');
            fs.mkdirSync(tmpDir, { recursive: true });
            for (let i = 0; i < 5; i++) {
                const r = makeRunResult('wf-count', { startedAtMs: i * 1000 });
                fs.appendFileSync(filePath, JSON.stringify(r) + '\n', 'utf8');
            }

            const pruned = history.prune('wf-count');
            expect(pruned).toBe(3);

            const recent = history.readRecent('wf-count', 10);
            expect(recent).toHaveLength(2);
        });

        it('no-op when entries are under limit', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir, maxEntries: 10 });
            history.append(makeRunResult('wf-small'));

            const pruned = history.prune('wf-small');
            expect(pruned).toBe(0);

            const recent = history.readRecent('wf-small');
            expect(recent).toHaveLength(1);
        });
    });

    describe('constructor', () => {
        it('throws on invalid maxEntries', () => {
            expect(() => new WorkflowHistory({ historyDir: tmpDir, maxEntries: 0 })).toThrow('maxEntries must be between 1 and 10000');
            expect(() => new WorkflowHistory({ historyDir: tmpDir, maxEntries: -1 })).toThrow('maxEntries must be between 1 and 10000');
            expect(() => new WorkflowHistory({ historyDir: tmpDir, maxEntries: 10001 })).toThrow('maxEntries must be between 1 and 10000');
        });
    });

    describe('sanitization', () => {
        it('rejects invalid workflow IDs', () => {
            const history = new WorkflowHistory({ historyDir: tmpDir });

            // Path traversal
            expect(history.readRecent('../etc/passwd')).toEqual([]);
            expect(history.readRecent('../../etc/passwd')).toEqual([]);

            // Special characters
            expect(history.readRecent('wf with spaces')).toEqual([]);
            expect(history.readRecent('wf/slash')).toEqual([]);
            expect(history.readRecent('wf\\back')).toEqual([]);
            expect(history.readRecent('')).toEqual([]);

            // append should throw for invalid IDs
            expect(() => history.append(makeRunResult('../bad'))).toThrow('Invalid workflow ID');
        });
    });
});
