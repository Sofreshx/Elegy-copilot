import type { WorkflowStep } from './workflowSchema';
import type { StepExecutor } from './workflowRuntime';

export type ActionExecutor = (step: WorkflowStep, context: Record<string, unknown>) => Promise<unknown>;

export class ActionNotFoundError extends Error {
    public readonly actionName: string;

    constructor(actionName: string) {
        super(`Action not found: "${actionName}"`);
        this.name = 'ActionNotFoundError';
        this.actionName = actionName;
    }
}

export class ActionRegistry {
    private readonly executors = new Map<string, ActionExecutor>();

    register(actionName: string, executor: ActionExecutor): void {
        if (this.executors.has(actionName)) {
            throw new Error(`Action "${actionName}" is already registered`);
        }
        this.executors.set(actionName, executor);
    }

    get(actionName: string): ActionExecutor {
        const executor = this.executors.get(actionName);
        if (!executor) {
            throw new ActionNotFoundError(actionName);
        }
        return executor;
    }

    has(actionName: string): boolean {
        return this.executors.has(actionName);
    }

    toStepExecutor(): StepExecutor {
        return (step, context) => {
            const executor = this.get(step.action);
            return executor(step, context);
        };
    }

    getRegisteredActions(): string[] {
        return [...this.executors.keys()].sort();
    }
}
