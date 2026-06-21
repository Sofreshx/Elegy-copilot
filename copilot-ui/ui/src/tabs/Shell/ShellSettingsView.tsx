import { useEffect } from 'react';
import { Badge, HealthDot, Panel } from '../../components';
import { createStore, useStoreValue } from '../../lib/store';

interface ShellDetectedShell {
  type: string;
  path: string;
  posix: boolean;
}

interface ShellHarnessConfig {
  shell: string | null;
  configured: boolean;
}

interface ShellStatus {
  wsl2: string;
  detectedShell: ShellDetectedShell | null;
  harnesses: {
    opencode: ShellHarnessConfig;
    codex: ShellHarnessConfig;
  };
  checks: Array<{ id: string; label: string; status: string; detail: string }>;
}

interface ShellState {
  data: ShellStatus | null;
  loading: boolean;
  error: string | null;
}

const shellStore = createStore<ShellState>({
  data: null,
  loading: true,
  error: null,
});

async function fetchShellStatus() {
  shellStore.setState({ data: null, loading: true, error: null });
  try {
    const res = await fetch('/api/shell/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ShellStatus = await res.json();
    shellStore.setState({ data, loading: false, error: null });
  } catch (e) {
    shellStore.setState({ data: null, loading: false, error: String(e) });
  }
}

export default function ShellSettingsView() {
  useEffect(() => {
    fetchShellStatus();
  }, []);

  const { data, loading, error } = useStoreValue(shellStore);

  if (loading) {
    return (
      <div className="shell-settings">
        <Panel title="Shell Configuration" subtitle="Default shell and terminal environment used by sessions">
          <HealthDot tone="loading" /> Checking...
        </Panel>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell-settings">
        <Panel title="Shell Configuration" subtitle="Default shell and terminal environment used by sessions">
          <HealthDot tone="error" /> Failed to load: {error}
        </Panel>
      </div>
    );
  }

  if (!data) return null;

  const findCheck = (id: string) => data.checks.find(c => c.id === id);

  const wsl2Check = findCheck('wsl2');
  const shellDetectCheck = findCheck('shell-detect');
  const opencodeShellCheck = findCheck('opencode-shell');
  const codexShellCheck = findCheck('codex-shell');

  return (
    <div className="shell-settings">
      <h2>Shell Configuration</h2>

      {/* Status cards row */}
      <div className="shell-status-row">
        <Panel title="WSL2" subtitle="Windows Subsystem for Linux detection and configuration">
          <div className="shell-status-card-content">
            <HealthDot tone={data.wsl2 === 'available' ? 'ok' : 'warn'} />
            <span>{data.wsl2 === 'available' ? 'Available' : data.wsl2 === 'unknown' ? 'N/A' : 'Not detected'}</span>
            {wsl2Check?.detail && (
              <small className="shell-status-detail">{wsl2Check.detail}</small>
            )}
          </div>
        </Panel>

        <Panel title="Detected Shell" subtitle="Shells found on this system available for sessions">
          <div className="shell-status-card-content">
            {data.detectedShell ? (
              <>
                <HealthDot tone={data.detectedShell.posix ? 'ok' : 'warn'} />
                <Badge tone="brand">{data.detectedShell.type}</Badge>
                <small className="shell-status-detail">{data.detectedShell.path}</small>
              </>
            ) : (
              <>
                <HealthDot tone="warn" />
                <span>No POSIX shell found</span>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Configuration" subtitle="Edit shell preferences and environment variables">
          <div className="shell-status-card-content">
            <HealthDot tone={data.detectedShell?.posix ? 'ok' : 'warn'} />
            <span>{data.detectedShell?.posix ? 'Auto-detected' : 'Manual setup needed'}</span>
          </div>
        </Panel>
      </div>

      {/* Harness configuration table */}
      <Panel title="Harness Shell Configuration" subtitle="Per-harness shell overrides for OpenCode, Codex, Claude Code, and Antigravity">
        <table className="shell-harness-table">
          <thead>
            <tr>
              <th>Harness</th>
              <th>Status</th>
              <th>Shell</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OpenCode</td>
              <td>
                <HealthDot tone={data.harnesses.opencode.configured ? 'ok' : 'warn'} />
                {' '}{data.harnesses.opencode.configured ? 'Configured' : 'Not configured'}
              </td>
              <td><code>{data.harnesses.opencode.shell || '\u2014'}</code></td>
            </tr>
            <tr>
              <td>Codex</td>
              <td>
                <HealthDot tone={data.harnesses.codex.configured ? 'ok' : 'warn'} />
                {' '}{data.harnesses.codex.configured ? 'Configured' : 'Not configured'}
              </td>
              <td><code>{data.harnesses.codex.shell || '\u2014'}</code></td>
            </tr>
            <tr>
              <td>Launcher</td>
              <td><HealthDot tone="ok" /> Active</td>
              <td><code>{data.detectedShell?.type || 'pwsh'}</code></td>
            </tr>
            <tr>
              <td>Worktree plugin</td>
              <td><HealthDot tone="ok" /> Auto-detect</td>
              <td><code>{data.detectedShell?.path || 'cmd'}</code></td>
            </tr>
          </tbody>
        </table>
      </Panel>

      {/* Troubleshooting panel */}
      <Panel title="Troubleshooting" subtitle="Common shell detection and configuration issues">
        {data.wsl2 !== 'available' && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> WSL2 is not detected. Run <code>wsl --install</code> (requires admin privileges) to install Ubuntu, or install Git for Windows for Git Bash fallback.
          </p>
        )}
        {!data.harnesses.opencode.configured && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> OpenCode shell is not configured. Re-run <code>node scripts/opencode-install.mjs</code> to auto-configure.
          </p>
        )}
        {!data.harnesses.codex.configured && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> Codex shell is not configured. Re-run <code>node scripts/codex-config-patch.mjs</code> to auto-configure.
          </p>
        )}
        <p className="shell-troubleshoot-item">
          Full documentation: <code>docs/system/windows-shell-optimization.md</code>
        </p>
      </Panel>

      <style>{`
        .shell-settings h2 { margin-bottom: 16px; }
        .shell-status-row { display: flex; gap: 16px; margin-bottom: 16px; }
        .shell-status-row > * { flex: 1; }
        .shell-status-card-content { display: flex; flex-direction: column; gap: 4px; }
        .shell-status-detail { color: var(--color-text-tertiary); font-size: 12px; margin-top: 4px; }
        .shell-harness-table { width: 100%; border-collapse: collapse; }
        .shell-harness-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border, #e0e0e0); font-weight: 600; }
        .shell-harness-table td { padding: 8px; }
        .shell-harness-table code { background: var(--surface2, #f5f5f5); padding: 2px 6px; border-radius: 3px; font-size: 12px; }
        .shell-troubleshoot-item { margin: 8px 0; display: flex; align-items: center; gap: 8px; }
        .shell-troubleshoot-item code { background: var(--surface2, #f5f5f5); padding: 2px 6px; border-radius: 3px; }
      `}</style>
    </div>
  );
}
