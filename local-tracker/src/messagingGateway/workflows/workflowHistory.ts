import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowRunResult } from './workflowSchema';

const DEFAULT_MAX_ENTRIES = 100;

export interface WorkflowHistoryOptions {
    /** Directory to store history files. */
    historyDir: string;
    /** Maximum entries per workflow. Older entries pruned on append. Default: 100. */
    maxEntries?: number;
}

export class WorkflowHistory {
    private readonly historyDir: string;
    private readonly maxEntries: number;

    constructor(options: WorkflowHistoryOptions) {
        this.historyDir = options.historyDir;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        if (this.maxEntries < 1 || this.maxEntries > 10000) {
            throw new Error('maxEntries must be between 1 and 10000');
        }
    }

    /**
     * Append a run result to the history for the given workflow.
     * Creates the history directory and file if they don't exist.
     * Prunes old entries if the file exceeds maxEntries.
     */
    append(result: WorkflowRunResult): void {
        const filePath = this.getFilePath(result.workflowId);
        fs.mkdirSync(this.historyDir, { recursive: true });

        const line = JSON.stringify(result) + '\n';
        fs.appendFileSync(filePath, line, 'utf8');

        // Prune if needed
        this.pruneIfNeeded(filePath);
    }

    /**
     * Read recent history for a workflow.
     * Returns entries in reverse chronological order (newest first).
     * @param limit Max entries to return. Default: 10.
     */
    readRecent(workflowId: string, limit = 10): WorkflowRunResult[] {
        const safeName = this.sanitizeWorkflowId(workflowId);
        if (!safeName) return [];

        const filePath = this.getFilePath(safeName);
        if (!fs.existsSync(filePath)) return [];

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);

        const entries: WorkflowRunResult[] = [];
        for (const line of lines) {
            try {
                entries.push(JSON.parse(line) as WorkflowRunResult);
            } catch {
                // Skip malformed lines
            }
        }

        return entries.slice(-Math.max(1, limit)).reverse();
    }

    /**
     * Prune history for a specific workflow to maxEntries.
     */
    prune(workflowId: string): number {
        const safeName = this.sanitizeWorkflowId(workflowId);
        if (!safeName) return 0;

        const filePath = this.getFilePath(safeName);
        return this.pruneFile(filePath);
    }

    private pruneIfNeeded(filePath: string): void {
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        if (lines.length > this.maxEntries) {
            const kept = lines.slice(-this.maxEntries);
            fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
        }
    }

    private pruneFile(filePath: string): number {
        if (!fs.existsSync(filePath)) return 0;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        if (lines.length <= this.maxEntries) return 0;
        const pruned = lines.length - this.maxEntries;
        const kept = lines.slice(-this.maxEntries);
        fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
        return pruned;
    }

    private getFilePath(workflowId: string): string {
        const safeName = this.sanitizeWorkflowId(workflowId);
        if (!safeName) throw new Error(`Invalid workflow ID: ${workflowId}`);
        return path.join(this.historyDir, `${safeName}.jsonl`);
    }

    private sanitizeWorkflowId(workflowId: string): string | null {
        const id = String(workflowId || '').trim();
        // Only alphanumeric, dash, underscore
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
        if (id.length > 64) return null;
        return id;
    }
}
