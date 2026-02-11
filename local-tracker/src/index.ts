import { loadConfig } from "./config";
import { FileWatcher } from "./watchers";
import { GitMonitor } from "./gitMonitor";

async function main() {
  const config = loadConfig();
  console.log("[Tracker] Starting local agent tracker...");
  console.log(`[Tracker] Watching: ${config.workspacePaths.join(", ")}`);
  console.log(`[Tracker] Relay: ${config.relayUrl || "not configured"}`);

  // Initialize watchers (e3t-015)
  const watcher = new FileWatcher(config);
  watcher.on((event) => {
    console.log(`[Tracker] Event: ${event.type}`, JSON.stringify(event.data));
  });
  watcher.start();

  // Initialize git monitor (e3t-016)
  const gitMonitor = new GitMonitor(config);
  gitMonitor.on((event) => {
    console.log(`[Tracker] Git event:`, JSON.stringify(event.data));
  });
  gitMonitor.start();

  // TODO: Connect to relay (e3t-017)

  console.log("[Tracker] Ready");

  // Keep alive
  process.on("SIGINT", async () => {
    console.log("[Tracker] Shutting down...");
    gitMonitor.stop();
    await watcher.stop();
    process.exit(0);
  });
}

main().catch(console.error);
