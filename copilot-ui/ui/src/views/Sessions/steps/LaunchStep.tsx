import { useEffect, useState } from 'react';
import { FormInput } from '../../../components';
import { listSdkModels } from '../../../lib/api';
import { getRemotePreference } from '../../../lib/api/sdk';
import { SESSION_AGENTS } from '../../../constants/sessionAgents';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';

interface LaunchStepProps {
  state: SessionWizardState;
}

const PRIMARY_MODELS = ['claude-sonnet-4.6', 'gpt-5.4'];

function projectLabel(state: SessionWizardState): string {
  if (state.useCustomRepo && state.customRepoPath) return state.customRepoPath;
  if (state.selectedProject) return state.selectedProject.repoLabel ?? state.selectedProject.repoPath ?? 'Unknown';
  return 'None selected';
}

function objectivePreview(state: SessionWizardState): string {
  if (state.objective) {
    return state.objective.length > 120
      ? state.objective.slice(0, 120) + '…'
      : state.objective;
  }
  return 'No objective set';
}

function isolationLabel(state: SessionWizardState): string {
  if (state.isolationMode === 'worktree') return `Worktree${state.worktreeId ? ` (${state.worktreeId})` : ''}`;
  if (state.isolationMode === 'sandbox') return `Sandbox${state.sandboxId ? ` (${state.sandboxId})` : ''}`;
  return 'Shared';
}

function agentLabel(state: SessionWizardState): string {
  const agent = SESSION_AGENTS.find(a => a.id === state.agentId);
  return agent ? `${agent.icon} ${agent.label}` : state.agentId;
}

export default function LaunchStep({ state }: LaunchStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(state.actorLabel || state.actorRole),
  );
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [globalRemoteDefault, setGlobalRemoteDefault] = useState(false);

  useEffect(() => {
    if (!state.model) {
      const agent = SESSION_AGENTS.find(a => a.id === state.agentId);
      if (agent?.defaultModel) {
        sessionWizardStore.setModel(agent.defaultModel);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setModelsLoading(true);
    listSdkModels()
      .then((response) => {
        if (cancelled) return;
        setAvailableModels(response.models);
        setModelsError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setAvailableModels([]);
        setModelsError(error instanceof Error ? error.message : 'Unable to load Copilot CLI models.');
      })
      .finally(() => {
        if (!cancelled) {
          setModelsLoading(false);
        }
      });

    getRemotePreference()
      .then((result) => {
        if (!cancelled) setGlobalRemoteDefault(result.enabled);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const primaryModels = availableModels.filter((m) => PRIMARY_MODELS.includes(m));
  const otherModels = availableModels.filter((m) => !PRIMARY_MODELS.includes(m));

  const modelPlaceholder = availableModels[0]
    ? `e.g. ${availableModels[0]}`
    : 'Load from Copilot CLI';

  return (
    <div className="session-wizard-launch-step" data-testid="session-wizard-launch-step">
      <div className="session-wizard-launch-summary" data-testid="session-wizard-launch-summary">
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">Project</span>
          <span className="session-wizard-launch-value">{projectLabel(state)}</span>
        </div>
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">Agent</span>
          <span className="session-wizard-launch-value" data-testid="session-wizard-launch-agent">{agentLabel(state)}</span>
        </div>
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">Objective</span>
          <span className="session-wizard-launch-value">{objectivePreview(state)}</span>
        </div>
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">Isolation</span>
          <span className="session-wizard-launch-value">{isolationLabel(state)}</span>
        </div>
      </div>

      <div className="session-wizard-remote-section" data-testid="session-wizard-remote-section">
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">🌐 Remote Access</span>
          <span className="session-wizard-launch-value">
            <span className="session-wizard-remote-chips" data-testid="session-wizard-remote-chips">
              {(['default', 'on', 'off'] as const).map((option) => {
                const value = option === 'default' ? null : option === 'on';
                const isActive = state.remoteEnabled === value;
                const label = option === 'default'
                  ? `Default (${globalRemoteDefault ? 'On' : 'Off'})`
                  : option === 'on' ? 'Enable' : 'Disable';
                return (
                  <button
                    key={option}
                    type="button"
                    className={`session-wizard-model-chip ${isActive ? 'session-wizard-model-chip-active' : ''}`}
                    data-testid={`session-wizard-remote-${option}`}
                    onClick={() => sessionWizardStore.setRemoteEnabled(value)}
                  >
                    {label}
                  </button>
                );
              })}
            </span>
          </span>
        </div>
        <p className="session-wizard-remote-hint">
          Stream session to GitHub.com for web/mobile steering. Requires GitHub-hosted repo.
        </p>
      </div>

      <div className="session-wizard-model-section">
        <FormInput
          label="Model"
          placeholder={modelPlaceholder}
          value={state.model}
          onValueChange={(v) => sessionWizardStore.setModel(v)}
          testId="session-wizard-model"
        />
        {modelsLoading ? <p className="session-wizard-loading">Loading models from Copilot CLI…</p> : null}
        {modelsError ? <p className="session-wizard-empty">{modelsError}</p> : null}
        {primaryModels.length > 0 ? (
          <div className="session-wizard-model-chips" data-testid="session-wizard-model-suggestions">
            {primaryModels.map((m) => (
              <button
                key={m}
                type="button"
                className={`session-wizard-model-chip session-wizard-model-chip-primary ${state.model === m ? 'session-wizard-model-chip-active' : ''}`}
                data-testid={`session-wizard-model-chip-${m}`}
                onClick={() => sessionWizardStore.setModel(m)}
              >
                {m}
              </button>
            ))}
          </div>
        ) : null}
        {otherModels.length > 0 ? (
          <>
            <button
              type="button"
              className="session-wizard-more-models-toggle"
              data-testid="session-wizard-more-models-toggle"
              onClick={() => setShowMoreModels((prev) => !prev)}
              aria-expanded={showMoreModels}
            >
              {showMoreModels ? '▾ Fewer models' : '▸ More models'}
            </button>
            {showMoreModels ? (
              <div className="session-wizard-model-chips" data-testid="session-wizard-model-others">
                {otherModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`session-wizard-model-chip ${state.model === m ? 'session-wizard-model-chip-active' : ''}`}
                    data-testid={`session-wizard-model-chip-${m}`}
                    onClick={() => sessionWizardStore.setModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="session-wizard-advanced-section">
        <button
          type="button"
          className="session-wizard-advanced-toggle"
          data-testid="session-wizard-advanced-toggle"
          onClick={() => setShowAdvanced((prev) => !prev)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
        </button>

        {showAdvanced ? (
          <div className="session-wizard-advanced-fields" data-testid="session-wizard-advanced-fields">
            <FormInput
              label="Actor label"
              placeholder="e.g. copilot-primary"
              value={state.actorLabel}
              onValueChange={(v) => sessionWizardStore.setActorLabel(v)}
              testId="session-wizard-actor-label"
            />
            <FormInput
              label="Actor role"
              placeholder="e.g. assistant"
              value={state.actorRole}
              onValueChange={(v) => sessionWizardStore.setActorRole(v)}
              testId="session-wizard-actor-role"
            />
          </div>
        ) : null}
      </div>

      {state.launchError ? (
        <p className="session-wizard-error" data-testid="session-wizard-launch-error">
          {state.launchError}
        </p>
      ) : null}

      {state.launching ? (
        <p className="session-wizard-status" data-testid="session-wizard-launch-status">
          {state.launchStatus ?? 'Launching…'}
        </p>
      ) : null}
    </div>
  );
}
