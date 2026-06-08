import React, { useEffect } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { githubStore } from '../../stores/githubStore';

export default function GitHubSettingsView() {
  const state = useStoreValue(githubStore);

  useEffect(() => {
    void githubStore.load();
    return () => {
      githubStore.resetState();
    };
  }, []);

  const handleLogin = () => {
    void githubStore.login();
  };

  const handleRefresh = () => {
    void githubStore.load();
  };

  return (
    <div className="github-settings-view" data-testid="github-settings-view">
      <Toolbar testId="github-settings-toolbar">
        <h2>GitHub CLI Setup</h2>
      </Toolbar>

      <div className="github-settings-content">
        {state.loading && !state.status ? (
          <p className="opencode-loading" data-testid="github-loading">Loading GitHub status...</p>
        ) : null}

        {state.installLoading ? (
          <p className="opencode-loading" data-testid="github-installing">Installing GitHub CLI... This may take a minute.</p>
        ) : null}

        {state.error ? (
          <p className="opencode-error" data-testid="github-error">{state.error}</p>
        ) : null}

        {state.message ? (
          <p className="opencode-message" data-testid="github-message">{state.message}</p>
        ) : null}

        {state.status ? (
          <>
            <Panel title="CLI Status" subtitle="GitHub CLI installation and authentication" testId="github-status">
              <div className="opencode-readiness-cards">
                <div className="opencode-readiness-card">
                  <span className="opencode-readiness-label">CLI Installed</span>
                  <Badge tone={state.status.ghInstalled ? 'success' : 'danger'} testId="github-gh-installed">
                    {state.status.ghInstalled ? 'INSTALLED' : 'NOT FOUND'}
                  </Badge>
                </div>
                {state.status.ghVersion && (
                  <div className="opencode-readiness-card">
                    <span className="opencode-readiness-label">Version</span>
                    <code className="opencode-readiness-value">{state.status.ghVersion}</code>
                  </div>
                )}
                <div className="opencode-readiness-card">
                  <span className="opencode-readiness-label">Authenticated</span>
                  <Badge tone={state.status.authenticated ? 'success' : 'accent'} testId="github-authenticated">
                    {state.status.authenticated ? 'YES' : 'NO'}
                  </Badge>
                </div>
                {state.status.user && (
                  <div className="opencode-readiness-card">
                    <span className="opencode-readiness-label">GitHub User</span>
                    <Badge tone="brand" testId="github-user">{state.status.user}</Badge>
                  </div>
                )}
              </div>

              {state.status.error && (
                <div className="opencode-error" style={{ marginTop: '12px' }}>{state.status.error}</div>
              )}
            </Panel>

            <Panel title="Setup" subtitle="Connect and configure GitHub CLI" testId="github-setup">
              {!state.status.ghInstalled ? (
                <div className="github-setup-install">
                  <h4>Install GitHub CLI</h4>
                  <p>The <code>gh</code> command-line tool is required for GitHub integration (push, pull requests, auth).</p>
                  <div className="opencode-model-actions" style={{ marginTop: '12px' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      testId="github-install-button"
                      disabled={state.installLoading}
                      onClick={() => void githubStore.install()}
                    >
                      {state.installLoading ? 'Installing...' : 'Install GitHub CLI'}
                    </Button>
                  </div>
                  <p style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    This will download and install the latest GitHub CLI. You may be prompted for administrator permissions.
                    If automatic install fails, you can also{' '}
                    <a href="https://cli.github.com/" target="_blank" rel="noopener noreferrer">
                      download manually →
                    </a>
                  </p>
                </div>
              ) : !state.status.authenticated ? (
                <div className="github-setup-auth">
                  <h4>Authenticate with GitHub</h4>
                  <p>Connect your GitHub account to enable push, pull requests, and repository operations.</p>
                  <div className="opencode-model-actions" style={{ marginTop: '12px' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      testId="github-login-button"
                      disabled={state.loginLoading}
                      onClick={handleLogin}
                    >
                      {state.loginLoading ? 'Opening browser...' : 'Login with GitHub (web)'}
                    </Button>
                  </div>
                  <p style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    Or run <code>gh auth login</code> in your terminal for more options (token, SSH, etc.).
                  </p>
                </div>
              ) : (
                <div className="github-setup-ok">
                  <h4>Connected</h4>
                  <p>GitHub CLI is installed and authenticated as <strong>{state.status.user || 'unknown'}</strong>. You can use git push, pull requests, and other GitHub features.</p>
                </div>
              )}
            </Panel>

            <Panel title="Troubleshooting" subtitle="Common issues and fixes" testId="github-troubleshoot">
              <dl className="settings-shortcuts-list">
                <dt>CLI not found after install</dt>
                <dd>Restart the Elegy Copilot dashboard or your terminal. Ensure <code>gh</code> is in your PATH.</dd>
                <dt>Authentication expired</dt>
                <dd>Run <code>gh auth refresh</code> or click "Login with GitHub" above to re-authenticate.</dd>
                <dt>Permission denied on push</dt>
                <dd>Ensure your GitHub token has <code>repo</code> scope. Use <code>gh auth refresh -s repo</code> to update scopes.</dd>
                <dt>OAuth setup</dt>
                <dd>GitHub CLI uses OAuth by default when running <code>gh auth login --web</code>. For headless environments, use <code>gh auth login --with-token</code>.</dd>
              </dl>
            </Panel>
          </>
        ) : null}

        <div className="opencode-model-actions" style={{ marginTop: '16px' }}>
          <Button
            variant="secondary"
            size="sm"
            testId="github-refresh"
            disabled={state.loading}
            onClick={handleRefresh}
          >
            {state.loading ? 'Checking...' : 'Refresh Status'}
          </Button>
        </div>
      </div>
    </div>
  );
}
