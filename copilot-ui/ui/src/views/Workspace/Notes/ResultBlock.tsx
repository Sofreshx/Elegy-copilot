import { useState } from 'react';
import type { NoteBlock } from '../../../lib/api/notes';

interface ResultBlockProps {
  block: NoteBlock;
  onDelete?: (blockId: string) => void;
}

export default function ResultBlock({ block, onDelete }: ResultBlockProps) {
  const [open, setOpen] = useState(block.block_kind === 'conflict');

  const isConflict = block.block_kind === 'conflict';
  const createdDate = new Date(block.created_at).toLocaleDateString();

  return (
    <details className="workspace-notes-result-block" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} data-testid={`result-block-${block.id}`}>
      <summary className="workspace-notes-result-block-summary">
        <span className="workspace-notes-result-block-badge">{isConflict ? '⚠ Conflict' : block.block_kind}</span>
        <span className="workspace-notes-result-block-date">{createdDate}</span>
        {onDelete && (
          <button className="workspace-notes-result-block-delete" onClick={e => { e.preventDefault(); onDelete(block.id); }} aria-label="Delete block">×</button>
        )}
      </summary>
      <div className="workspace-notes-result-block-body">
        {isConflict ? (
          <div className="workspace-notes-conflict-body">
            <div className="workspace-notes-conflict-section">
              <strong>Local version:</strong>
              <pre>{block.body}</pre>
            </div>
          </div>
        ) : (
          <pre>{block.body}</pre>
        )}
      </div>
    </details>
  );
}
