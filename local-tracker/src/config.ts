export interface TrackerConfig {
  workspacePaths: string[];
  relayUrl?: string;
  relayToken?: string;
  localWsPort: number;
  watchIntervalMs: number;
  e3DbPath?: string;
  statusPort: number;
}

export function loadConfig(): TrackerConfig {
  return {
    workspacePaths: (process.env.TRACKER_WORKSPACE_PATHS || ".").split(",").map(p => p.trim()),
    relayUrl: process.env.TRACKER_RELAY_URL,
    relayToken: process.env.TRACKER_RELAY_TOKEN,
    localWsPort: parseInt(process.env.TRACKER_WS_PORT || "9821", 10),
    watchIntervalMs: parseInt(process.env.TRACKER_WATCH_INTERVAL || "2000", 10),
    e3DbPath: process.env.TRACKER_E3_DB_PATH,
    statusPort: parseInt(process.env.TRACKER_STATUS_PORT || "9822", 10),
  };
}
