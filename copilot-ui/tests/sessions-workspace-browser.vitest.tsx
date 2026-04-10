import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionsWorkspaceBrowser from '../ui/src/tabs/Sessions/SessionsWorkspaceBrowser';

describe('SessionsWorkspaceBrowser', () => {
  it('switches between Active and History views inside the frozen Sessions workspace', () => {
    const onSelectView = vi.fn();
    const onSelectEntry = vi.fn();

    const props = {
      active: [
        {
          entryId: 'sdk:session-1',
          kind: 'sdk',
          title: 'session-1',
          status: 'active',
          source: 'sdk',
          sourceLabel: 'SDK',
          updatedAt: Date.UTC(2026, 3, 7),
          workspace: {
            primaryRepo: {
              repoId: 'repo-1',
              repoPath: 'C:/repo-1',
              repoLabel: 'Repo One',
            },
            linkedRepos: [],
          },
          detail: {
            handoffTarget: 'sdk',
          },
        },
      ],
      history: [
        {
          entryId: 'archive:cli:session-2',
          kind: 'archive',
          title: 'session-2',
          status: 'archived',
          source: 'cli',
          sourceLabel: 'Archive',
          updatedAt: Date.UTC(2026, 3, 6),
          workspace: {
            primaryRepo: {
              repoId: 'repo-2',
              repoPath: 'C:/repo-2',
              repoLabel: 'Repo Two',
            },
            linkedRepos: [],
          },
          detail: {
            handoffTarget: 'history',
          },
        },
      ],
      loading: false,
      onSelectEntry,
      onSelectView,
    };

    const { rerender } = render(
      <SessionsWorkspaceBrowser
        {...props}
        selectedEntryId="sdk:session-1"
        selectedView="active"
      />
    );

    expect(screen.getByText('session-1')).toBeInTheDocument();
    expect(screen.queryByText('session-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sessions-workspace-view-history'));

    expect(onSelectView).toHaveBeenCalledWith('history');

    rerender(
      <SessionsWorkspaceBrowser
        {...props}
        selectedEntryId="archive:cli:session-2"
        selectedView="history"
      />
    );

    expect(screen.getByText('session-2')).toBeInTheDocument();
    expect(screen.queryByText('session-1')).not.toBeInTheDocument();
  });
});
