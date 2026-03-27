import { useState } from 'react';

import { Button, StatusBadge } from '../../components';
import type {
  ObsidianSourceResolutionStatus,
  ObsidianSyncedNoteSourceRef,
  SyncedNoteSourceLocator,
  SyncedNoteSourceRecord,
} from '../../lib/types';

interface ObsidianSourceManagementSectionProps {
  repoContextSelected: boolean;
  repoContextLabel: string;
  sourceResolution?: ObsidianSourceResolutionStatus;
  loading: boolean;
  selectionSaving: boolean;
  sourceSaving: boolean;
  deletingSourceId: string | null;
  onSetActiveSource: (sourceId: string) => Promise<boolean> | boolean;
  onClearActiveSource: () => Promise<boolean> | boolean;
  onCreateSource: (source: SyncedNoteSourceLocator) => Promise<SyncedNoteSourceRecord | null> | SyncedNoteSourceRecord | null;
  onUpdateSource: (
    sourceId: string,
    source: SyncedNoteSourceLocator,
  ) => Promise<SyncedNoteSourceRecord | null> | SyncedNoteSourceRecord | null;
  onDeleteSource: (sourceId: string) => Promise<boolean> | boolean;
}

const DEFAULT_SOURCE_DRAFT: SyncedNoteSourceLocator = {
  provider: 'github',
  host: 'github.com',
  owner: '',
  repo: '',
  branch: 'main',
  notesPath: '',
};

const SOURCE_PROVIDER_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitea', label: 'Gitea' },
  { value: 'git', label: 'Generic Git' },
];

function createSourceDraft(source?: ObsidianSyncedNoteSourceRef | null): SyncedNoteSourceLocator {
  if (!source) {
    return { ...DEFAULT_SOURCE_DRAFT };
  }

  return {
    provider: source.provider || DEFAULT_SOURCE_DRAFT.provider,
    host: source.host || DEFAULT_SOURCE_DRAFT.host,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch || DEFAULT_SOURCE_DRAFT.branch,
    notesPath: source.notesPath,
  };
}

function normalizeSourceDraft(source: SyncedNoteSourceLocator): SyncedNoteSourceLocator {
  return {
    provider: source.provider.trim(),
    host: source.host.trim(),
    owner: source.owner.trim(),
    repo: source.repo.trim(),
    branch: source.branch.trim(),
    notesPath: source.notesPath.trim(),
  };
}

function isSourceDraftComplete(source: SyncedNoteSourceLocator): boolean {
  const normalized = normalizeSourceDraft(source);
  return Boolean(
    normalized.provider
    && normalized.host
    && normalized.owner
    && normalized.repo
    && normalized.branch
    && normalized.notesPath
  );
}

function formatSourceIdentity(source: ObsidianSyncedNoteSourceRef): string {
  return `${source.host}/${source.owner}/${source.repo} @ ${source.branch}`;
}

function resolveResolutionTone(sourceResolution?: ObsidianSourceResolutionStatus): 'neutral' | 'accent' | 'success' | 'danger' {
  if (sourceResolution?.resolved) {
    return 'success';
  }

  if (sourceResolution?.requiresSource) {
    return 'danger';
  }

  return sourceResolution ? 'accent' : 'neutral';
}

export default function ObsidianSourceManagementSection(props: ObsidianSourceManagementSectionProps) {
  const [editingSourceId, setEditingSourceId] = useState('');
  const [draft, setDraft] = useState<SyncedNoteSourceLocator>({ ...DEFAULT_SOURCE_DRAFT });
  const availableSources = props.sourceResolution?.availableSources ?? [];
  const activeSourceId = props.sourceResolution?.activeSourceId ?? '';
  const effectiveSourceId = props.sourceResolution?.effectiveSource?.id ?? '';

  if (!props.repoContextSelected) {
    return null;
  }

  const resetDraft = () => {
    setEditingSourceId('');
    setDraft({ ...DEFAULT_SOURCE_DRAFT });
  };

  const startEditing = (source: ObsidianSyncedNoteSourceRef) => {
    setEditingSourceId(source.id);
    setDraft(createSourceDraft(source));
  };

  const handleSubmit = async () => {
    const normalizedDraft = normalizeSourceDraft(draft);
    if (!isSourceDraftComplete(normalizedDraft)) {
      return;
    }

    if (editingSourceId) {
      const updated = await props.onUpdateSource(editingSourceId, normalizedDraft);
      if (updated) {
        resetDraft();
      }
      return;
    }

    const created = await props.onCreateSource(normalizedDraft);
    if (created) {
      resetDraft();
    }
  };

  const handleDelete = async (sourceId: string) => {
    const deleted = await props.onDeleteSource(sourceId);
    if (deleted && editingSourceId === sourceId) {
      resetDraft();
    }
  };

  return (
    <div className="planning-controls" data-testid="planning-obsidian-source-management">
      <p className="planning-copy">
        Tracker remains the synced-note source registry authority for
        {' '}
        <strong>{props.repoContextLabel || 'the selected repo'}</strong>
        . Obsidian runtime status remains the local authority for effective source resolution and sync readiness.
      </p>
      <div className="planning-actions">
        <StatusBadge
          status={props.sourceResolution?.resolved ? 'resolved' : 'unresolved'}
          testId="planning-obsidian-source-resolution-status"
          tone={resolveResolutionTone(props.sourceResolution)}
        />
        {props.sourceResolution?.reason ? (
          <StatusBadge
            status={props.sourceResolution.reason.replace(/_/g, ' ')}
            testId="planning-obsidian-source-resolution-reason"
            tone="neutral"
          />
        ) : null}
        <Button
          disabled={props.selectionSaving || !props.sourceResolution?.activeSourceConfigured}
          onClick={() => {
            void props.onClearActiveSource();
          }}
          testId="planning-obsidian-clear-source-selection"
          variant="ghost"
        >
          {props.selectionSaving ? 'Updating selection…' : 'Clear active source'}
        </Button>
      </div>
      <p className="planning-copy" data-testid="planning-obsidian-source-resolution-message">
        {props.sourceResolution?.message
          || (props.loading
            ? 'Loading synced-note source resolution for the selected repo…'
            : 'Synced-note source resolution is unavailable for the selected repo.')}
      </p>

      {props.sourceResolution?.effectiveSource ? (
        <div className="planning-metric-card" data-testid="planning-obsidian-effective-source">
          <div className="planning-actions">
            <strong>Effective source</strong>
            {props.sourceResolution.activeSourceConfigured ? (
              <StatusBadge status="operator selected" testId="planning-obsidian-effective-source-mode" tone="brand" />
            ) : (
              <StatusBadge status="automatic" testId="planning-obsidian-effective-source-mode" tone="accent" />
            )}
          </div>
          <p className="planning-copy">{formatSourceIdentity(props.sourceResolution.effectiveSource)}</p>
          <p className="planning-copy">
            Notes path:
            {' '}
            <code>{props.sourceResolution.effectiveSource.notesPath}</code>
          </p>
          <p className="planning-copy">
            Source id:
            {' '}
            <code>{props.sourceResolution.effectiveSource.id}</code>
          </p>
        </div>
      ) : null}

      {availableSources.length > 0 ? (
        <div className="planning-controls" data-testid="planning-obsidian-source-list">
          {availableSources.map((source) => {
            const isActiveSelection = activeSourceId === source.id;
            const isEffectiveSource = effectiveSourceId === source.id;
            return (
              <div key={source.id} className="planning-metric-card" data-testid={`planning-obsidian-source-${source.id}`}>
                <div className="planning-actions">
                  <strong>{source.owner}/{source.repo}</strong>
                  {isEffectiveSource ? (
                    <StatusBadge status="effective" testId={`planning-obsidian-source-effective-${source.id}`} tone="success" />
                  ) : null}
                  {isActiveSelection ? (
                    <StatusBadge status="active selection" testId={`planning-obsidian-source-active-${source.id}`} tone="brand" />
                  ) : null}
                </div>
                <p className="planning-copy">{source.provider} · {formatSourceIdentity(source)}</p>
                <p className="planning-copy">
                  Notes path:
                  {' '}
                  <code>{source.notesPath}</code>
                </p>
                <p className="planning-copy">
                  Source id:
                  {' '}
                  <code>{source.id}</code>
                </p>
                <div className="planning-actions">
                  <Button
                    disabled={props.selectionSaving || isActiveSelection}
                    onClick={() => {
                      void props.onSetActiveSource(source.id);
                    }}
                    testId={`planning-obsidian-source-select-${source.id}`}
                    variant={isEffectiveSource ? 'secondary' : 'ghost'}
                  >
                    {isActiveSelection
                      ? 'Active source selected'
                      : isEffectiveSource
                        ? 'Pin as active source'
                        : 'Set active source'}
                  </Button>
                  <Button
                    disabled={props.sourceSaving || props.deletingSourceId === source.id}
                    onClick={() => startEditing(source)}
                    testId={`planning-obsidian-source-edit-${source.id}`}
                    variant="ghost"
                  >
                    Edit
                  </Button>
                  <Button
                    disabled={props.sourceSaving || props.deletingSourceId === source.id}
                    onClick={() => {
                      void handleDelete(source.id);
                    }}
                    testId={`planning-obsidian-source-delete-${source.id}`}
                    variant="danger"
                  >
                    {props.deletingSourceId === source.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="state-message">
          {props.loading
            ? 'Loading tracker synced-note sources…'
            : 'No tracker synced-note sources are currently available for the selected repo context.'}
        </p>
      )}

      <div className="planning-metric-card" data-testid="planning-obsidian-source-form">
        <div className="planning-actions">
          <strong>{editingSourceId ? 'Edit synced-note source' : 'Create synced-note source'}</strong>
          {editingSourceId ? (
            <Button onClick={resetDraft} testId="planning-obsidian-source-cancel-edit" variant="ghost">
              Cancel edit
            </Button>
          ) : null}
        </div>
        <div className="planning-field-grid">
          <label className="form-input" htmlFor="planning-obsidian-source-provider">
            <span className="form-label">Provider</span>
            <select
              data-testid="planning-obsidian-source-provider"
              id="planning-obsidian-source-provider"
              onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))}
              value={draft.provider}
            >
              {SOURCE_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-input" htmlFor="planning-obsidian-source-host">
            <span className="form-label">Host</span>
            <input
              data-testid="planning-obsidian-source-host"
              id="planning-obsidian-source-host"
              onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
              placeholder="github.com"
              type="text"
              value={draft.host}
            />
          </label>
          <label className="form-input" htmlFor="planning-obsidian-source-owner">
            <span className="form-label">Owner</span>
            <input
              data-testid="planning-obsidian-source-owner"
              id="planning-obsidian-source-owner"
              onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
              placeholder="InstructionEngine"
              type="text"
              value={draft.owner}
            />
          </label>
          <label className="form-input" htmlFor="planning-obsidian-source-repo">
            <span className="form-label">Repo</span>
            <input
              data-testid="planning-obsidian-source-repo"
              id="planning-obsidian-source-repo"
              onChange={(event) => setDraft((current) => ({ ...current, repo: event.target.value }))}
              placeholder="workspace"
              type="text"
              value={draft.repo}
            />
          </label>
          <label className="form-input" htmlFor="planning-obsidian-source-branch">
            <span className="form-label">Branch</span>
            <input
              data-testid="planning-obsidian-source-branch"
              id="planning-obsidian-source-branch"
              onChange={(event) => setDraft((current) => ({ ...current, branch: event.target.value }))}
              placeholder="main"
              type="text"
              value={draft.branch}
            />
          </label>
          <label className="form-input" htmlFor="planning-obsidian-source-notes-path">
            <span className="form-label">Notes path</span>
            <input
              data-testid="planning-obsidian-source-notes-path"
              id="planning-obsidian-source-notes-path"
              onChange={(event) => setDraft((current) => ({ ...current, notesPath: event.target.value }))}
              placeholder="docs/planning/synced-note.md"
              type="text"
              value={draft.notesPath}
            />
          </label>
        </div>
        <div className="planning-actions">
          <Button
            disabled={props.sourceSaving || !isSourceDraftComplete(draft)}
            onClick={() => {
              void handleSubmit();
            }}
            testId="planning-obsidian-source-submit"
          >
            {props.sourceSaving
              ? editingSourceId
                ? 'Saving source…'
                : 'Creating source…'
              : editingSourceId
                ? 'Save source'
                : 'Create source'}
          </Button>
          <Button
            disabled={props.sourceSaving}
            onClick={resetDraft}
            testId="planning-obsidian-source-reset"
            variant="ghost"
          >
            {editingSourceId ? 'Reset form' : 'Clear form'}
          </Button>
        </div>
      </div>
    </div>
  );
}