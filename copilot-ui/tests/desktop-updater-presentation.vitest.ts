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
  it('summarizes an available update with signed updater guidance', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'available',
      availableVersion: '1.2.4',
      canDownload: true,
    })).toEqual({
      tone: 'warn',
      summary: 'New version available: 1.2.4. Install signed update.',
    });
  });

  it('summarizes install progress with percentage when available', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'downloading',
      availableVersion: '1.2.4',
      progressPercent: 42.4,
    })).toEqual({
      tone: 'loading',
      summary: 'Installing signed update for version 1.2.4 (42.4%).',
    });
  });

  it('summarizes legacy downloaded state as already installed', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      status: 'downloaded',
      availableVersion: '1.2.4',
      canRestartToUpdate: true,
    })).toEqual({
      tone: 'ok',
      summary: 'Version 1.2.4 was installed by the signed updater.',
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

  it('maps signed updater failures to clear blocked copy', () => {
    expect(getDesktopUpdaterPresentation({
      ...BASE_STATE,
      supported: false,
      status: 'blocked',
      reason: 'tauri_updater_error',
      message: 'Signature validation failed.',
      canCheckForUpdates: false,
    })).toEqual({
      tone: 'warn',
      summary: 'Desktop updates are paused because the signed updater failed.',
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
