import { GitMonitor } from "../gitMonitor";
import { TrackerConfig } from "../config";
import { TrackerEvent, GitSnapshot } from "../types";

/** Testable subclass that overrides runCommand */
class TestableGitMonitor extends GitMonitor {
  public responses: Record<string, string> = {};

  protected async runCommand(cmd: string): Promise<string> {
    const key = Object.keys(this.responses).find((k) => cmd.includes(k));
    if (key !== undefined) return this.responses[key];
    throw new Error(`Unmocked command: ${cmd}`);
  }

  /** Replace mock responses */
  setResponses(map: Record<string, string>): void {
    this.responses = map;
  }
}

function makeConfig(overrides?: Partial<TrackerConfig>): TrackerConfig {
  return {
    workspacePaths: ["/fake/repo"],
    relayTokenSource: "missing",
    watchIntervalMs: 1000,
    statusPort: 0,
    obsidianNotePaths: [],
    obsidianPollIntervalMs: 1000,
    ...overrides,
  };
}

describe("GitMonitor", () => {
  let monitor: TestableGitMonitor;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (monitor) monitor.stop();
    jest.useRealTimers();
  });

  describe("getCurrentBranch", () => {
    it("parses branch name from git output", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "rev-parse --abbrev-ref": "main\n" });

      const branch = await monitor.getCurrentBranch("/fake/repo");
      expect(branch).toBe("main");
    });

    it("trims whitespace", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "rev-parse --abbrev-ref": "  feature/my-branch  \n" });

      const branch = await monitor.getCurrentBranch("/fake/repo");
      expect(branch).toBe("feature/my-branch");
    });

    it("rejects when git fails", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({});

      await expect(monitor.getCurrentBranch("/fake/repo")).rejects.toThrow("Unmocked command");
    });
  });

  describe("getStatus", () => {
    it("counts modified, untracked, and staged files", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      const porcelain = [
        " M src/file1.ts",  // work=M -> modified
        "M  src/file2.ts",  // index=M -> staged
        "?? newfile.txt",   // untracked
        "A  added.ts",      // index=A -> staged
        "MM both.ts",       // index=M -> staged, work=M -> modified
      ].join("\n");
      monitor.setResponses({ "status --porcelain": porcelain });

      const status = await monitor.getStatus("/fake/repo");

      expect(status.modified).toBe(2);
      expect(status.untracked).toBe(1);
      expect(status.staged).toBe(3);
    });

    it("returns zeros for clean repo", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "status --porcelain": "" });

      const status = await monitor.getStatus("/fake/repo");
      expect(status.modified).toBe(0);
      expect(status.untracked).toBe(0);
      expect(status.staged).toBe(0);
    });

    it("counts deleted files as modified", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "status --porcelain": " D deleted.ts\n" });

      const status = await monitor.getStatus("/fake/repo");
      expect(status.modified).toBe(1);
    });
  });

  describe("getAheadBehind", () => {
    it("parses ahead and behind counts", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "rev-list --left-right": "3\t5\n" });

      const result = await monitor.getAheadBehind("/fake/repo");
      expect(result.ahead).toBe(3);
      expect(result.behind).toBe(5);
    });

    it("returns zeros when no upstream", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({});

      const result = await monitor.getAheadBehind("/fake/repo");
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });

    it("returns zeros for in-sync repo", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({ "rev-list --left-right": "0\t0\n" });

      const result = await monitor.getAheadBehind("/fake/repo");
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });
  });

  describe("getSnapshot", () => {
    it("returns a complete GitSnapshot", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "develop\n",
        "status --porcelain": " M file.ts\n?? new.txt\n",
        "rev-list --left-right": "2\t1\n",
      });

      const snapshot = await monitor.getSnapshot("/fake/repo");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.repo).toBe("repo");
      expect(snapshot!.branch).toBe("develop");
      expect(snapshot!.modified).toBe(1);
      expect(snapshot!.untracked).toBe(1);
      expect(snapshot!.ahead).toBe(2);
      expect(snapshot!.behind).toBe(1);
      expect(snapshot!.lastChecked).toBeDefined();
    });

    it("returns null when git commands fail", async () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({});

      const snapshot = await monitor.getSnapshot("/not-a-repo");
      expect(snapshot).toBeNull();
    });
  });

  describe("change detection", () => {
    it("emits git_update when status changes between polls", async () => {
      const events: TrackerEvent[] = [];
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });
      monitor.on((e) => events.push(e));

      // First poll — baseline
      await monitor.checkAll();
      expect(events).toHaveLength(0);

      // Second poll — same data
      await monitor.checkAll();
      expect(events).toHaveLength(0);

      // Third poll — modified count changed
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": " M changed.ts\n",
        "rev-list --left-right": "0\t0\n",
      });
      await monitor.checkAll();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("git_update");
      expect((events[0].data as GitSnapshot).modified).toBe(1);
    });

    it("emits git_update when branch changes", async () => {
      const events: TrackerEvent[] = [];
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });
      monitor.on((e) => events.push(e));

      await monitor.checkAll();

      // Branch changed
      monitor.setResponses({
        "rev-parse --abbrev-ref": "feature/new\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });
      await monitor.checkAll();

      expect(events).toHaveLength(1);
      expect((events[0].data as GitSnapshot).branch).toBe("feature/new");
    });

    it("does not emit when nothing changes", async () => {
      const events: TrackerEvent[] = [];
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": " M file.ts\n",
        "rev-list --left-right": "1\t0\n",
      });
      monitor.on((e) => events.push(e));

      await monitor.checkAll();
      await monitor.checkAll();
      await monitor.checkAll();

      expect(events).toHaveLength(0);
    });
  });

  describe("start / stop", () => {
    it("stop clears the interval", () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });

      monitor.start();
      expect(jest.getTimerCount()).toBe(1);

      monitor.stop();
      expect(jest.getTimerCount()).toBe(0);
    });

    it("start triggers immediate checkAll", () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });

      const spy = jest.spyOn(monitor, "checkAll");
      monitor.start();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("polling interval fires checkAll periodically", () => {
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });

      const spy = jest.spyOn(monitor, "checkAll");
      monitor.start();

      jest.advanceTimersByTime(1000);
      // 1 initial + 1 interval = 2
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("skips repos that are not git repos", async () => {
      monitor = new TestableGitMonitor(
        makeConfig({ workspacePaths: ["/not-git", "/also-not-git"] })
      );
      monitor.setResponses({});

      const snapshots = await monitor.checkAll();
      expect(snapshots).toHaveLength(0);
    });

    it("handler errors do not break other handlers", async () => {
      const goodEvents: TrackerEvent[] = [];
      monitor = new TestableGitMonitor(makeConfig());
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": "",
        "rev-list --left-right": "0\t0\n",
      });

      monitor.on(() => {
        throw new Error("bad handler");
      });
      monitor.on((e) => goodEvents.push(e));

      // First poll — baseline
      await monitor.checkAll();

      // Second poll — trigger change
      monitor.setResponses({
        "rev-parse --abbrev-ref": "main\n",
        "status --porcelain": " M file.ts\n",
        "rev-list --left-right": "0\t0\n",
      });
      await monitor.checkAll();

      expect(goodEvents).toHaveLength(1);
    });
  });
});
