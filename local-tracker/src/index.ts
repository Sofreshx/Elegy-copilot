import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();
  console.log("[Tracker] Starting local agent tracker...");
  console.log(`[Tracker] Watching: ${config.workspacePaths.join(", ")}`);
  console.log(`[Tracker] Relay: ${config.relayUrl || "not configured"}`);

  // TODO: Initialize watchers (e3t-015)
  // TODO: Initialize git monitor (e3t-016)
  // TODO: Connect to relay (e3t-017)

  console.log("[Tracker] Ready");

  // Keep alive
  process.on("SIGINT", () => {
    console.log("[Tracker] Shutting down...");
    process.exit(0);
  });
}

main().catch(console.error);
