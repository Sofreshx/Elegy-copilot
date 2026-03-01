import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput } from '../../components';
import type { PlanningResearchNoteInput } from '../../lib/api';
import type { PlanningResearchNote } from '../../lib/types';

interface ResearchNotesPanelProps {
  recordId: string;
  notes: PlanningResearchNote[];
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  onRefresh: () => void;
  onSave: (note: PlanningResearchNoteInput) => Promise<void> | void;
  onDelete: (noteId: string) => Promise<void> | void;
}

function normalizeSources(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export default function ResearchNotesPanel({
  recordId,
  notes,
  loading,
  saving,
  deleting,
  error,
  onRefresh,
  onSave,
  onDelete,
}: ResearchNotesPanelProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [phase, setPhase] = useState('research');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourcesRaw, setSourcesRaw] = useState('');

  useEffect(() => {
    setEditingNoteId(null);
    setPhase('research');
    setTitle('');
    setContent('');
    setSourcesRaw('');
  }, [recordId]);

  const sortedNotes = useMemo(
    () => notes.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
    [notes]
  );

  const isEditing = Boolean(editingNoteId);

  const startCreate = () => {
    setEditingNoteId(null);
    setPhase('research');
    setTitle('');
    setContent('');
    setSourcesRaw('');
  };

  const startEdit = (note: PlanningResearchNote) => {
    setEditingNoteId(note.id);
    setPhase(note.phase || 'research');
    setTitle(note.title || '');
    setContent(note.content || note.summary || '');
    setSourcesRaw((note.sources || (note.source ? [note.source] : [])).join(', '));
  };

  const handleSubmit = async () => {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle || !normalizedContent) {
      return;
    }

    const sources = normalizeSources(sourcesRaw);

    await onSave({
      id: editingNoteId || undefined,
      phase: phase.trim() || 'research',
      title: normalizedTitle,
      content: normalizedContent,
      sources: sources.length > 0 ? sources : undefined,
    });

    if (!editingNoteId) {
      startCreate();
    }
  };

  return (
    <section className="research-notes-panel" data-testid="research-notes-panel">
      <div className="research-notes-toolbar">
        <p className="planning-copy">Record: {recordId || '(none selected)'}</p>
        <div className="planning-actions">
          <Button disabled={!recordId || loading} onClick={onRefresh} testId="planning-notes-refresh" variant="secondary">
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button disabled={!recordId || saving} onClick={startCreate} testId="planning-notes-create" variant="ghost">
            New note
          </Button>
        </div>
      </div>

      {error ? (
        <p className="planning-error" role="alert">
          {error}
        </p>
      ) : null}

      {sortedNotes.length === 0 ? (
        <p className="state-message">No research notes for this record.</p>
      ) : (
        <ul className="planning-record-list">
          {sortedNotes.map((note) => {
            const isCurrentEdit = editingNoteId === note.id;
            return (
              <li key={note.id}>
                <div className="research-note-entry">
                  <p className="planning-item-title">{note.title || note.id}</p>
                  <p className="planning-item-copy">
                    {note.phase || 'research'} | {note.createdAt || 'unknown'}
                  </p>

                  <details className="research-note-details">
                    <summary>View note</summary>
                    <pre className="code-block">{note.content || note.summary || ''}</pre>
                    {note.sources && note.sources.length > 0 ? (
                      <p className="planning-item-copy">Sources: {note.sources.join(', ')}</p>
                    ) : null}
                  </details>
                </div>
                <div className="planning-actions">
                  <Button
                    onClick={() => startEdit(note)}
                    size="sm"
                    testId={`planning-note-edit-${note.id}`}
                    variant={isCurrentEdit ? 'primary' : 'ghost'}
                  >
                    {isCurrentEdit ? 'Editing' : 'Edit'}
                  </Button>
                  <Button
                    disabled={deleting}
                    onClick={() => {
                      void onDelete(note.id);
                    }}
                    size="sm"
                    testId={`planning-note-delete-${note.id}`}
                    variant="danger"
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="research-note-form">
        <div className="planning-field-grid">
          <FormInput
            id="planning-note-phase"
            label="Phase"
            onValueChange={setPhase}
            placeholder="research"
            testId="planning-note-phase"
            value={phase}
          />
          <FormInput
            id="planning-note-title"
            label="Title"
            onValueChange={setTitle}
            placeholder="Note title"
            testId="planning-note-title"
            value={title}
          />
        </div>

        <label className="form-input" htmlFor="planning-note-content">
          <span className="form-label">Content</span>
          <textarea
            data-testid="planning-note-content"
            id="planning-note-content"
            onChange={(event) => setContent(event.target.value)}
            placeholder="Research notes"
            rows={6}
            value={content}
          />
        </label>

        <FormInput
          id="planning-note-sources"
          label="Sources (comma or newline separated)"
          onValueChange={setSourcesRaw}
          placeholder="doc-a, doc-b"
          testId="planning-note-sources"
          value={sourcesRaw}
        />

        <div className="planning-actions">
          <Button
            disabled={!recordId || saving || title.trim().length === 0 || content.trim().length === 0}
            onClick={() => {
              void handleSubmit();
            }}
            testId="planning-note-save"
          >
            {saving ? 'Saving...' : isEditing ? 'Save note' : 'Create note'}
          </Button>
          {isEditing ? (
            <Button onClick={startCreate} testId="planning-note-cancel" variant="ghost">
              Cancel edit
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
