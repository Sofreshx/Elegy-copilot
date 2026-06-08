import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../../components';
import { readRepoDoc, writeRepoDoc } from '../../lib/api/repoDocs';

const NOTES_PATH = '.elegy/notes.md';

interface NoteTag {
  lineIndex: number;
  text: string;
}

interface TagInfo {
  tag: string;
  lineIndices: number[];
}

interface WorkspaceNotesTabProps {
  repoPath: string;
}

export default function WorkspaceNotesTab({ repoPath }: WorkspaceNotesTabProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [highlightWord, setHighlightWord] = useState<string | null>(null);
  const [tags, setTags] = useState<Map<string, TagInfo>>(new Map());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showTagInput, setShowTagInput] = useState<number | null>(null);
  const [tagInputValue, setTagInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load notes on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await readRepoDoc(repoPath, NOTES_PATH);
        if (!cancelled) {
          setContent(res.content);
          parseTagsFromContent(res.content);
        }
      } catch {
        // File doesn't exist yet — start with empty content
        if (!cancelled) setContent('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // Save notes (Ctrl+S or button)
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await writeRepoDoc(repoPath, NOTES_PATH, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [repoPath, content]);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  // Word highlighting — click on a word to highlight all occurrences
  const handleWordClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const pos = textarea.selectionStart;
    const text = textarea.value;

    // Find word boundaries around cursor position
    let start = pos;
    let end = pos;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    
    const word = text.slice(start, end).toLowerCase();
    if (word && word.length > 1) {
      if (highlightWord === word) {
        setHighlightWord(null); // Toggle off
      } else {
        setHighlightWord(word);
      }
    } else {
      setHighlightWord(null);
    }
  }, [highlightWord]);

  // Parse lines starting with "- " as points
  const lines = content.split('\n');
  const points = lines
    .map((line, i) => ({ index: i, text: line, isPoint: line.trimStart().startsWith('- ') }))
    .filter(p => p.isPoint);

  // Parse tags from content (<!-- tags: tag1, tag2 --> on each line)
  function parseTagsFromContent(text: string) {
    const newTags = new Map<string, TagInfo>();
    const tagRegex = /<!--\s*tags:\s*([^-]+)\s*-->/g;
    const lineTexts = text.split('\n');
    
    lineTexts.forEach((line, idx) => {
      const match = tagRegex.exec(line);
      if (match) {
        const raw = match[1].trim();
        if (raw) {
          raw.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
            const existing = newTags.get(tag);
            if (existing) {
              if (!existing.lineIndices.includes(idx)) {
                existing.lineIndices.push(idx);
              }
            } else {
              newTags.set(tag, { tag, lineIndices: [idx] });
            }
          });
        }
      }
      tagRegex.lastIndex = 0; // Reset for next iteration
    });

    setTags(newTags);
  }



  // Handle tagging a point
  const handleTagPoint = (lineIndex: number) => {
    setShowTagInput(lineIndex);
    setTagInputValue('');
  };

  const handleAddTag = (lineIndex: number) => {
    const tag = tagInputValue.trim().toLowerCase();
    if (!tag) return;

    // Check if line already has tags
    const line = lines[lineIndex];
    const existingTagMatch = line.match(/<!--\s*tags:\s*(.*?)\s*-->/);
    
    let newLine: string;
    if (existingTagMatch) {
      const existingTags = existingTagMatch[1];
      if (existingTags.split(',').map(t => t.trim()).includes(tag)) {
        setShowTagInput(null);
        return; // Tag already exists
      }
      newLine = line.replace(/<!--\s*tags:\s*(.*?)\s*-->/, `<!-- tags: ${existingTags}, ${tag} -->`);
    } else {
      newLine = `${line.trimEnd()} <!-- tags: ${tag} -->`;
    }

    const newLines = [...lines];
    newLines[lineIndex] = newLine;
    const newContent = newLines.join('\n');
    setContent(newContent);
    parseTagsFromContent(newContent);
    setShowTagInput(null);
    setTagInputValue('');
  };

  const handleRemoveTag = (tag: string) => {
    const newLines = [...lines];
    newLines.forEach((line, i) => {
      newLines[i] = line.replace(new RegExp(`<!--\\s*tags:\\s*${tag}\\s*(,|-->)|,\\s*${tag}\\s*(?=-->|,)`, 'g'), (match) => {
        if (match.endsWith('-->')) return '-->';
        return '';
      });
    });
    const newContent = newLines.join('\n');
    setContent(newContent);
    parseTagsFromContent(newContent);
    if (selectedTag === tag) setSelectedTag(null);
  };



  // Determine which lines to highlight based on selected tag
  const getTaggedLineIndices = (): Set<number> => {
    if (!selectedTag) return new Set();
    const info = tags.get(selectedTag);
    return info ? new Set(info.lineIndices) : new Set();
  };

  const taggedLines = getTaggedLineIndices();

  if (loading) {
    return <div className="workspace-notes-loading" data-testid="notes-loading">Loading notes...</div>;
  }

  return (
    <div className="workspace-notes-tab" data-testid="notes-tab">
      <div className="workspace-notes-toolbar">
        <h3 className="workspace-notes-title">Notes</h3>
        <div className="workspace-notes-actions">
          {saved && <span className="workspace-notes-saved">Saved</span>}
          <Button
            variant="primary"
            size="sm"
            testId="notes-save"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {error && <p className="workspace-notes-error" data-testid="notes-error">{error}</p>}

      <div className="workspace-notes-body">
        <div className="workspace-notes-editor">
          <textarea
            ref={textareaRef}
            className="workspace-notes-textarea"
            value={content}
            onChange={(e) => { setContent(e.target.value); setSaved(false); }}
            onClick={handleWordClick}
            placeholder="Write your notes here... Use '- ' to create taggable points."
            spellCheck={false}
            data-testid="notes-textarea"
          />
          
          {highlightWord && (
            <div className="workspace-notes-highlight-info">
              Highlighting: <strong>{highlightWord}</strong>
              <Button variant="ghost" size="sm" testId="notes-clear-highlight" onClick={() => setHighlightWord(null)}>
                Clear
              </Button>
            </div>
          )}
        </div>

        <div className="workspace-notes-sidebar">
          <div className="workspace-notes-points">
            <h4 className="workspace-notes-section-title">Points ({points.length})</h4>
            {points.length === 0 ? (
              <p className="workspace-notes-empty">Lines starting with "- " become taggable points.</p>
            ) : (
              <ul className="workspace-notes-point-list">
                {points.map((point) => {
                  const isTagged = taggedLines.has(point.index);
                  return (
                    <li
                      key={point.index}
                      className={`workspace-notes-point${isTagged ? ' workspace-notes-point-tagged' : ''}`}
                      data-testid={`notes-point-${point.index}`}
                    >
                      <span className="workspace-notes-point-text" title={`Line ${point.index + 1}`}>
                        {point.text.trimStart().slice(2)}
                      </span>
                      <div className="workspace-notes-point-actions">
                        {showTagInput === point.index ? (
                          <div className="workspace-notes-tag-input-row">
                            <input
                              className="workspace-notes-tag-input"
                              value={tagInputValue}
                              onChange={(e) => setTagInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddTag(point.index);
                                if (e.key === 'Escape') setShowTagInput(null);
                              }}
                              placeholder="tag name"
                              autoFocus
                              data-testid={`notes-tag-input-${point.index}`}
                            />
                            <Button variant="ghost" size="sm" testId={`notes-tag-add-${point.index}`} onClick={() => handleAddTag(point.index)}>
                              Add
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            testId={`notes-tag-btn-${point.index}`}
                            onClick={() => handleTagPoint(point.index)}
                          >
                            + Tag
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="workspace-notes-tags">
            <h4 className="workspace-notes-section-title">Tags ({tags.size})</h4>
            {tags.size === 0 ? (
              <p className="workspace-notes-empty">No tags yet. Tag points to organize them.</p>
            ) : (
              <div className="workspace-notes-tag-list">
                {Array.from(tags.values()).map(({ tag, lineIndices }) => (
                  <div
                    key={tag}
                    className={`workspace-notes-tag-chip${selectedTag === tag ? ' workspace-notes-tag-chip-active' : ''}`}
                    data-testid={`notes-tag-${tag}`}
                  >
                    <span
                      className="workspace-notes-tag-label"
                      onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    >
                      {tag}
                      <span className="workspace-notes-tag-count">{lineIndices.length}</span>
                    </span>
                    <button
                      className="workspace-notes-tag-remove"
                      onClick={() => handleRemoveTag(tag)}
                      data-testid={`notes-tag-remove-${tag}`}
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {selectedTag && (
                  <Button variant="ghost" size="sm" testId="notes-tag-clear-filter" onClick={() => setSelectedTag(null)}>
                    Clear filter
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
