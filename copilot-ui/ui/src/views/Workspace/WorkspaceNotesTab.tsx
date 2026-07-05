import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components';
import { deriveWorkspaceOperationSnapshot } from '../../stores/workspaceOperationStore';
import WorkspaceNotesReader from './Notes/Reader';
import WorkspaceNotesEditor from './Notes/Editor';
import WorkspaceNotesRaw from './Notes/Raw';
import WorkspaceOperationBanner from './WorkspaceOperationBanner';
import {
  exportNotes,
  importNotes,
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
  type ExportMdResponse,
  type ExportPayload,
  type GitLogEntry,
  type GitStatus,
  type ImportPayload,
  type VaultStatus,
  type DriveSyncStatus,
} from '../../lib/api/notes';

type NotesViewMode = 'read' | 'write' | 'raw';
type BusyAction = 'export-json' | 'export-markdown' | 'import' | 'push' | 'pull' | 'auth' | 'commit' | 'init' | null;

interface WorkspaceNotesTabProps {
  repoPath: string;
}

function downloadText(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusTone(ok: boolean | undefined) {
  return ok ? 'workspace-notes-status-ok' : 'workspace-notes-status-warn';
}

function formatSyncResult(prefix: string, result: { ok: boolean; message?: string; error?: string; conflicts?: number }) {
  if (result.message) return result.message;
  if (result.error) return `${prefix} failed: ${result.error}`;
  if (typeof result.conflicts === 'number' && result.conflicts > 0) return `${prefix} completed with ${result.conflicts} conflict(s).`;
  return result.ok ? `${prefix} complete.` : `${prefix} failed.`;
}

function getDriveSetupStep(driveSync: DriveSyncStatus | null): { label: string; detail: string; command?: string; action?: 'verify' | 'push' } {
  if (!driveSync) {
    return {
      label: 'Check Drive status',
      detail: 'Refresh Drive status before syncing notes.',
    };
  }
  if (!driveSync.rcloneInstalled) {
    return {
      label: 'Install rclone',
      detail: 'Google Drive sync uses rclone locally.',
      command: 'winget install rclone',
    };
  }
  if (!driveSync.rcloneConfigured) {
    return {
      label: 'Configure DevVault remote',
      detail: `Create an rclone Drive remote named ${driveSync.gdriveFolderName || 'DevVault'}.`,
      command: 'rclone config',
    };
  }
  if (!driveSync.authenticated) {
    return {
      label: 'Verify remote auth',
      detail: 'Ask rclone to validate the configured Drive remote.',
      action: 'verify',
    };
  }
  if (!driveSync.driveFolderExists) {
    return {
      label: 'Create Drive folder',
      detail: 'Push notes once to create the remote folder.',
      action: 'push',
    };
  }
  return {
    label: 'Drive sync ready',
    detail: 'Push or pull notes when you want to transfer vault changes.',
  };
}

export default function WorkspaceNotesTab({ repoPath }: WorkspaceNotesTabProps) {
  const [viewMode, setViewMode] = useState<NotesViewMode>('read');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showLocalTools, setShowLocalTools] = useState(false);

  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLog, setGitLog] = useState<GitLogEntry[]>([]);
  const [driveSync, setDriveSync] = useState<DriveSyncStatus | null>(null);
  const [commitMsg, setCommitMsg] = useState('');

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupInstructions, setSetupInstructions] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authUserCode, setAuthUserCode] = useState<string | null>(null);
  const [authVerificationUrl, setAuthVerificationUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshGitStatus = useCallback(async () => {
    const nextGitStatus = await getGitStatus();
    setGitStatus(nextGitStatus);
    if (nextGitStatus.ok) {
      const log = await getGitLog(8);
      if (log.ok) setGitLog(log.entries);
    } else {
      setGitLog([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const [nextVaultStatus, nextDriveStatus] = await Promise.all([
      getVaultStatus(),
      getDriveSyncStatus(),
    ]);
    setVaultStatus(nextVaultStatus);
    setDriveSync(nextDriveStatus);
    await refreshGitStatus();
  }, [refreshGitStatus]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const showMessage = useCallback((nextMessage: string, timeout = 5000) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage(null), timeout);
  }, []);

  const handleExport = useCallback(async (format: 'json' | 'markdown') => {
    setBusyAction(format === 'json' ? 'export-json' : 'export-markdown');
    try {
      const result = await exportNotes(format);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        const payload = result as ExportPayload;
        downloadText(`elegy-notes-${stamp}.json`, 'application/json', JSON.stringify(payload, null, 2));
        showMessage(`Exported ${payload.notes.length} note(s) as JSON.`);
      } else {
        const payload = result as ExportMdResponse;
        const combined = payload.files
          .map((file) => `<!-- ${file.filename} -->\n\n${file.content.trim()}\n`)
          .join('\n---\n\n');
        downloadText(`elegy-notes-${stamp}.md`, 'text/markdown', combined);
        showMessage(`Exported ${payload.count} note(s) as Markdown.`);
      }
    } catch (err) {
      showMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  }, [showMessage]);

  const handleImportFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setBusyAction('import');
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw) as ImportPayload;
      if (!Array.isArray(payload.notes)) {
        throw new Error('Import file must contain a notes array.');
      }
      const result = await importNotes(payload);
      showMessage(`Imported ${result.imported}, updated ${result.updated}, errors ${result.errors?.length ?? 0}.`);
      await refreshAll();
    } catch (err) {
      showMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [refreshAll, showMessage]);

  const handleGitInit = useCallback(async () => {
    setBusyAction('init');
    try {
      const result = await gitInit();
      showMessage(result.ok ? result.message || 'Git initialized in vault.' : `Git init failed: ${result.error || 'unknown error'}`);
      await refreshGitStatus();
    } finally {
      setBusyAction(null);
    }
  }, [refreshGitStatus, showMessage]);

  const handleCommit = useCallback(async () => {
    setBusyAction('commit');
    try {
      const result = await gitCommit(commitMsg);
      showMessage(result.ok ? result.message || (result.committed ? 'Changes committed.' : 'Nothing to commit.') : `Commit failed: ${result.error || 'unknown error'}`);
      if (result.ok) setCommitMsg('');
      await refreshGitStatus();
    } finally {
      setBusyAction(null);
    }
  }, [commitMsg, refreshGitStatus, showMessage]);

  const handleDrivePush = useCallback(async () => {
    setBusyAction('push');
    try {
      const result = await driveSyncPush();
      showMessage(formatSyncResult('Push', result), 7000);
      await getDriveSyncStatus().then(setDriveSync);
    } finally {
      setBusyAction(null);
    }
  }, [showMessage]);

  const handleDrivePull = useCallback(async () => {
    setBusyAction('pull');
    try {
      const result = await driveSyncPull();
      showMessage(formatSyncResult('Pull', result), 7000);
      await getDriveSyncStatus().then(setDriveSync);
    } finally {
      setBusyAction(null);
    }
  }, [showMessage]);

  const handleDriveAuth = useCallback(async () => {
    setBusyAction('auth');
    setSetupInstructions(null);
    try {
      const result = await driveAuth();
      if (result.ok && result.pending && result.userCode && result.verificationUrl) {
        setAuthUserCode(result.userCode);
        setAuthVerificationUrl(result.verificationUrl);
        setAuthPending(true);
        showMessage(`Auth started. Enter code ${result.userCode}.`, 7000);

        let attempts = 0;
        const pollInterval = window.setInterval(async () => {
          attempts += 1;
          if (attempts > 60) {
            window.clearInterval(pollInterval);
            setAuthPending(false);
            showMessage('Auth timed out. Run setup again.');
            return;
          }
          const poll = await checkDriveAuth();
          if (poll.ok && poll.completed) {
            window.clearInterval(pollInterval);
            setAuthPending(false);
            setAuthUserCode(null);
            setAuthVerificationUrl(null);
            showMessage('Drive authentication confirmed.');
            await getDriveSyncStatus().then(setDriveSync);
          } else if (poll.expired) {
            window.clearInterval(pollInterval);
            setAuthPending(false);
            setAuthUserCode(null);
            setAuthVerificationUrl(null);
            showMessage('Auth code expired. Run setup again.');
          } else if (poll.error) {
            window.clearInterval(pollInterval);
            setAuthPending(false);
            showMessage(`Auth failed: ${poll.error}`);
          }
        }, 5000);
      } else if (result.ok) {
        showMessage(result.message || 'Drive configuration is ready.');
        await getDriveSyncStatus().then(setDriveSync);
      } else {
        const instructions = result.setupInstructions || result.message || result.error || 'Run rclone config and create the DevVault remote.';
        setSetupInstructions(instructions);
        showMessage(instructions, 9000);
      }
    } finally {
      setBusyAction(null);
    }
  }, [showMessage]);

  const handleCancelAuth = useCallback(async () => {
    await cancelDriveAuth();
    setAuthPending(false);
    setAuthUserCode(null);
    setAuthVerificationUrl(null);
    showMessage('Authentication cancelled.');
    await getDriveSyncStatus().then(setDriveSync);
  }, [showMessage]);

  function handleNoteSelect(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('read');
  }

  function handleNewNote() {
    setActiveNoteId(null);
    setViewMode('write');
    setShowLocalTools(true);
  }

  function handleEditNote(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('write');
    setShowLocalTools(true);
  }

  const vaultReady = Boolean(vaultStatus?.configured && vaultStatus?.vaultExists);
  const driveReady = Boolean(driveSync?.rcloneInstalled && driveSync.rcloneConfigured && driveSync.authenticated);
  const hasGitChanges = Boolean(gitStatus?.ok && gitStatus.changes && gitStatus.changes.length > 0);
  const syncBusy = busyAction === 'push' || busyAction === 'pull';
  const driveSetupStep = getDriveSetupStep(driveSync);
  const operationSnapshot = deriveWorkspaceOperationSnapshot({
    repoPath,
    notesState: {
      vaultStatus,
      gitStatus,
      driveSync,
      busyAction,
    },
  });

  function handleOperationPrimaryAction() {
    const actionId = operationSnapshot.nextAction?.id;
    if (actionId === 'notes.drive.push') {
      if (driveSetupStep.action === 'verify') {
        void handleDriveAuth();
      } else {
        void handleDrivePush();
      }
    }
  }

  return (
    <div className="workspace-notes-tab workspace-notes-transfer" data-testid="notes-tab">
      <WorkspaceOperationBanner
        snapshot={operationSnapshot}
        onPrimaryAction={handleOperationPrimaryAction}
      />

      <div className="workspace-notes-transfer-header">
        <div>
          <h3 className="workspace-notes-title">Notes Transfer</h3>
          <p className="workspace-notes-transfer-subtitle">
            Move vault notes between local files, Git snapshots, and Google Drive.
          </p>
        </div>
        <div className="workspace-notes-transfer-actions">
          <Button variant="ghost" size="sm" onClick={() => void refreshAll()} testId="notes-refresh">
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={handleNewNote} testId="notes-new-note">
            New note
          </Button>
          <Button
            variant={showLocalTools ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowLocalTools((value) => !value)}
            testId="notes-local-tools-toggle"
          >
            Local tools
          </Button>
        </div>
      </div>

      {message ? (
        <div className="workspace-notes-message" data-testid="notes-message">
          {message}
        </div>
      ) : null}

      <div className="workspace-notes-transfer-grid">
        <section className="workspace-notes-transfer-panel" data-testid="notes-vault-panel">
          <div className="workspace-notes-panel-header">
            <span className="workspace-notes-panel-kicker">Vault</span>
            <span className={`workspace-notes-status-pill ${statusTone(vaultReady)}`}>
              {vaultReady ? 'ready' : 'attention'}
            </span>
          </div>
          <dl className="workspace-notes-facts">
            <div>
              <dt>Path</dt>
              <dd title={vaultStatus?.vaultPath || undefined}>{vaultStatus?.vaultPath || 'Not configured'}</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>{vaultStatus?.fileCount ?? '-'}</dd>
            </div>
            <div>
              <dt>Git</dt>
              <dd>{vaultStatus?.gitEnabled ? 'enabled' : 'disabled'}</dd>
            </div>
            <div>
              <dt>Drive folder</dt>
              <dd>{vaultStatus?.gdriveFolderName || 'DevVault'}</dd>
            </div>
          </dl>
        </section>

        <section className="workspace-notes-transfer-panel" data-testid="notes-transfer-panel">
          <div className="workspace-notes-panel-header">
            <span className="workspace-notes-panel-kicker">Import / export</span>
            <span className="workspace-notes-status-pill">portable</span>
          </div>
          <p className="workspace-notes-panel-copy">
            JSON keeps the full note model. Markdown is for inspection and handoff.
          </p>
          <div className="workspace-notes-button-row">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleExport('json')}
              disabled={busyAction === 'export-json'}
              testId="notes-export-json"
            >
              Export JSON
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExport('markdown')}
              disabled={busyAction === 'export-markdown'}
              testId="notes-export-markdown"
            >
              Export Markdown
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busyAction === 'import'}
              testId="notes-import-trigger"
            >
              Import JSON
            </Button>
            <input
              ref={fileInputRef}
              className="workspace-notes-hidden-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
              data-testid="notes-import-file"
            />
          </div>
        </section>

        <section className="workspace-notes-transfer-panel" data-testid="notes-drive-panel">
          <div className="workspace-notes-panel-header">
            <span className="workspace-notes-panel-kicker">Google Drive</span>
            <span className={`workspace-notes-status-pill ${statusTone(driveReady)}`}>
              {driveReady ? 'connected' : 'setup needed'}
            </span>
          </div>
          <ul className="workspace-notes-checklist">
            <li className={statusTone(driveSync?.rcloneInstalled)}>rclone {driveSync?.rcloneInstalled ? 'installed' : 'not installed'}</li>
            <li className={statusTone(driveSync?.rcloneConfigured)}>remote {driveSync?.rcloneConfigured ? 'configured' : 'not configured'}</li>
            <li className={statusTone(driveSync?.authenticated)}>auth {driveSync?.authenticated ? 'ready' : 'not ready'}</li>
            <li className={statusTone(driveSync?.driveFolderExists)}>folder {driveSync?.driveFolderExists ? 'found' : 'will be created'}</li>
          </ul>
          <div className="workspace-notes-drive-step" data-testid="notes-drive-next-step">
            <span>{driveSetupStep.label}</span>
            <p>{driveSetupStep.detail}</p>
            {driveSetupStep.command ? <code>{driveSetupStep.command}</code> : null}
          </div>
          {driveSync?.authenticatedEmail ? (
            <div className="workspace-notes-account">{driveSync.authenticatedEmail}</div>
          ) : null}
          <div className="workspace-notes-button-row">
            <Button variant="primary" size="sm" onClick={handleDrivePush} disabled={syncBusy || !driveReady} testId="notes-drive-push">
              Push to Drive
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDrivePull} disabled={syncBusy || !driveReady} testId="notes-drive-pull">
              Pull from Drive
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDriveAuth} disabled={busyAction === 'auth' || authPending} testId="notes-drive-setup">
              {authPending ? 'Auth pending' : 'Setup / verify'}
            </Button>
          </div>
          {authPending && authUserCode && authVerificationUrl ? (
            <div className="workspace-notes-auth-box" data-testid="notes-drive-auth-pending">
              <div>Open <a href={authVerificationUrl} target="_blank" rel="noreferrer">{authVerificationUrl}</a></div>
              <div>Code <strong>{authUserCode}</strong></div>
              <Button variant="ghost" size="sm" onClick={handleCancelAuth}>Cancel</Button>
            </div>
          ) : null}
          {setupInstructions ? (
            <pre className="workspace-notes-setup" data-testid="notes-drive-setup-instructions">{setupInstructions}</pre>
          ) : null}
        </section>
      </div>

      <section className="workspace-notes-transfer-panel workspace-notes-git-panel" data-testid="notes-git-panel">
        <div className="workspace-notes-panel-header">
          <span className="workspace-notes-panel-kicker">Vault Git snapshot</span>
          <span className={`workspace-notes-status-pill ${statusTone(gitStatus?.ok && !hasGitChanges)}`}>
            {!gitStatus?.ok ? 'not initialized' : hasGitChanges ? `${gitStatus.changes?.length ?? 0} change(s)` : 'clean'}
          </span>
        </div>
        <div className="workspace-notes-git-layout">
          <div className="workspace-notes-git-changes">
            {!gitStatus?.ok ? (
              <div className="workspace-notes-empty">Git is not initialized for the vault.</div>
            ) : hasGitChanges ? (
              gitStatus.changes?.map((change, index) => (
                <div className="workspace-notes-change-row" key={`${change.status}-${change.file}-${index}`}>
                  <span>{change.status === '??' ? 'new' : change.status}</span>
                  <code>{change.file}</code>
                </div>
              ))
            ) : (
              <div className="workspace-notes-empty">No uncommitted vault changes.</div>
            )}
          </div>
          <div className="workspace-notes-git-actions">
            {!gitStatus?.ok ? (
              <Button variant="secondary" size="sm" onClick={handleGitInit} disabled={busyAction === 'init'} testId="notes-git-init">
                Init Git
              </Button>
            ) : (
              <>
                <input
                  className="form-input-field workspace-notes-commit-input"
                  value={commitMsg}
                  onChange={(event) => setCommitMsg(event.target.value)}
                  placeholder="Commit message..."
                  data-testid="notes-commit-msg"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCommit}
                  disabled={busyAction === 'commit' || !commitMsg.trim() || !hasGitChanges}
                  testId="notes-commit-btn"
                >
                  Commit snapshot
                </Button>
              </>
            )}
          </div>
        </div>
        {gitLog.length > 0 ? (
          <div className="workspace-notes-log" data-testid="notes-git-log">
            {gitLog.map((entry) => (
              <div className="workspace-notes-log-row" key={entry.hash}>
                <code>{entry.hash.slice(0, 8)}</code>
                <span>{entry.date.slice(0, 10)}</span>
                <span>{entry.subject}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {showLocalTools ? (
        <section className="workspace-notes-local-tools" data-testid="notes-local-tools">
          <div className="workspace-notes-toolbar">
            <div className="workspace-notes-toolbar-left">
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
          </div>
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
                onCancel={() => setViewMode('read')}
              />
            )}
            {viewMode === 'raw' && (
              <WorkspaceNotesRaw repoPath={repoPath} noteId={activeNoteId} />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
