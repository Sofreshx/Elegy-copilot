import type { DesktopUpdaterState } from './types';

export type DesktopUpdaterTone = 'ok' | 'warn' | 'loading' | 'error';

export interface DesktopUpdaterPresentation {
  tone: DesktopUpdaterTone;
  summary: string;
}

const BLOCKED_REASON_SUMMARIES: Record<string, string> = {
  candidate_version_above_channel_ceiling: 'Updates are temporarily paused while this release channel is held back.',
  current_version_below_minimum_safe: 'This build is below the minimum safe version for self-updates.',
  desktop_bridge_unavailable: 'Desktop updates are unavailable in this runtime.',
  desktop_updater_bridge_error: 'Desktop updates are unavailable because the desktop bridge failed.',
  github_release_artifact_missing: 'Desktop updates are paused because the published signed update artifact is incomplete.',
  github_release_channel_mismatch: 'Desktop updates are paused because the published release channel metadata is inconsistent.',
  github_release_manifest_invalid: 'Desktop updates are paused because the published release metadata is invalid.',
  github_release_manifest_missing: 'Desktop updates are paused because the latest release is missing its manifest metadata.',
  publish_repository_unavailable: 'Desktop updates are unavailable because the publish repository is not configured.',
  release_draft_unavailable: 'Desktop updates are paused because the latest published release is still a draft.',
  rollback_policy_malformed: 'Updates are temporarily paused because release policy data is invalid.',
  rollback_policy_source_unavailable: 'Updates are temporarily paused until release policy data is available.',
  tauri_updater_error: 'Desktop updates are paused because the signed updater failed.',
  update_channel_invalid: 'Updates are blocked because the configured desktop update channel is invalid.',
  updater_module_unavailable: 'Desktop updates are unavailable in this build.',
  updates_disabled_globally: 'Updates are temporarily paused by release policy.',
};

function isKnownVersion(version: string | null | undefined): boolean {
  const normalized = String(version || '').trim();
  return normalized.length > 0 && normalized !== 'unknown';
}

function formatTargetLabel(state: DesktopUpdaterState): string {
  return isKnownVersion(state.availableVersion) ? `Version ${state.availableVersion}` : 'An update';
}

function formatProgressPercent(percent: number | null): string | null {
  if (!Number.isFinite(percent)) {
    return null;
  }

  const rounded = Math.round((percent || 0) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function summarizeBlockedState(state: DesktopUpdaterState): string {
  if (state.reason && BLOCKED_REASON_SUMMARIES[state.reason]) {
    return BLOCKED_REASON_SUMMARIES[state.reason];
  }

  if (state.message && state.message.trim()) {
    return state.message;
  }

  return 'Updates are currently blocked.';
}

export function getDesktopUpdaterPresentation(state: DesktopUpdaterState): DesktopUpdaterPresentation {
  switch (state.status) {
    case 'error':
      return {
        tone: 'error',
        summary: state.message?.trim() || 'The desktop updater hit an unexpected error.',
      };
    case 'downloaded':
      return {
        tone: 'ok',
        summary: `${formatTargetLabel(state)} was installed by the signed updater.`,
      };
    case 'available':
      return {
        tone: 'warn',
        summary: `New version available: ${isKnownVersion(state.availableVersion) ? state.availableVersion : 'update ready'}. Install signed update.`,
      };
    case 'downloading': {
      const progress = formatProgressPercent(state.progressPercent);
      return {
        tone: 'loading',
        summary: progress
          ? `Installing signed update for ${formatTargetLabel(state).toLowerCase()} (${progress}).`
          : `Installing signed update for ${formatTargetLabel(state).toLowerCase()}.`,
      };
    }
    case 'checking':
      return {
        tone: 'loading',
        summary: 'Checking for updates...',
      };
    case 'up-to-date':
      return {
        tone: 'ok',
        summary: isKnownVersion(state.currentVersion)
          ? `You're on the latest version (${state.currentVersion}).`
          : 'You are on the latest version.',
      };
    case 'blocked':
      return {
        tone: 'warn',
        summary: summarizeBlockedState(state),
      };
    case 'idle':
    default:
      return {
        tone: 'warn',
        summary: 'Signed update checks are enabled.',
      };
  }
}
