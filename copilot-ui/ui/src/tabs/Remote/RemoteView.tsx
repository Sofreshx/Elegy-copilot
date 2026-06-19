import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Button,
  FormInput,
  LogViewer,
  PageContainer,
  Panel,
  StatusBadge,
} from '../../components';
import { useRemoteStore } from './RemoteStore';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Starting',
  starting: 'Starting',
  awaiting_install: 'Install required',
  awaiting_auth: 'Authorizing',
  ready: 'Connected',
  restarting: 'Restarting',
  error: 'Connection error',
  unavailable: 'Runtime unavailable',
};

function statusTone(state?: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (state === 'ready') return 'success';
  if (state === 'error' || state === 'unavailable') return 'danger';
  if (state === 'awaiting_install' || state === 'awaiting_auth') return 'accent';
  return 'brand';
}

export default function RemoteView() {
  const store = useRemoteStore();
  const [showAddProject, setShowAddProject] = useState(false);
  const [directory, setDirectory] = useState('');
  const [project, setProject] = useState('');
  const [prompt, setPrompt] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState('');
  const [renameTitle, setRenameTitle] = useState('');
  const { status, projects, sessions, logsTail, statusLoading, actionLoading, error } = store;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const nextStatus = await store.loadStatus();
      if (cancelled) return;
      if (nextStatus?.ready) {
        await store.loadOperations();
      }
      timer = setTimeout(refresh, nextStatus?.ready ? 10_000 : 3_000);
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!project && projects.length > 0) {
      setProject(projects[0].directory);
    }
  }, [project, projects]);

  const handleInstall = useCallback(() => {
    if (status?.installUrl) window.open(status.installUrl, '_blank');
  }, [status?.installUrl]);

  const handleAddProject = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = directory.trim();
    if (!normalized) return;
    await store.addProject(normalized, status?.guildIds.length === 1 ? status.guildIds[0] : undefined);
    setDirectory('');
    setShowAddProject(false);
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = prompt.trim();
    if (!project || !normalized) return;
    await store.sendPrompt(project, normalized);
    setPrompt('');
  };

  const connectionState = status?.state || 'starting';
  const isReady = Boolean(status?.ready);

  return (
    <PageContainer testId="remote-view">
      <div className="remote-shell">
        <header className="remote-header">
          <div>
            <span className="kicker">Discord connection</span>
            <h2>Remote Sessions</h2>
            <p>Start and continue OpenCode work from Discord through Kimaki.</p>
          </div>
          <StatusBadge
            status={STATUS_LABELS[connectionState] || connectionState}
            tone={statusTone(connectionState)}
            testId="remote-status-badge"
          />
        </header>

        {error ? <div className="remote-alert" role="alert" data-testid="remote-error">{error}</div> : null}

        {!isReady ? (
          <Panel testId="remote-onboarding">
            <div className="remote-onboarding">
              <div className="remote-onboarding-copy">
                <h3>{STATUS_LABELS[connectionState] || 'Connect Discord'}</h3>
                <p>{status?.message || 'Checking the Kimaki runtime and Discord connection.'}</p>
              </div>

              <ol className="remote-steps" aria-label="Discord setup progress">
                <li className={status?.available ? 'complete' : 'active'}>
                  <span>1</span>
                  <div><strong>Runtime</strong><small>Locate the bundled Kimaki service.</small></div>
                </li>
                <li className={connectionState === 'awaiting_install' ? 'active' : status?.ready || connectionState === 'awaiting_auth' ? 'complete' : ''}>
                  <span>2</span>
                  <div><strong>Install</strong><small>Add Kimaki to your Discord server.</small></div>
                </li>
                <li className={connectionState === 'awaiting_auth' ? 'active' : status?.ready ? 'complete' : ''}>
                  <span>3</span>
                  <div><strong>Authorize</strong><small>Confirm the selected Discord server.</small></div>
                </li>
                <li className={status?.ready ? 'complete' : ''}>
                  <span>4</span>
                  <div><strong>Connected</strong><small>Remote projects and sessions become available.</small></div>
                </li>
              </ol>

              <div className="remote-onboarding-actions">
                {status?.installUrl ? (
                  <Button onClick={handleInstall} testId="remote-install">
                    Install in Discord
                  </Button>
                ) : null}
                {(connectionState === 'error' || connectionState === 'unavailable') ? (
                  <Button onClick={() => store.restart()} loading={actionLoading} testId="remote-restart">
                    Retry runtime
                  </Button>
                ) : null}
                {statusLoading ? <span className="state-message">Checking connection…</span> : null}
              </div>
              {status?.lastError ? <code className="remote-inline-error">{status.lastError}</code> : null}
            </div>
          </Panel>
        ) : (
          <>
            <Panel
              title="Connection"
              subtitle={`${status?.guildIds.length || 0} Discord server${status?.guildIds.length === 1 ? '' : 's'} connected via ${status?.runtime || 'node'}.`}
              testId="remote-status"
              actions={(
                <Button onClick={() => store.restart()} variant="secondary" loading={actionLoading} testId="remote-restart">
                  Restart
                </Button>
              )}
            >
              <div className="remote-connection-meta">
                <span><strong>App</strong> {status?.appId || 'Connected'}</span>
                <span><strong>Data</strong> {status?.dataDir || 'Managed by Elegy'}</span>
              </div>
            </Panel>

            <div className="remote-operations-grid">
              <Panel
                title="Projects"
                subtitle="Repositories mapped to Discord channels."
                testId="remote-projects"
                actions={<Button onClick={() => setShowAddProject((value) => !value)} testId="remote-add-project">Add project</Button>}
              >
                {showAddProject ? (
                  <form className="remote-inline-form" onSubmit={handleAddProject}>
                    <FormInput
                      label="Project directory"
                      value={directory}
                      placeholder="C:\path\to\repository"
                      onValueChange={setDirectory}
                      testId="remote-project-directory"
                    />
                    <div className="remote-form-actions">
                      <Button type="submit" loading={actionLoading}>Create Discord channel</Button>
                      <Button type="button" variant="ghost" onClick={() => setShowAddProject(false)}>Cancel</Button>
                    </div>
                  </form>
                ) : null}
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Project</th><th>Discord</th><th>Added</th></tr></thead>
                    <tbody>
                      {projects.map((item) => (
                        <tr key={item.directory}>
                          <td><code>{item.directory}</code></td>
                          <td>{item.channelId && item.guildId ? <a href={`https://discord.com/channels/${item.guildId}/${item.channelId}`} target="_blank" rel="noreferrer">Open channel</a> : 'Pending'}</td>
                          <td>{item.lastActivity || '—'}</td>
                        </tr>
                      ))}
                      {projects.length === 0 ? <tr><td className="empty-cell" colSpan={3}>Add a project to create its Discord channel.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Send a prompt" subtitle="Create a new Discord thread and OpenCode session." testId="remote-send">
                <form className="remote-composer" onSubmit={handleSend}>
                  <label className="form-input">
                    <span className="form-label">Project</span>
                    <select value={project} onChange={(event) => setProject(event.target.value)} disabled={projects.length === 0} data-testid="remote-send-project">
                      {projects.length === 0 ? <option value="">Add a project first</option> : null}
                      {projects.map((item) => <option key={item.directory} value={item.directory}>{item.directory}</option>)}
                    </select>
                  </label>
                  <label className="form-input">
                    <span className="form-label">Prompt</span>
                    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder="What should the remote session work on?" data-testid="remote-send-prompt" />
                  </label>
                  <Button type="submit" disabled={!project || !prompt.trim()} loading={actionLoading} testId="remote-send-btn">Start session</Button>
                </form>
              </Panel>
            </div>

            <Panel
              title="Recent sessions"
              subtitle="OpenCode sessions in registered projects. Kimaki mirrors them into Discord automatically."
              testId="remote-sessions"
            >
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Session</th><th>Project</th><th>Sync</th><th>Updated</th><th>Discord</th></tr></thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.sessionId || session.threadId || `${session.project}-${session.updatedAt}`}>
                        <td>{session.threadName || session.sessionId || 'Untitled session'}</td>
                        <td><code>{session.project || '—'}</code></td>
                        <td>
                          <StatusBadge
                            status={session.syncStatus === 'connected' ? 'Connected' : 'Pending sync'}
                            tone={session.syncStatus === 'connected' ? 'success' : 'accent'}
                          />
                        </td>
                        <td>{session.updatedAt || '—'}</td>
                        <td>
                          {session.discordUrl
                            ? <a href={session.discordUrl} target="_blank" rel="noreferrer">Open Discord thread</a>
                            : 'Waiting for Kimaki'}
                        </td>
                      </tr>
                    ))}
                    {sessions.length === 0 ? <tr><td className="empty-cell" colSpan={5}>No OpenCode sessions found in registered projects.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="remote-sync-guide">
                <strong>Automatic Discord sync</strong>
                <ol>
                  <li>Keep Kimaki connected.</li>
                  <li>Register the project directory above.</li>
                  <li>Start or continue OpenCode from that directory.</li>
                </ol>
                <p>Kimaki mirrors the conversation into a Discord thread. It does not stream terminal output.</p>
              </div>
            </Panel>
          </>
        )}

        <section className="remote-diagnostics">
          <button type="button" onClick={() => {
            const next = !showDiagnostics;
            setShowDiagnostics(next);
            if (next) void store.refreshLogs();
          }} aria-expanded={showDiagnostics}>
            Diagnostics
          </button>
          {showDiagnostics ? (
            <Panel
              testId="remote-logs"
              actions={<Button variant="secondary" onClick={() => store.refreshLogs()} testId="remote-refresh-logs">Refresh logs</Button>}
            >
              <LogViewer lines={logsTail} showLevel={false} testId="remote-log-viewer" />
            </Panel>
          ) : null}
        </section>

        <section className="remote-debug">
          <button type="button" onClick={() => {
            const next = !showDebug;
            setShowDebug(next);
            if (next) setRenameSessionId(sessions[0]?.sessionId || '');
          }} aria-expanded={showDebug}>
            Session debug
          </button>
          {showDebug ? (
            <Panel testId="remote-session-debug">
              <div className="remote-debug-form">
                <label className="form-input">
                  <span className="form-label">Session</span>
                  <select value={renameSessionId} onChange={(e) => {
                    setRenameSessionId(e.target.value);
                    const session = sessions.find((s) => s.sessionId === e.target.value);
                    if (session) setRenameTitle(session.threadName || '');
                  }} data-testid="remote-rename-session-select">
                    {sessions.length === 0 ? <option value="">No sessions loaded</option> : null}
                    {sessions.map((s) => (
                      <option key={s.sessionId} value={s.sessionId || ''}>
                        {s.threadName || s.sessionId || 'Untitled'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-input">
                  <span className="form-label">New name</span>
                  <input
                    type="text"
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    placeholder="Enter new session name"
                    data-testid="remote-rename-title-input"
                  />
                </label>
                <Button
                  onClick={async () => {
                    const id = renameSessionId.trim();
                    const name = renameTitle.trim();
                    if (!id || !name) return;
                    await store.renameSession(id, name);
                  }}
                  disabled={!renameSessionId.trim() || !renameTitle.trim()}
                  loading={actionLoading}
                  testId="remote-rename-btn"
                >
                  Rename
                </Button>
              </div>
            </Panel>
          ) : null}
        </section>
      </div>
    </PageContainer>
  );
}
