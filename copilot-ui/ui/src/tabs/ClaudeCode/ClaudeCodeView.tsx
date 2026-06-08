import { useEffect } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { ClaudeCodeStatusResponse } from '../../lib/types';
import { claudeCodeStore } from '../../stores/claudeCodeStore';
import ClaudeCodeProviderPanel from '../../views/Settings/ClaudeCodeProviderPanel';

function StatusDot({ status }: { status: string }) {
  const className = status === 'ok' ? 'health-dot health-dot-ok'
    : status === 'warning' ? 'health-dot health-dot-warn'
    : status === 'blocked' || status === 'critical' ? 'health-dot health-dot-error'
    : 'health-dot health-dot-neutral';
  return (
    <span className={className}>
      <span className="health-dot-pip" aria-hidden="true" />
    </span>
  );
}

function ReadinessSection({ status }: { status: ClaudeCodeStatusResponse }) {
  const overallBadge = status.overallStatus === 'ready' ? 'success'
    : status.overallStatus === 'degraded' ? 'accent'
    : 'danger';

  return (
    <div className="opencode-section" data-testid="claude-code-readiness">
      <Panel title="Readiness Dashboard" testId="claude-code-readiness">
        <div className="opencode-readiness-cards">
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Overall Status</span>
            <Badge tone={overallBadge} testId="claude-code-overall-status">
              {status.overallStatus.toUpperCase()}
            </Badge>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Claude Home</span>
            <code className="opencode-readiness-value">{status.claudeHome}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Config Path</span>
            <code className="opencode-readiness-value">{status.claudeConfigPath || 'Not found'}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">CLI Installed</span>
            <StatusDot status={status.cli.installed ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {status.cli.installed ? (status.cli.version || 'Installed') : 'Not installed'}
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SetupSection({ status }: { status: ClaudeCodeStatusResponse }) {
  const state = useStoreValue(claudeCodeStore);

  const handleInstall = () => {
    void claudeCodeStore.installCli();
  };

  return (
    <div className="opencode-section" data-testid="claude-code-setup">
      <Panel title="Setup" testId="claude-code-setup-checklist">
        <div className="opencode-setup-row" data-testid="claude-code-setup-cli">
          <StatusDot status={status.cli.installed ? 'ok' : 'warning'} />
          <div className="opencode-setup-content">
            <strong>Claude Code CLI</strong>
            <p>
              {status.cli.installed
                ? `Installed${status.cli.version ? `: ${status.cli.version}` : ''}`
                : 'Claude Code CLI not detected. Install via npm.'}
            </p>
            {status.cli.lastError ? (
              <p style={{ color: 'var(--danger-color, #c00)', fontSize: '0.75rem' }}>
                {status.cli.lastError}
              </p>
            ) : null}
          </div>
          <div className="opencode-setup-action">
            {!status.cli.installed ? (
              <Button
                variant="secondary"
                size="sm"
                testId="claude-code-setup-action-cli"
                disabled={state.installing}
                onClick={handleInstall}
              >
                {state.installing ? 'Installing…' : 'Install Claude Code CLI'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                testId="claude-code-setup-action-cli"
                disabled={state.installing}
                onClick={handleInstall}
              >
                {state.installing ? 'Reinstalling…' : 'Reinstall Claude Code CLI'}
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default function ClaudeCodeView() {
  const state = useStoreValue(claudeCodeStore);

  useEffect(() => {
    void claudeCodeStore.load();
    return () => {
      claudeCodeStore.resetState();
    };
  }, []);

  return (
    <div className="opencode-view" data-testid="claude-code-view">
      <Toolbar testId="claude-code-toolbar">
        <h2>Claude Code Setup</h2>
      </Toolbar>

      <div className="opencode-content">
        {state.loading && !state.status ? (
          <p className="opencode-loading" data-testid="claude-code-loading">Loading Claude Code status...</p>
        ) : null}

        {state.error ? (
          <p className="opencode-error" data-testid="claude-code-error">{state.error}</p>
        ) : null}

        {state.message ? (
          <p className="opencode-message" data-testid="claude-code-message">{state.message}</p>
        ) : null}

        {state.status ? (
          <>
            <ReadinessSection status={state.status} />
            <SetupSection status={state.status} />
            <div className="opencode-section" data-testid="claude-code-provider-section">
              <ClaudeCodeProviderPanel />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
