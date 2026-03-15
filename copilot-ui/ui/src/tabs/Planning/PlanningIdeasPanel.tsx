import { useEffect, useState } from 'react';
import { Button, Panel } from '../../components';
import type { PlanningRecordItem } from '../../lib/types';
import { isIdeaRecord, planningStore, type PlanningState } from './planningStore';

function normalizeTargetRepoInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

function formatTargetRepoInput(record: PlanningRecordItem): string {
  return Array.isArray(record.targetRepoIds) ? record.targetRepoIds.join(', ') : '';
}

function formatAcceptanceCriteria(record: PlanningRecordItem): string {
  if (typeof record.acceptanceCriteriaText === 'string' && record.acceptanceCriteriaText.trim()) {
    return record.acceptanceCriteriaText.trim();
  }

  return Array.isArray(record.acceptanceCriteria) ? record.acceptanceCriteria.join('\n') : '';
}

function IdeaRecordEditor(props: {
  record: PlanningRecordItem;
  checked: boolean;
  disabled: boolean;
}) {
  const { record, checked, disabled } = props;
  const [title, setTitle] = useState(String(record.title || ''));
  const [summary, setSummary] = useState(String(record.summary || ''));
  const [targetRepos, setTargetRepos] = useState(formatTargetRepoInput(record));
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(formatAcceptanceCriteria(record));
  const [state, setState] = useState(String(record.state || 'thought'));

  useEffect(() => {
    setTitle(String(record.title || ''));
    setSummary(String(record.summary || ''));
    setTargetRepos(formatTargetRepoInput(record));
    setAcceptanceCriteria(formatAcceptanceCriteria(record));
    setState(String(record.state || 'thought'));
  }, [record]);

  return (
    <article className="idea-record-card">
      <div className="idea-record-card-header">
        <label className="planning-checkbox" htmlFor={`idea-select-${record.recordId}`}>
          <input
            checked={checked}
            id={`idea-select-${record.recordId}`}
            onChange={(event) => planningStore.toggleIdeaSelected(record.recordId, event.target.checked)}
            type="checkbox"
          />
          <span>Select</span>
        </label>

        <div className="idea-record-actions">
          <Button
            onClick={() => planningStore.setSelectedRecordId(record.recordId)}
            testId={`idea-inspect-${record.recordId}`}
            variant="ghost"
          >
            Inspect
          </Button>
          <Button
            disabled={disabled || title.trim().length === 0}
            onClick={() => {
              void planningStore.updateIdea(record.recordId, {
                title: title.trim(),
                summary: summary.trim(),
                targetRepoIds: normalizeTargetRepoInput(targetRepos),
                acceptanceCriteriaText: acceptanceCriteria,
                state,
              });
            }}
            testId={`idea-save-${record.recordId}`}
            variant="secondary"
          >
            {disabled ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="planning-field-grid">
        <label className="form-input" htmlFor={`idea-title-${record.recordId}`}>
          <span className="form-label">Idea</span>
          <input
            id={`idea-title-${record.recordId}`}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>

        <label className="form-input" htmlFor={`idea-state-${record.recordId}`}>
          <span className="form-label">State</span>
          <select id={`idea-state-${record.recordId}`} onChange={(event) => setState(event.target.value)} value={state}>
            <option value="thought">thought</option>
            <option value="research">research</option>
            <option value="pre-plan">pre-plan</option>
            <option value="queued">queued</option>
          </select>
        </label>

        <label className="form-input" htmlFor={`idea-targets-${record.recordId}`}>
          <span className="form-label">Target Repos</span>
          <input
            id={`idea-targets-${record.recordId}`}
            onChange={(event) => setTargetRepos(event.target.value)}
            placeholder="repo-a, repo-b"
            value={targetRepos}
          />
        </label>
      </div>

      <label className="form-input" htmlFor={`idea-summary-${record.recordId}`}>
        <span className="form-label">Summary</span>
        <textarea
          id={`idea-summary-${record.recordId}`}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="What needs to happen?"
          value={summary}
        />
      </label>

      <label className="form-input" htmlFor={`idea-criteria-${record.recordId}`}>
        <span className="form-label">Acceptance Criteria</span>
        <textarea
          id={`idea-criteria-${record.recordId}`}
          onChange={(event) => setAcceptanceCriteria(event.target.value)}
          placeholder="One acceptance criterion per line"
          value={acceptanceCriteria}
        />
      </label>
    </article>
  );
}

export default function PlanningIdeasPanel(props: {
  planningState: PlanningState;
  onSdkSessionReady?: (sessionId: string) => void;
}) {
  const { planningState, onSdkSessionReady } = props;
  const ideaRecords = planningState.records.filter(isIdeaRecord);
  const selectedCount = planningState.selectedIdeaIds.length;

  const handleCompile = async () => {
    const sessionId = await planningStore.compileSelectedIdeas();
    if (sessionId && onSdkSessionReady) {
      onSdkSessionReady(sessionId);
    }
  };

  return (
    <div className="planning-grid">
      <Panel
        subtitle="Type one idea per line, attach target repos, then add them as durable planning records."
        testId="planning-ideas-inbox-panel"
        title="Idea Inbox"
      >
        <div className="planning-controls">
          <label className="form-input" htmlFor="planning-ideas-draft">
            <span className="form-label">Ideas</span>
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

          <div className="planning-actions">
            <Button
              disabled={planningState.creating}
              onClick={() => {
                void planningStore.createIdeaBatch();
              }}
              testId="planning-ideas-add"
            >
              {planningState.creating ? 'Adding...' : 'Add Ideas'}
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
        </div>
      </Panel>

      <Panel
        subtitle="Editable idea records that can be selected and compiled into an SDK-backed planning session."
        testId="planning-idea-records-panel"
        title="Idea Records"
      >
        {ideaRecords.length === 0 ? (
          <p className="planning-copy">No idea records yet. Add a few bullet ideas to start shaping the plan.</p>
        ) : (
          <div className="idea-record-list">
            {ideaRecords.map((record) => (
              <IdeaRecordEditor
                checked={planningState.selectedIdeaIds.includes(record.recordId)}
                disabled={planningState.updatingRecordId === record.recordId}
                key={record.recordId}
                record={record}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}