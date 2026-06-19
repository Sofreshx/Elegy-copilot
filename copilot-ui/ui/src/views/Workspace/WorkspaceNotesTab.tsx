import { useState } from 'react';
import WorkspaceNotesReader from './Notes/Reader';
import WorkspaceNotesEditor from './Notes/Editor';
import WorkspaceNotesRaw from './Notes/Raw';

type NotesViewMode = 'read' | 'write' | 'raw';

interface WorkspaceNotesTabProps {
  repoPath: string;
}

export default function WorkspaceNotesTab({ repoPath }: WorkspaceNotesTabProps) {
  const [viewMode, setViewMode] = useState<NotesViewMode>('read');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  function handleNoteSelect(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('read');
  }

  function handleNewNote() {
    setActiveNoteId(null);
    setViewMode('write');
  }

  function handleEditNote(noteId: string) {
    setActiveNoteId(noteId);
    setViewMode('write');
  }

  return (
    <div className="workspace-notes-tab" data-testid="notes-tab">
      {/* Toolbar */}
      <div className="workspace-notes-toolbar">
        <div className="workspace-notes-toolbar-left">
          <h3 className="workspace-notes-title">Notes</h3>
          <div className="workspace-notes-view-switcher" role="tablist">
            <button
              className={`workspace-notes-view-btn${viewMode === 'read' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'read'}
              onClick={() => setViewMode('read')}
              data-testid="notes-view-read"
            >
              Read
            </button>
            <button
              className={`workspace-notes-view-btn${viewMode === 'write' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'write'}
              onClick={() => setViewMode('write')}
              data-testid="notes-view-write"
            >
              Write
            </button>
            <button
              className={`workspace-notes-view-btn${viewMode === 'raw' ? ' active' : ''}`}
              role="tab"
              aria-selected={viewMode === 'raw'}
              onClick={() => setViewMode('raw')}
              data-testid="notes-view-raw"
            >
              Raw
            </button>
          </div>
        </div>
        <div className="workspace-notes-actions">
          <button
            className="button button-primary button-sm"
            onClick={handleNewNote}
            data-testid="notes-new-note"
          >
            + New Note
          </button>
        </div>
      </div>

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
    </div>
  );
}
