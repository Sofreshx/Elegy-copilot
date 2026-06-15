import { useState, useEffect, useCallback } from 'react';
import { listNotes, searchNotes, getNote, type Note } from '../../../lib/api/notes';

interface ReaderProps {
  repoPath: string;
  activeNoteId: string | null;
  onNoteSelect: (id: string) => void;
  onEditNote: (id: string) => void;
}

export default function WorkspaceNotesReader({ repoPath: _repoPath, activeNoteId, onNoteSelect, onEditNote }: ReaderProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [noteBlocks, setNoteBlocks] = useState<import('../../../lib/api/notes').NoteBlock[]>([]);
  const [sortBy, setSortBy] = useState<string>('updated_at DESC');

  // Load notes
  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | boolean | number> = { limit: 100, order: sortBy };
      if (selectedTheme) params.theme = selectedTheme;
      if (selectedTag) params.tag = selectedTag;
      
      if (searchQuery.trim()) {
        const result = await searchNotes(searchQuery.trim(), 50);
        setNotes(result.results);
      } else {
        const result = await listNotes(params as any);
        setNotes(result.notes);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [searchQuery, selectedTheme, selectedTag, sortBy]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);

  // Load selected note detail
  useEffect(() => {
    if (!activeNoteId) { setSelectedNote(null); setNoteBlocks([]); return; }
    let cancelled = false;
    getNote(activeNoteId).then(n => {
      if (!cancelled) {
        setSelectedNote(n);
        setNoteBlocks(n.blocks || []);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeNoteId]);

  // Extract all unique themes and tags from loaded notes
  const themes = Array.from(new Set(notes.map(n => n.theme).filter(Boolean) as string[])).sort();
  const allTags = Array.from(new Set(
    notes.flatMap(n => { try { return JSON.parse(n.tags_json); } catch { return []; } })
  )).sort() as string[];

  // Simple markdown-to-text for preview (first 200 chars)
  function preview(text: string): string {
    return text.replace(/[#*`\[\]()>_~]/g, '').replace(/\n+/g, ' ').slice(0, 200).trim();
  }

  return (
    <div className="workspace-notes-reader" data-testid="notes-reader">
      {/* Sidebar — note list + filters */}
      <div className="workspace-notes-reader-sidebar">
        <div className="workspace-notes-search">
          <input
            className="workspace-notes-search-input"
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            data-testid="notes-search-input"
          />
        </div>

        <div className="workspace-notes-filters">
          <select className="workspace-notes-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)} data-testid="notes-sort">
            <option value="updated_at DESC">Latest</option>
            <option value="updated_at ASC">Oldest</option>
            <option value="title ASC">Title A-Z</option>
            <option value="title DESC">Title Z-A</option>
            <option value="created_at DESC">Newest created</option>
          </select>
        </div>

        {themes.length > 0 && (
          <div className="workspace-notes-filter-group">
            <h4 className="workspace-notes-section-title">Themes</h4>
            <div className="workspace-notes-chip-row">
              <button className={`workspace-notes-chip${!selectedTheme ? ' active' : ''}`} onClick={() => setSelectedTheme(null)}>All</button>
              {themes.map(t => (
                <button key={t} className={`workspace-notes-chip${selectedTheme === t ? ' active' : ''}`} onClick={() => setSelectedTheme(selectedTheme === t ? null : t)}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {allTags.length > 0 && (
          <div className="workspace-notes-filter-group">
            <h4 className="workspace-notes-section-title">Tags</h4>
            <div className="workspace-notes-chip-row">
              {allTags.map(t => (
                <button key={t} className={`workspace-notes-chip${selectedTag === t ? ' active' : ''}`} onClick={() => setSelectedTag(selectedTag === t ? null : t)}>{t}</button>
              ))}
            </div>
          </div>
        )}

        <div className="workspace-notes-list">
          <h4 className="workspace-notes-section-title">Notes ({notes.length})</h4>
          {loading ? (
            <p className="workspace-notes-empty">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="workspace-notes-empty">No notes yet. Click "+ New Note" to get started.</p>
          ) : (
            notes.map(note => (
              <button
                key={note.id}
                className={`workspace-notes-list-item${activeNoteId === note.id ? ' active' : ''}`}
                onClick={() => onNoteSelect(note.id)}
                data-testid={`notes-item-${note.id}`}
              >
                <div className="workspace-notes-list-item-title">{note.title || 'Untitled'}</div>
                {note.theme && <span className="workspace-notes-list-item-theme">{note.theme}</span>}
                <div className="workspace-notes-list-item-preview">{preview(note.content)}</div>
                <div className="workspace-notes-list-item-meta">
                  {new Date(note.updated_at).toLocaleDateString()}
                  {note.archived ? ' · Archived' : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content — selected note detail */}
      <div className="workspace-notes-reader-main">
        {selectedNote ? (
          <div className="workspace-notes-detail">
            <div className="workspace-notes-detail-header">
              <h2 className="workspace-notes-detail-title">{selectedNote.title || 'Untitled'}</h2>
              <div className="workspace-notes-detail-actions">
                <button className="button button-secondary button-sm" onClick={() => onEditNote(selectedNote.id)} data-testid="notes-edit-btn">
                  Edit
                </button>
              </div>
            </div>
            {selectedNote.theme && <span className="workspace-notes-detail-theme">{selectedNote.theme}</span>}
            <div className="workspace-notes-detail-meta">
              Created {new Date(selectedNote.created_at).toLocaleDateString()} · Updated {new Date(selectedNote.updated_at).toLocaleDateString()}
              {selectedNote.archived ? ' · Archived' : ''}
            </div>
            <div className="workspace-notes-detail-content" data-testid="notes-content">
              {/* Pre blocks for raw markdown — will be replaced with react-markdown later */}
              {selectedNote.content.split('\n').map((line, i) => (
                <div key={i} className={`notes-content-line${line.trimStart().startsWith('#') ? ' notes-content-h' : ''}${line.trimStart().startsWith('- ') ? ' notes-content-point' : ''}`}>
                  {line || '\u00A0'}
                </div>
              ))}
            </div>
            {/* Note blocks (research results, etc.) */}
            {noteBlocks.length > 0 && (
              <div className="workspace-notes-blocks">
                {noteBlocks.map(block => (
                  <details key={block.id} className="workspace-notes-block" open>
                    <summary className="workspace-notes-block-summary">
                      {block.block_kind} · {new Date(block.created_at).toLocaleDateString()}
                    </summary>
                    <div className="workspace-notes-block-body">{block.body}</div>
                  </details>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="workspace-notes-empty-state">
            <p>Select a note from the sidebar to read it, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
