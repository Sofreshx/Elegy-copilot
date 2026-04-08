import http from 'http';

import type { WorkflowDefinition, WorkflowRunResult } from './workflowSchema';

const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isZodLikeError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && (error as { name?: unknown }).name === 'ZodError';
}

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function parseRoute(pathname: string): string[] {
    return pathname
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => decodeURIComponent(segment));
}

function validateWorkflowId(rawId: string): string | null {
    const id = String(rawId ?? '').trim();
    if (!WORKFLOW_ID_PATTERN.test(id)) {
        return null;
    }
    return id;
}

function getApiErrorStatus(error: unknown): number | null {
    if (!isRecord(error)) {
        return null;
    }
    const statusCode = error.statusCode;
    if (typeof statusCode !== 'number' || !Number.isFinite(statusCode)) {
        return null;
    }
    if (statusCode < 100 || statusCode > 599) {
        return null;
    }
    return Math.trunc(statusCode);
}

function getApiErrorCode(error: unknown): string | undefined {
    if (!isRecord(error)) {
        return undefined;
    }
    const code = error.code;
    return typeof code === 'string' && code.trim().length > 0 ? code : undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    if (typeof error === 'string' && error.trim().length > 0) {
        return error;
    }
    return fallback;
}

function normalizePutPayload(pathId: string, payload: unknown): Record<string, unknown> {
    if (!isRecord(payload)) {
        throw new WorkflowHttpError(400, 'Invalid workflow definition payload', 'invalid_workflow_definition');
    }

    const bodyId = payload.id;
    if (bodyId !== undefined && String(bodyId).trim() !== pathId) {
        throw new WorkflowHttpError(400, 'Body id must match route id', 'workflow_id_mismatch');
    }

    return {
        ...payload,
        id: pathId,
    };
}

function normalizeRunPayloadContext(workflowId: string, payload: unknown): Record<string, unknown> {
    if (payload !== undefined && !isRecord(payload)) {
        throw new WorkflowHttpError(400, 'Invalid workflow run payload', 'invalid_workflow_run');
    }

    const body = isRecord(payload) ? payload : {};
    const rawContext = body.context;
    if (rawContext !== undefined && !isRecord(rawContext)) {
        throw new WorkflowHttpError(400, 'Workflow run context must be an object', 'invalid_workflow_run_context');
    }

    const normalizedContext: Record<string, unknown> = isRecord(rawContext)
        ? { ...rawContext }
        : {};
    const rawSessionId = body.sessionId ?? normalizedContext.sessionId;

    if (rawSessionId !== undefined) {
        if (typeof rawSessionId !== 'string') {
            throw new WorkflowHttpError(400, 'sessionId must be a string', 'invalid_workflow_run_session');
        }
        const sessionId = rawSessionId.trim();
        if (!sessionId) {
            throw new WorkflowHttpError(400, 'sessionId must not be empty', 'invalid_workflow_run_session');
        }
        normalizedContext.sessionId = sessionId;
    }

    normalizedContext.workflowId = workflowId;
    return normalizedContext;
}

export class WorkflowHttpError extends Error {
    readonly statusCode: number;
    readonly code?: string;

    constructor(statusCode: number, message: string, code?: string) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

export interface WorkflowHttpRunResponse {
    result: WorkflowRunResult;
    runId?: string;
}

export interface WorkflowHttpApiHandlers {
    listTemplateDefinitions: () => WorkflowDefinition[];
    getTemplateDefinition: (id: string) => WorkflowDefinition | undefined;
    listPersistedDefinitions: () => WorkflowDefinition[];
    getPersistedDefinition: (id: string) => WorkflowDefinition | undefined;
    createPersistedDefinition: (payload: unknown) => WorkflowDefinition;
    updatePersistedDefinition: (id: string, payload: unknown) => WorkflowDefinition;
    deletePersistedDefinition: (id: string) => boolean;
    runPersistedDefinition: (definition: WorkflowDefinition, context?: Record<string, unknown>) => Promise<WorkflowHttpRunResponse>;
}

export interface WorkflowHttpRouteContext {
    method: string;
    pathname: string;
    req: http.IncomingMessage;
    res: http.ServerResponse;
    handlers?: WorkflowHttpApiHandlers;
    readJsonBody: (req: http.IncomingMessage, maxBytes?: number) => Promise<unknown>;
}

export async function handleWorkflowHttpRoute(context: WorkflowHttpRouteContext): Promise<boolean> {
    const { method, pathname, req, res, handlers, readJsonBody } = context;
    const parts = parseRoute(pathname);
    if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'workflows') {
        return false;
    }
    if (!handlers) {
        return false;
    }

    try {
        // GET /api/workflows/templates
        if (method === 'GET' && parts.length === 3 && parts[2] === 'templates') {
            writeJson(res, 200, handlers.listTemplateDefinitions());
            return true;
        }

        // GET /api/workflows/templates/:id
        if (method === 'GET' && parts.length === 4 && parts[2] === 'templates') {
            const templateId = validateWorkflowId(parts[3]);
            if (!templateId) {
                writeJson(res, 400, { error: 'Invalid workflow id format' });
                return true;
            }

            const template = handlers.getTemplateDefinition(templateId);
            if (!template) {
                writeJson(res, 404, { error: 'Workflow template not found' });
                return true;
            }

            writeJson(res, 200, template);
            return true;
        }

        // GET /api/workflows/definitions
        if (method === 'GET' && parts.length === 3 && parts[2] === 'definitions') {
            writeJson(res, 200, handlers.listPersistedDefinitions());
            return true;
        }

        // GET /api/workflows/definitions/:id
        if (method === 'GET' && parts.length === 4 && parts[2] === 'definitions') {
            const workflowId = validateWorkflowId(parts[3]);
            if (!workflowId) {
                writeJson(res, 400, { error: 'Invalid workflow id format' });
                return true;
            }

            const definition = handlers.getPersistedDefinition(workflowId);
            if (!definition) {
                writeJson(res, 404, { error: 'Workflow definition not found' });
                return true;
            }

            writeJson(res, 200, definition);
            return true;
        }

        // POST /api/workflows/definitions
        if (method === 'POST' && parts.length === 3 && parts[2] === 'definitions') {
            const payload = await readJsonBody(req);
            const saved = handlers.createPersistedDefinition(payload);
            writeJson(res, 201, saved);
            return true;
        }

        // PUT /api/workflows/definitions/:id
        if (method === 'PUT' && parts.length === 4 && parts[2] === 'definitions') {
            const workflowId = validateWorkflowId(parts[3]);
            if (!workflowId) {
                writeJson(res, 400, { error: 'Invalid workflow id format' });
                return true;
            }

            const payload = await readJsonBody(req);
            const normalizedPayload = normalizePutPayload(workflowId, payload);
            const saved = handlers.updatePersistedDefinition(workflowId, normalizedPayload);
            writeJson(res, 200, saved);
            return true;
        }

        // DELETE /api/workflows/definitions/:id
        if (method === 'DELETE' && parts.length === 4 && parts[2] === 'definitions') {
            const workflowId = validateWorkflowId(parts[3]);
            if (!workflowId) {
                writeJson(res, 400, { error: 'Invalid workflow id format' });
                return true;
            }

            const deleted = handlers.deletePersistedDefinition(workflowId);
            if (!deleted) {
                writeJson(res, 404, { error: 'Workflow definition not found' });
                return true;
            }

            writeJson(res, 200, { ok: true, id: workflowId });
            return true;
        }

        // POST /api/workflows/definitions/:id/run
        if (method === 'POST' && parts.length === 5 && parts[2] === 'definitions' && parts[4] === 'run') {
            const workflowId = validateWorkflowId(parts[3]);
            if (!workflowId) {
                writeJson(res, 400, { error: 'Invalid workflow id format' });
                return true;
            }

            const definition = handlers.getPersistedDefinition(workflowId);
            if (!definition) {
                writeJson(res, 404, { error: 'Workflow definition not found' });
                return true;
            }

            const payload = await readJsonBody(req);
            const runResponse = await handlers.runPersistedDefinition(
                definition,
                normalizeRunPayloadContext(workflowId, payload),
            );
            writeJson(res, 200, runResponse);
            return true;
        }
    } catch (error) {
        if (isZodLikeError(error)) {
            writeJson(res, 400, {
                error: 'Invalid workflow definition payload',
            });
            return true;
        }

        const apiStatus = getApiErrorStatus(error);
        if (apiStatus !== null) {
            writeJson(res, apiStatus, {
                error: getErrorMessage(error, 'Workflow API error'),
                ...(getApiErrorCode(error) ? { code: getApiErrorCode(error) } : {}),
            });
            return true;
        }

        const message = getErrorMessage(error, 'Workflow API error');
        if (message === 'Invalid JSON body' || message === 'Request body too large') {
            writeJson(res, 400, { error: message });
            return true;
        }

        writeJson(res, 500, { error: message });
        return true;
    }

    return false;
}
