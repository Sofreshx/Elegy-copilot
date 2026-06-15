import { useState, useEffect } from 'react';
import { createNote, updateNote, getNote } from '../../../lib/api/notes';

interface EditorProps {
  repoPath: string;
  noteId: string | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

export default function WorkspaceNotesEditor({ repoPath: _repoPath, noteId, onSaved, onCancel }: EditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [theme, setTheme] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isEditing = Boolean(noteId);

  // Load existing note if editing
  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    getNote(noteId).then(n => {
      if (!cancelled) {
        setTitle(n.title || '');
        setContent(n.content || '');
        setTheme(n.theme || '');
        try { setTags(JSON.parse(n.tags_json)); } catch { setTags([]); }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [noteId]);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [title, content, theme, tags, noteId]);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (isEditing && noteId) {
        await updateNote({ id: noteId, title, content, theme, tags });
        onSaved(noteId);
      } else {
        const created = await createNote({ title, content, theme, tags });
        onSaved(created.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) { setTags([...tags, t]); }
    setTagInput('');
  }

  function removeTag(tag: string) { setTags(tags.filter(t => t !== tag)); }

  return (
    <div className="workspace-notes-editor-view" data-testid="notes-editor">
      {error && <div className="workspace-notes-error">{error}</div>}
      
      <div className="workspace-notes-editor-form">
        <div className="workspace-notes-editor-field">
          <label className="workspace-notes-editor-label">Title</label>
          <input className="workspace-notes-editor-input" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title" data-testid="notes-editor-title" />
        </div>
        <div className="workspace-notes-editor-field">
          <label className="workspace-notes-editor-label">Theme</label>
          <input className="workspace-notes-editor-input" type="text" value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. research, personal, project" data-testid="notes-editor-theme" />
        </div>
        <div className="workspace-notes-editor-field">
          <label className="workspace-notes-editor-label">Tags</label>
          <div className="workspace-notes-tag-row">
            {tags.map(tag => (
              <span key={tag} className="workspace-notes-editor-tag" data-testid={`notes-editor-tag-${tag}`}>
                {tag}
                <button className="workspace-notes-editor-tag-remove" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>×</button>
              </span>
            ))}
            <input className="workspace-notes-editor-tag-input" type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add tag..." data-testid="notes-editor-tag-input" />
          </div>
        </div>
      </div>

      <div className="workspace-notes-editor-content">
        <label className="workspace-notes-editor-label">Content</label>
        <textarea className="workspace-notes-editor-textarea" value={content} onChange={e => { setContent(e.target.value); setSaved(false); }} placeholder="Write your note content here..." spellCheck={false} data-testid="notes-editor-content" />
      </div>

      <div className="workspace-notes-editor-actions">
        <button className="button button-secondary button-sm" onClick={onCancel} data-testid="notes-editor-cancel">Cancel</button>
        <button className="button button-primary button-sm" onClick={() => void handleSave()} disabled={saving || !content.trim()} data-testid="notes-editor-save">
          {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
        </button>
        {saved && <span className="workspace-notes-saved">Saved</span>}
      </div>
    </div>
  );
}
