import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
  enabled: true,
  pid: 1234,
  uptimeMs: 1000,
  status: {
    state: 'ready' as const,
    available: true,
    ready: true,
    phase: 'ready',
    reason: null,
    message: 'Discord remote sessions are connected.',
    runtime: 'node' as const,
    installUrl: null,
    guildIds: ['guild-1'],
    appId: 'app-1',
    dataDir: 'C:/Users/test/.elegy/kimaki',
    lastError: null,
  },
  projects: [{
    directory: 'C:/repo',
    guildId: 'guild-1',
    channelId: 'channel-1',
  }],
  sessions: [{
    threadId: 'thread-1',
    sessionId: 'session-1',
    threadName: 'Fix tests',
    source: 'kimaki' as const,
    syncStatus: 'connected' as const,
    project: 'C:/repo',
    guildId: 'guild-1',
    discordUrl: 'https://discord.com/channels/guild-1/thread-1',
    createdAt: '2026-06-18T10:00:00Z',
    updatedAt: '2026-06-18T10:05:00Z',
  }],
  logsTail: ['Kimaki ready'],
  statusLoading: false,
  actionLoading: false,
  error: null,
  loadStatus: vi.fn(),
  loadOperations: vi.fn(),
  sendPrompt: vi.fn(),
  addProject: vi.fn(),
  refreshLogs: vi.fn(),
  restart: vi.fn(),
  toggleRemote: vi.fn(),
  renameSession: vi.fn(),
};

vi.mock('../ui/src/tabs/Remote/RemoteStore', () => ({
  useRemoteStore: () => store,
}));

import RemoteView from '../ui/src/tabs/Remote/RemoteView';

describe('RemoteView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ready state, projects, sessions, send form, and logs', () => {
    render(<RemoteView />);
    expect(screen.getByTestId('remote-view')).toBeTruthy();
    expect(screen.getByTestId('remote-status-badge').textContent).toBe('Connected');
    expect(screen.getAllByText('C:/repo').length).toBeGreaterThan(0);
    expect(screen.getByText('Fix tests')).toBeTruthy();
    expect(screen.getByTestId('remote-send-btn')).toBeTruthy();
    fireEvent.click(screen.getByText('Diagnostics'));
    expect(screen.getByText('Kimaki ready')).toBeTruthy();
  });

  it('renders guided setup without loading operational data before readiness', () => {
    store.status = {
      ...store.status,
      state: 'awaiting_install',
      ready: false,
      phase: 'awaiting_install',
      installUrl: 'https://discord.test/install',
      message: 'Install Kimaki in Discord.',
    };
    render(<RemoteView />);

    expect(screen.getByTestId('remote-onboarding')).toBeTruthy();
    expect(screen.getByTestId('remote-install')).toBeTruthy();
    expect(screen.queryByTestId('remote-projects')).toBeNull();
    expect(store.loadOperations).not.toHaveBeenCalled();
    store.status = {
      ...store.status,
      state: 'ready',
      ready: true,
      phase: 'ready',
      installUrl: null,
      message: 'Discord remote sessions are connected.',
    };
  });

  it('renders ordinary OpenCode sessions as pending Discord sync', () => {
    store.sessions = [{
      threadId: null,
      sessionId: 'session-external',
      threadName: 'Local CLI work',
      source: 'opencode',
      syncStatus: 'pending',
      project: 'C:/repo',
      discordUrl: null,
      updatedAt: '2026-06-19T14:00:00Z',
    }];

    render(<RemoteView />);
    expect(screen.getByText('Local CLI work')).toBeTruthy();
    expect(screen.getByText('Pending sync')).toBeTruthy();
    expect(screen.getByText('Waiting for Kimaki')).toBeTruthy();

    store.sessions = [{
      threadId: 'thread-1',
      sessionId: 'session-1',
      threadName: 'Fix tests',
      source: 'kimaki',
      syncStatus: 'connected',
      project: 'C:/repo',
      guildId: 'guild-1',
      discordUrl: 'https://discord.com/channels/guild-1/thread-1',
      updatedAt: '2026-06-18T10:05:00Z',
    }];
  });
});
