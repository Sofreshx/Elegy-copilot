import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopUpdaterState } from '../ui/src/lib/types';

const updaterState = vi.hoisted(() => ({
  value: null as DesktopUpdaterState | null,
}));

const updaterStoreMock = vi.hoisted(() => ({
  getState: vi.fn(() => updaterState.value),
  subscribe: vi.fn(() => () => {}),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  restartToUpdate: vi.fn(),
}));

vi.mock('../ui/src/stores/desktopUpdaterStore', () => ({
  desktopUpdaterStore: updaterStoreMock,
}));

function createUpdaterState(overrides: Partial<DesktopUpdaterState> = {}): DesktopUpdaterState {
  return {
    supported: true,
    status: 'idle',
    channel: 'stable',
    currentVersion: '1.0.1',
    availableVersion: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    message: 'Automatic checks are enabled.',
    reason: null,
    lastUpdatedAtMs: Date.now(),
    canCheckForUpdates: true,
    canDownload: false,
    canRestartToUpdate: false,
    ...overrides,
  };
}

describe('desktop updater UI affordances', () => {
  beforeEach(() => {
    updaterStoreMock.checkForUpdates.mockReset();
    updaterStoreMock.downloadUpdate.mockReset();
    updaterStoreMock.restartToUpdate.mockReset();
  });

  it('shows update button when update is available to download', async () => {
    const { default: StatusBar } = await import('../ui/src/components/StatusBar');
    render(<StatusBar
      desktopUpdaterTone="warn"
      desktopUpdaterSummary="New version available."
      canDownload
      canRestartToUpdate={false}
      onDownloadUpdate={() => undefined}
      onRestartToUpdate={() => undefined}
    />);
    expect(screen.getByTestId('status-bar-updater')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-updater-download')).toHaveTextContent('Update');
    expect(screen.queryByTestId('desktop-updater-restart')).not.toBeInTheDocument();
  });

  it('hides updater content when no actionable update is available', async () => {
    const { default: StatusBar } = await import('../ui/src/components/StatusBar');
    render(<StatusBar
      desktopUpdaterTone="ok"
      desktopUpdaterSummary="You're on the latest version."
      canDownload={false}
      canRestartToUpdate={false}
      onDownloadUpdate={() => undefined}
      onRestartToUpdate={() => undefined}
    />);
    expect(screen.queryByTestId('status-bar-updater')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desktop-updater-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desktop-updater-restart')).not.toBeInTheDocument();
  });

  it('shows install button when update is ready to install', async () => {
    const { default: StatusBar } = await import('../ui/src/components/StatusBar');
    render(<StatusBar
      desktopUpdaterTone="ok"
      desktopUpdaterSummary="Update is ready."
      canDownload={false}
      canRestartToUpdate
      onDownloadUpdate={() => undefined}
      onRestartToUpdate={() => undefined}
    />);
    expect(screen.getByTestId('status-bar-updater')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-updater-restart')).toHaveTextContent('Install');
    expect(screen.queryByTestId('desktop-updater-download')).not.toBeInTheDocument();
  });

  it('shows update action only when an update is available on the maintenance card', async () => {
    updaterState.value = createUpdaterState({
      status: 'available',
      availableVersion: '1.0.2',
      canDownload: true,
      canCheckForUpdates: true,
    });

    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');
    render(<UpdatesSection />);

    expect(screen.queryByTestId('updates-app-check')).not.toBeInTheDocument();
    expect(screen.getByTestId('updates-app-download')).toHaveTextContent('Update');
  });

  it('shows no app action on the maintenance card while idle and auto-checking', async () => {
    updaterState.value = createUpdaterState({
      status: 'idle',
      canDownload: false,
      canRestartToUpdate: false,
      canCheckForUpdates: true,
    });

    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');
    render(<UpdatesSection />);

    expect(screen.queryByTestId('updates-app-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('updates-app-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('updates-app-restart')).not.toBeInTheDocument();
  });
});
