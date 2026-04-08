import chokidar, { FSWatcher } from "chokidar";
import crypto from "crypto";
import os from "os";
import path from "path";
import { TrackerConfig } from "./config";
import { TrackerEvent } from "./types";

export type EventHandler = (event: TrackerEvent) => void;

const LEGACY_TASK_SURFACE_ENV = "TRACKER_ENABLE_LEGACY_TASK_SURFACE";

type TaskAuthority = "canonical" | "legacy-compat";
const CANONICAL_TASK_GLOBS = ["**/*.json", "**/*.md"] as const;
const LEGACY_TASK_GLOBS = ["**/*.md"] as const;

interface TaskWatchSurface {
  authority: TaskAuthority;
  taskStorePath: string;
  taskGlobs: readonly string[];
}

function normalizeRepoPathForKey(workspacePath: string): string {
  return workspacePath.replace(/\\/g, "/").trim().toLowerCase();
}

function getRepoId(workspacePath: string): string {
  return crypto.createHash("sha256").update(normalizeRepoPathForKey(workspacePath), "utf8").digest("hex").slice(0, 12);
}

function toPosixPath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

function getCanonicalTasksPath(workspacePath: string): string {
  return path.join(os.homedir(), ".copilot", "repo-state", getRepoId(workspacePath), "tasks");
}

function getLegacyTasksPath(workspacePath: string): string {
  return path.join(workspacePath, ".instructions", "tasks");
}

function shouldWatchLegacyTaskSurface(): boolean {
  const value = process.env[LEGACY_TASK_SURFACE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function warnLegacyTaskSurfaceEnabled(workspacePath: string): void {
  console.warn(
    `[Watcher] ${LEGACY_TASK_SURFACE_ENV}=true enables legacy repo-local task watching for ${toPosixPath(workspacePath)}. `
    + `This is a compatibility-only surface; canonical task authority is ~/.copilot/repo-state/<repoId>/tasks/.`
  );
}

export const __watcherTestExports = {
  getCanonicalTasksPath,
  getLegacyTasksPath,
  shouldWatchLegacyTaskSurface,
  warnLegacyTaskSurfaceEnabled,
};

export class FileWatcher {
  private config: TrackerConfig;
  private watchers: FSWatcher[] = [];
  private handlers: EventHandler[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly debounceMs: number;

  constructor(config: TrackerConfig, debounceMs = 500) {
    this.config = config;
    this.debounceMs = debounceMs;
  }

  /** Register an event handler */
  on(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /** Start watching configured paths */
  start(): void {
    for (const workspacePath of this.config.workspacePaths) {
      this.watchTaskFiles(workspacePath);
    }
    console.log(`[Watcher] Started watching ${this.config.workspacePaths.length} workspace(s)`);
  }

  /** Watch canonical repo-state tasks, plus opt-in legacy repo-local tasks for compatibility. */
  private watchTaskFiles(workspacePath: string): void {
    const surfaces: TaskWatchSurface[] = [
      { authority: "canonical", taskStorePath: getCanonicalTasksPath(workspacePath), taskGlobs: CANONICAL_TASK_GLOBS },
    ];

    if (shouldWatchLegacyTaskSurface()) {
      warnLegacyTaskSurfaceEnabled(workspacePath);
      surfaces.push({
        authority: "legacy-compat",
        taskStorePath: getLegacyTasksPath(workspacePath),
        taskGlobs: LEGACY_TASK_GLOBS,
      });
    }

    for (const surface of surfaces) {
      const watcher = chokidar.watch(surface.taskGlobs.map((glob) => path.join(surface.taskStorePath, glob)), {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      watcher.on("all", (eventType, filePath) => {
        this.debouncedEmit(`task-${filePath}`, () => {
          this.emit({
            type: "task_update",
            timestamp: new Date().toISOString(),
            data: {
              authority: surface.authority,
              event: eventType,
              path: filePath,
              relativePath: toPosixPath(path.relative(surface.taskStorePath, filePath)),
              taskStorePath: toPosixPath(surface.taskStorePath),
              workspacePath: toPosixPath(workspacePath),
            },
          });
        });
      });

      this.watchers.push(watcher);
    }
  }

  /** Debounced event emission */
  private debouncedEmit(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        fn();
      }, this.debounceMs)
    );
  }

  /** Emit an event to all handlers */
  private emit(event: TrackerEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[Watcher] Handler error:", error);
      }
    }
  }

  /** Stop all watchers */
  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
    console.log("[Watcher] All watchers stopped");
  }
}
