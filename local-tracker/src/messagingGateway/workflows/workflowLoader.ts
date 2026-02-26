import fs from 'node:fs';
import path from 'node:path';
import { WorkflowDefinition, parseWorkflowDefinition } from './workflowSchema';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Load a single workflow template by filename.
 * Throws if file not found or schema invalid.
 */
export function loadWorkflowTemplate(filename: string): WorkflowDefinition {
    // Sanitize: only allow alphanumeric, dash, underscore, and .json extension
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(filename)) {
        throw new Error(`Invalid template filename: ${filename}`);
    }
    const filePath = path.join(TEMPLATES_DIR, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Template not found: ${filename}`);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return parseWorkflowDefinition(data);
}

/**
 * Load all workflow templates from the templates directory.
 * Returns a Map of workflow ID → WorkflowDefinition.
 * Skips files that fail validation and logs warnings.
 */
export function loadAllWorkflowTemplates(
    logger?: { warn: (msg: string) => void },
): Map<string, WorkflowDefinition> {
    const templates = new Map<string, WorkflowDefinition>();

    if (!fs.existsSync(TEMPLATES_DIR)) return templates;

    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        try {
            const def = loadWorkflowTemplate(file);
            templates.set(def.id, def);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            (logger ?? console).warn(`[WorkflowLoader] Skipping ${file}: ${msg}`);
        }
    }

    return templates;
}
