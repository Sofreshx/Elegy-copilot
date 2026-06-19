import { useEffect, useCallback, useRef } from 'react';
import { Button, PageContainer, Panel } from '../../components';
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

  const handleRestart = useCallback(async () => {
    await store.restart();
  }, []);

  const handleAddProject = useCallback(async () => {
    const dir = prompt('Enter project directory path:');
    if (dir) {
      await store.addProject(dir);
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
    <PageContainer testId="remote-view">
      <h2>Remote Sessions (Kimaki)</h2>

      {error && (
        <div className="remote-error" data-testid="remote-error">
          {error}
        </div>
      )}

      <Panel
        title="Status"
        testId="remote-status"
        actions={(
          <>
            <Button onClick={handleRestart} variant="secondary" loading={loading} testId="remote-restart">
              Restart
            </Button>
            {status?.state !== 'ready' && status?.installUrl ? (
              <Button onClick={handleInstall} testId="remote-install">
                Install Kimaki to Discord
              </Button>
            ) : null}
          </>
        )}
      >
        <div>
          <span className={`status-badge status-${status?.state || 'unknown'}`}>
            {STATUS_LABELS[status?.state || 'unknown'] || status?.state}
          </span>
          {status?.dataDir && <span className="remote-data-dir">Data: {status.dataDir}</span>}
          {status?.lastError && <span className="remote-last-error">{status.lastError}</span>}
        </div>
      </Panel>

      <Panel
        title="Projects"
        testId="remote-projects"
        actions={<Button onClick={handleAddProject} testId="remote-add-project">Add Project</Button>}
      >
        <table>
          <thead>
            <tr>
              <th>Directory</th>
              <th>Channel</th>
              <th>Last Activity</th>
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
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={3}>No projects configured</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel title="Sessions" testId="remote-sessions">
        <table>
          <thead>
            <tr>
              <th>Thread</th>
              <th>Project</th>
              <th>Source</th>
              <th>Last Message</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.threadId}>
                <td>{s.threadName || s.threadId}</td>
                <td>{s.project || '-'}</td>
                <td>{s.source}</td>
                <td>{s.updatedAt || '-'}</td>
                <td>
                  {s.guildId ? (
                    <a
                      href={`https://discord.com/channels/${s.guildId}/${s.threadId}`}
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
      </Panel>

      <Panel title="Send Prompt" testId="remote-send">
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
          <Button type="submit" loading={loading} testId="remote-send-btn">
            Send
          </Button>
        </form>
      </Panel>

      <Panel
        title="Logs"
        testId="remote-logs"
        actions={<Button onClick={() => store.refreshLogs()} variant="secondary" testId="remote-refresh-logs">Refresh</Button>}
      >
        <pre className="remote-log-block">
          {logsTail.join('\n') || 'No log entries'}
        </pre>
      </Panel>

      <section className="remote-troubleshooting">
        <h3>Troubleshooting</h3>
        <ul>
          <li>If Kimaki is not responding, try <strong>Restart</strong></li>
          <li>Use <code>/upgrade-and-restart</code> in Discord to update Kimaki</li>
          <li>See <a href="https://kimaki.dev" target="_blank" rel="noopener noreferrer">kimaki.dev</a> for documentation</li>
        </ul>
      </section>
    </PageContainer>
  );
}
