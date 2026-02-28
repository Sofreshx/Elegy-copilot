import { loadAllWorkflowTemplates } from './workflowLoader';
import type { WorkflowDefinition } from './workflowSchema';

export class WorkflowDiscovery {
    private templates = new Map<string, WorkflowDefinition>();
    private readonly logger?: { warn: (msg: string) => void };

    constructor(logger?: { warn: (msg: string) => void }) {
        this.logger = logger;
        this.refresh();
    }

    refresh(): void {
        this.templates = loadAllWorkflowTemplates(this.logger);
    }

    listAll(): WorkflowDefinition[] {
        return [...this.templates.values()];
    }

    get(id: string): WorkflowDefinition | undefined {
        return this.templates.get(id);
    }

    has(id: string): boolean {
        return this.templates.has(id);
    }

    getIds(): string[] {
        return [...this.templates.keys()].sort();
    }
}
