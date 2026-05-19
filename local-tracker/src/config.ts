export const TRACKER_TOKEN_READINESS_CONTRACT_VERSION = 1;

export type TrackerTokenReadinessState = "ready" | "missing" | "invalid" | "expired";
export type TrackerTokenReadinessReasonCode =
  | "relay_token_valid"
  | "relay_token_missing"
  | "relay_token_invalid"
  | "relay_token_expired";
export type TrackerRelayTokenSource = "env" | "keychain" | "manual" | "config" | "missing" | "unknown";

export interface TrackerTokenReadinessV1 {
  contractVersion: typeof TRACKER_TOKEN_READINESS_CONTRACT_VERSION;
  state: TrackerTokenReadinessState;
  reasonCode: TrackerTokenReadinessReasonCode;
  deterministic: true;
  source: TrackerRelayTokenSource;
}

export interface TrackerConfig {
  workspacePaths: string[];
  relayUrl?: string;
  relayToken?: string;
  relayTokenSource: TrackerRelayTokenSource;
  watchIntervalMs: number;
  statusPort: number;
  obsidianNotePaths: string[];
  obsidianSyncStatusPath?: string;
  obsidianPollIntervalMs: number;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadConfig(): TrackerConfig {
  const relayToken = normalizeOptionalString(process.env.TRACKER_RELAY_TOKEN);
  const obsidianNotePaths = (process.env.TRACKER_OBSIDIAN_NOTE_PATHS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const obsidianSyncStatusPath = normalizeOptionalString(process.env.TRACKER_OBSIDIAN_SYNC_STATUS_PATH);

  return {
    workspacePaths: (process.env.TRACKER_WORKSPACE_PATHS || ".").split(",").map(p => p.trim()),
    relayUrl: process.env.TRACKER_RELAY_URL,
    relayToken,
    relayTokenSource: relayToken ? "env" : "missing",
    watchIntervalMs: parseInt(process.env.TRACKER_WATCH_INTERVAL || "2000", 10),
    statusPort: parseInt(process.env.TRACKER_STATUS_PORT || "9822", 10),
    obsidianNotePaths,
    obsidianSyncStatusPath,
    obsidianPollIntervalMs: parseInt(process.env.TRACKER_OBSIDIAN_POLL_INTERVAL || process.env.TRACKER_WATCH_INTERVAL || "2000", 10),
  };
}
