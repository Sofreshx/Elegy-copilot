import { useState } from 'react';
import SteppedWizard from '../../components/SteppedWizard';
import { navigationStore } from '../../stores/navigation';
import { projectsListStore } from './projectsListStore';

// ── Wizard steps definition ──

const WIZARD_STEPS = [
  { id: 'select-folder', label: 'Select Folder', description: 'Choose a repository path' },
  { id: 'confirm', label: 'Confirm', description: 'Review and register' },
];

// ── Helpers ──

function extractRepoName(repoPath: string): string {
  const trimmed = repoPath.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || repoPath;
}

// ── Component ──

export default function AddProjectWizard() {
  const [step, setStep] = useState(0);
  const [repoPath, setRepoPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pathIsValid = repoPath.trim().length > 0;
  const detectedName = extractRepoName(repoPath.trim());

  const stepsWithValidity = WIZARD_STEPS.map((s, i) => ({
    ...s,
    isValid: i === 0 ? pathIsValid : true,
  }));

  function handleCancel() {
    navigationStore.closeWizard();
  }

  async function handleComplete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/catalog/repos/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repoPath.trim() }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Registration failed (${res.status})`);
      }
      const result: { key?: string } = await res.json();
      navigationStore.closeWizard();
      projectsListStore.refresh();
      if (result.key) {
        navigationStore.selectProject(result.key);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // ── Step content ──

  function renderSelectFolder() {
    return (
      <div className="add-project-step" data-testid="add-project-step-folder">
        <p className="add-project-hint">Enter the full path to a local git repository.</p>
        <div className="add-project-path-row">
          <input
            className="add-project-path-input"
            data-testid="add-project-path-input"
            type="text"
            placeholder="/path/to/your/repo"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            autoFocus
          />
          <button
            className="button button-secondary button-sm"
            data-testid="add-project-browse"
            type="button"
            disabled
            title="Tauri file dialog integration coming soon"
          >
            Browse…
          </button>
        </div>
      </div>
    );
  }

  function renderConfirm() {
    return (
      <div className="add-project-step" data-testid="add-project-step-confirm">
        <dl className="add-project-summary">
          <dt>Repository name</dt>
          <dd data-testid="add-project-detected-name">{detectedName}</dd>
          <dt>Path</dt>
          <dd data-testid="add-project-detected-path">{repoPath.trim()}</dd>
        </dl>
        {error ? (
          <p className="add-project-error" data-testid="add-project-error">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="add-project-loading" data-testid="add-project-loading">
            Registering…
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="add-project-wizard" data-testid="add-project-wizard">
      <SteppedWizard
        steps={stepsWithValidity}
        activeStepIndex={step}
        onStepChange={setStep}
        onComplete={handleComplete}
        onCancel={handleCancel}
        completeLabel={loading ? 'Registering…' : 'Register'}
        testId="add-project-wizard-stepped"
      >
        {step === 0 ? renderSelectFolder() : null}
        {step === 1 ? renderConfirm() : null}
      </SteppedWizard>
    </div>
  );
}
