import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { TrackerConfig } from "./config";
import { GitSnapshot, TrackerEvent } from "./types";

const execAsync = promisify(exec);

export type GitEventHandler = (event: TrackerEvent) => void;

export class GitMonitor {
  private config: TrackerConfig;
  private handlers: GitEventHandler[] = [];
  private pollTimer?: NodeJS.Timeout;
  private lastSnapshots: Map<string, GitSnapshot> = new Map();

  constructor(config: TrackerConfig) {
    this.config = config;
  }

  /** Run a git command and return stdout. Override in tests. */
  protected async runCommand(cmd: string, cwd: string): Promise<string> {
    const { stdout } = await execAsync(cmd, { cwd });
    return stdout;
  }

  on(handler: GitEventHandler): void {
    this.handlers.push(handler);
  }

  /** Start periodic git status polling */
  start(): void {
    this.pollTimer = setInterval(() => {
      this.checkAll().catch(console.error);
    }, this.config.watchIntervalMs);

    // Initial check
    this.checkAll().catch(console.error);
    console.log(
      `[GitMonitor] Started polling ${this.config.workspacePaths.length} repo(s) every ${this.config.watchIntervalMs}ms`
    );
  }

  /** Check all workspaces */
  async checkAll(): Promise<GitSnapshot[]> {
    const snapshots: GitSnapshot[] = [];
    for (const repoPath of this.config.workspacePaths) {
      try {
        const snapshot = await this.getSnapshot(repoPath);
        if (snapshot) {
          snapshots.push(snapshot);
          this.checkForChanges(repoPath, snapshot);
        }
      } catch {
        // Not a git repo or git not available
      }
    }
    return snapshots;
  }

  /** Get git snapshot for a repo */
  async getSnapshot(repoPath: string): Promise<GitSnapshot | null> {
    try {
      const branch = await this.getCurrentBranch(repoPath);
      const status = await this.getStatus(repoPath);
      const { ahead, behind } = await this.getAheadBehind(repoPath);

      return {
        repo: path.basename(repoPath),
        branch,
        ahead,
        behind,
        modified: status.modified,
        untracked: status.untracked,
        lastChecked: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /** Get current branch name */
  async getCurrentBranch(repoPath: string): Promise<string> {
    const stdout = await this.runCommand("git rev-parse --abbrev-ref HEAD", repoPath);
    return stdout.trim();
  }

  /** Get file status counts */
  async getStatus(
    repoPath: string
  ): Promise<{ modified: number; untracked: number; staged: number }> {
    const stdout = await this.runCommand("git status --porcelain", repoPath);
    const lines = stdout
      .split("\n")
      .filter((l) => l.length >= 2);

    let modified = 0,
      untracked = 0,
      staged = 0;
    for (const line of lines) {
      const indexStatus = line[0];
      const workStatus = line[1];
      if (indexStatus === "?" && workStatus === "?") untracked++;
      else if (indexStatus !== " " && indexStatus !== "?") staged++;
      if (workStatus === "M" || workStatus === "D") modified++;
    }

    return { modified, untracked, staged };
  }

  /** Get ahead/behind counts relative to upstream */
  async getAheadBehind(
    repoPath: string
  ): Promise<{ ahead: number; behind: number }> {
    try {
      const stdout = await this.runCommand(
        "git rev-list --left-right --count HEAD...@{upstream}",
        repoPath
      );
      const [ahead, behind] = stdout
        .trim()
        .split(/\s+/)
        .map(Number);
      return { ahead: ahead || 0, behind: behind || 0 };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  /** Check if snapshot changed from last known state */
  private checkForChanges(repoPath: string, current: GitSnapshot): void {
    const last = this.lastSnapshots.get(repoPath);
    this.lastSnapshots.set(repoPath, current);

    if (!last) return; // First check, no comparison

    const changed =
      last.branch !== current.branch ||
      last.modified !== current.modified ||
      last.untracked !== current.untracked ||
      last.ahead !== current.ahead ||
      last.behind !== current.behind;

    if (changed) {
      this.emit({
        type: "git_update",
        timestamp: new Date().toISOString(),
        data: current,
      });
    }
  }

  private emit(event: TrackerEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[GitMonitor] Handler error:", error);
      }
    }
  }

  /** Stop polling */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    console.log("[GitMonitor] Stopped");
  }
}
