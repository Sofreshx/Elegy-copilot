import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../ui/src/lib/api/core', () => ({ apiRequest }));

import RepositoriesView from '../ui/src/views/Repositories/RepositoriesView';
import { repositoriesStore } from '../ui/src/views/Repositories/repositoriesStore';
import { navigationStore } from '../ui/src/stores/navigation';

const repos = [
  {
    repoId: 'alpha',
    repoPath: 'C:\\work\\alpha',
    repoLabel: 'Alpha',
    registered: true,
    canonicalRemote: 'elegy/alpha',
    pinned: true,
    lastActivityMs: Date.now(),
  },
  {
    repoId: 'beta',
    repoPath: 'C:\\work\\beta',
    repoLabel: 'Beta',
    registered: false,
    canonicalRemote: null,
    pinned: false,
    lastActivityMs: null,
  },
];

describe('RepositoriesView', () => {
  beforeEach(() => {
    apiRequest.mockResolvedValue({ repos, selectedRepo: null, workspaceScan: { customScanRoots: [] } });
  });

  afterEach(() => {
    cleanup();
    repositoriesStore.reset();
    navigationStore.reset();
    vi.clearAllMocks();
  });

  it('removes persisted workspace tabs that are absent from canonical inventory', async () => {
    navigationStore.openWorkspace('C:\\work\\alpha', 'Alpha');
    navigationStore.openWorkspace('C:\\work\\deleted', 'Deleted');

    render(<RepositoriesView />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());
    await waitFor(() => {
      expect(navigationStore.getState().openWorkspaces.map((workspace) => workspace.repoPath)).toEqual(['C:\\work\\alpha']);
    });
  });

  it('groups repositories and keeps registration and discovery settings behind dialogs', async () => {
    render(<RepositoriesView />);

    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());
    expect(screen.getByRole('heading', { name: 'Pinned' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'All repositories' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add repository' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Discovery settings' })).toBeDefined();
    expect(screen.queryByTestId('repos-register-panel')).toBeNull();
    expect(screen.queryByTestId('repos-sources-config')).toBeNull();
  });

  it('opens an accessible add-repository dialog', async () => {
    render(<RepositoriesView />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));

    expect(screen.getByRole('dialog', { name: 'Add repository' })).toBeDefined();
    expect(screen.getByLabelText('Repository path')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });
});
