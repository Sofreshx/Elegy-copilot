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

  it('shows check action on the maintenance card while idle', async () => {
    updaterState.value = createUpdaterState({
      status: 'idle',
      canDownload: false,
      canRestartToUpdate: false,
      canCheckForUpdates: true,
    });

    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');
    render(<UpdatesSection />);

    expect(screen.getByTestId('updates-app-check')).toHaveTextContent('Check');
    expect(screen.queryByTestId('updates-app-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('updates-app-restart')).not.toBeInTheDocument();
  });

  it('shows disabled installing state while the signed updater is applying', async () => {
    updaterState.value = createUpdaterState({
      status: 'downloading',
      availableVersion: '1.0.2',
      canDownload: false,
      canRestartToUpdate: false,
      canCheckForUpdates: false,
    });

    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');
    render(<UpdatesSection />);

    expect(screen.getByTestId('updates-app-installing')).toHaveTextContent('Installing...');
    expect(screen.getByTestId('updates-app-installing')).toBeDisabled();
    expect(screen.queryByTestId('updates-app-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('updates-app-download')).not.toBeInTheDocument();
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

  it('does not render desktop updater shell action (removed from AppLayout)', async () => {
    const { default: AppLayout } = await import('../ui/src/components/AppLayout');
    render(
      <AppLayout appVersion="1.0.0" sidebar={<div />}>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.queryByTestId('desktop-updater-shell-action')).not.toBeInTheDocument();
  });
});
