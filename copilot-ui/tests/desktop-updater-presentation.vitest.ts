import { describe, expect, it } from 'vitest';

import { getDesktopUpdaterPresentation } from '../ui/src/lib/desktopUpdaterPresentation';
import type { DesktopUpdaterState } from '../ui/src/lib/types';

const BASE_STATE: DesktopUpdaterState = {
  supported: true,
  status: 'idle',
  channel: 'stable',
  currentVersion: '1.2.3',
  availableVersion: null,
  progressPercent: null,
  transferredBytes: null,
  totalBytes: null,
  message: null,
  reason: null,
  lastUpdatedAtMs: Date.now(),
  canCheckForUpdates: true,
  canDownload: false,
  canRestartToUpdate: false,
};

describe('getDesktopUpdaterPresentation', () => {
  it('summarizes an available update with download guidance', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'available',
      availableVersion: '1.2.4',
      canDownload: true,
    })).toEqual({
      tone: 'warn',
      summary: 'New version available: 1.2.4. Download to install.',
    });
  });

  it('summarizes download progress with percentage when available', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'downloading',
      availableVersion: '1.2.4',
      progressPercent: 42.4,
    })).toEqual({
      tone: 'loading',
      summary: 'Downloading version 1.2.4 (42.4%).',
    });
  });

  it('summarizes restart readiness after download completes', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'downloaded',
      availableVersion: '1.2.4',
      canRestartToUpdate: true,
    })).toEqual({
      tone: 'ok',
      summary: 'Version 1.2.4 is ready. Restart to finish installing it.',
    });
  });

  it('maps blocked policy reasons to friendly copy', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      supported: false,
      status: 'blocked',
      reason: 'rollback_policy_source_unavailable',
      message: 'Updates blocked: rollback_policy_source_unavailable',
      canCheckForUpdates: false,
    })).toEqual({
      tone: 'warn',
      summary: 'Updates are temporarily paused until release policy data is available.',
    });
  });

  it('shows the current version when already up to date', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'up-to-date',
    })).toEqual({
      tone: 'ok',
      summary: "You're on the latest version (1.2.3).",
    });
  });
});