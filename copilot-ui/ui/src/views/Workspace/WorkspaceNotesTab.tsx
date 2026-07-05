import { useState, useEffect, useCallback } from 'react';
import WorkspaceNotesReader from './Notes/Reader';
import WorkspaceNotesEditor from './Notes/Editor';
import WorkspaceNotesRaw from './Notes/Raw';
import {
  getVaultStatus,
  getGitStatus,
  getGitLog,
  gitCommit,
  gitInit,
  driveSyncPush,
  driveSyncPull,
  getDriveSyncStatus,
  driveAuth,
  checkDriveAuth,
  cancelDriveAuth,
  type VaultStatus,
  type GitStatus,
  type GitLogEntry,
  type DriveSyncStatus,
} from '../../lib/api/notes';

type NotesViewMode = 'read' | 'write' | 'raw';

interface WorkspaceNotesTabProps {
  repoPath: string;
}

export default function WorkspaceNotesTab({ repoPath }: WorkspaceNotesTabProps) {
  const [viewMode, setViewMode] = useState<NotesViewMode>('read');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Vault state
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLog, setGitLog] = useState<GitLogEntry[]>([]);
  const [driveSync, setDriveSync] = useState<DriveSyncStatus | null>(null);
  const [commitMsg, setCommitMsg] = useState('');

  // UI state
  const [showVaultPanel, setShowVaultPanel] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showDrivePanel, setShowDrivePanel] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authUserCode, setAuthUserCode] = useState<string | null>(null);
  const [authVerificationUrl, setAuthVerificationUrl] = useState<string | null>(null);

  useEffect(() => {
    void getVaultStatus().then(setVaultStatus);
    void getGitStatus().then(setGitStatus);
    void getDriveSyncStatus().then(setDriveSync);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    const s = await getGitStatus();
    setGitStatus(s);
    if (s.ok) {
      const log = await getGitLog(10);
      if (log.ok) setGitLog(log.entries);
    }
  }, []);

  const handleGitInit = useCallback(async () => {
    const result = await gitInit();
    if (result.ok) {
      setMessage('Git initialized in vault.');
      await refreshGitStatus();
    } else {
      setMessage(`Git init failed: ${result.error}`);
    }
    setTimeout(() => setMessage(null), 3000);
  }, [refreshGitStatus]);

  const handleCommit = useCallback(async () => {
    setCommitting(true);
    try {
      const result = await gitCommit(commitMsg);
      if (result.ok) {
        setMessage(result.committed ? 'Changes committed.' : 'Nothing to commit.');
        setCommitMsg('');
        await refreshGitStatus();
      } else {
        setMessage(`Commit failed: ${result.error}`);
      }
    } catch {
      setMessage('Commit failed.');
    }
    setCommitting(false);
    setTimeout(() => setMessage(null), 3000);
  }, [commitMsg, refreshGitStatus]);

  const handleDrivePush = useCallback(async () => {
    setSyncing(true);
    const result = await driveSyncPush();
    setMessage(result.message || (result.ok ? 'Push complete.' : 'Push failed.'));
    setSyncing(false);
    await getDriveSyncStatus().then(setDriveSync);
    setTimeout(() => setMessage(null), 5000);
  }, []);

  const handleDrivePull = useCallback(async () => {
    setSyncing(true);
    const result = await driveSyncPull();
    setMessage(result.message || (result.ok ? 'Pull complete.' : 'Pull failed.'));
    setSyncing(false);
    await getDriveSyncStatus().then(setDriveSync);
    setTimeout(() => setMessage(null), 5000);
  }, []);

  const handleDriveAuth = useCallback(async () => {
    const result = await driveAuth();
    if (result.ok && result.pending && result.userCode && result.verificationUrl) {
      setAuthUserCode(result.userCode);
      setAuthVerificationUrl(result.verificationUrl);
      setAuthPending(true);
      setMessage(`Auth started. Visit ${result.verificationUrl} and enter code: ${result.userCode}`);

      // Poll for completion
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 60) {
          clearInterval(pollInterval);
          setAuthPending(false);
          setMessage('Auth timed out. Try again.');
          return;
        }
        const poll = await checkDriveAuth();
        if (poll.ok && poll.completed) {
          clearInterval(pollInterval);
          setAuthPending(false);
          setAuthUserCode(null);
          setAuthVerificationUrl(null);
          setMessage('Authenticated successfully!');
          await getDriveSyncStatus().then(setDriveSync);
        } else if (poll.expired) {
          clearInterval(pollInterval);
          setAuthPending(false);
          setAuthUserCode(null);
          setAuthVerificationUrl(null);
          setMessage('Auth code expired. Click Authenticate again.');
        } else if (poll.error) {
          clearInterval(pollInterval);
          setAuthPending(false);
          setMessage(`Auth failed: ${poll.error}`);
        }
      }, 5000);
    } else if (result.ok) {
      setMessage('Authenticated successfully!');
      await getDriveSyncStatus().then(setDriveSync);
      setTimeout(() => setMessage(null), 3000);
    } else {
      setMessage(result.error || 'Authentication failed.');
      setTimeout(() => setMessage(null), 5000);
    }
  }, []);

  const handleCancelAuth = useCallback(async () => {
    await cancelDriveAuth();
    setAuthPending(false);
    setAuthUserCode(null);
    setAuthVerificationUrl(null);
    setMessage('Authentication cancelled.');
    await getDriveSyncStatus().then(setDriveSync);
    setTimeout(() => setMessage(null), 3000);
  }, []);

  function handleNoteSelect(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('read');
  }

  function handleNewNote() {
    setActiveNoteId(null);
    setViewMode('write');
  }

  function handleEditNote(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('write');
  }

  return (
    <div className="workspace-notes-tab" data-testid="notes-tab">
      {/* Toolbar */}
      <div className="workspace-notes-toolbar">
        <div className="workspace-notes-toolbar-left">
          <h3 className="workspace-notes-title">Notes</h3>
          <div className="workspace-notes-view-switcher" role="tablist">
            <button
              className={`workspace-notes-view-btn${viewMode === 'read' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'read'}
              onClick={() => setViewMode('read')}
              data-testid="notes-view-read"
            >
              Read
            </button>
            <button
              className={`workspace-notes-view-btn${viewMode === 'write' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'write'}
              onClick={() => setViewMode('write')}
              data-testid="notes-view-write"
            >
              Write
            </button>
            <button
              className={`workspace-notes-view-btn${viewMode === 'raw' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'raw'}
              onClick={() => setViewMode('raw')}
              data-testid="notes-view-raw"
            >
              Raw
            </button>
          </div>
        </div>
        <div className="workspace-notes-actions">
          {/* Vault status indicator */}
          {vaultStatus && (
            <span
              className={`workspace-notes-vault-badge ${vaultStatus.configured && vaultStatus.vaultExists ? 'badge-ok' : 'badge-warn'}`}
              onClick={() => setShowVaultPanel(!showVaultPanel)}
              title={`Vault: ${vaultStatus.vaultPath}`}
              style={{ cursor: 'pointer', fontSize: '0.75rem', marginRight: '8px' }}
            >
              {vaultStatus.configured && vaultStatus.vaultExists ? '●' : '○'} Vault
            </span>
          )}

          {/* Git button */}
          <button
            className="button button-secondary button-sm"
            onClick={() => setShowGitPanel(!showGitPanel)}
            title="Git versioning"
            data-testid="notes-git-btn"
          >
            {gitStatus?.ok && !gitStatus.isClean ? `Git (${gitStatus.changes?.length || 0})` : 'Git'}
          </button>

          {/* Drive sync button */}
          <button
            className="button button-secondary button-sm"
            onClick={() => setShowDrivePanel(!showDrivePanel)}
            title="Google Drive sync"
            disabled={syncing}
            data-testid="notes-drive-btn"
          >
            {syncing ? 'Syncing...' : 'Drive'}
          </button>

          <button
            className="button button-primary button-sm"
            onClick={handleNewNote}
            data-testid="notes-new-note"
          >
            + New Note
          </button>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className="workspace-notes-message" style={{ padding: '4px 12px', fontSize: '0.8rem', background: 'var(--bg-surface)' }}>
          {message}
        </div>
      )}

      {/* Vault Info Panel */}
      {showVaultPanel && vaultStatus && (
        <div className="workspace-notes-panel" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
          <strong>Vault Status</strong>
          <ul style={{ margin: '4px 0', paddingLeft: '16px' }}>
            <li>Path: {vaultStatus.vaultPath || 'Not configured'}</li>
            <li>Exists: {vaultStatus.vaultExists ? 'Yes' : 'No'}</li>
            <li>Files: {vaultStatus.fileCount}</li>
            <li>Git: {vaultStatus.gitEnabled ? 'Enabled' : 'Disabled'}</li>
            <li>Drive: {vaultStatus.gdriveEnabled ? 'Enabled' : 'Disabled'}</li>
          </ul>
        </div>
      )}

      {/* Git Panel */}
      {showGitPanel && (
        <div className="workspace-notes-panel" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            <strong>Git Versioning</strong>
            {!gitStatus?.ok && gitStatus?.error?.includes('not initialized') && (
              <button className="button button-secondary button-xs" onClick={handleGitInit}>Init Git</button>
            )}
            <button className="button button-secondary button-xs" onClick={refreshGitStatus}>Refresh</button>
          </div>
          {gitStatus?.ok && gitStatus.changes && gitStatus.changes.length > 0 && (
            <>
              <div style={{ marginBottom: '4px' }}>
                {gitStatus.changes.map((c, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {c.status === 'M' ? 'modified' : c.status === '??' ? 'untracked' : c.status} {c.file}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                <input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message..."
                  style={{ flex: 1, fontSize: '0.75rem', padding: '2px 4px' }}
                  data-testid="notes-commit-msg"
                />
                <button
                  className="button button-primary button-xs"
                  onClick={handleCommit}
                  disabled={committing || !commitMsg.trim()}
                  data-testid="notes-commit-btn"
                >
                  {committing ? '...' : 'Commit'}
                </button>
              </div>
            </>
          )}
          {gitStatus?.ok && gitStatus.isClean && (
            <div style={{ color: 'var(--text-secondary)' }}>No uncommitted changes.</div>
          )}
          {gitLog.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer' }}>Recent commits ({gitLog.length})</summary>
              <div style={{ maxHeight: '200px', overflow: 'auto', marginTop: '4px' }}>
                {gitLog.map((entry, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.7rem', marginBottom: '2px' }}>
                    <span title={entry.hash}>{entry.hash.slice(0, 8)}</span>
                    {' '}{entry.date.slice(0, 10)}
                    {' '}{entry.subject}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Drive Sync Panel */}
      {showDrivePanel && (
        <div className="workspace-notes-panel" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            <strong>Google Drive Sync</strong>
            {driveSync && (
              <span style={{ fontSize: '0.7rem' }}>
                {driveSync.authenticated ? '✓ Authenticated' : authPending ? '⏳ Auth pending...' : '✗ Not authenticated'}
              </span>
            )}
          </div>
          {driveSync && (
            <ul style={{ margin: '4px 0', paddingLeft: '16px', fontSize: '0.75rem' }}>
              <li>Folder: {driveSync.gdriveFolderName}</li>
              <li>rclone: {driveSync.rcloneInstalled ? `✓ ${driveSync.rclonePath}` : '✗ Not installed'}</li>
              <li>Remote: {driveSync.rcloneConfigured ? '✓ Configured' : '✗ Not configured'}</li>
              <li>Drive folder: {driveSync.driveFolderExists ? '✓ Found' : 'Not yet created'}</li>
              {driveSync.authenticatedEmail && <li>Account: {driveSync.authenticatedEmail}</li>}
            </ul>
          )}

          {/* Auth pending UI */}
          {authPending && authUserCode && authVerificationUrl && (
            <div style={{ margin: '8px 0', padding: '8px', background: 'var(--bg-surface)', borderRadius: '4px', border: '1px solid var(--color-brand-400)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Authorization Required</div>
              <div style={{ marginBottom: '4px' }}>
                1. Visit: <a href={authVerificationUrl} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{authVerificationUrl}</a>
              </div>
              <div style={{ marginBottom: '4px' }}>
                2. Enter code: <strong style={{ fontSize: '1.1rem', letterSpacing: '2px' }}>{authUserCode}</strong>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Waiting for you to complete authorization...
              </div>
              <button
                className="button button-secondary button-xs"
                onClick={handleCancelAuth}
                style={{ marginTop: '4px' }}
              >
                Cancel
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button
              className="button button-secondary button-xs"
              onClick={handleDrivePush}
              disabled={syncing || (!driveSync?.authenticated && !authPending)}
            >
              Push to Drive
            </button>
            <button
              className="button button-secondary button-xs"
              onClick={handleDrivePull}
              disabled={syncing || (!driveSync?.authenticated && !authPending)}
            >
              Pull from Drive
            </button>
            <button
              className="button button-secondary button-xs"
              onClick={handleDriveAuth}
              disabled={syncing || authPending}
            >
              {authPending ? 'Auth in progress...' : 'Authenticate'}
            </button>
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            Setup: Install rclone (<code>winget install rclone</code>) then run <code>rclone config</code> to add a "drive" remote named DevVault
          </div>
        </div>
      )}

      {/* Content area — delegates to child views */}
      <div className="workspace-notes-body" role="tabpanel">
        {viewMode === 'read' && (
          <WorkspaceNotesReader
            repoPath={repoPath}
            activeNoteId={activeNoteId}
            onNoteSelect={handleNoteSelect}
            onEditNote={handleEditNote}
          />
        )}
        {viewMode === 'write' && (
          <WorkspaceNotesEditor
            repoPath={repoPath}
            noteId={activeNoteId}
            onSaved={(id) => { setActiveNoteId(id); setViewMode('read'); }}
            onCancel={() => setViewMode(activeNoteId ? 'read' : 'read')}
          />
        )}
        {viewMode === 'raw' && (
          <WorkspaceNotesRaw
            repoPath={repoPath}
            noteId={activeNoteId}
          />
        )}
      </div>
    </div>
  );
}
