import { useState } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { PlanningBulletState } from '../../lib/types';
import PlanningPathActions from './PlanningPathActions';
import type { PlanningState } from './planningStore';
import { planningWorkspaceStore } from './planningWorkspaceStore';

function normalizeTargetRepoInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

export default function PlanningIdeasPanel(props: {
  planningState: PlanningState;
  onBulletCreated?: () => void;
  onOpenCatalogAssets?: () => void;
  selectedCatalogRepoId?: string;
  selectedCatalogRepoLabel?: string;
}) {
  const {
    planningState,
    onBulletCreated,
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
            <>
              <p className="planning-copy">
                Active repo: <code>{selectedCatalogRepoLabel || selectedCatalogRepoId}</code>
              </p>
              <PlanningPathActions
                openLabel="Open bullet file"
                path={planningWorkspaceState.planningBulletsFile?.filePath}
                repoRelativePath={planningWorkspaceState.planningBulletsFile?.repoRelativePath}
                testIdPrefix="planning-bullet-composer-file"
              />
            </>
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
    </div>
  );
}
