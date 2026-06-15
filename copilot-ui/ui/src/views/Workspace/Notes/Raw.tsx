import { useState, useEffect } from 'react';
import { getNote, updateNote } from '../../../lib/api/notes';

interface RawProps {
  repoPath: string;
  noteId: string | null;
}

export default function WorkspaceNotesRaw({ repoPath: _repoPath, noteId }: RawProps) {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!noteId) { setContent(''); setTitle(''); return; }
    let cancelled = false;
    getNote(noteId).then(n => {
      if (!cancelled) { setContent(n.content || ''); setTitle(n.title || ''); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [noteId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editMode) { e.preventDefault(); void handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [content, noteId, editMode]);

  async function handleSave() {
    if (!noteId) return;
    setSaving(true);
    setError(null);
    try {
      await updateNote({ id: noteId, content });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  if (!noteId) {
    return (
      <div className="workspace-notes-raw" data-testid="notes-raw">
        <p className="state-message">Select a note to view its raw content.</p>
      </div>
    );
  }

  const lines = content.split('\n');

  return (
    <div className="workspace-notes-raw" data-testid="notes-raw">
      {error && <div className="workspace-notes-error">{error}</div>}
      
      <div className="workspace-notes-raw-toolbar">
        <h3 className="workspace-notes-title">{title || 'Untitled'} (Raw)</h3>
        <div className="workspace-notes-actions">
          {saved && <span className="workspace-notes-saved">Saved</span>}
          <button
            className={`button button-sm ${editMode ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setEditMode(!editMode)}
            data-testid="notes-raw-toggle-edit"
          >
            {editMode ? 'Read Only' : 'Edit'}
          </button>
          {editMode && (
            <button className="button button-primary button-sm" onClick={() => void handleSave()} disabled={saving} data-testid="notes-raw-save">
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {editMode ? (
        <textarea
          className="workspace-notes-raw-textarea"
          value={content}
          onChange={e => { setContent(e.target.value); setSaved(false); }}
          spellCheck={false}
          data-testid="notes-raw-textarea"
        />
      ) : (
        <div className="workspace-notes-raw-lines" data-testid="notes-raw-lines">
          {lines.map((line, i) => (
            <div key={i} className="workspace-notes-raw-line">
              <span className="workspace-notes-raw-line-num">{i + 1}</span>
              <span className="workspace-notes-raw-line-text">{line || '\u00A0'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
