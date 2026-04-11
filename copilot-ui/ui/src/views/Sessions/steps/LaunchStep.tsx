import { useEffect, useState } from 'react';
import { FormInput } from '../../../components';
import { listSdkModels } from '../../../lib/api';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';

interface LaunchStepProps {
  state: SessionWizardState;
}

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
  if (state.templateId) return state.templateId;
  return 'No objective set';
}

function isolationLabel(state: SessionWizardState): string {
  if (state.isolationMode === 'worktree') return `Worktree${state.worktreeId ? ` (${state.worktreeId})` : ''}`;
  if (state.isolationMode === 'sandbox') return `Sandbox${state.sandboxId ? ` (${state.sandboxId})` : ''}`;
  return 'Shared';
}

export default function LaunchStep({ state }: LaunchStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(state.actorLabel || state.actorRole),
  );
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

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

    return () => {
      cancelled = true;
    };
  }, []);

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
          <span className="session-wizard-launch-key">Objective</span>
          <span className="session-wizard-launch-value">{objectivePreview(state)}</span>
        </div>
        <div className="session-wizard-launch-row">
          <span className="session-wizard-launch-key">Isolation</span>
          <span className="session-wizard-launch-value">{isolationLabel(state)}</span>
        </div>
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
        {availableModels.length > 0 ? (
          <div className="session-wizard-model-chips" data-testid="session-wizard-model-suggestions">
            {availableModels.map((m) => (
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
