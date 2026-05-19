import { loadConfig } from "./config";
import { FileWatcher } from "./watchers";
import { GitMonitor } from "./gitMonitor";
import { StatusServer } from "./statusServer";
import { TrackerAuth } from "./auth";
import { ObsidianMonitor } from "./obsidianMonitor";

async function main() {
  const config = loadConfig();
  const auth = new TrackerAuth();
  const resolvedCredentials = await auth.resolve();
  if (resolvedCredentials?.relayToken) {
    config.relayToken = resolvedCredentials.relayToken;
    config.relayTokenSource = resolvedCredentials.source;
  }
  const relayTokenReadiness = auth.evaluateTokenReadiness(config.relayToken, config.relayTokenSource);

  console.log("[Tracker] Starting local agent tracker...");
  console.log(`[Tracker] Watching: ${config.workspacePaths.join(", ")}`);
  console.log(`[Tracker] Relay: ${config.relayUrl || "not configured"}`);
  console.log(`[Tracker] Relay token readiness: ${relayTokenReadiness.state} (${relayTokenReadiness.reasonCode})`);

  // Initialize status dashboard
  const statusServer = new StatusServer(config, {
    relayTokenReadiness,
  });
  await statusServer.start();

  // Initialize watchers
  const watcher = new FileWatcher(config);
  watcher.on((event) => {
    console.log(`[Tracker] Event: ${event.type}`, JSON.stringify(event.data));
    statusServer.pushEvent(event);
  });
  watcher.start();

  const obsidianMonitor = new ObsidianMonitor(config);
  obsidianMonitor.on((event) => {
    console.log(`[Tracker] Obsidian event: ${event.type}`, JSON.stringify(event.data));
    statusServer.pushEvent(event);
  });
  obsidianMonitor.start();

  // Initialize git monitor
  const gitMonitor = new GitMonitor(config);
  gitMonitor.on((event) => {
    console.log(`[Tracker] Git event:`, JSON.stringify(event.data));
    statusServer.pushEvent(event);
    // Update git snapshots from the monitor's latest check
    gitMonitor.checkAll().then((snapshots) => {
      statusServer.updateGitSnapshots(snapshots);
    }).catch(() => {});
  });
  gitMonitor.start();

  console.log("[Tracker] Ready");

  // Keep alive
  process.on("SIGINT", async () => {
    console.log("[Tracker] Shutting down...");
    gitMonitor.stop();
    await obsidianMonitor.stop();
    await watcher.stop();
    await statusServer.stop();
    process.exit(0);
  });
}

main().catch(console.error);
