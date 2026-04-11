import { FormInput } from '../../../components';
import type { SessionWizardState } from '../sessionWizardStore';
import { sessionWizardStore } from '../sessionWizardStore';

interface IsolationStepProps {
  state: SessionWizardState;
}

const ISOLATION_OPTIONS: {
  mode: SessionWizardState['isolationMode'];
  label: string;
  description: string;
}[] = [
  { mode: 'shared', label: 'Shared', description: 'Work directly in the project repository' },
  { mode: 'worktree', label: 'Worktree', description: 'Create an isolated git worktree' },
  { mode: 'sandbox', label: 'Sandbox', description: 'Run in a sandboxed environment' },
];

export default function IsolationStep({ state }: IsolationStepProps) {
  return (
    <div className="session-wizard-isolation-step" data-testid="session-wizard-isolation-step">
      <div className="session-wizard-isolation-cards" data-testid="session-wizard-isolation-cards">
        {ISOLATION_OPTIONS.map((opt) => {
          const isActive = state.isolationMode === opt.mode;
          let cardClass = 'session-wizard-isolation-card';
          if (isActive) cardClass += ' session-wizard-isolation-card-active';

          return (
            <button
              key={opt.mode}
              type="button"
              className={cardClass}
              data-testid={`session-wizard-isolation-${opt.mode}`}
              onClick={() => sessionWizardStore.setIsolationMode(opt.mode)}
              aria-pressed={isActive}
            >
              <span className="session-wizard-isolation-card-label">{opt.label}</span>
              <span className="session-wizard-isolation-card-desc">{opt.description}</span>
            </button>
          );
        })}
      </div>

      {state.isolationMode === 'worktree' ? (
        <div className="session-wizard-isolation-fields" data-testid="session-wizard-worktree-fields">
          <FormInput
            label="Worktree ID"
            placeholder="e.g. feature-xyz"
            value={state.worktreeId}
            onValueChange={(v) => sessionWizardStore.setWorktreeId(v)}
            testId="session-wizard-worktree-id"
          />
          <FormInput
            label="Worktree path"
            placeholder="/path/to/worktree"
            value={state.worktreePath}
            onValueChange={(v) => sessionWizardStore.setWorktreePath(v)}
            testId="session-wizard-worktree-path"
          />
        </div>
      ) : null}

      {state.isolationMode === 'sandbox' ? (
        <div className="session-wizard-isolation-fields" data-testid="session-wizard-sandbox-fields">
          <FormInput
            label="Sandbox ID"
            placeholder="e.g. sandbox-001"
            value={state.sandboxId}
            onValueChange={(v) => sessionWizardStore.setSandboxId(v)}
            testId="session-wizard-sandbox-id"
          />
        </div>
      ) : null}
    </div>
  );
}
