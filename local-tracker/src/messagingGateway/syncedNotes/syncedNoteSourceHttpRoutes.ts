import http from 'http';
import {
  SyncedNoteSourceContractError,
  normalizeSyncedNoteSourceId,
  type SyncedNoteSourceRecord,
} from '@elegy-copilot/contracts';

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

function writeApiError(res: http.ServerResponse, statusCode: number, error: string, code?: string): void {
  writeJson(res, statusCode, {
    error,
    ...(code ? { code } : {}),
  });
}

function parseRoute(pathname: string): string[] {
  return pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

function validateSourceId(rawId: string): string | null {
  try {
    return normalizeSyncedNoteSourceId(rawId);
  } catch (error) {
    if (error instanceof SyncedNoteSourceContractError) {
      return null;
    }
    return null;
  }
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
    throw new SyncedNoteSourceHttpError(400, 'Invalid synced-note source payload', 'invalid_synced_note_source');
  }

  const bodyId = payload.id;
  if (bodyId !== undefined && String(bodyId).trim() !== pathId) {
    throw new SyncedNoteSourceHttpError(400, 'Body id must match route id', 'synced_note_source_id_mismatch');
  }

  return {
    ...payload,
    id: pathId,
  };
}

export class SyncedNoteSourceHttpError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SyncedNoteSourceHttpApiHandlers {
  listSources: () => SyncedNoteSourceRecord[];
  getSource: (id: string) => SyncedNoteSourceRecord | undefined;
  createSource: (payload: unknown) => SyncedNoteSourceRecord;
  updateSource: (id: string, payload: unknown) => SyncedNoteSourceRecord;
  deleteSource: (id: string) => boolean;
}

export interface SyncedNoteSourceHttpRouteContext {
  method: string;
  pathname: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  handlers?: SyncedNoteSourceHttpApiHandlers;
  readJsonBody: (req: http.IncomingMessage, maxBytes?: number) => Promise<unknown>;
}

export async function handleSyncedNoteSourceHttpRoute(context: SyncedNoteSourceHttpRouteContext): Promise<boolean> {
  const { method, pathname, req, res, handlers, readJsonBody } = context;
  const parts = parseRoute(pathname);
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'synced-notes' || parts[2] !== 'sources') {
    return false;
  }
  if (!handlers) {
    return false;
  }

  try {
    if (method === 'GET' && parts.length === 3) {
      writeJson(res, 200, handlers.listSources());
      return true;
    }

    if (method === 'POST' && parts.length === 3) {
      const payload = await readJsonBody(req);
      const created = handlers.createSource(payload);
      writeJson(res, 201, created);
      return true;
    }

    if (parts.length === 4) {
      const sourceId = validateSourceId(parts[3]);
      if (!sourceId) {
        writeApiError(res, 400, 'Invalid synced-note source id format', 'invalid_synced_note_source_id');
        return true;
      }

      if (method === 'GET') {
        const source = handlers.getSource(sourceId);
        if (!source) {
          writeApiError(res, 404, 'Synced-note source not found', 'synced_note_source_not_found');
          return true;
        }

        writeJson(res, 200, source);
        return true;
      }

      if (method === 'PUT') {
        const payload = await readJsonBody(req);
        const normalizedPayload = normalizePutPayload(sourceId, payload);
        const updated = handlers.updateSource(sourceId, normalizedPayload);
        writeJson(res, 200, updated);
        return true;
      }

      if (method === 'DELETE') {
        const deleted = handlers.deleteSource(sourceId);
        if (!deleted) {
          writeApiError(res, 404, 'Synced-note source not found', 'synced_note_source_not_found');
          return true;
        }

        writeJson(res, 200, { ok: true, id: sourceId });
        return true;
      }
    }
  } catch (error) {
    if (isZodLikeError(error)) {
      writeApiError(res, 400, 'Invalid synced-note source payload', 'invalid_synced_note_source');
      return true;
    }

    const apiStatus = getApiErrorStatus(error);
    if (apiStatus !== null) {
      writeJson(res, apiStatus, {
        error: getErrorMessage(error, 'Synced-note source API error'),
        ...(getApiErrorCode(error) ? { code: getApiErrorCode(error) } : {}),
      });
      return true;
    }

    const message = getErrorMessage(error, 'Synced-note source API error');
    if (message === 'Invalid JSON body' || message === 'Request body too large') {
      writeJson(res, 400, { error: message });
      return true;
    }

    writeJson(res, 500, { error: message });
    return true;
  }

  return false;
}