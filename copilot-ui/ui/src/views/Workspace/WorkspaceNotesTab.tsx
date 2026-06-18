<<<<<<< Updated upstream
import { useState } from 'react';
import WorkspaceNotesReader from './Notes/Reader';
import WorkspaceNotesEditor from './Notes/Editor';
import WorkspaceNotesRaw from './Notes/Raw';

type NotesViewMode = 'read' | 'write' | 'raw';
=======
import { useState, useEffect, useCallback, useRef } from 'react';
import { listNotes, createNote, updateNote, deleteNote, type Note } from '../../lib/api/notes';
import { notificationStore } from '../../stores/notificationStore';
>>>>>>> Stashed changes

interface WorkspaceNotesTabProps {
  repoPath: string;
}

export default function WorkspaceNotesTab({ repoPath }: WorkspaceNotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [theme, setTheme] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ content: string; tags: string[]; theme: string } | null>(null);

  const activeNote = notes.find(n => n.id === activeNoteId) || null;

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNotes({ limit: 100, order: 'updated_at DESC' });
      const repoNotes = result.notes.filter(n => n.repo_path === repoPath);
      setNotes(repoNotes);
      if (!activeNoteId && repoNotes.length > 0) {
        setActiveNoteId(repoNotes[0].id);
      }
    } catch {
      setError('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);

  useEffect(() => {
    if (activeNote) {
      setContent(activeNote.content);
      setTheme(activeNote.theme || '');
      try { setTags(JSON.parse(activeNote.tags_json || '[]')); } catch { setTags([]); }
    } else {
      setContent('');
      setTheme('');
      setTags([]);
    }
  }, [activeNote?.id]);

  const scheduleSave = useCallback((newContent: string, newTags: string[], newTheme: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingRef.current = { content: newContent, tags: newTags, theme: newTheme };
    debounceRef.current = setTimeout(async () => {
      if (!activeNoteId || !pendingRef.current) return;
      const p = pendingRef.current;
      pendingRef.current = null;
      setSaving(true);
      try {
        const updated = await updateNote({
          id: activeNoteId,
          content: p.content,
          tags: p.tags,
          theme: p.theme || undefined,
        });
        setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
      } catch (err) {
        notificationStore.error('Failed to save note', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [activeNoteId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pendingRef.current && activeNoteId) {
        const p = pendingRef.current;
        updateNote({ id: activeNoteId, content: p.content, tags: p.tags, theme: p.theme || undefined }).catch(() => {});
      }
    };
  }, [activeNoteId]);

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setContent(v);
    scheduleSave(v, tags, theme);
  }

  function handleBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (pendingRef.current && activeNoteId) {
      const p = pendingRef.current;
      pendingRef.current = null;
      setSaving(true);
      updateNote({ id: activeNoteId, content: p.content, tags: p.tags, theme: p.theme || undefined })
        .then(updated => {
          setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
        })
        .catch(() => {})
        .finally(() => setSaving(false));
    }
  }

  async function handleNewNote() {
    setError(null);
    try {
      const note = await createNote({
        content: '',
        title: '',
        repo_path: repoPath,
        tags: [],
      });
      setNotes(prev => [note, ...prev]);
      setActiveNoteId(note.id);
    } catch {
      setError('Failed to create note');
    }
  }

  async function handleDeleteNote(id: string) {
    try {
      await deleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (activeNoteId === id) {
        const remaining = notes.filter(n => n.id !== id);
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch {
      setError('Failed to delete note');
    }
  }

  function handleAddTag(tag: string) {
    const next = [...tags, tag];
    setTags(next);
    scheduleSave(content, next, theme);
  }

  function handleRemoveTag(tag: string) {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    scheduleSave(content, next, theme);
  }

  const points = content
    .split('\n')
    .map((l, i) => ({ line: l.trim(), index: i }))
    .filter(p => p.line.startsWith('- ') || p.line.startsWith('* '));

  function isPointTagged(text: string): boolean {
    return tags.some(t => text.toLowerCase().includes(t.toLowerCase()));
  }

  function handleTogglePointTag(pointText: string) {
    const clean = pointText.replace(/^[-*]\s*/, '').trim();
    if (!clean) return;
    if (isPointTagged(clean)) {
      handleRemoveTag(clean);
    } else {
      handleAddTag(clean);
    }
  }

  return (
    <div className="workspace-notes-tab" data-testid="workspace-notes-tab">
      <div className="workspace-notes-toolbar">
        <h3 className="workspace-notes-title">Notes</h3>
        <div className="workspace-notes-actions">
          {saving && <span className="workspace-notes-saved">Saving...</span>}
          <button
            className="button button-primary button-sm"
            onClick={handleNewNote}
            data-testid="notes-new-btn"
            type="button"
          >
            + New
          </button>
        </div>
      </div>

<<<<<<< Updated upstream
      {/* Content area — delegates to child views */}
      <div className="workspace-notes-body" role="tabpanel">
        {viewMode === 'read' && (
          <WorkspaceNotesReader
            repoPath={repoPath}
            activeNoteId={activeNoteId}
            onNoteSelect={handleNoteSelect}
            onEditNote={handleEditNote}
          />
        )}
        {viewMode === 'write' && (
          <WorkspaceNotesEditor
            repoPath={repoPath}
            noteId={activeNoteId}
            onSaved={(id) => { setActiveNoteId(id); setViewMode('read'); }}
            onCancel={() => setViewMode(activeNoteId ? 'read' : 'read')}
          />
        )}
        {viewMode === 'raw' && (
          <WorkspaceNotesRaw
            repoPath={repoPath}
            noteId={activeNoteId}
          />
        )}
      </div>
=======
      {error && <p className="workspace-notes-error">{error}</p>}

      {loading ? (
        <p className="workspace-notes-loading">Loading notes...</p>
      ) : notes.length === 0 ? (
        <p className="workspace-notes-loading">No notes yet. Click &quot;+ New&quot; to create one.</p>
      ) : activeNote ? (
        <div className="workspace-notes-body">
          <div className="workspace-notes-editor">
            <textarea
              className="workspace-notes-textarea"
              value={content}
              onChange={handleContentChange}
              onBlur={handleBlur}
              placeholder="Write your note in markdown..."
              data-testid="notes-textarea"
            />
            {(theme || tags.length > 0) && (
              <div className="workspace-notes-highlight-info">
                {theme && <span>Theme: {theme}</span>}
                {theme && tags.length > 0 && <span> | </span>}
                {tags.length > 0 && <span>{tags.length} tag{tags.length !== 1 ? 's' : ''}</span>}
              </div>
            )}
          </div>

          <div className="workspace-notes-sidebar">
            {points.length > 0 && (
              <div className="workspace-notes-points">
                <h4 className="workspace-notes-section-title">Points ({points.length})</h4>
                <ul className="workspace-notes-point-list">
                  {points.map(p => {
                    const clean = p.line.replace(/^[-*]\s*/, '').trim();
                    const tagged = isPointTagged(clean);
                    return (
                      <li
                        key={p.index}
                        className={`workspace-notes-point${tagged ? ' workspace-notes-point-tagged' : ''}`}
                        data-testid={`notes-point-${p.index}`}
                      >
                        <span className="workspace-notes-point-text">{clean}</span>
                        <span className="workspace-notes-point-actions">
                          <button
                            className="workspace-notes-tag-chip"
                            onClick={() => handleTogglePointTag(p.line)}
                            type="button"
                            title={tagged ? 'Remove tag' : 'Tag this point'}
                          >
                            {tagged ? 'Tagged' : 'Tag'}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="workspace-notes-tags">
              <h4 className="workspace-notes-section-title">Tags</h4>
              <div className="workspace-notes-tag-input-row">
                <input
                  className="workspace-notes-tag-input"
                  type="text"
                  placeholder="Add tag..."
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                      handleAddTag((e.target as HTMLInputElement).value.trim());
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                  data-testid="notes-tag-input"
                />
              </div>
              {tags.length > 0 && (
                <div className="workspace-notes-tag-list">
                  {tags.map(t => (
                    <span key={t} className="workspace-notes-tag-chip workspace-notes-tag-chip-active">
                      <span className="workspace-notes-tag-label">{t}</span>
                      <button
                        className="workspace-notes-tag-remove"
                        onClick={() => handleRemoveTag(t)}
                        type="button"
                        aria-label={`Remove tag ${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
>>>>>>> Stashed changes
    </div>
  );
}
