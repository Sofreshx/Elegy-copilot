import type { SdkHealthResponse, SessionSummary } from './types';

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function resolveRawSessionStatus(session: SessionSummary): string {
  if (typeof session.resolvedStatus === 'string' && session.resolvedStatus.trim()) {
    return session.resolvedStatus.trim().toLowerCase();
  }

  if (typeof session.status === 'string' && session.status.trim()) {
    return session.status.trim().toLowerCase();
  }

  return '';
}

function hasLiveRuntimeEvidence(session: SessionSummary, rawStatus = resolveRawSessionStatus(session)): boolean {
  if (typeof session.active === 'boolean') {
    return session.active;
  }

  const reconciliation = readRecord(session.reconciliation);
  return reconciliation.hasRuntimeState === true && rawStatus === 'active';
}

export function humanizeToken(value: unknown, fallback = 'Unknown'): string {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) {
    return fallback;
  }

  const words = token
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0);

  if (words.length === 0) {
    return fallback;
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function formatTimestampLabel(value: number | null): string {
  if (!value) {
    return 'Unknown';
  }

  return new Date(value).toLocaleString();
}

export function resolveSessionStatus(session: SessionSummary): string {
  const rawStatus = resolveRawSessionStatus(session);
  if (rawStatus) {
    if (rawStatus === 'active' && !hasLiveRuntimeEvidence(session, rawStatus)) {
      return 'unknown';
    }
    return rawStatus;
  }

  if (typeof session.active === 'boolean') {
    return session.active ? 'active' : 'inactive';
  }

  return 'unknown';
}

export function resolveSessionActiveLabel(session: SessionSummary): string {
  const rawStatus = resolveRawSessionStatus(session);
  if (hasLiveRuntimeEvidence(session, rawStatus)) {
    return 'true';
  }

  if (typeof session.active === 'boolean') {
    return 'false';
  }

  if (rawStatus === 'idle' || rawStatus === 'inactive' || rawStatus === 'missing') return 'false';
  return 'unknown';
}

export function resolveSessionStartedAt(session: SessionSummary): number | null {
  return toTimestamp(session.startedAtMs) ?? toTimestamp(session.startTime) ?? toTimestamp(session.startedAt) ?? null;
}

export function resolveSessionUpdatedAt(session: SessionSummary): number | null {
  return (
    toTimestamp(session.updatedAtMs) ??
    toTimestamp(session.lastEventTime) ??
    toTimestamp(session.updatedAt) ??
    toTimestamp(session.lastUpdatedAt) ??
    null
  );
}

export function resolveSessionSourceLabel(session: SessionSummary): string {
  const sourceSet = Array.isArray(session.resolvedSourceSet)
    ? session.resolvedSourceSet
    : Array.isArray(session.sources)
      ? session.sources
      : [];

  const normalized = sourceSet
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  if (normalized.length > 0) {
    return normalized.join(', ');
  }

  if (typeof session.source === 'string' && session.source.trim()) {
    return session.source.trim();
  }

  return 'unknown';
}

export function resolveSessionReason(session: SessionSummary): { code: string; label: string; message: string } {
  const reconciliation = readRecord(session.reconciliation);
  const reasonCode =
    (typeof reconciliation.reason === 'string' && reconciliation.reason.trim()) ||
    (typeof session.reconciliationReason === 'string' && session.reconciliationReason.trim()) ||
    (typeof reconciliation.resolvedStatus === 'string' && reconciliation.resolvedStatus.trim()) ||
    resolveSessionStatus(session);

  const normalizedCode = String(reasonCode).trim().toLowerCase() || 'unknown';
  const status = resolveSessionStatus(session);

  const knownMessages: Record<string, string> = {
    active: 'Session is currently active.',
    idle: 'Session has no recent events in the active window.',
    inactive: 'Session is currently inactive.',
    missing: 'Session activity is missing from the current authority source.',
    runtime_and_artifact: 'Runtime and persisted artifacts both report state.',
    runtime_only: 'Runtime state is available, persisted artifact state is missing.',
    artifact_only: 'State comes from persisted artifacts only.',
    artifact_fallback: 'No runtime signal; fallback uses persisted artifacts.',
  };

  const message = knownMessages[normalizedCode] || knownMessages[status] || `${humanizeToken(normalizedCode)}.`;

  return {
    code: normalizedCode,
    label: humanizeToken(normalizedCode),
    message,
  };
}

export function summarizeSdkHealth(
  health: SdkHealthResponse | null,
  error: string | null
): { status: string; detail: string } {
  if (error) {
    return {
      status: 'Error',
      detail: error,
    };
  }

  if (!health) {
    return {
      status: 'Checking',
      detail: 'Waiting for SDK health response.',
    };
  }

  if (health.state === 'disabled') {
    return {
      status: 'Disabled',
      detail: health.error || 'Set COPILOT_SDK_BRIDGE=1 to enable SDK sessions.',
    };
  }

  if (health.connected) {
    const sessionCount = Number.isFinite(health.sessionCount) ? Number(health.sessionCount) : 0;
    return {
      status: 'Connected',
      detail: `${sessionCount} session(s) registered with the SDK bridge.`,
    };
  }

  return {
    status: humanizeToken(health.state || 'disconnected'),
    detail: health.error || 'SDK bridge is reachable but not connected.',
  };
}

export function formatGatewaySegmentSummary(
  segment: Record<string, unknown> | null,
  fallbackStatus = 'unknown',
): { statusLabel: string; readinessLabel: string; detail?: string } {
  if (!segment) {
    return { statusLabel: fallbackStatus, readinessLabel: 'unavailable' };
  }

  const rawStatus = typeof segment.status === 'string' && segment.status.trim()
    ? segment.status
    : null;
  const ready = segment.ready === true;
  const error = typeof segment.error === 'string' && segment.error.trim()
    ? segment.error
    : undefined;

  return {
    statusLabel: humanizeToken(rawStatus, fallbackStatus),
    readinessLabel: ready ? 'ready' : 'not ready',
    ...(error ? { detail: error } : {}),
  };
}
