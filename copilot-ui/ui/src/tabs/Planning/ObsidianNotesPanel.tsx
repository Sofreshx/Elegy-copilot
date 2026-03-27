import { Button, Panel, StatusBadge } from '../../components';
import type {
  ObsidianPlanningNoteDetail,
  ObsidianPlanningNoteSummary,
  ObsidianPlanningRepresentationSummary,
  ObsidianPlanningRepresentationsStatus,
  ObsidianPlanningStatus,
  SyncedNoteSourceLocator,
  SyncedNoteSourceRecord,
} from '../../lib/types';
import ObsidianSourceManagementSection from './ObsidianSourceManagementSection';

interface ObsidianNotesPanelProps {
  repoContextSelected: boolean;
  repoContextLabel: string;
  selectedRoadmapTitle: string;
  status: ObsidianPlanningStatus | null;
  notes: ObsidianPlanningNoteSummary[];
  representationsStatus: ObsidianPlanningRepresentationsStatus | null;
  representations: ObsidianPlanningRepresentationSummary[];
  selectedNoteId: string;
  selectedNote: ObsidianPlanningNoteDetail | null;
  loading: boolean;
  detailLoading: boolean;
  syncing: boolean;
  representationsLoading: boolean;
  representationsRefreshing: boolean;
  promotionSaving: boolean;
  sourceSelectionSaving: boolean;
  sourceSaving: boolean;
  sourceDeletingId: string | null;
  error: string | null;
  onRefresh: () => void;
  onRefreshRepresentations: () => void;
  onManualSync: () => void;
  onSelectNote: (noteId: string) => void;
  onSeedPlan: (note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail) => void;
  onPromoteToBacklog: (note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail) => Promise<string | null> | string | null;
  onPromoteToRoadmap: (
    note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail,
  ) => Promise<{ backlogId: string; roadmapItemId: string } | null> | { backlogId: string; roadmapItemId: string } | null;
  onSetActiveSource: (sourceId: string) => Promise<boolean> | boolean;
  onClearActiveSource: () => Promise<boolean> | boolean;
  onCreateSource: (source: SyncedNoteSourceLocator) => Promise<SyncedNoteSourceRecord | null> | SyncedNoteSourceRecord | null;
  onUpdateSource: (
    sourceId: string,
    source: SyncedNoteSourceLocator,
  ) => Promise<SyncedNoteSourceRecord | null> | SyncedNoteSourceRecord | null;
  onDeleteSource: (sourceId: string) => Promise<boolean> | boolean;
}

function resolveBadgeTone(status: ObsidianPlanningStatus | null): 'neutral' | 'accent' | 'success' | 'danger' {
  switch (status?.state) {
    case 'ready':
      return 'success';
    case 'not-configured':
      return 'accent';
    case 'vault-unavailable':
    case 'notes-unavailable':
      return 'danger';
    default:
      return 'neutral';
  }
}

function resolveFreshnessTone(freshness: ObsidianPlanningRepresentationSummary['freshness']): 'neutral' | 'accent' | 'success' | 'danger' {
  switch (freshness) {
    case 'current':
      return 'success';
    case 'stale':
    case 'missing':
    case 'source-missing':
      return 'accent';
    case 'invalid':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function ObsidianNotesPanel(props: ObsidianNotesPanelProps) {
  const selectedDetail =
    props.selectedNote && props.selectedNote.id === props.selectedNoteId
      ? props.selectedNote
      : null;
  const currentNote =
    selectedDetail
    || props.notes.find((entry) => entry.id === props.selectedNoteId)
    || props.notes[0]
    || null;

  const notePreview = selectedDetail?.content || currentNote?.summary || '';
  const statusLabel = props.status?.state ? props.status.state.replace(/-/g, ' ') : 'unknown';
  const remoteSync = props.status?.remoteSync;

  return (
    <Panel
      subtitle="Primary Planning note context now reads from an external Obsidian surface. These notes are external and non-canonical; repo docs plus session plan.md remain authoritative."
      testId="planning-obsidian-notes-panel"
      title="External Obsidian Notes"
      actions={(
        <div className="planning-actions">
          <StatusBadge
            status={statusLabel}
            testId="planning-obsidian-status"
            tone={resolveBadgeTone(props.status)}
          />
          <Button
            disabled={props.loading}
            onClick={props.onRefresh}
            testId="planning-obsidian-refresh"
            variant="ghost"
          >
            {props.loading ? 'Refreshing…' : 'Refresh notes'}
          </Button>
          <Button
            disabled={props.syncing || !props.status?.syncAvailable}
            onClick={props.onManualSync}
            testId="planning-obsidian-manual-sync"
            variant="secondary"
          >
            {props.syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}
    >
      <div className="planning-controls">
        <p className="planning-copy">{props.status?.message || 'External Obsidian notes are unavailable.'}</p>
        <p className="planning-copy">
          Authority: <strong>external / non-canonical</strong>. Backlog, roadmaps, and the active session
          <code> plan.md </code>
          remain canonical.
        </p>

        {props.status?.notesDirectoryPath ? (
          <p className="planning-copy">
            Repo note folder: <code>{props.status.notesDirectoryPath}</code>
          </p>
        ) : null}

        {props.status?.vaultPath ? (
          <p className="planning-copy">
            Vault: <code>{props.status.vaultPath}</code>
          </p>
        ) : null}

        {props.status?.cli ? (
          <p className="planning-copy">
            CLI: <strong>{props.status.cli.state}</strong>
            {' — '}
            {props.status.cli.message}
          </p>
        ) : null}

        {remoteSync ? (
          <p className="planning-copy" data-testid="planning-obsidian-sync-status">
            Remote sync: <strong>{remoteSync.state}</strong>
            {' — '}
            {remoteSync.message}
            {remoteSync.lastSuccessAt ? (
              <>
                {' '}
                Last success: <code>{remoteSync.lastSuccessAt}</code>
              </>
            ) : null}
          </p>
        ) : null}

        {remoteSync?.conflictCount ? (
          <p className="planning-error" role="alert">
            Remote sync left {remoteSync.conflictCount} note conflict(s) untouched. Review the local vault before retrying.
          </p>
        ) : null}

        <ObsidianSourceManagementSection
          deletingSourceId={props.sourceDeletingId}
          loading={props.loading}
          onClearActiveSource={props.onClearActiveSource}
          onCreateSource={props.onCreateSource}
          onDeleteSource={props.onDeleteSource}
          onSetActiveSource={props.onSetActiveSource}
          onUpdateSource={props.onUpdateSource}
          repoContextLabel={props.repoContextLabel}
          repoContextSelected={props.repoContextSelected}
          selectionSaving={props.sourceSelectionSaving}
          sourceResolution={props.status?.sourceResolution}
          sourceSaving={props.sourceSaving}
        />

        {props.error ? (
          <p className="planning-error" role="alert">
            {props.error}
          </p>
        ) : null}

        <div className="planning-controls" data-testid="planning-obsidian-representations">
          <p className="planning-copy">
            Canonical planning mirrors: deterministic Obsidian representations of
            {' '}
            <code>docs/planning/bullets.md</code>
            {' '}
            and
            {' '}
            <code>docs/roadmaps/*.md</code>
            . They remain <strong>external / non-canonical</strong> and are never parsed back as authority.
          </p>
          <p className="planning-copy">
            {props.representationsStatus?.message || 'Deterministic planning mirrors are unavailable.'}
          </p>
          <p className="planning-copy">
            Mirror freshness — current: {props.representationsStatus?.currentCount ?? 0}
            {' · '}
            stale: {props.representationsStatus?.staleCount ?? 0}
            {' · '}
            missing: {props.representationsStatus?.missingCount ?? 0}
            {' · '}
            invalid: {props.representationsStatus?.invalidCount ?? 0}
            {' · '}
            source missing: {props.representationsStatus?.sourceMissingCount ?? 0}
          </p>
          <div className="planning-actions">
            <Button
              disabled={props.representationsRefreshing || !props.representationsStatus?.writeAvailable}
              onClick={props.onRefreshRepresentations}
              testId="planning-obsidian-refresh-representations"
              variant="secondary"
            >
              {props.representationsRefreshing ? 'Refreshing mirrors…' : 'Refresh canonical mirrors'}
            </Button>
          </div>
          {props.representations.length > 0 ? (
            <div className="planning-controls">
              {props.representations.map((representation) => (
                <div key={representation.id} className="planning-metric-card" data-testid={`planning-obsidian-representation-${representation.id}`}>
                  <div className="planning-actions">
                    <strong>{representation.title}</strong>
                    <StatusBadge
                      status={representation.freshness.replace(/-/g, ' ')}
                      testId={`planning-obsidian-representation-status-${representation.id}`}
                      tone={resolveFreshnessTone(representation.freshness)}
                    />
                  </div>
                  <p className="planning-copy">{representation.summary}</p>
                  <p className="planning-copy">
                    Canonical source: <code>{representation.sourceRepoRelativePath}</code>
                  </p>
                  <p className="planning-copy">
                    Mirror note: <code>{representation.notePath}</code>
                  </p>
                  {representation.generatedAt ? (
                    <p className="planning-copy">Generated: {representation.generatedAt}</p>
                  ) : null}
                  {representation.sourceUpdatedAt ? (
                    <p className="planning-copy">Canonical updated: {representation.sourceUpdatedAt}</p>
                  ) : null}
                  <p className="planning-copy">{representation.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="state-message">
              {props.representationsLoading
                ? 'Loading canonical planning mirrors…'
                : 'No deterministic canonical planning mirrors are currently tracked for the selected repo.'}
            </p>
          )}
        </div>

        {props.notes.length > 0 ? (
          <>
            <label className="form-input" htmlFor="planning-obsidian-note-select">
              <span className="form-label">External note</span>
              <select
                data-testid="planning-obsidian-note-select"
                id="planning-obsidian-note-select"
                onChange={(event) => props.onSelectNote(event.target.value)}
                value={currentNote?.id || ''}
              >
                {props.notes.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title}
                  </option>
                ))}
              </select>
            </label>

            {currentNote ? (
              <>
                <p className="planning-copy" data-testid="planning-obsidian-note-path">
                  Note path: <code>{currentNote.notePath}</code>
                </p>
                {currentNote.lastModifiedAt ? (
                  <p className="planning-copy">Updated: {currentNote.lastModifiedAt}</p>
                ) : null}
                <p className="planning-copy" data-testid="planning-obsidian-selected-roadmap-label">
                  {props.selectedRoadmapTitle
                    ? <>Selected roadmap for canonical promotion: <strong>{props.selectedRoadmapTitle}</strong>.</>
                    : 'Select a roadmap in the Roadmaps section to link this external note into canonical roadmap work.'}
                </p>
                <div className="planning-actions">
                  <Button
                    disabled={props.detailLoading}
                    onClick={() => props.onSelectNote(currentNote.id)}
                    testId="planning-obsidian-open-note"
                    variant="secondary"
                  >
                    {props.detailLoading ? 'Loading note…' : 'Open note detail'}
                  </Button>
                  <Button
                    onClick={() => props.onSeedPlan(selectedDetail || currentNote)}
                    testId="planning-obsidian-seed-plan"
                  >
                    Seed plan from note
                  </Button>
                  <Button
                    disabled={props.promotionSaving}
                    onClick={() => {
                      void props.onPromoteToBacklog(selectedDetail || currentNote);
                    }}
                    testId="planning-obsidian-promote-backlog"
                    variant="secondary"
                  >
                    {props.promotionSaving ? 'Promoting…' : 'Suggest backlog item'}
                  </Button>
                  <Button
                    disabled={props.promotionSaving || !props.selectedRoadmapTitle}
                    onClick={() => {
                      void props.onPromoteToRoadmap(selectedDetail || currentNote);
                    }}
                    testId="planning-obsidian-promote-roadmap"
                  >
                    {props.promotionSaving ? 'Promoting…' : 'Add to selected roadmap'}
                  </Button>
                </div>
                <pre className="code-block" data-testid="planning-obsidian-note-viewer">
                  {notePreview || 'No note content available.'}
                </pre>
              </>
            ) : null}
          </>
        ) : (
          <p className="state-message">
            {props.loading
              ? 'Loading external Obsidian notes…'
              : 'No external Obsidian notes are currently available for the selected Catalog repo.'}
          </p>
        )}
      </div>
    </Panel>
  );
}
