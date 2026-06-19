import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
  status: {
    state: 'ready' as const,
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
    threadName: 'Fix tests',
    source: 'kimaki',
    project: 'C:/repo',
    guildId: 'guild-1',
    createdAt: '2026-06-18T10:00:00Z',
    updatedAt: '2026-06-18T10:05:00Z',
  }],
  logsTail: ['Kimaki ready'],
  loading: false,
  error: null,
  loadStatus: vi.fn(),
  loadProjects: vi.fn(),
  loadSessions: vi.fn(),
  sendPrompt: vi.fn(),
  addProject: vi.fn(),
  refreshLogs: vi.fn(),
  restart: vi.fn(),
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
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getAllByText('C:/repo').length).toBeGreaterThan(0);
    expect(screen.getByText('Fix tests')).toBeTruthy();
    expect(screen.getByTestId('remote-send-btn')).toBeTruthy();
    expect(screen.getByText('Kimaki ready')).toBeTruthy();
  });
});
