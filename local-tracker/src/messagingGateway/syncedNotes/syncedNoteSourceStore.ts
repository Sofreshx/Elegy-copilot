import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SYNCED_NOTE_SOURCE_PROVIDERS,
  SyncedNoteSourceContractError,
  assertSyncedNoteSourceIdMatches,
  canonicalizeSyncedNoteSourceLocator,
  deriveSyncedNoteSourceId,
  getSyncedNoteSourceProviderPolicy,
  normalizeSyncedNoteSourceId,
  type SyncedNoteSourceRecord,
} from '@elegy-copilot/contracts';
import { z } from 'zod';

const SYNCED_NOTE_SOURCE_FILE_PATTERN = /^snsrc_[a-f0-9]{32}\.jsonl$/;

const syncedNoteSourceMutationSchema = z.object({
  id: z.string().trim().optional(),
  provider: z.enum(SYNCED_NOTE_SOURCE_PROVIDERS),
  host: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  branch: z.string().trim().min(1),
  notesPath: z.string().trim().min(1),
  localCheckoutPath: z.string().trim().min(1).optional(),
}).strict();

const persistedSyncedNoteSourceSchema = syncedNoteSourceMutationSchema.extend({
  id: z.string().trim(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
}).strict();

function isZodLikeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'ZodError';
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

export class SyncedNoteSourceStoreError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SyncedNoteSourceStoreOptions {
  sourcesDir?: string;
}

export function getDefaultSyncedNoteSourcesDir(): string {
  return path.join(os.homedir(), '.copilot', 'synced-notes', 'sources');
}

function toStoreErrorFromContractError(
  error: SyncedNoteSourceContractError,
  options: { locatorMismatchMessage?: string } = {},
): SyncedNoteSourceStoreError {
  if (error.code === 'invalid_synced_note_source_id') {
    return new SyncedNoteSourceStoreError(400, error.message, 'invalid_synced_note_source_id');
  }
  if (error.code === 'synced_note_source_locator_mismatch') {
    return new SyncedNoteSourceStoreError(
      400,
      options.locatorMismatchMessage ?? error.message,
      'synced_note_source_locator_mismatch',
    );
  }
  return new SyncedNoteSourceStoreError(400, error.message, 'invalid_synced_note_source');
}

function requireSyncedNoteSourceId(sourceId: string): string {
  try {
    return normalizeSyncedNoteSourceId(sourceId);
  } catch (error) {
    if (error instanceof SyncedNoteSourceContractError) {
      throw toStoreErrorFromContractError(error);
    }
    throw error;
  }
}

function normalizeMutation(
  payload: unknown,
  options: { expectedId?: string; createdAt?: string } = {},
): SyncedNoteSourceRecord {
  const expectedId = typeof options.expectedId === 'string' && options.expectedId.trim().length > 0
    ? requireSyncedNoteSourceId(options.expectedId)
    : '';

  try {
    const parsed = syncedNoteSourceMutationSchema.parse(payload);
    const providerPolicy = getSyncedNoteSourceProviderPolicy(parsed.provider);
    const locator = canonicalizeSyncedNoteSourceLocator({
      ...parsed,
      provider: providerPolicy.provider,
    });
    const localCheckoutPath = typeof parsed.localCheckoutPath === 'string' && parsed.localCheckoutPath.trim().length > 0
      ? parsed.localCheckoutPath.trim()
      : undefined;
    let derivedId = deriveSyncedNoteSourceId(locator);

    if (expectedId) {
      try {
        assertSyncedNoteSourceIdMatches(locator, expectedId);
      } catch (error) {
        if (error instanceof SyncedNoteSourceContractError) {
          throw toStoreErrorFromContractError(error, {
            locatorMismatchMessage: 'Payload locator does not match route id',
          });
        }
        throw error;
      }
      derivedId = expectedId;
    }

    if (parsed.id) {
      let payloadId: string;
      try {
        payloadId = normalizeSyncedNoteSourceId(parsed.id);
      } catch (error) {
        if (error instanceof SyncedNoteSourceContractError) {
          throw toStoreErrorFromContractError(error);
        }
        throw error;
      }

      try {
        derivedId = assertSyncedNoteSourceIdMatches(locator, payloadId);
      } catch (error) {
        if (error instanceof SyncedNoteSourceContractError) {
          throw toStoreErrorFromContractError(error, {
            locatorMismatchMessage: 'Payload id does not match locator',
          });
        }
        throw error;
      }

      if (expectedId) {
        derivedId = expectedId;
      }
    }

    const now = new Date().toISOString();
    return {
      id: derivedId,
      ...locator,
      ...(localCheckoutPath ? { localCheckoutPath } : {}),
      createdAt: options.createdAt || now,
      updatedAt: now,
    };
  } catch (error) {
    if (error instanceof SyncedNoteSourceStoreError) {
      throw error;
    }
    if (error instanceof SyncedNoteSourceContractError) {
      throw toStoreErrorFromContractError(error);
    }
    if (isZodLikeError(error)) {
      throw new SyncedNoteSourceStoreError(400, 'Invalid synced-note source payload', 'invalid_synced_note_source');
    }
    throw new SyncedNoteSourceStoreError(
      400,
      toErrorMessage(error, 'Invalid synced-note source payload'),
      'invalid_synced_note_source',
    );
  }
}

function sanitizeSyncedNoteSourceId(sourceId: string): string | null {
  try {
    return normalizeSyncedNoteSourceId(sourceId);
  } catch {
    return null;
  }
}

export class SyncedNoteSourceStore {
  private readonly sourcesDir: string;

  constructor(options: SyncedNoteSourceStoreOptions = {}) {
    this.sourcesDir = options.sourcesDir ?? getDefaultSyncedNoteSourcesDir();
  }

  create(payload: unknown): SyncedNoteSourceRecord {
    const record = normalizeMutation(payload);
    if (this.load(record.id)) {
      throw new SyncedNoteSourceStoreError(409, 'Synced-note source already exists', 'synced_note_source_exists');
    }

    const filePath = this.getFilePath(record.id);
    fs.mkdirSync(this.sourcesDir, { recursive: true });
    this.appendWithBackup(filePath, `${JSON.stringify(record)}\n`);
    return record;
  }

  update(sourceId: string, payload: unknown): SyncedNoteSourceRecord {
    const safeId = requireSyncedNoteSourceId(sourceId);

    const existing = this.load(safeId);
    if (!existing) {
      throw new SyncedNoteSourceStoreError(404, 'Synced-note source not found', 'synced_note_source_not_found');
    }

    const record = normalizeMutation(payload, {
      expectedId: safeId,
      createdAt: existing.createdAt,
    });
    this.appendWithBackup(this.getFilePath(safeId), `${JSON.stringify(record)}\n`);
    return record;
  }

  load(sourceId: string): SyncedNoteSourceRecord | undefined {
    const safeId = sanitizeSyncedNoteSourceId(sourceId);
    if (!safeId) {
      return undefined;
    }

    const filePath = this.getFilePath(safeId);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    return this.readLatestRecord(filePath);
  }

  list(): SyncedNoteSourceRecord[] {
    if (!fs.existsSync(this.sourcesDir)) {
      return [];
    }

    const files = fs.readdirSync(this.sourcesDir)
      .filter((name) => SYNCED_NOTE_SOURCE_FILE_PATTERN.test(name))
      .sort();
    const results: SyncedNoteSourceRecord[] = [];

    for (const fileName of files) {
      const latest = this.readLatestRecord(path.join(this.sourcesDir, fileName));
      if (latest) {
        results.push(latest);
      }
    }

    return results;
  }

  delete(sourceId: string): boolean {
    const safeId = sanitizeSyncedNoteSourceId(sourceId);
    if (!safeId) {
      return false;
    }

    const filePath = this.getFilePath(safeId);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }

  private readLatestRecord(filePath: string): SyncedNoteSourceRecord | undefined {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    let latest: SyncedNoteSourceRecord | undefined;
    for (const line of lines) {
      try {
        const parsed = persistedSyncedNoteSourceSchema.parse(JSON.parse(line) as unknown);
        const parsedId = normalizeSyncedNoteSourceId(parsed.id);
        const locator = canonicalizeSyncedNoteSourceLocator(parsed);
        assertSyncedNoteSourceIdMatches(locator, parsedId);
        latest = {
          id: parsedId,
          ...locator,
          ...(parsed.localCheckoutPath ? { localCheckoutPath: parsed.localCheckoutPath } : {}),
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        };
      } catch {
        // Skip malformed JSONL and invalid synced-note source records.
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

  private getFilePath(sourceId: string): string {
    const safeId = requireSyncedNoteSourceId(sourceId);
    return path.join(this.sourcesDir, `${safeId}.jsonl`);
  }

  private getBackupPath(filePath: string): string {
    if (filePath.endsWith('.jsonl')) {
      return filePath.slice(0, -'.jsonl'.length) + '.bak.jsonl';
    }
    return `${filePath}.bak`;
  }
}