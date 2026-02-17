import chokidar, { FSWatcher } from "chokidar";
import path from "path";
import { TrackerConfig } from "./config";
import { TrackerEvent } from "./types";

export type EventHandler = (event: TrackerEvent) => void;

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
