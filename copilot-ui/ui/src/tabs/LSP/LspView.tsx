import { useEffect } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { lspStore } from './lspStore';

export default function LspView() {
  const lspState = useStoreValue(lspStore);

  useEffect(() => {
    void lspStore.loadConfig();
  }, []);

  const handleRefresh = async () => {
    await lspStore.refresh();
  };

  const handleInstall = async () => {
    try {
      await lspStore.install();
    } catch {
      // Store already captures and exposes the error state.
    }
  };

  const configJson = JSON.stringify(lspState.config, null, 2);

  return (
    <section className="lsp-view" data-testid="lsp-view">
      <Toolbar testId="lsp-view-toolbar">
        <div className="lsp-summary">
          <p className="lsp-title">Language Server Configuration</p>
          <p className="lsp-copy">Read current config and trigger installation manually.</p>
        </div>

        <div className="lsp-toolbar-actions">
          <Button
            disabled={lspState.loading || lspState.installing}
            onClick={handleRefresh}
            testId="lsp-view-refresh"
            variant="secondary"
          >
            {lspState.loading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button
            disabled={lspState.installing}
            onClick={handleInstall}
            testId="lsp-view-install"
            variant="primary"
          >
            {lspState.installing ? 'Installing...' : 'Install LSP'}
          </Button>
        </div>
      </Toolbar>

      {lspState.error ? (
        <p className="lsp-error" role="alert">
          {lspState.error}
        </p>
      ) : null}

      <div className="lsp-grid">
        <Panel
          subtitle="Raw response from GET /api/lsp/config."
          testId="lsp-config-panel"
          title="LSP Config"
        >
          <pre className="code-block">{configJson || '{}'}</pre>
        </Panel>

        <Panel
          subtitle="Output from POST /api/lsp/install."
          testId="lsp-install-panel"
          title="Install Logs"
        >
          <p className="lsp-install-meta">{lspState.installMeta}</p>
          <pre className="code-block">{lspState.installLogs || 'No install logs captured yet.'}</pre>
        </Panel>
      </div>
    </section>
  );
}
