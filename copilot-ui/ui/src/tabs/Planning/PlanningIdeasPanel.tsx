import { useEffect, useMemo, useState } from 'react';
import { Button, Panel } from '../../components';
import type { CatalogRepoInventoryEntry, PlanningDraftItem } from '../../lib/types';
import { planningStore, type PlanningState } from './planningStore';

function normalizeTargetRepoInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

function formatTargetRepoInput(record: PlanningDraftItem): string {
  return Array.isArray(record.targetRepoIds) ? record.targetRepoIds.join(', ') : '';
}

function formatAcceptanceCriteria(record: PlanningDraftItem): string {
  if (typeof record.acceptanceCriteriaText === 'string' && record.acceptanceCriteriaText.trim()) {
    return record.acceptanceCriteriaText.trim();
  }

  return Array.isArray(record.acceptanceCriteria) ? record.acceptanceCriteria.join('\n') : '';
}

function buildRepoOptionLabel(repo: CatalogRepoInventoryEntry): string {
  const repoLabel = typeof repo.repoLabel === 'string' ? repo.repoLabel.trim() : '';
  const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';
  const repoPath = typeof repo.repoPath === 'string' ? repo.repoPath.trim() : '';
  return repoLabel || repoId || repoPath || '(unnamed repo)';
}

function resolveDraftSaveRepoId(record: PlanningDraftItem, selectedCatalogRepoId: string): string {
  const explicitSaveRepoId = typeof record.saveRepoId === 'string' ? record.saveRepoId.trim() : '';
  if (explicitSaveRepoId) {
    return explicitSaveRepoId;
  }

  const targetRepoIds = Array.isArray(record.targetRepoIds)
    ? record.targetRepoIds.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (targetRepoIds.length === 1) {
    return targetRepoIds[0];
  }

  return selectedCatalogRepoId.trim();
}

function normalizeIdeaPlanningState(value: unknown): 'thought' | 'research' | 'pre-plan' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'research') return 'research';
  if (normalized === 'pre-plan') return 'pre-plan';
  return 'thought';
}

function IdeaRecordEditor(props: {
  record: PlanningDraftItem;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  knownRepos: CatalogRepoInventoryEntry[];
  selectedCatalogRepoId: string;
}) {
  const { record, checked, disabled, saving, knownRepos, selectedCatalogRepoId } = props;
  const [title, setTitle] = useState(String(record.title || ''));
  const [summary, setSummary] = useState(String(record.summary || ''));
  const [targetRepos, setTargetRepos] = useState(formatTargetRepoInput(record));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(formatAcceptanceCriteria(record));
  const [saveRepoId, setSaveRepoId] = useState(resolveDraftSaveRepoId(record, selectedCatalogRepoId));
  const [state, setState] = useState(normalizeIdeaPlanningState(record.state));

  useEffect(() => {
    setTitle(String(record.title || ''));
    setSummary(String(record.summary || ''));
    setTargetRepos(formatTargetRepoInput(record));
    setAcceptanceCriteria(formatAcceptanceCriteria(record));
    setSaveRepoId(resolveDraftSaveRepoId(record, selectedCatalogRepoId));
    setState(normalizeIdeaPlanningState(record.state));
  }, [record, selectedCatalogRepoId]);

  const normalizedTargets = useMemo(() => normalizeTargetRepoInput(targetRepos), [targetRepos]);
  const requiresSplit = normalizedTargets.length > 1;
  const effectiveSaveRepoId =
    saveRepoId.trim()
    || (normalizedTargets.length === 1 ? normalizedTargets[0] : '')
    || selectedCatalogRepoId.trim();
  const saveDisabled = saving || title.trim().length === 0 || effectiveSaveRepoId.length === 0;

  const persistDraft = async (): Promise<void> => {
    await planningStore.updateIdea(record.draftId, {
      title: title.trim(),
      summary: summary.trim(),
      targetRepoIds: normalizedTargets,
      acceptanceCriteriaText: acceptanceCriteria,
      saveRepoId: saveRepoId.trim() || null,
      state,
    });
  };

  return (
    <article className="idea-record-card">
      <div className="idea-record-card-header">
        <label className="planning-checkbox" htmlFor={`idea-select-${record.draftId}`}>
          <input
            checked={checked}
            id={`idea-select-${record.draftId}`}
            onChange={(event) => planningStore.toggleIdeaSelected(record.draftId, event.target.checked)}
            type="checkbox"
          />
          <span>Select</span>
        </label>

        <div className="idea-record-actions">
          {requiresSplit ? (
            <Button
              disabled={disabled || saving || title.trim().length === 0}
              onClick={async () => {
                await persistDraft();
                planningStore.splitIdea(record.draftId);
              }}
              testId={`idea-split-${record.draftId}`}
              variant="secondary"
            >
              Split by repo
            </Button>
          ) : null}
          <Button
            disabled={disabled || saving || title.trim().length === 0}
            onClick={() => {
              void persistDraft();
            }}
            testId={`idea-save-${record.draftId}`}
            variant="secondary"
          >
            {disabled ? 'Saving...' : 'Save draft'}
          </Button>
            <Button
              disabled={saveDisabled}
              onClick={async () => {
                await persistDraft();
                await planningStore.saveIdeaDraft(record.draftId, effectiveSaveRepoId);
              }}
              testId={`idea-save-intake-${record.draftId}`}
            >
              {saving ? 'Saving to intake...' : 'Save to intake'}
            </Button>
          <Button
            disabled={disabled || saving}
            onClick={() => planningStore.removeIdea(record.draftId)}
            testId={`idea-remove-${record.draftId}`}
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      </div>

      <div className="planning-field-grid">
        <label className="form-input" htmlFor={`idea-title-${record.draftId}`}>
          <span className="form-label">Idea</span>
          <input
            id={`idea-title-${record.draftId}`}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>

        <label className="form-input" htmlFor={`idea-state-${record.draftId}`}>
          <span className="form-label">State</span>
          <select
            id={`idea-state-${record.draftId}`}
            onChange={(event) => setState(normalizeIdeaPlanningState(event.target.value))}
            value={state}
          >
            <option value="thought">thought</option>
            <option value="research">research</option>
            <option value="pre-plan">pre-plan</option>
          </select>
        </label>

        <label className="form-input" htmlFor={`idea-targets-${record.draftId}`}>
          <span className="form-label">Target Repos</span>
          <input
            id={`idea-targets-${record.draftId}`}
            onChange={(event) => setTargetRepos(event.target.value)}
            placeholder="repo-a, repo-b"
            value={targetRepos}
          />
        </label>

        <label className="form-input" htmlFor={`idea-save-repo-${record.draftId}`}>
          <span className="form-label">Save Repo</span>
          <select
            id={`idea-save-repo-${record.draftId}`}
            onChange={(event) => setSaveRepoId(event.target.value)}
            value={saveRepoId}
          >
            <option value="">
              {knownRepos.length > 0 ? '(choose a Catalog repo)' : '(no Catalog repos available)'}
            </option>
            {knownRepos.map((repo) => {
              const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';
              if (!repoId) {
                return null;
              }

              return (
                <option key={repoId} value={repoId}>
                  {buildRepoOptionLabel(repo)}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <label className="form-input" htmlFor={`idea-summary-${record.draftId}`}>
        <span className="form-label">Summary</span>
        <textarea
          id={`idea-summary-${record.draftId}`}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="What needs to happen?"
          value={summary}
        />
      </label>

      <label className="form-input" htmlFor={`idea-criteria-${record.draftId}`}>
        <span className="form-label">Acceptance Criteria</span>
        <textarea
          id={`idea-criteria-${record.draftId}`}
          onChange={(event) => setAcceptanceCriteria(event.target.value)}
          placeholder="One acceptance criterion per line"
          value={acceptanceCriteria}
        />
      </label>

      {requiresSplit ? (
        <p className="state-message" data-testid={`idea-split-required-${record.draftId}`}>
          This draft targets multiple repos. Split it if you want repo-specific artifacts, or save one shared intake artifact that keeps all targets.
        </p>
      ) : effectiveSaveRepoId ? (
        <p className="planning-copy">
          Save target: <code>{effectiveSaveRepoId}</code> → <code>docs/planning/intake/*.json</code>
        </p>
      ) : (
        <p className="state-message">
          Choose a known Catalog repo before saving this draft to <code>docs/planning/intake/*.json</code>.
        </p>
      )}
    </article>
  );
}

export default function PlanningIdeasPanel(props: {
  planningState: PlanningState;
  knownRepos: CatalogRepoInventoryEntry[];
  onOpenCatalogAssets?: () => void;
  selectedCatalogRepoId?: string;
  onSdkSessionReady?: (sessionId: string) => void;
}) {
  const {
    planningState,
    knownRepos,
    onOpenCatalogAssets,
    selectedCatalogRepoId = planningState.catalogRepoContext?.repoId || '',
    onSdkSessionReady,
  } = props;
  const ideaRecords = planningState.draftIdeas;
  const selectedCount = planningState.selectedIdeaIds.filter((draftId) =>
    ideaRecords.some((record) => record.draftId === draftId)
  ).length;

  const handleCompile = async () => {
    const sessionId = await planningStore.compileSelectedIdeas();
    if (sessionId && onSdkSessionReady) {
      onSdkSessionReady(sessionId);
    }
  };

  return (
    <div className="planning-grid" data-testid="planning-bullet-intake">
      <Panel
        subtitle="Draft locally first, then save typed repo-backed intake artifacts under docs/planning/intake. Accepted work can later move into canonical docs/backlog.md."
        testId="planning-ideas-inbox-panel"
        title="Draft Intake"
      >
        <div className="planning-controls">
          <label className="form-input" htmlFor="planning-ideas-draft">
            <span className="form-label">Bullets</span>
            <textarea
              id="planning-ideas-draft"
              onChange={(event) => planningStore.setIdeaDraft(event.target.value)}
              placeholder="- Consolidate overlapping tabs&#10;- Add provider install flow for external skills&#10;- Create a runtime readiness page"
              value={planningState.ideaDraft}
            />
          </label>

          <div className="planning-field-grid">
            <label className="form-input" htmlFor="planning-ideas-target-repos">
              <span className="form-label">Target Repos</span>
              <input
                data-testid="planning-ideas-target-repos"
                id="planning-ideas-target-repos"
                onChange={(event) => planningStore.setIdeaTargetRepos(event.target.value)}
                placeholder="instruction-engine, copilot-sdk"
                value={planningState.ideaTargetRepos}
              />
            </label>

            <label className="form-input" htmlFor="planning-ideas-scope">
              <span className="form-label">Capture Scope</span>
              <select
                data-testid="planning-ideas-scope-select"
                id="planning-ideas-scope"
                onChange={(event) => planningStore.setCreateScope(event.target.value as 'user' | 'repo' | 'global')}
                value={planningState.createScope}
              >
                <option value="user">user</option>
                <option value="repo">repo</option>
                <option value="global">global</option>
              </select>
            </label>
          </div>

          {selectedCatalogRepoId ? (
            <p className="planning-copy">
              Known repos from Catalog can be chosen at save time. Current Catalog repo:{' '}
              <code>{selectedCatalogRepoId}</code>
            </p>
          ) : (
            <p className="planning-copy">
              No Catalog repo is selected yet. You can keep drafting now, then open <strong>Catalog &gt; Assets</strong> later to pick a repo intake target.
            </p>
          )}

          <div className="planning-actions">
            {selectedCatalogRepoId ? (
              <Button
                onClick={() => planningStore.setIdeaTargetRepos(selectedCatalogRepoId)}
                testId="planning-ideas-use-catalog-repo"
                variant="secondary"
              >
                Use Catalog repo
              </Button>
            ) : null}
            {onOpenCatalogAssets ? (
              <Button onClick={onOpenCatalogAssets} testId="planning-open-catalog-assets" variant="secondary">
                Open Catalog Assets
              </Button>
            ) : null}
            <Button
              disabled={planningState.creating}
              onClick={() => {
                void planningStore.createIdeaBatch();
              }}
              testId="planning-ideas-add"
            >
              {planningState.creating ? 'Adding...' : 'Add bullets as drafts'}
            </Button>
            <Button
              disabled={planningState.compiling || selectedCount === 0}
              onClick={() => {
                void handleCompile();
              }}
              testId="planning-ideas-compile"
              variant="secondary"
            >
              {planningState.compiling ? 'Compiling...' : `Compile Selected (${selectedCount})`}
            </Button>
          </div>

          {planningState.error ? (
            <p className="planning-error" role="alert">
              {planningState.error}
            </p>
          ) : null}
          {planningState.statusMessage ? <p className="planning-copy">{planningState.statusMessage}</p> : null}
        </div>
      </Panel>

        <Panel
          subtitle="Local drafts stay editable until you save them into repo-backed planning intake artifacts."
        testId="planning-idea-records-panel"
        title="Draft Backlog Items"
      >
        {ideaRecords.length === 0 ? (
          <p className="planning-copy">No local drafts yet. Add a few bullet ideas to start shaping the plan.</p>
        ) : (
          <div className="idea-record-list">
            {ideaRecords.map((record) => (
              <IdeaRecordEditor
                checked={planningState.selectedIdeaIds.includes(record.draftId)}
                disabled={planningState.updatingRecordId === record.draftId}
                key={record.draftId}
                knownRepos={knownRepos}
                record={record}
                saving={planningState.savingIdeaId === record.draftId}
                selectedCatalogRepoId={selectedCatalogRepoId}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
