import { FileWatcher, EventHandler } from "../watchers";
import { TrackerConfig } from "../config";
import { TrackerEvent } from "../types";

// ---------- Mocks ----------

// Mock chokidar: each call to chokidar.watch() returns a fresh mock watcher
const mockWatcherInstances: MockWatcher[] = [];

class MockWatcher {
  private listeners: Map<string, ((...args: any[]) => void)[]> = new Map();
  closed = false;

  on(event: string, cb: (...args: any[]) => void): this {
    const arr = this.listeners.get(event) || [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }

  /** Simulate chokidar firing an event */
  simulateEvent(event: string, ...args: any[]): void {
    for (const cb of this.listeners.get(event) || []) {
      cb(...args);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

jest.mock("chokidar", () => ({
  watch: jest.fn(() => {
    const w = new MockWatcher();
    mockWatcherInstances.push(w);
    return w;
  }),
}));

// ---------- Helpers ----------

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    workspacePaths: ["/test/workspace"],
    localWsPort: 9821,
    watchIntervalMs: 2000,
    statusPort: 0,
    ...overrides,
  };
}

// ---------- Tests ----------

beforeEach(() => {
  jest.useFakeTimers();
  mockWatcherInstances.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("FileWatcher", () => {
  describe("handler registration", () => {
    it("registers an event handler", () => {
      const watcher = new FileWatcher(makeConfig());
      const handler = jest.fn();
      watcher.on(handler);
      // No error — handler stored internally
      expect(handler).not.toHaveBeenCalled();
    });

    it("supports multiple handlers", () => {
      const watcher = new FileWatcher(makeConfig());
      const h1 = jest.fn();
      const h2 = jest.fn();
      watcher.on(h1);
      watcher.on(h2);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  describe("start()", () => {
    it("creates watchers for each workspace path", () => {
      const chokidar = require("chokidar");
      const watcher = new FileWatcher(makeConfig({ workspacePaths: ["/a", "/b"] }));
      watcher.start();
      // 2 workspaces × 1 watcher each (tasks) = 2
      expect(chokidar.watch).toHaveBeenCalledTimes(2);
    });

    it("watches .instructions/tasks/*.md", () => {
      const chokidar = require("chokidar");
      const watcher = new FileWatcher(makeConfig());
      watcher.start();

      const firstCallPath = chokidar.watch.mock.calls[0][0];
      expect(firstCallPath).toContain(".instructions");
      expect(firstCallPath).toContain("tasks");
      expect(firstCallPath).toContain("*.md");
    });

  });

  describe("debounced event emission", () => {
    it("emits task_update when a task file changes", () => {
      const handler = jest.fn();
      const watcher = new FileWatcher(makeConfig(), 100);
      watcher.on(handler);
      watcher.start();

      // The first mockWatcherInstance is the task file watcher
      const taskWatcher = mockWatcherInstances[0];
      taskWatcher.simulateEvent("all", "change", "/test/workspace/.instructions/tasks/t-001.md");

      jest.advanceTimersByTime(150);

      expect(handler).toHaveBeenCalledTimes(1);
      const event: TrackerEvent = handler.mock.calls[0][0];
      expect(event.type).toBe("task_update");
      expect(event.data).toMatchObject({
        event: "change",
        path: "/test/workspace/.instructions/tasks/t-001.md",
      });
    });

    it("debounces rapid events into a single emission", () => {
      const handler = jest.fn();
      const watcher = new FileWatcher(makeConfig(), 200);
      watcher.on(handler);
      watcher.start();

      const taskWatcher = mockWatcherInstances[0];
      const filePath = "/test/workspace/.instructions/tasks/t-001.md";

      // Fire 5 events in quick succession for the SAME file
      for (let i = 0; i < 5; i++) {
        taskWatcher.simulateEvent("all", "change", filePath);
        jest.advanceTimersByTime(50); // only 50ms between each
      }

      // Should still not have fired (last event was 50ms ago, debounce is 200ms)
      expect(handler).not.toHaveBeenCalled();

      // Advance past debounce
      jest.advanceTimersByTime(200);

      // Only 1 event emitted despite 5 file change events
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not debounce events for different files", () => {
      const handler = jest.fn();
      const watcher = new FileWatcher(makeConfig(), 100);
      watcher.on(handler);
      watcher.start();

      const taskWatcher = mockWatcherInstances[0];

      taskWatcher.simulateEvent("all", "change", "/test/workspace/.instructions/tasks/t-001.md");
      taskWatcher.simulateEvent("all", "change", "/test/workspace/.instructions/tasks/t-002.md");

      jest.advanceTimersByTime(150);

      // Both should fire — different debounce keys
      expect(handler).toHaveBeenCalledTimes(2);
    });

  });

  describe("handler error isolation", () => {
    it("continues calling other handlers if one throws", () => {
      const badHandler = jest.fn(() => {
        throw new Error("boom");
      });
      const goodHandler = jest.fn();

      const watcher = new FileWatcher(makeConfig(), 50);
      watcher.on(badHandler);
      watcher.on(goodHandler);
      watcher.start();

      const taskWatcher = mockWatcherInstances[0];
      taskWatcher.simulateEvent("all", "add", "/test/workspace/.instructions/tasks/t-001.md");

      jest.advanceTimersByTime(100);

      expect(badHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop()", () => {
    it("closes all chokidar watchers", async () => {
      const watcher = new FileWatcher(makeConfig());
      watcher.start();

      expect(mockWatcherInstances).toHaveLength(1);
      expect(mockWatcherInstances[0].closed).toBe(false);

      await watcher.stop();

      expect(mockWatcherInstances[0].closed).toBe(true);
    });

    it("clears pending debounce timers", async () => {
      const handler = jest.fn();
      const watcher = new FileWatcher(makeConfig(), 5000);
      watcher.on(handler);
      watcher.start();

      const taskWatcher = mockWatcherInstances[0];
      taskWatcher.simulateEvent("all", "change", "/test/workspace/.instructions/tasks/t-001.md");

      // Stop before debounce fires
      await watcher.stop();

      // Advance past what would have been the debounce window
      jest.advanceTimersByTime(6000);

      // Handler should NOT have been called — timers were cleared
      expect(handler).not.toHaveBeenCalled();
    });

    it("is idempotent (safe to call twice)", async () => {
      const watcher = new FileWatcher(makeConfig());
      watcher.start();

      await watcher.stop();
      await watcher.stop(); // should not throw
    });
  });
});
