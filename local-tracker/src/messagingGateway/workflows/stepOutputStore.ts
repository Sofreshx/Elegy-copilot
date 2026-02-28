const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const FULL_TEMPLATE_PATTERN = /^\{\{\s*([^{}]+?)\s*\}\}$/;

const DANGEROUS_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyTemplateValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    if (value === null) return 'null';
    if (value === undefined) return '';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

interface ResolvedExpression {
    found: boolean;
    value: unknown;
}

export class StepOutputStore {
    private readonly outputs = new Map<string, unknown>();

    setStepOutput(stepId: string, output: unknown): void {
        this.outputs.set(stepId, output);
    }

    getStepOutput(stepId: string): unknown {
        return this.outputs.get(stepId);
    }

    resolveParams(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
        if (params === undefined) return undefined;
        return this.resolveValue(params) as Record<string, unknown>;
    }

    private resolveValue(value: unknown): unknown {
        if (typeof value === 'string') {
            return this.resolveString(value);
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.resolveValue(item));
        }

        if (isRecord(value)) {
            const resolved: Record<string, unknown> = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                if (DANGEROUS_PATH_KEYS.has(key)) continue;
                resolved[key] = this.resolveValue(nestedValue);
            }
            return resolved;
        }

        return value;
    }

    private resolveString(input: string): unknown {
        const fullTemplateMatch = input.match(FULL_TEMPLATE_PATTERN);
        if (fullTemplateMatch) {
            const resolved = this.resolveExpression(fullTemplateMatch[1]);
            return resolved.found ? resolved.value : input;
        }

        return input.replace(TEMPLATE_PATTERN, (raw, expression: string) => {
            const resolved = this.resolveExpression(expression);
            if (!resolved.found) return raw;
            return stringifyTemplateValue(resolved.value);
        });
    }

    private resolveExpression(rawExpression: string): ResolvedExpression {
        const segments = rawExpression
            .split('.')
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0);

        if (segments.length === 0) {
            return { found: false, value: undefined };
        }

        if (segments.some((segment) => DANGEROUS_PATH_KEYS.has(segment))) {
            return { found: false, value: undefined };
        }

        const [stepId, ...pathSegments] = segments;
        if (!this.outputs.has(stepId)) {
            return { found: false, value: undefined };
        }

        let current: unknown = this.outputs.get(stepId);
        for (const segment of pathSegments) {
            if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
                return { found: false, value: undefined };
            }
            current = current[segment];
        }

        return { found: true, value: current };
    }
}