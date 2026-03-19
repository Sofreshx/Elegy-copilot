import { useEffect, useMemo, useState } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { PlanningBulletState } from '../../lib/types';
import { planningStore, type PlanningState } from './planningStore';
import { planningWorkspaceStore } from './planningWorkspaceStore';

function normalizeTargetRepoInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

type PlanningActionRequestButtonKind =
  | 'audit-request'
  | 'roadmap-request'
  | 'review-prep'
  | 'commit-prep';

function PlanningActionWorkflowsPanel(props: {
  creating: boolean;
  onIntakeArtifactCreated?: () => void;
  onOpenCatalogAssets?: () => void;
  selectedCatalogRepoId: string;
}) {
  const { creating, onIntakeArtifactCreated, onOpenCatalogAssets, selectedCatalogRepoId } = props;
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [targetRepos, setTargetRepos] = useState(selectedCatalogRepoId);
  const [submittingKind, setSubmittingKind] = useState<PlanningActionRequestButtonKind | null>(null);

  useEffect(() => {
    if (!targetRepos.trim() && selectedCatalogRepoId.trim()) {
      setTargetRepos(selectedCatalogRepoId);
    }
  }, [selectedCatalogRepoId, targetRepos]);

  const normalizedTargets = useMemo(() => normalizeTargetRepoInput(targetRepos), [targetRepos]);
  const submitDisabled =
    creating
    || submittingKind !== null
    || title.trim().length === 0
    || selectedCatalogRepoId.trim().length === 0;

  const createRequest = async (kind: PlanningActionRequestButtonKind): Promise<void> => {
    setSubmittingKind(kind);
    try {
      const artifactId = await planningStore.createActionRequest(kind, {
        title: title.trim(),
        notes: notes.trim(),
        targetRepoIds: normalizedTargets,
        saveRepoId: selectedCatalogRepoId.trim(),
      });

      if (artifactId) {
        setTitle('');
        setNotes('');
        setTargetRepos(selectedCatalogRepoId.trim());
        onIntakeArtifactCreated?.();
      }
    } finally {
      setSubmittingKind(null);
    }
  };

  return (
    <Panel
      subtitle="Tracked requests stay typed under docs/planning/intake/*.json, while repo bullets remain the simpler future-plan seed surface."
      testId="planning-action-workflows-panel"
      title="Planning Action Workflows"
    >
      <div className="planning-controls">
        <p className="planning-copy">
          These actions save directly to <code>docs/planning/intake/*.json</code> for the active Catalog repo.
          They stay separate from <code>docs/planning/bullets.md</code> so freeform bullet seeds and typed
          request workflows do not drift together.
        </p>

        <div className="planning-field-grid">
          <label className="form-input" htmlFor="planning-prep-title">
            <span className="form-label">Request Title</span>
            <input
              data-testid="planning-prep-title"
              id="planning-prep-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Generate roadmap proposal for planning surfaces"
              value={title}
            />
          </label>

          <label className="form-input" htmlFor="planning-prep-target-repos">
            <span className="form-label">Target Repos</span>
            <input
              data-testid="planning-prep-target-repos"
              id="planning-prep-target-repos"
              onChange={(event) => setTargetRepos(event.target.value)}
              placeholder={selectedCatalogRepoId || 'repo-a, repo-b'}
              value={targetRepos}
            />
          </label>
        </div>

        <label className="form-input" htmlFor="planning-prep-notes">
          <span className="form-label">Requested Output / Focus</span>
          <textarea
            data-testid="planning-prep-notes"
            id="planning-prep-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional: note audit scope, roadmap goals, validation expectations, reviewer focus areas, or commit-prep constraints."
            value={notes}
          />
        </label>

        {selectedCatalogRepoId ? (
          <p className="planning-copy">
            Save target: <code>{selectedCatalogRepoId}</code> → <code>docs/planning/intake/*.json</code>
          </p>
        ) : (
          <p className="state-message">
            Select a Catalog repo before creating tracked Planning action requests.
          </p>
        )}

        <div className="planning-actions">
          {onOpenCatalogAssets ? (
            <Button onClick={onOpenCatalogAssets} testId="planning-open-catalog-assets" variant="secondary">
              Open Catalog Assets
            </Button>
          ) : null}
          <Button
            disabled={submitDisabled}
            onClick={() => {
              void createRequest('audit-request');
            }}
            testId="planning-create-audit-request"
            variant="secondary"
          >
            {submittingKind === 'audit-request' ? 'Creating audit request…' : 'Request audit'}
          </Button>
          <Button
            disabled={submitDisabled}
            onClick={() => {
              void createRequest('roadmap-request');
            }}
            testId="planning-create-roadmap-request"
            variant="secondary"
          >
            {submittingKind === 'roadmap-request' ? 'Creating roadmap request…' : 'Request roadmap proposal'}
          </Button>
          <Button
            disabled={submitDisabled}
            onClick={() => {
              void createRequest('review-prep');
            }}
            testId="planning-create-review-prep"
            variant="secondary"
          >
            {submittingKind === 'review-prep' ? 'Creating review prep…' : 'Create review prep request'}
          </Button>
          <Button
            disabled={submitDisabled}
            onClick={() => {
              void createRequest('commit-prep');
            }}
            testId="planning-create-commit-prep"
          >
            {submittingKind === 'commit-prep' ? 'Creating commit prep…' : 'Create commit prep request'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export default function PlanningIdeasPanel(props: {
  planningState: PlanningState;
  onBulletCreated?: () => void;
  onIntakeArtifactCreated?: () => void;
  onOpenCatalogAssets?: () => void;
  selectedCatalogRepoId?: string;
  selectedCatalogRepoLabel?: string;
}) {
  const {
    planningState,
    onBulletCreated,
    onIntakeArtifactCreated,
    onOpenCatalogAssets,
    selectedCatalogRepoId = planningState.catalogRepoContext?.repoId || '',
    selectedCatalogRepoLabel = planningState.catalogRepoContext?.repoLabel || '',
  } = props;
  const planningWorkspaceState = useStoreValue(planningWorkspaceStore);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<PlanningBulletState>('idea');
  const [saving, setSaving] = useState(false);
  const createDisabled = saving || !selectedCatalogRepoId.trim() || title.trim().length === 0;

  const handleCreateBullet = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await planningWorkspaceStore.createBullet({
        title: title.trim(),
        state,
        summary: summary.trim(),
        notes: normalizeTargetRepoInput(notes.replace(/\r\n?/g, '\n')),
      });

      if (created) {
        setTitle('');
        setSummary('');
        setNotes('');
        setState('idea');
        onBulletCreated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="planning-grid" data-testid="planning-bullet-intake">
      <Panel
        subtitle="Capture future-session bullet seeds directly into docs/planning/bullets.md for the active Catalog repo."
        testId="planning-bullet-composer-panel"
        title="Repo Bullet Composer"
      >
        <div className="planning-controls">
          {selectedCatalogRepoId ? (
            <p className="planning-copy">
              Active repo: <code>{selectedCatalogRepoLabel || selectedCatalogRepoId}</code> →{' '}
              <code>docs/planning/bullets.md</code>
            </p>
          ) : (
            <p className="state-message">
              No Catalog repo is selected yet. Pick one first so new bullets land in the right repository file.
            </p>
          )}

          <div className="planning-field-grid">
            <label className="form-input" htmlFor="planning-bullet-title">
              <span className="form-label">Bullet Title</span>
              <input
                data-testid="planning-bullet-title"
                id="planning-bullet-title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Clarify roadmap hierarchy in Planning"
                value={title}
              />
            </label>

            <label className="form-input" htmlFor="planning-bullet-state">
              <span className="form-label">Bullet State</span>
              <select
                data-testid="planning-bullet-state"
                id="planning-bullet-state"
                onChange={(event) => setState(event.target.value as PlanningBulletState)}
                value={state}
              >
                <option value="idea">idea</option>
                <option value="research">research</option>
                <option value="pre-plan">pre-plan</option>
              </select>
            </label>
          </div>

          <label className="form-input" htmlFor="planning-bullet-summary">
            <span className="form-label">Summary</span>
            <textarea
              data-testid="planning-bullet-summary"
              id="planning-bullet-summary"
              onChange={(event) => setSummary(event.target.value)}
              placeholder="One clear summary line for the future plan seed."
              value={summary}
            />
          </label>

          <label className="form-input" htmlFor="planning-bullet-notes">
            <span className="form-label">Notes</span>
            <textarea
              data-testid="planning-bullet-notes"
              id="planning-bullet-notes"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="- Keep bullets browse-first in the selected repo&#10;- Make plan creation explicit"
              value={notes}
            />
          </label>

          {planningWorkspaceState.bulletsError ? (
            <p className="planning-error" role="alert">
              {planningWorkspaceState.bulletsError}
            </p>
          ) : null}
          {planningState.error ? (
            <p className="planning-error" role="alert">
              {planningState.error}
            </p>
          ) : null}
          {planningState.statusMessage ? <p className="planning-copy">{planningState.statusMessage}</p> : null}

          <div className="planning-actions">
            {onOpenCatalogAssets ? (
              <Button onClick={onOpenCatalogAssets} testId="planning-open-catalog-assets-bullets" variant="secondary">
                Open Catalog Assets
              </Button>
            ) : null}
            <Button
              disabled={createDisabled}
              onClick={() => {
                void handleCreateBullet();
              }}
              testId="planning-create-bullet"
            >
              {saving ? 'Saving bullet…' : 'Add bullet to repo file'}
            </Button>
          </div>
        </div>
      </Panel>

      <PlanningActionWorkflowsPanel
        creating={planningState.creating}
        onIntakeArtifactCreated={onIntakeArtifactCreated}
        onOpenCatalogAssets={onOpenCatalogAssets}
        selectedCatalogRepoId={selectedCatalogRepoId}
      />
    </div>
  );
}
