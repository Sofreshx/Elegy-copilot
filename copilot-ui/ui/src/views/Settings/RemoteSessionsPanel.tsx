import { useEffect } from 'react';
import { Button, Panel, Badge } from '../../components';
import { useStoreValue } from '../../lib/store';
import { remotePreferenceStore, type RemotePreferenceState } from '../../stores/remotePreferenceStore';

export default function RemoteSessionsPanel() {
  const state: RemotePreferenceState = useStoreValue(remotePreferenceStore);

  useEffect(() => {
    void remotePreferenceStore.load();
  }, []);

  return (
    <Panel
      title="Remote Sessions"
      subtitle="Stream CLI sessions to GitHub.com for web and mobile access"
      testId="settings-remote-sessions"
      actions={
        <Button
          variant={state.enabled ? 'primary' : 'secondary'}
          size="sm"
          testId="remote-sessions-toggle"
          disabled={state.loading || state.saving}
          onClick={() => remotePreferenceStore.toggle(!state.enabled)}
        >
          {state.saving ? 'Saving…' : state.enabled ? 'On' : 'Off'}
        </Button>
      }
    >
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Default remote mode</strong>
          <span className="settings-row-description">
            When enabled, new sessions stream activity to GitHub.com in real time.
            You can view and steer sessions from your browser or phone.
          </span>
        </div>
        <div className="settings-row-action">
          {state.enabled && <Badge tone="accent" testId="remote-sessions-active-badge">Active</Badge>}
        </div>
      </div>

      {state.warning && (
        <p className="settings-row-warning" data-testid="remote-sessions-warning">
          ⚠️ {state.warning}
        </p>
      )}

      {state.error && (
        <p className="settings-row-error" data-testid="remote-sessions-error">
          {state.error}
        </p>
      )}

      <div className="settings-row">
        <div className="settings-row-label">
          <span className="settings-row-description">
            <strong>Note:</strong> Remote sessions require a GitHub-hosted repository.
            For Copilot Business/Enterprise, the "Remote Control" policy must be enabled by your admin.
            Per-session override is available in the session wizard.
          </span>
        </div>
      </div>
    </Panel>
  );
}
