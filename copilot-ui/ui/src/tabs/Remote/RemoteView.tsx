import { useEffect, useCallback, useRef } from 'react';
import { useRemoteStore } from './RemoteStore';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  awaiting_install: 'Awaiting Install',
  awaiting_auth: 'Awaiting Authorization',
  ready: 'Ready',
  error: 'Error',
  unavailable: 'Unavailable',
};

export default function RemoteView() {
  const store = useRemoteStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { status, projects, sessions, logsTail, loading, error } = store;

  useEffect(() => {
    store.loadStatus();
    store.loadProjects();
    store.loadSessions();
    store.refreshLogs();

    intervalRef.current = setInterval(() => {
      store.loadStatus();
      store.loadProjects();
      store.loadSessions();
    }, 10_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleInstall = useCallback(() => {
    if (status?.installUrl) {
      window.open(status.installUrl, '_blank');
    }
  }, [status?.installUrl]);

  const handleRestart = useCallback(() => {
    store.restart();
  }, []);

  const handleAddProject = useCallback(async () => {
    const dir = prompt('Enter project directory path:');
    if (dir) {
      await store.addProject(dir);
    }
  }, []);

  const handleRemoveProject = useCallback(async (dir: string) => {
    if (confirm(`Remove project ${dir}?`)) {
      await store.removeProject(dir);
    }
  }, []);

  const handleSendPrompt = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const project = formData.get('project') as string;
    const prompt = formData.get('prompt') as string;

    if (!project || !prompt) return;

    await store.sendPrompt(project, prompt);
    form.reset();
  }, []);

  return (
    <div className="remote-view" data-testid="remote-view">
      <h2>Remote Sessions (Kimaki)</h2>

      {error && (
        <div className="remote-error" data-testid="remote-error">
          {error}
        </div>
      )}

      <section className="remote-status-card" data-testid="remote-status">
        <h3>Status</h3>
        <div>
          <span className={`status-badge status-${status?.state || 'unknown'}`}>
            {STATUS_LABELS[status?.state || 'unknown'] || status?.state}
          </span>
          {status?.dataDir && <span className="remote-data-dir">Data: {status.dataDir}</span>}
          {status?.lastError && <span className="remote-last-error">{status.lastError}</span>}
        </div>
        <div className="remote-status-actions">
          <button onClick={handleRestart} type="button" data-testid="remote-restart">
            Restart
          </button>
          {status?.state !== 'ready' && status?.installUrl && (
            <button
              onClick={handleInstall}
              type="button"
              className="primary"
              data-testid="remote-install"
            >
              Install Kimaki to Discord
            </button>
          )}
        </div>
      </section>

      <section className="remote-projects" data-testid="remote-projects">
        <h3>Projects</h3>
        <button onClick={handleAddProject} type="button" data-testid="remote-add-project">
          Add Project
        </button>
        <table>
          <thead>
            <tr>
              <th>Directory</th>
              <th>Channel</th>
              <th>Last Activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.directory}>
                <td>{p.directory}</td>
                <td>
                  {p.channelId && p.guildId ? (
                    <a
                      href={`https://discord.com/channels/${p.guildId}/${p.channelId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
                <td>{p.lastActivity || '-'}</td>
                <td>
                  <button
                    onClick={() => handleRemoveProject(p.directory)}
                    type="button"
                    data-testid={`remote-remove-${p.directory}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={4}>No projects configured</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="remote-sessions" data-testid="remote-sessions">
        <h3>Sessions</h3>
        <table>
          <thead>
            <tr>
              <th>Thread</th>
              <th>Project</th>
              <th>Status</th>
              <th>Last Message</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.threadId}>
                <td>{s.threadName || s.threadId}</td>
                <td>{s.project || '-'}</td>
                <td>{s.status}</td>
                <td>{s.updatedAt || '-'}</td>
                <td>
                  {s.channelId && s.guildId ? (
                    <a
                      href={`https://discord.com/channels/${s.guildId}/${s.channelId}/${s.threadId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Thread
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5}>No active sessions</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="remote-send" data-testid="remote-send">
        <h3>Send Prompt</h3>
        <form onSubmit={handleSendPrompt}>
          <select name="project" required data-testid="remote-send-project">
            <option value="">Select project...</option>
            {projects.map((p) => (
              <option key={p.directory} value={p.directory}>
                {p.directory}
              </option>
            ))}
          </select>
          <textarea
            name="prompt"
            placeholder="Enter prompt..."
            required
            rows={4}
            data-testid="remote-send-prompt"
          />
          <button type="submit" disabled={loading} data-testid="remote-send-btn">
            Send
          </button>
        </form>
      </section>

      <section className="remote-logs" data-testid="remote-logs">
        <h3>Logs</h3>
        <button onClick={() => store.refreshLogs()} type="button" data-testid="remote-refresh-logs">
          Refresh
        </button>
        <pre className="remote-log-block">
          {logsTail.join('\n') || 'No log entries'}
        </pre>
      </section>

      <section className="remote-troubleshooting">
        <h3>Troubleshooting</h3>
        <ul>
          <li>If Kimaki is not responding, try <strong>Restart</strong></li>
          <li>Use <code>/upgrade-and-restart</code> in Discord to update Kimaki</li>
          <li>See <a href="https://kimaki.dev" target="_blank" rel="noopener noreferrer">kimaki.dev</a> for documentation</li>
        </ul>
      </section>
    </div>
  );
}
