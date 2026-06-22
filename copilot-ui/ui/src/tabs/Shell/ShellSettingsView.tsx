import { useEffect, useMemo } from 'react';
import { Badge, Button, HealthDot, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { shellStore } from '../../stores/shellStore';
import type { ShellOption } from '../../stores/shellStore';

export default function ShellSettingsView() {
  useEffect(() => {
    async function init() {
      await shellStore.load();
      const currentStatus = shellStore.getState().status;
      await shellStore.loadOptions(currentStatus);
    }
    void init();
    return () => {
      shellStore.resetState();
    };
  }, []);

  const state = useStoreValue(shellStore);
  const { status, options, selectedShell, loading, saving, error, message } = state;

  // Resolve the selected shell option object for warnings display
  const selectedOption: ShellOption | null = useMemo(() => {
    if (!options || !selectedShell) return null;
    return options.find((o) => o.type === selectedShell) || null;
  }, [options, selectedShell]);

  const handleSelectShell = (shellType: string) => {
    shellStore.setState((prev) => ({ ...prev, selectedShell: shellType, message: null, error: null }));
  };

  const handleApply = () => {
    if (selectedShell) {
      void shellStore.setShell(selectedShell);
    }
  };

  // Derive what the active configured shell type is from status data
  const activeShellType = useMemo(() => {
    if (!status?.harnesses?.opencode?.shell || !options) return null;
    const activePath = status.harnesses.opencode.shell;
    const match = options.find((o) => o.path === activePath);
    return match ? match.type : null;
  }, [status, options]);

  // ── Loading state ──
  if (loading && !status) {
    return (
      <div className="shell-settings" data-testid="shell-settings-view">
        <Toolbar testId="shell-toolbar">
          <h2>Shell Configuration</h2>
        </Toolbar>
        <Panel title="Shell Configuration" subtitle="Default shell and terminal environment used by sessions">
          <HealthDot tone="loading" /> Checking...
        </Panel>
      </div>
    );
  }

  // ── Error state ──
  if (error && !status) {
    return (
      <div className="shell-settings" data-testid="shell-settings-view">
        <Toolbar testId="shell-toolbar">
          <h2>Shell Configuration</h2>
        </Toolbar>
        <Panel title="Shell Configuration" subtitle="Default shell and terminal environment used by sessions">
          <HealthDot tone="error" /> Failed to load: {error}
        </Panel>
      </div>
    );
  }

  if (!status) return null;

  const wsl2Check = status.checks.find((c) => c.id === 'wsl2');
  const firstDetectedShell = options && options.length > 0 ? options[0] : null;

  return (
    <div className="shell-settings" data-testid="shell-settings-view">
      <Toolbar testId="shell-toolbar">
        <h2>Shell Configuration</h2>
      </Toolbar>

      {/* ── Status cards row ── */}
      <div className="shell-status-row">
        <Panel title="WSL2" subtitle="Windows Subsystem for Linux availability">
          <div className="shell-status-card-content">
            <HealthDot tone={status.wsl2 === 'available' ? 'ok' : 'warn'} />
            <span>{status.wsl2 === 'available' ? 'Available' : status.wsl2 === 'unknown' ? 'N/A' : 'Not detected'}</span>
            {wsl2Check?.detail && (
              <small className="shell-status-detail">{wsl2Check.detail}</small>
            )}
          </div>
        </Panel>

        <Panel title="Active Shell" subtitle="Currently configured for OpenCode">
          <div className="shell-status-card-content">
            {activeShellType ? (
              <>
                <HealthDot tone="ok" />
                <Badge tone="brand">{activeShellType === 'gitbash' ? 'Git Bash' : activeShellType === 'wsl' ? 'WSL' : activeShellType}</Badge>
                {status.harnesses.opencode.shell && (
                  <small className="shell-status-detail">{status.harnesses.opencode.shell}</small>
                )}
              </>
            ) : status.harnesses.opencode.configured ? (
              <>
                <HealthDot tone="warn" />
                <span>Custom shell</span>
                <small className="shell-status-detail">{status.harnesses.opencode.shell}</small>
              </>
            ) : (
              <>
                <HealthDot tone="warn" />
                <span>Not configured</span>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Detected Shells" subtitle="Shells found on this system">
          <div className="shell-status-card-content">
            {firstDetectedShell ? (
              <>
                <HealthDot tone={firstDetectedShell.posix ? 'ok' : 'warn'} />
                <span>{firstDetectedShell.posix ? `${options!.length} POSIX shell(s)` : 'Non-POSIX only'}</span>
                <small className="shell-status-detail">{options!.length} total available</small>
              </>
            ) : (
              <>
                <HealthDot tone="warn" />
                <span>No shells detected</span>
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Shell Selection ── */}
      <Panel
        title="Shell Selection"
        subtitle="Choose the shell for AI agent sessions. Windows .exe tools (gh, node, npm) are resolved natively by Git Bash."
        testId="shell-selection"
      >
        {!options || options.length === 0 ? (
          <p className="shell-empty" data-testid="shell-options-empty">
            <HealthDot tone="warn" /> No shells detected on this system. Ensure WSL2 or Git for Windows is installed.
          </p>
        ) : (
          <div className="shell-options-list" data-testid="shell-options-list">
            {options.map((option) => (
              <label
                key={option.type}
                className={`shell-option${selectedShell === option.type ? ' shell-option--selected' : ''}`}
                data-testid={`shell-option-${option.type}`}
              >
                <input
                  type="radio"
                  name="shell"
                  value={option.type}
                  checked={selectedShell === option.type}
                  onChange={() => handleSelectShell(option.type)}
                  disabled={saving}
                />
                <div className="shell-option-info">
                  <div className="shell-option-header">
                    <strong>{option.label}</strong>
                    {option.recommended && (
                      <Badge tone="success" testId={`shell-option-recommended-${option.type}`}>Recommended</Badge>
                    )}
                    {activeShellType === option.type && (
                      <Badge tone="brand" testId={`shell-option-active-${option.type}`}>Active</Badge>
                    )}
                  </div>
                  <code className="shell-option-path">{option.path}</code>
                  <span className="shell-option-posix">
                    {option.posix ? 'POSIX-compatible' : 'Non-POSIX'}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

        {/* ── Warnings for selected shell ── */}
        {selectedOption && selectedOption.warnings.length > 0 && (
          <div className="shell-warnings" data-testid="shell-warnings">
            {selectedOption.warnings.map((warning, i) => (
              <p key={i} className="shell-warning-item">
                <HealthDot tone="warn" /> {warning}
              </p>
            ))}
          </div>
        )}
        {selectedOption && selectedOption.warnings.length === 0 && (
          <div className="shell-warnings shell-warnings--ok" data-testid="shell-warnings">
            <p className="shell-warning-item">
              <HealthDot tone="ok" /> No known issues with this shell for OpenCode agents.
            </p>
          </div>
        )}
      </Panel>

      {/* ── Apply Actions ── */}
      <div className="shell-apply-row" data-testid="shell-apply-row">
        <Button
          variant="primary"
          size="sm"
          testId="shell-apply-button"
          disabled={saving || !selectedShell}
          loading={saving}
          onClick={handleApply}
        >
          {saving ? 'Saving...' : 'Apply to OpenCode'}
        </Button>
        {message && (
          <p className="shell-success" data-testid="shell-success-message">{message}</p>
        )}
        {error && status && (
          <p className="shell-error" data-testid="shell-error-message">{error}</p>
        )}
      </div>

      {/* ── Troubleshooting ── */}
      <Panel title="Troubleshooting" subtitle="Common shell detection and configuration issues" testId="shell-troubleshoot">
        {status.wsl2 !== 'available' && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> WSL2 is not detected. Run <code>wsl --install</code> (requires admin privileges) to install Ubuntu, or install Git for Windows for Git Bash fallback.
          </p>
        )}
        {!status.harnesses.opencode.configured && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> OpenCode shell is not configured. Re-run <code>node scripts/opencode-install.mjs</code> to auto-configure.
          </p>
        )}
        {!status.harnesses.codex.configured && (
          <p className="shell-troubleshoot-item">
            <HealthDot tone="warn" /> Codex shell is not configured. Re-run <code>node scripts/codex-config-patch.mjs</code> to auto-configure.
          </p>
        )}
        <p className="shell-troubleshoot-item">
          <HealthDot tone="warn" /> WSL bash
          does not resolve Windows <code>.exe</code> tools (<code>gh</code>, <code>node</code>, <code>npm</code>).
          Switch to Git Bash or install tools inside WSL.
        </p>
        <p className="shell-troubleshoot-item">
          Full documentation: <code>docs/system/windows-shell-optimization.md</code>
        </p>
      </Panel>

      <style>{`
        .shell-settings h2 { margin: 0; }
        .shell-status-row { display: flex; gap: 16px; margin-bottom: 24px; }
        .shell-status-row > * { flex: 1; }
        .shell-status-card-content { display: flex; flex-direction: column; gap: 4px; }
        .shell-status-detail { color: var(--color-text-tertiary); font-size: 12px; margin-top: 4px; word-break: break-all; }
        .shell-harness-table { width: 100%; border-collapse: collapse; }
        .shell-harness-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border, #e0e0e0); font-weight: 600; }
        .shell-harness-table td { padding: 8px; }
        .shell-harness-table code { background: var(--surface2, #f5f5f5); padding: 2px 6px; border-radius: 3px; font-size: 12px; }
        .shell-troubleshoot-item { margin: 8px 0; }
        .shell-troubleshoot-item code { background: var(--surface2, #f5f5f5); padding: 2px 6px; border-radius: 3px; }

        /* Shell options list */
        .shell-options-list { display: flex; flex-direction: column; gap: 8px; }
        .shell-option {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 12px; border: 1px solid var(--border, #e0e0e0); border-radius: 6px;
          cursor: pointer; transition: border-color 0.15s, background 0.15s;
        }
        .shell-option:hover { border-color: var(--color-accent, #2563eb); background: var(--surface2, #f5f5f5); }
        .shell-option--selected { border-color: var(--color-accent, #2563eb); background: var(--surface2, #f5f5f5); }
        .shell-option input[type="radio"] { margin-top: 3px; flex-shrink: 0; }
        .shell-option-info { flex: 1; min-width: 0; }
        .shell-option-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
        .shell-option-path {
          display: block; font-size: 12px; color: var(--color-text-tertiary);
          word-break: break-all; margin-bottom: 2px;
        }
        .shell-option-posix { font-size: 12px; color: var(--color-text-secondary); }

        /* Warnings */
        .shell-warnings { margin-top: 12px; padding: 12px; background: var(--surface-warning, #fff8e1); border-radius: 6px; border: 1px solid var(--border-warning, #ffe082); }
        .shell-warnings--ok { background: var(--surface-success, #e8f5e9); border-color: var(--border-success, #a5d6a7); }
        .shell-warning-item { margin: 4px 0; font-size: 13px; }

        /* Apply row */
        .shell-apply-row { display: flex; align-items: center; gap: 12px; margin: 16px 0 24px; }
        .shell-success { color: var(--color-success, #2e7d32); font-size: 13px; margin: 0; }
        .shell-error { color: var(--color-danger, #c62828); font-size: 13px; margin: 0; }
        .shell-empty { margin: 8px 0; }
      `}</style>
    </div>
  );
}
