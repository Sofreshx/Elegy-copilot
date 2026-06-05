import fs from 'fs';
import path from 'path';

export type RuntimeDiagnosticEvent =
  | 'startup_dep_failed'
  | 'child_unexpected_exit'
  | 'uncaught_exception'
  | 'unhandled_rejection';

export interface RuntimeDiagnosticPayload {
  schema?: string;
  pid?: number | null;
  platform?: NodeJS.Platform;
  appVersion?: string;
  runtimeRoot?: string;
  windowUrl?: string | null;
  endpoint?: string;
  child?: {
    label: string;
    pid: number | null;
    exitCode: number | null;
    signal?: string | null;
    lastStderr?: string[];
  };
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  childrenState?: Record<string, { status: string; pid: number | null; lastStderr?: string[] }>;
  context?: Record<string, unknown>;
}

export interface RuntimeDiagnosticsLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface RuntimeDiagnosticsFs {
  existsSync: (filePath: string) => boolean;
  mkdirSync: (filePath: string, options?: { recursive?: boolean }) => void;
  writeFileSync: (filePath: string, data: string) => void;
  readdirSync: (filePath: string) => string[];
  statSync: (filePath: string) => { mtimeMs: number };
  unlinkSync: (filePath: string) => void;
}

export interface RuntimeDiagnostics {
  recordEvent: (event: RuntimeDiagnosticEvent, payload: RuntimeDiagnosticPayload) => Promise<void>;
  recordEventSync: (event: RuntimeDiagnosticEvent, payload: RuntimeDiagnosticPayload) => void;
  resolveLogPath: (event: RuntimeDiagnosticEvent, at?: Date) => string;
}

const DEFAULT_MAX_FILES = 16;
const DIAGNOSTIC_SCHEMA = 'elegy.runtime.diagnostic/v1';

function defaultLogger(): RuntimeDiagnosticsLogger {
  return {
    log: (message: string) => process.stderr.write(`[runtime-diagnostics] ${message}\n`),
    warn: (message: string) => process.stderr.write(`[runtime-diagnostics] ${message}\n`),
  };
}

function defaultFs(): RuntimeDiagnosticsFs {
  return {
    existsSync: (filePath) => fs.existsSync(filePath),
    mkdirSync: (filePath, options) => fs.mkdirSync(filePath, options),
    writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
    readdirSync: (filePath) => fs.readdirSync(filePath),
    statSync: (filePath) => fs.statSync(filePath),
    unlinkSync: (filePath) => fs.unlinkSync(filePath),
  };
}

function formatTimestamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
    `-${pad(date.getUTCMilliseconds(), 3)}`
  );
}

export interface RuntimeDiagnosticsOptions {
  logsDir: string;
  fsImpl?: RuntimeDiagnosticsFs;
  logger?: Partial<RuntimeDiagnosticsLogger>;
  maxFiles?: number;
}

export function createRuntimeDiagnostics(options: RuntimeDiagnosticsOptions): RuntimeDiagnostics {
  const fsImpl = options.fsImpl ?? defaultFs();
  const logger: RuntimeDiagnosticsLogger = {
    log: options.logger?.log ?? defaultLogger().log,
    warn: options.logger?.warn ?? defaultLogger().warn,
  };
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  function resolveLogPath(event: RuntimeDiagnosticEvent, at: Date = new Date()): string {
    return path.join(options.logsDir, `runtime-${event}-${formatTimestamp(at)}.json`);
  }

  function pruneIfNeeded(): void {
    try {
      if (!fsImpl.existsSync(options.logsDir)) {
        return;
      }
      const files = fsImpl
        .readdirSync(options.logsDir)
        .filter((name) => name.startsWith('runtime-') && name.endsWith('.json'));
      if (files.length <= maxFiles) {
        return;
      }
      const entries = files
        .map((name) => {
          const filePath = path.join(options.logsDir, name);
          try {
            return { filePath, mtimeMs: fsImpl.statSync(filePath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { filePath: string; mtimeMs: number } => entry !== null);
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toRemove = entries.slice(0, entries.length - maxFiles);
      for (const entry of toRemove) {
        try {
          fsImpl.unlinkSync(entry.filePath);
        } catch {
          // best-effort cleanup
        }
      }
    } catch (error) {
      logger.warn(
        `prune failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function write(event: RuntimeDiagnosticEvent, payload: RuntimeDiagnosticPayload, at: Date): void {
    const enriched: RuntimeDiagnosticPayload & {
      schema: string;
      event: RuntimeDiagnosticEvent;
      timestamp: string;
    } = {
      schema: DIAGNOSTIC_SCHEMA,
      event,
      timestamp: at.toISOString(),
      ...payload,
    };
    try {
      if (!fsImpl.existsSync(options.logsDir)) {
        fsImpl.mkdirSync(options.logsDir, { recursive: true });
      }
      const filePath = resolveLogPath(event, at);
      fsImpl.writeFileSync(filePath, JSON.stringify(enriched, null, 2));
      pruneIfNeeded();
    } catch (error) {
      logger.warn(
        `failed to write ${event} diagnostic: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    recordEvent: async (event, payload) => {
      write(event, payload, new Date());
    },
    recordEventSync: (event, payload) => {
      write(event, payload, new Date());
    },
    resolveLogPath,
  };
}
