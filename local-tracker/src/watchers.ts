import chokidar from "chokidar";
import path from "path";
import Database from "better-sqlite3";
import { TrackerConfig } from "./config";
import { TrackerEvent, SessionSnapshot } from "./types";

export type EventHandler = (event: TrackerEvent) => void;

export class FileWatcher {
  private config: TrackerConfig;
  private watchers: chokidar.FSWatcher[] = [];
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
      this.watchE3Database(workspacePath);
      this.watchTaskFiles(workspacePath);
    }
    console.log(`[Watcher] Started watching ${this.config.workspacePaths.length} workspace(s)`);
  }

  /** Watch E3 database for changes */
  private watchE3Database(workspacePath: string): void {
    const dbPath = this.config.e3DbPath || path.join(workspacePath, ".e3-local", "executive3.db");

    const watcher = chokidar.watch(dbPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    watcher.on("change", () => {
      this.debouncedEmit(`e3-db-${workspacePath}`, () => {
        const snapshot = this.readSessionSnapshot(dbPath);
        if (snapshot) {
          this.emit({
            type: "session_update",
            timestamp: new Date().toISOString(),
            data: snapshot,
          });
        }
      });
    });

    this.watchers.push(watcher);
  }

  /** Watch .instructions/tasks/ for file changes */
  private watchTaskFiles(workspacePath: string): void {
    const tasksPath = path.join(workspacePath, ".instructions", "tasks");

    const watcher = chokidar.watch(path.join(tasksPath, "**/*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    watcher.on("all", (eventType, filePath) => {
      this.debouncedEmit(`task-${filePath}`, () => {
        this.emit({
          type: "task_update",
          timestamp: new Date().toISOString(),
          data: {
            event: eventType,
            path: filePath,
            relativePath: path.relative(workspacePath, filePath),
          },
        });
      });
    });

    this.watchers.push(watcher);
  }

  /** Read session snapshot from E3 database */
  private readSessionSnapshot(dbPath: string): SessionSnapshot | null {
    try {
      const db = new Database(dbPath, { readonly: true });

      // Get active session
      const session = db.prepare(
        "SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
      ).get() as Record<string, unknown> | undefined;

      if (!session) {
        db.close();
        return null;
      }

      // Get task summary
      const summary = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done, SUM(CASE WHEN status='in-progress' THEN 1 ELSE 0 END) as in_progress FROM tasks WHERE session_id = ?"
      ).get(session.id) as Record<string, number> | undefined;

      db.close();

      return {
        id: session.id as string,
        status: session.status as string,
        planId: session.plan_id as string | undefined,
        taskSummary: summary
          ? { total: summary.total, done: summary.done, inProgress: summary.in_progress }
          : undefined,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      // DB might be locked or not exist yet
      console.warn(`[Watcher] Could not read E3 DB: ${error}`);
      return null;
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
