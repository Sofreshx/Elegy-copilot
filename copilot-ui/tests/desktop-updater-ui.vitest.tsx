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

describe('desktop updater shell action (titlebar)', () => {
  it('renders download button when canDownload is true', async () => {
    const { default: DesktopUpdaterShellAction } = await import('../ui/src/components/DesktopUpdaterShellAction');
    render(<DesktopUpdaterShellAction canDownload canRestartToUpdate={false} />);
    expect(screen.getByTestId('desktop-updater-shell-action')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-updater-download')).toHaveTextContent('Update');
    expect(screen.queryByTestId('desktop-updater-restart')).not.toBeInTheDocument();
  });

  it('renders nothing when no update is actionable', async () => {
    const { default: DesktopUpdaterShellAction } = await import('../ui/src/components/DesktopUpdaterShellAction');
    const { container } = render(<DesktopUpdaterShellAction canDownload={false} canRestartToUpdate={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders install button when canRestartToUpdate is true', async () => {
    const { default: DesktopUpdaterShellAction } = await import('../ui/src/components/DesktopUpdaterShellAction');
    render(<DesktopUpdaterShellAction canDownload={false} canRestartToUpdate />);
    expect(screen.getByTestId('desktop-updater-shell-action')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-updater-restart')).toHaveTextContent('Install');
  });
});

describe('AppLayout titlebar shell', () => {
  it('renders custom titlebar with window controls', async () => {
    const { default: AppLayout } = await import('../ui/src/components/AppLayout');
    render(
      <AppLayout appVersion="1.0.0" sidebar={<div />}>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    // Version footer should always render now
    expect(screen.getByTestId('app-version-footer')).toBeInTheDocument();
  });

  it('renders desktop updater shell action only when updater props are actionable', async () => {
    const { default: AppLayout } = await import('../ui/src/components/AppLayout');
    render(
      <AppLayout appVersion="1.0.0" sidebar={<div />} canDownload>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.getByTestId('desktop-updater-shell-action')).toBeInTheDocument();
  });
});
