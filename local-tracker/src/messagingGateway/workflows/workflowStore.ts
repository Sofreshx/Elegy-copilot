import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWorkflowDefinition, type WorkflowDefinition } from './workflowSchema';

export function getDefaultWorkflowDefinitionsDir(): string {
    return path.join(os.homedir(), '.instruction-engine', 'workflows', 'definitions');
}

export interface WorkflowStoreOptions {
    definitionsDir?: string;
}

export class WorkflowStore {
    private readonly definitionsDir: string;

    constructor(options: WorkflowStoreOptions = {}) {
        this.definitionsDir = options.definitionsDir ?? getDefaultWorkflowDefinitionsDir();
    }

    save(definitionInput: unknown): WorkflowDefinition {
        const definition = parseWorkflowDefinition(definitionInput);
        const filePath = this.getFilePath(definition.id);
        fs.mkdirSync(this.definitionsDir, { recursive: true });

        const line = `${JSON.stringify(definition)}\n`;
        this.appendWithBackup(filePath, line);

        return definition;
    }

    load(workflowId: string): WorkflowDefinition | undefined {
        const safeId = this.sanitizeWorkflowId(workflowId);
        if (!safeId) return undefined;

        const filePath = path.join(this.definitionsDir, `${safeId}.jsonl`);
        if (!fs.existsSync(filePath)) return undefined;

        return this.readLatestDefinition(filePath);
    }

    list(): WorkflowDefinition[] {
        if (!fs.existsSync(this.definitionsDir)) return [];

        const files = fs
            .readdirSync(this.definitionsDir)
            .filter((name) => /^[a-zA-Z0-9_-]+\.jsonl$/.test(name))
            .sort();

        const results: WorkflowDefinition[] = [];
        for (const fileName of files) {
            const latest = this.readLatestDefinition(path.join(this.definitionsDir, fileName));
            if (latest) results.push(latest);
        }

        return results;
    }

    delete(workflowId: string): void {
        const safeId = this.sanitizeWorkflowId(workflowId);
        if (!safeId) return;

        const filePath = path.join(this.definitionsDir, `${safeId}.jsonl`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    private readLatestDefinition(filePath: string): WorkflowDefinition | undefined {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter((line) => line.trim().length > 0);

        let latest: WorkflowDefinition | undefined;
        for (const line of lines) {
            try {
                const parsedLine = JSON.parse(line) as unknown;
                latest = parseWorkflowDefinition(parsedLine);
            } catch {
                // Skip malformed JSONL and invalid workflow records.
            }
        }

        return latest;
    }

    private appendWithBackup(filePath: string, line: string): void {
        const exists = fs.existsSync(filePath);
        const backupPath = this.getBackupPath(filePath);
        const currentContent = exists ? fs.readFileSync(filePath, 'utf8') : '';
        const nextContent = `${currentContent}${line}`;

        if (exists) {
            fs.copyFileSync(filePath, backupPath);
        }

        try {
            fs.writeFileSync(filePath, nextContent, 'utf8');
        } catch (error) {
            if (exists && fs.existsSync(backupPath)) {
                try {
                    fs.copyFileSync(backupPath, filePath);
                } catch {
                    // Best effort rollback.
                }
            }
            throw error;
        }
    }

    private getFilePath(workflowId: string): string {
        const safeId = this.sanitizeWorkflowId(workflowId);
        if (!safeId) {
            throw new Error(`Invalid workflow ID: ${workflowId}`);
        }
        return path.join(this.definitionsDir, `${safeId}.jsonl`);
    }

    private getBackupPath(filePath: string): string {
        if (filePath.endsWith('.jsonl')) {
            return filePath.slice(0, -'.jsonl'.length) + '.bak.jsonl';
        }
        return `${filePath}.bak`;
    }

    private sanitizeWorkflowId(workflowId: string): string | null {
        const id = String(workflowId ?? '').trim();
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
        if (id.length > 64) return null;
        return id;
    }
}
