import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/views/Workspace/Notes/Reader', () => ({
  default: () => <div data-testid="mock-notes-reader">reader</div>,
}));

vi.mock('../ui/src/views/Workspace/Notes/Editor', () => ({
  default: () => <div data-testid="mock-notes-editor">editor</div>,
}));

vi.mock('../ui/src/views/Workspace/Notes/Raw', () => ({
  default: () => <div data-testid="mock-notes-raw">raw</div>,
}));

vi.mock('../ui/src/lib/api/notes', () => ({
  exportNotes: vi.fn(),
  importNotes: vi.fn(),
  getVaultStatus: vi.fn(),
  getGitStatus: vi.fn(),
  getGitLog: vi.fn(),
  gitCommit: vi.fn(),
  gitInit: vi.fn(),
  driveSyncPush: vi.fn(),
  driveSyncPull: vi.fn(),
  getDriveSyncStatus: vi.fn(),
  driveAuth: vi.fn(),
  checkDriveAuth: vi.fn(),
  cancelDriveAuth: vi.fn(),
}));

import WorkspaceNotesTab from '../ui/src/views/Workspace/WorkspaceNotesTab';
import * as notesApi from '../ui/src/lib/api/notes';

describe('WorkspaceNotesTab transfer console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notesApi.getVaultStatus).mockResolvedValue({
      ok: true,
      vaultPath: 'C:/Users/test/DevVault',
      vaultExists: true,
      fileCount: 12,
      configured: true,
      gitEnabled: true,
      gdriveEnabled: true,
      gdriveFolderName: 'DevVault',
    });
    vi.mocked(notesApi.getGitStatus).mockResolvedValue({
      ok: true,
      isClean: false,
      changes: [{ status: 'M', file: 'Current Sprint.md' }],
    });
    vi.mocked(notesApi.getGitLog).mockResolvedValue({
      ok: true,
      entries: [{ hash: 'abcdef123456', date: '2026-07-05', author: 'Test', subject: 'Update notes' }],
    });
    vi.mocked(notesApi.getDriveSyncStatus).mockResolvedValue({
      ok: true,
      configured: true,
      vaultPath: 'C:/Users/test/DevVault',
      vaultExists: true,
      gdriveEnabled: true,
      gdriveFolderName: 'DevVault',
      rcloneInstalled: true,
      rclonePath: 'rclone',
      rcloneConfigured: false,
      authenticated: false,
      authenticatedEmail: null,
      driveFolderExists: false,
    });
  });

  it('shows transfer controls first and hides local note browsing by default', async () => {
    render(<WorkspaceNotesTab repoPath="/test/repo" />);

    await waitFor(() => {
      expect(screen.getByTestId('notes-transfer-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('notes-export-json')).toBeInTheDocument();
    expect(screen.getByTestId('notes-import-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('notes-drive-setup')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-operation-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('Install rclone before Google Drive sync can run.')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes-drive-next-step')).toHaveTextContent('Configure DevVault remote');
    expect(screen.getByTestId('notes-git-panel')).toHaveTextContent('1 change');
    expect(screen.queryByTestId('notes-local-tools')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('notes-local-tools-toggle'));

    expect(screen.getByTestId('notes-local-tools')).toBeInTheDocument();
    expect(screen.getByTestId('mock-notes-reader')).toBeInTheDocument();
  });

  it('surfaces rclone setup instructions from Drive verify', async () => {
    vi.mocked(notesApi.driveAuth).mockResolvedValue({
      ok: false,
      needsSetup: true,
      setupInstructions: 'Install rclone and create the DevVault remote.',
    });

    render(<WorkspaceNotesTab repoPath="/test/repo" />);

    await waitFor(() => {
      expect(screen.getByTestId('notes-drive-setup')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('notes-drive-setup'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-drive-setup-instructions')).toHaveTextContent('Install rclone');
    });
  });
});
