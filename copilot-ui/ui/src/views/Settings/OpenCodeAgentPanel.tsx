import { useEffect, useState } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { opencodeAgentStore, type OpenCodeAgentState } from '../../stores/opencodeAgentStore';

export default function OpenCodeAgentPanel() {
  const state: OpenCodeAgentState = useStoreValue(opencodeAgentStore);
  const [exploreModel, setExploreModel] = useState('');
  const [scoutModel, setScoutModel] = useState('');

  useEffect(() => {
    void opencodeAgentStore.load();
  }, []);

  useEffect(() => {
    if (state.status) {
      setExploreModel(state.status.exploreModel);
      setScoutModel(state.status.scoutModel);
    }
  }, [state.status]);

  const hasChanges = state.status
    ? exploreModel !== state.status.exploreModel || scoutModel !== state.status.scoutModel
    : false;

  const handleSave = () => {
    void opencodeAgentStore.save(exploreModel, scoutModel);
  };

  const handleReset = () => {
    void opencodeAgentStore.reset();
  };

  return (
    <Panel
      title="OpenCode Agents"
      subtitle="Configure model selection for exploration and research agents"
      testId="settings-opencode-agents"
      actions={
        <>
          <Button
            variant="primary"
            size="sm"
            testId="opencode-agents-save"
            disabled={state.loading || state.saving || !hasChanges}
            onClick={handleSave}
          >
            {state.saving ? 'Saving...' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            testId="opencode-agents-reset"
            disabled={state.loading || state.saving || !state.status?.isCustom}
            onClick={handleReset}
          >
            Reset to Defaults
          </Button>
        </>
      }
    >
      {state.loading && !state.status ? (
        <p className="settings-about-loading">Loading...</p>
      ) : null}

      {state.error ? (
        <p className="settings-row-error" data-testid="opencode-agents-error">
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <p className="settings-row-description" data-testid="opencode-agents-message">
          {state.message}
        </p>
      ) : null}

      {state.status ? (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Explore Agent Model</strong>
              <span className="settings-row-description">
                Used for codebase exploration and search tasks
              </span>
            </div>
            <div className="settings-row-action">
              <select
                value={exploreModel}
                onChange={(e) => setExploreModel(e.target.value)}
                disabled={state.saving}
                data-testid="opencode-explore-model-select"
              >
                {state.status.availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Scout Agent Model</strong>
              <span className="settings-row-description">
                Used for external documentation research
              </span>
            </div>
            <div className="settings-row-action">
              <select
                value={scoutModel}
                onChange={(e) => setScoutModel(e.target.value)}
                disabled={state.saving}
                data-testid="opencode-scout-model-select"
              >
                {state.status.availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-description">
                Config: <code>{state.status.configPath}</code>
              </span>
            </div>
            <div className="settings-row-action">
              <Badge
                tone={state.status.isCustom ? 'accent' : 'neutral'}
                testId="opencode-agents-mode-badge"
              >
                {state.status.isCustom ? 'Custom' : 'Default'}
              </Badge>
            </div>
          </div>
        </>
      ) : null}
    </Panel>
  );
}
