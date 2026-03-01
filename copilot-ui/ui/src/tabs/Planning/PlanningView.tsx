import { useEffect, useMemo } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import MermaidViewer from './MermaidViewer';
import {
  hasReviewedAllPlanningConflicts,
  planningGateAllowsMerge,
  planningStore,
} from './planningStore';
import ResearchNotesPanel from './ResearchNotesPanel';

function renderConflictValue(value: string | null): string {
  if (value == null || !value.trim()) {
    return '-';
  }

  return value;
}

export default function PlanningView() {
  const planningState = useStoreValue(planningStore);

  useEffect(() => {
    void planningStore.loadInitial();
  }, []);

  const compareTargets = useMemo(() => {
    const source = planningState.compareResponse?.planningRecords || [];
    const ids = source
      .map((record) => String(record.recordId || '').trim())
      .filter((id) => id.length > 0);

    return [...new Set(ids)];
  }, [planningState.compareResponse]);

  const compareReceiptId = planningState.compareResponse?.compareReceipt?.receiptId || '';
  const selectedRecord = planningState.records.find((record) => record.recordId === planningState.selectedRecordId) ?? null;
  const selectedDiagram =
    planningState.diagrams.find((diagram) => diagram.id === planningState.selectedDiagramId)
    ?? planningState.diagrams[0]
    ?? null;
  const reviewedAllConflicts = hasReviewedAllPlanningConflicts(
    planningState.conflictRows,
    planningState.reviewedConflictKeys
  );

  const canPrepareIntent =
    !planningState.mutatingBlocked &&
    !planningState.preparingIntent &&
    Boolean(compareReceiptId) &&
    planningState.mergeTargetId.trim().length > 0;

  const canConfirmMerge =
    !planningState.mutatingBlocked &&
    !planningState.merging &&
    planningGateAllowsMerge(planningState.gateState) &&
    Boolean(planningState.intentToken) &&
    reviewedAllConflicts;

  const handleRefresh = async () => {
    await Promise.allSettled([planningStore.refreshPolicyPreflight(true), planningStore.listRecords()]);
  };

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="planning-summary">
          <p className="planning-title">Planning Records</p>
          <p className="planning-copy">
            {planningState.records.length} records, {planningState.searchResults.length} search results
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <StatusBadge status={planningState.gateState} testId="planning-gate-badge" />
          <Button
            disabled={planningState.loading || planningState.listing || planningState.preflightLoading}
            onClick={handleRefresh}
            testId="planning-refresh-button"
            variant="secondary"
          >
            {planningState.listing || planningState.preflightLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      {planningState.error ? (
        <p className="planning-error" role="alert">
          {planningState.error}
        </p>
      ) : null}

      {planningState.statusMessage ? <p className="planning-status">{planningState.statusMessage}</p> : null}

      {planningState.mutatingBlocked ? (
        <p className="planning-warning" role="alert">
          Mutating actions are disabled by policy preflight: {planningState.mutatingReason || 'blocked'}
        </p>
      ) : null}

      <div className="planning-grid">
        <Panel
          subtitle="Context drives list/search/compare endpoints."
          testId="planning-context-panel"
          title="Context"
        >
          <div className="planning-controls">
            <div className="planning-field-grid">
              <FormInput
                id="planning-user-id"
                label="User ID"
                onValueChange={(value) => planningStore.setUserId(value)}
                placeholder="userId"
                testId="planning-user-id-input"
                value={planningState.userId}
              />
              <FormInput
                id="planning-repo-id"
                label="Repo ID"
                onValueChange={(value) => planningStore.setRepoId(value)}
                placeholder="repoId"
                testId="planning-repo-id-input"
                value={planningState.repoId}
              />
              <FormInput
                id="planning-query"
                label="Query"
                onValueChange={(value) => planningStore.setQuery(value)}
                placeholder="search query"
                testId="planning-query-input"
                value={planningState.query}
              />
              <FormInput
                id="planning-session-id"
                label="Session ID"
                onValueChange={(value) => planningStore.setSessionId(value)}
                placeholder="sessionId"
                testId="planning-session-id-input"
                value={planningState.sessionId}
              />
            </div>

            <div className="planning-scope-row">
              <label className="planning-checkbox" htmlFor="planning-scope-user">
                <input
                  checked={planningState.scopeUser}
                  id="planning-scope-user"
                  onChange={(event) => planningStore.setScope('user', event.target.checked)}
                  type="checkbox"
                />
                <span>user</span>
              </label>
              <label className="planning-checkbox" htmlFor="planning-scope-repo">
                <input
                  checked={planningState.scopeRepo}
                  id="planning-scope-repo"
                  onChange={(event) => planningStore.setScope('repo', event.target.checked)}
                  type="checkbox"
                />
                <span>repo</span>
              </label>
              <label className="planning-checkbox" htmlFor="planning-scope-global">
                <input
                  checked={planningState.scopeGlobal}
                  id="planning-scope-global"
                  onChange={(event) => planningStore.setScope('global', event.target.checked)}
                  type="checkbox"
                />
                <span>global</span>
              </label>
            </div>

            <div className="planning-actions">
              <Button
                disabled={planningState.listing}
                onClick={() => {
                  void planningStore.listRecords();
                }}
                testId="planning-list-button"
                variant="secondary"
              >
                {planningState.listing ? 'Loading...' : 'List records'}
              </Button>
              <Button
                disabled={planningState.searching}
                onClick={() => {
                  void planningStore.searchRecords();
                }}
                testId="planning-search-button"
                variant="secondary"
              >
                {planningState.searching ? 'Searching...' : 'Search'}
              </Button>
              <Button
                disabled={planningState.comparing || planningState.mutatingBlocked}
                onClick={() => {
                  void planningStore.compareRecords();
                }}
                testId="planning-compare-button"
              >
                {planningState.comparing ? 'Comparing...' : 'Compare'}
              </Button>
            </div>

            <p className="planning-copy">
              Gate reason: {planningState.gateReason} | Denied scopes:{' '}
              {planningState.deniedScopes.length > 0 ? planningState.deniedScopes.join(', ') : '(none)'}
            </p>
          </div>
        </Panel>

        <Panel
          subtitle="Manual create flow only."
          testId="planning-create-panel"
          title="Create Record"
        >
          <div className="planning-controls">
            <div className="planning-select-grid">
              <label className="form-input" htmlFor="planning-create-scope">
                <span className="form-label">Scope</span>
                <select
                  data-testid="planning-create-scope-select"
                  id="planning-create-scope"
                  onChange={(event) => {
                    planningStore.setCreateScope(event.target.value as 'user' | 'repo' | 'global');
                  }}
                  value={planningState.createScope}
                >
                  <option value="user">user</option>
                  <option value="repo">repo</option>
                  <option value="global">global</option>
                </select>
              </label>

              <label className="form-input" htmlFor="planning-create-state">
                <span className="form-label">State</span>
                <select
                  data-testid="planning-create-state-select"
                  id="planning-create-state"
                  onChange={(event) => {
                    planningStore.setCreateState(event.target.value);
                  }}
                  value={planningState.createState}
                >
                  <option value="thought">thought</option>
                  <option value="research">research</option>
                  <option value="pre-plan">pre-plan</option>
                  <option value="queued">queued</option>
                  <option value="implemented">implemented</option>
                  <option value="merged">merged</option>
                  <option value="superseded">superseded</option>
                </select>
              </label>
            </div>

            <FormInput
              id="planning-create-title"
              label="Title"
              onValueChange={(value) => planningStore.setCreateTitle(value)}
              placeholder="Short title"
              testId="planning-create-title-input"
              value={planningState.createTitle}
            />

            <label className="form-input" htmlFor="planning-create-summary">
              <span className="form-label">Summary</span>
              <textarea
                data-testid="planning-create-summary-input"
                id="planning-create-summary"
                onChange={(event) => planningStore.setCreateSummary(event.target.value)}
                placeholder="Multiline notes"
                rows={6}
                value={planningState.createSummary}
              />
            </label>

            <label className="form-input" htmlFor="planning-create-acceptance-criteria">
              <span className="form-label">Acceptance Criteria (one per line)</span>
              <textarea
                data-testid="planning-create-acceptance-criteria-input"
                id="planning-create-acceptance-criteria"
                onChange={(event) => planningStore.setCreateAcceptanceCriteria(event.target.value)}
                placeholder={'Given ...\nWhen ...\nThen ...'}
                rows={5}
                value={planningState.createAcceptanceCriteria}
              />
            </label>

            <Button
              disabled={
                planningState.mutatingBlocked ||
                planningState.creating ||
                planningState.createTitle.trim().length === 0
              }
              onClick={() => {
                void planningStore.createRecord();
              }}
              testId="planning-create-button"
            >
              {planningState.creating ? 'Creating...' : 'Create record'}
            </Button>
          </div>
        </Panel>

        <Panel
          subtitle="List and search output snapshots."
          testId="planning-results-panel"
          title="Records + Search"
        >
          <div className="planning-list-grid">
            <div>
              <h4>Records</h4>
              {planningState.records.length === 0 ? (
                <p className="state-message">No records returned.</p>
              ) : (
                <ul className="planning-record-list">
                  {planningState.records.map((record) => (
                    <li key={record.recordId}>
                      <p className="planning-item-title">{record.title || record.recordId}</p>
                      <p className="planning-item-copy">
                        <code>{record.recordId}</code> | {record.scope} | {record.state || 'unknown'}
                      </p>
                      {record.acceptanceCriteria && record.acceptanceCriteria.length > 0 ? (
                        <p className="planning-item-copy">
                          Acceptance criteria: {record.acceptanceCriteria.join(' | ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4>Search Results</h4>
              {planningState.searchResults.length === 0 ? (
                <p className="state-message">No search results.</p>
              ) : (
                <ul className="planning-record-list">
                  {planningState.searchResults.map((result) => (
                    <li key={`${result.recordId}-${result.rank}`}>
                      <p className="planning-item-title">#{result.rank} {result.recordId}</p>
                      <p className="planning-item-copy">
                        {result.scope || 'unknown'} | {result.status || 'unknown'} | score={result.score}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          subtitle="Attach research notes and inspect diagrams for the selected record."
          testId="planning-artifacts-panel"
          title="Research + Diagrams"
        >
          <div className="planning-controls">
            <div className="planning-select-grid">
              <label className="form-input" htmlFor="planning-artifact-record-id">
                <span className="form-label">Selected Record</span>
                <select
                  data-testid="planning-artifact-record-select"
                  id="planning-artifact-record-id"
                  onChange={(event) => planningStore.setSelectedRecordId(event.target.value)}
                  value={planningState.selectedRecordId}
                >
                  {planningState.records.length === 0 ? <option value="">(no records)</option> : null}
                  {planningState.records.map((record) => (
                    <option key={record.recordId} value={record.recordId}>
                      {record.recordId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-input" htmlFor="planning-artifact-diagram-id">
                <span className="form-label">Diagram</span>
                <select
                  data-testid="planning-artifact-diagram-select"
                  id="planning-artifact-diagram-id"
                  onChange={(event) => planningStore.setSelectedDiagramId(event.target.value)}
                  value={planningState.selectedDiagramId}
                >
                  {planningState.diagrams.length === 0 ? <option value="">(no diagrams)</option> : null}
                  {planningState.diagrams.map((diagram) => (
                    <option key={diagram.id} value={diagram.id}>
                      {diagram.title || diagram.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="planning-copy">
              Selected: {selectedRecord?.recordId || '(none)'} | Notes: {planningState.researchNotes.length} | Diagrams:{' '}
              {planningState.diagrams.length}
            </p>

            <ResearchNotesPanel
              deleting={planningState.artifactsDeleting}
              error={planningState.artifactsError}
              loading={planningState.artifactsLoading}
              notes={planningState.researchNotes}
              onDelete={async (noteId) => {
                await planningStore.removeResearchNote(noteId);
              }}
              onRefresh={() => {
                void planningStore.loadArtifacts();
              }}
              onSave={async (note) => {
                await planningStore.saveResearchNote(note);
              }}
              recordId={planningState.selectedRecordId}
              saving={planningState.artifactsSaving}
            />

            <MermaidViewer diagram={selectedDiagram} />
          </div>
        </Panel>

        <Panel
          subtitle="Manual compare -> intent -> confirm flow."
          testId="planning-merge-panel"
          title="Compare + Merge"
        >
          <div className="planning-controls">
            <p className="planning-copy">
              Compare receipt: <code>{compareReceiptId || '(none)'}</code>
            </p>
            <p className="planning-copy">
              Matches: {planningState.compareResponse?.matches.length || 0} | Planning records in compare:{' '}
              {planningState.compareResponse?.planningRecords.length || 0}
            </p>

            <label className="form-input" htmlFor="planning-merge-target">
              <span className="form-label">Merge Target</span>
              <select
                data-testid="planning-merge-target-select"
                id="planning-merge-target"
                onChange={(event) => planningStore.setMergeTargetId(event.target.value)}
                value={planningState.mergeTargetId}
              >
                {compareTargets.length === 0 ? <option value="">(compare first)</option> : null}
                {compareTargets.map((targetId) => (
                  <option key={targetId} value={targetId}>
                    {targetId}
                  </option>
                ))}
              </select>
            </label>

            <div className="planning-actions">
              <Button
                disabled={!canPrepareIntent}
                onClick={() => {
                  void planningStore.prepareMergeIntent();
                }}
                testId="planning-prepare-intent-button"
                variant="secondary"
              >
                {planningState.preparingIntent ? 'Preparing...' : 'Prepare intent'}
              </Button>
              <Button
                disabled={!canConfirmMerge}
                onClick={() => {
                  void planningStore.confirmMerge();
                }}
                testId="planning-confirm-merge-button"
                variant="danger"
              >
                {planningState.merging ? 'Merging...' : 'Confirm merge'}
              </Button>
            </div>

            <p className="planning-copy">
              Merge checks: gate={planningState.gateState}, reviewedAll={String(reviewedAllConflicts)},
              intent={planningState.intentToken ? 'present' : 'missing'}
            </p>

            {planningState.conflictRows.length > 0 ? (
              <table className="planning-conflicts-table" data-testid="planning-conflicts-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">User</th>
                    <th scope="col">Repo</th>
                    <th scope="col">Global</th>
                    <th scope="col">Winner</th>
                    <th scope="col">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {planningState.conflictRows.map((row) => {
                    const reviewed = planningState.reviewedConflictKeys.includes(row.conflictKey);
                    return (
                      <tr key={row.conflictKey}>
                        <td>{row.field}</td>
                        <td>{renderConflictValue(row.valuesByScope.user?.value || null)}</td>
                        <td>{renderConflictValue(row.valuesByScope.repo?.value || null)}</td>
                        <td>{renderConflictValue(row.valuesByScope.global?.value || null)}</td>
                        <td>{row.winnerScope}</td>
                        <td>
                          <input
                            checked={reviewed}
                            onChange={(event) => {
                              planningStore.toggleConflictReviewed(row.conflictKey, event.target.checked);
                            }}
                            type="checkbox"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="state-message">No precedence conflicts in the latest compare response.</p>
            )}

            <pre className="code-block" data-testid="planning-intent-token">
              {planningState.intentToken
                ? JSON.stringify(planningState.intentToken, null, 2)
                : '(no intent token prepared)'}
            </pre>
          </div>
        </Panel>
      </div>
    </section>
  );
}
