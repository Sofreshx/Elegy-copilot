import fs from "fs";
import os from "os";
import path from "path";
import { ObsidianMonitor } from "../obsidianMonitor";
import { TrackerConfig } from "../config";

function makeConfig(tmpRoot: string, overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    workspacePaths: [tmpRoot],
    relayTokenSource: "missing",
    localWsPort: 9821,
    watchIntervalMs: 2000,
    statusPort: 0,
    obsidianNotePaths: [],
    obsidianPollIntervalMs: 250,
    obsidianSyncStatusPath: path.join(tmpRoot, "obsidian-sync", "status.json"),
    ...overrides,
  };
}

describe("ObsidianMonitor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("emits obsidian_note_update when a tracked note changes", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-obsidian-note-"));
    const notePath = path.join(tmpRoot, "daily-note.md");
    fs.writeFileSync(notePath, "# Note\n", "utf8");

    const monitor = new ObsidianMonitor(makeConfig(tmpRoot, {
      obsidianNotePaths: [notePath],
    }));
    const handler = jest.fn();
    monitor.on(handler);
    monitor.start();

    fs.writeFileSync(notePath, "# Note\n\nUpdated\n", "utf8");
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: "obsidian_note_update",
      data: expect.objectContaining({
        path: notePath.replace(/\\/g, "/"),
        exists: true,
      }),
    }));

    await monitor.stop();
  });

  it("emits obsidian_sync_update when the shared sync status file changes", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-obsidian-sync-"));
    const syncStatusPath = path.join(tmpRoot, "obsidian-sync", "status.json");
    fs.mkdirSync(path.dirname(syncStatusPath), { recursive: true });
    fs.writeFileSync(syncStatusPath, JSON.stringify({ repos: {} }, null, 2), "utf8");

    const monitor = new ObsidianMonitor(makeConfig(tmpRoot));
    const handler = jest.fn();
    monitor.on(handler);
    monitor.start();

    fs.writeFileSync(syncStatusPath, JSON.stringify({
      repos: {
        abc123: {
          state: "success",
        },
      },
    }, null, 2), "utf8");
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: "obsidian_sync_update",
      data: expect.objectContaining({
        path: syncStatusPath.replace(/\\/g, "/"),
        exists: true,
      }),
    }));

    await monitor.stop();
  });
});
