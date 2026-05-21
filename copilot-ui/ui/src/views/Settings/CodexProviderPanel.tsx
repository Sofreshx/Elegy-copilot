import { useEffect } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { codexProviderStore, type CodexProviderState } from '../../stores/codexProviderStore';

export default function CodexProviderPanel() {
  const state: CodexProviderState = useStoreValue(codexProviderStore);

  useEffect(() => {
    void codexProviderStore.load();
  }, []);

  const status = state.status;
  const activeMode = status?.activeMode || 'native';

  return (
    <Panel
      title="Codex Provider"
      subtitle="Switch local Codex between native defaults and Elegy routing"
      testId="settings-codex-provider"
      actions={
        <>
          <Button
            variant={activeMode === 'native' ? 'primary' : 'secondary'}
            size="sm"
            testId="codex-provider-native"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.setMode('native')}
          >
            {state.saving && activeMode !== 'native' ? 'Saving…' : 'Native Codex'}
          </Button>
          <Button
            variant={activeMode === 'elegy-routed' ? 'primary' : 'secondary'}
            size="sm"
            testId="codex-provider-elegy"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.setMode('elegy-routed')}
          >
            {state.saving && activeMode !== 'elegy-routed' ? 'Saving…' : 'Elegy Routed'}
          </Button>
        </>
      }
    >
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Current local default</strong>
          <span className="settings-row-description">
            This updates the shared Codex home config used by local Codex clients. Use Native Codex to keep the built-in OpenAI path unchanged.
          </span>
        </div>
        <div className="settings-row-action">
          <Badge tone={activeMode === 'elegy-routed' ? 'accent' : 'neutral'} testId="codex-provider-mode-badge">
            {activeMode === 'elegy-routed' ? 'Elegy Routed' : 'Native Codex'}
          </Badge>
        </div>
      </div>

      {status && (
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-description">
              Config: <code>{status.configPath}</code>
            </span>
            {status.gateway?.baseUrl ? (
              <span className="settings-row-description">
                Elegy gateway: <code>{status.gateway.baseUrl}</code>
              </span>
            ) : null}
          </div>
          <div className="settings-row-action">
            {status.hasBackup ? <Badge tone="brand" testId="codex-provider-backup-badge">Backup Ready</Badge> : null}
          </div>
        </div>
      )}

      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Recovery</strong>
          <span className="settings-row-description">
            Soft reset removes only Elegy-managed provider settings. Hard restore writes back the pre-Elegy backup snapshot.
          </span>
        </div>
        <div className="settings-row-action">
          <Button
            variant="secondary"
            size="sm"
            testId="codex-provider-soft-reset"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.reset(false)}
          >
            Soft Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="codex-provider-hard-reset"
            disabled={state.loading || state.saving || !status?.hasBackup}
            onClick={() => codexProviderStore.reset(true)}
          >
            Hard Restore
          </Button>
        </div>
      </div>

      {state.message ? (
        <p className="settings-row-description" data-testid="codex-provider-message">
          {state.message}
        </p>
      ) : null}

      {state.error ? (
        <p className="settings-row-error" data-testid="codex-provider-error">
          {state.error}
        </p>
      ) : null}

      <div className="settings-row">
        <div className="settings-row-label">
          <span className="settings-row-description">
            Existing open Codex windows may need a new thread or restart before provider changes are reflected.
          </span>
        </div>
      </div>
    </Panel>
  );
}
