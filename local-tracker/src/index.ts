import { loadConfig } from "./config";
import { FileWatcher } from "./watchers";
import { GitMonitor } from "./gitMonitor";
import { ExtensionBridge } from "./extensionBridge";
import { StatusServer } from "./statusServer";

async function main() {
  const config = loadConfig();
  console.log("[Tracker] Starting local agent tracker...");
  console.log(`[Tracker] Watching: ${config.workspacePaths.join(", ")}`);
  console.log(`[Tracker] Relay: ${config.relayUrl || "not configured"}`);

  // Initialize extension bridge (e3t-017)
  const bridge = new ExtensionBridge(config);
  bridge.start();

  // Initialize status dashboard (e3t-018)
  const statusServer = new StatusServer(config);
  await statusServer.start();

  // Initialize watchers (e3t-015)
  const watcher = new FileWatcher(config);
  watcher.on((event) => {
    console.log(`[Tracker] Event: ${event.type}`, JSON.stringify(event.data));
    bridge.broadcast(event);
    statusServer.pushEvent(event);
    statusServer.updateExtensionCount(bridge.getClientCount());
  });
  watcher.start();

  // Initialize git monitor (e3t-016)
  const gitMonitor = new GitMonitor(config);
  gitMonitor.on((event) => {
    console.log(`[Tracker] Git event:`, JSON.stringify(event.data));
    bridge.broadcast(event);
    statusServer.pushEvent(event);
    // Update git snapshots from the monitor's latest check
    gitMonitor.checkAll().then((snapshots) => {
      statusServer.updateGitSnapshots(snapshots);
    }).catch(() => {});
    statusServer.updateExtensionCount(bridge.getClientCount());
  });
  gitMonitor.start();

  console.log("[Tracker] Ready");

  // Keep alive
  process.on("SIGINT", async () => {
    console.log("[Tracker] Shutting down...");
    gitMonitor.stop();
    await watcher.stop();
    await bridge.stop();
    await statusServer.stop();
    process.exit(0);
  });
}

main().catch(console.error);
