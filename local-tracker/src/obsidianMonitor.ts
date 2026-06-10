import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { TrackerConfig } from "./config";
import { TrackerEvent } from "./types";

export type ObsidianMonitorEventHandler = (event: TrackerEvent) => void;

interface FileSnapshot {
  exists: boolean;
  hash: string;
  size: number;
  updatedAt: string | null;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function createMissingFileSnapshot(): FileSnapshot {
  return {
    exists: false,
    hash: "",
    size: 0,
    updatedAt: null,
  };
}

function isMissingOrNotFileError(error: unknown): boolean {
  return !!error
    && typeof error === "object"
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR");
}

function isTransientFileError(error: unknown): boolean {
  return !!error
    && typeof error === "object"
    && "code" in error
    && (
      error.code === "EACCES"
      || error.code === "EPERM"
      || error.code === "EBUSY"
      || error.code === "EMFILE"
      || error.code === "ENFILE"
    );
}

function readFileSnapshot(filePath: string, fallback: FileSnapshot = createMissingFileSnapshot()): FileSnapshot {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return createMissingFileSnapshot();
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      return {
        exists: true,
        hash: hashContent(content),
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    } catch (error) {
      if (isMissingOrNotFileError(error)) {
        return createMissingFileSnapshot();
      }
      if (isTransientFileError(error)) {
        return fallback;
      }
      throw error;
    }
  } catch (error) {
    if (isMissingOrNotFileError(error)) {
      return createMissingFileSnapshot();
    }
    if (isTransientFileError(error)) {
      return fallback;
    }
    throw error;
  }
}

function resolveDefaultSyncStatusPath(): string {
  return path.join(os.homedir(), ".elegy", "obsidian-sync", "status.json");
}

export class ObsidianMonitor {
  private config: TrackerConfig;
  private handlers: ObsidianMonitorEventHandler[] = [];
  private timer: NodeJS.Timeout | null = null;
  private noteSnapshots: Map<string, FileSnapshot> = new Map();
  private syncSnapshot: FileSnapshot | null = null;

  constructor(config: TrackerConfig) {
    this.config = config;
  }

  on(handler: ObsidianMonitorEventHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    if (this.timer) {
      return;
    }

    const syncStatusPath = this.getSyncStatusPath();
    for (const notePath of this.config.obsidianNotePaths) {
      const absolutePath = path.resolve(notePath);
      this.noteSnapshots.set(absolutePath, readFileSnapshot(absolutePath));
    }

    this.syncSnapshot = readFileSnapshot(syncStatusPath);
    this.timer = setInterval(() => this.poll(), Math.max(this.config.obsidianPollIntervalMs, 500));
  }

  private getSyncStatusPath(): string {
    return path.resolve(this.config.obsidianSyncStatusPath || resolveDefaultSyncStatusPath());
  }

  private poll(): void {
    for (const notePath of this.config.obsidianNotePaths) {
      const absolutePath = path.resolve(notePath);
      const previous = this.noteSnapshots.get(absolutePath) || createMissingFileSnapshot();
      const next = readFileSnapshot(absolutePath, previous);
      this.noteSnapshots.set(absolutePath, next);

      if (previous.hash !== next.hash || previous.exists !== next.exists || previous.updatedAt !== next.updatedAt) {
        this.emit({
          type: "obsidian_note_update",
          timestamp: new Date().toISOString(),
          data: {
            path: normalizePath(absolutePath),
            exists: next.exists,
            hash: next.hash || undefined,
            size: next.size,
            updatedAt: next.updatedAt,
          },
        });
      }
    }

    const syncStatusPath = this.getSyncStatusPath();
    const previousSyncSnapshot = this.syncSnapshot || createMissingFileSnapshot();
    const nextSyncSnapshot = readFileSnapshot(syncStatusPath, previousSyncSnapshot);
    this.syncSnapshot = nextSyncSnapshot;
    if (
      previousSyncSnapshot.hash !== nextSyncSnapshot.hash
      || previousSyncSnapshot.exists !== nextSyncSnapshot.exists
      || previousSyncSnapshot.updatedAt !== nextSyncSnapshot.updatedAt
    ) {
      this.emit({
        type: "obsidian_sync_update",
        timestamp: new Date().toISOString(),
        data: {
          path: normalizePath(syncStatusPath),
          exists: nextSyncSnapshot.exists,
          hash: nextSyncSnapshot.hash || undefined,
          size: nextSyncSnapshot.size,
          updatedAt: nextSyncSnapshot.updatedAt,
        },
      });
    }
  }

  private emit(event: TrackerEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[ObsidianMonitor] Handler error:", error);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const __obsidianMonitorTestExports = {
  resolveDefaultSyncStatusPath,
};
