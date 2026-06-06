import { useState, useEffect } from 'react';
import { Panel, MarkdownMessage } from '../../components';
import { listRepoDocs, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse } from '../../lib/api/repoDocs';

interface WorkspaceDocsCenterProps {
  repoPath: string;
  isFocused?: boolean;
  treeVisible?: boolean;
  onToggleTree?: () => void;
}

export default function WorkspaceDocsCenter({ repoPath, isFocused, treeVisible = true, onToggleTree }: WorkspaceDocsCenterProps) {
  const [files, setFiles] = useState<RepoDocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<RepoDocReadResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [treeOverlayVisible, setTreeOverlayVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listRepoDocs(repoPath);
        if (!cancelled) setFiles(data.files);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  async function handleSelectFile(file: RepoDocEntry) {
    // Skip blocked files
    if (file.blockedReason) return;
    setDocLoading(true);
    setDocError(null);
    setSelectedDoc(null);
    try {
      const doc = await readRepoDoc(repoPath, file.path);
      setSelectedDoc(doc);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocLoading(false);
      // Auto-minimize tree overlay when a document is selected from the overlay
      setTreeOverlayVisible(false);
    }
  }

  function handleNavigateDoc(docPath: string) {
    let targetPath = docPath;

    // Resolve relative path against current doc's directory
    if (targetPath.startsWith('./') || targetPath.startsWith('../')) {
      if (selectedDoc?.path) {
        const currentDir = selectedDoc.path.substring(0, selectedDoc.path.lastIndexOf('/') + 1);
        targetPath = currentDir + docPath.substring(docPath.startsWith('./') ? 2 : 0);
        // Normalize ../
        const parts = targetPath.split('/');
        const resolved: string[] = [];
        for (const part of parts) {
          if (part === '..') {
            resolved.pop();
          } else if (part !== '.' && part !== '') {
            resolved.push(part);
          }
        }
        targetPath = resolved.join('/');
      }
    }

    // Find matching file in the list
    const match = files.find(f => f.path === targetPath || f.path.replace(/\\/g, '/') === targetPath);
    if (match) {
      void handleSelectFile(match);
    } else {
      // Try case-insensitive match
      const lowerTarget = targetPath.toLowerCase();
      const lowerMatch = files.find(f => f.path.toLowerCase() === lowerTarget);
      if (lowerMatch) {
        void handleSelectFile(lowerMatch);
      }
    }
  }

  // Shared file list content for both inline tree and overlay
  const treeContent = (
    <>
      {loading ? (
        <div className="state-message">Loading...</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : files.length === 0 ? (
        <div className="state-message">No docs or specs found in this repository.</div>
      ) : (
        <ul className="workspace-docs-list" data-testid="workspace-docs-list">
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={
                  `workspace-docs-item` +
                  (file.blockedReason ? ` workspace-docs-item-blocked` : '') +
                  (!file.blockedReason && selectedDoc?.path === file.path ? ` workspace-docs-item-active` : '') +
                  (file.isSymlink && !file.blockedReason ? ` workspace-docs-item-symlink` : '')
                }
                onClick={() => void handleSelectFile(file)}
                disabled={!!file.blockedReason}
                data-testid={`workspace-docs-item-${file.path}`}
                title={file.blockedReason || (file.isSymlink ? `Symlink → ${file.resolvedPath}` : file.path)}
              >
                <span className="workspace-docs-item-path">{file.path}</span>
                {file.isSymlink && !file.blockedReason && (
                  <span className="workspace-docs-item-symlink-indicator" title={`Resolves to: ${file.resolvedPath}`}>&#x2197;</span>
                )}
                {file.blockedReason && (
                  <span className="workspace-docs-item-warning" title={file.blockedReason}>&#x26A0;</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const treeHidden = isFocused;

  return (
    <div className={`workspace-docs-center${treeHidden ? ' workspace-docs-tree-collapsed' : ''}`} data-testid="workspace-docs-center">
      {/* Inline tree sidebar */}
      {treeVisible && !treeHidden && (
        <div className="workspace-docs-tree" data-testid="workspace-docs-tree">
          <Panel title="Docs & Specs" subtitle={`${files.length} files`} testId="workspace-docs-panel">
            {treeContent}
          </Panel>
          {onToggleTree && (
            <button
              className="workspace-docs-tree-close"
              onClick={onToggleTree}
              data-testid="workspace-docs-tree-close"
              title="Close tree panel"
            >
              &times;
            </button>
          )}
        </div>
      )}

      <div className="workspace-docs-viewer" data-testid="workspace-docs-viewer">
        {/* Viewer header with tree toggle for collapsed mode */}
        <div className="workspace-docs-viewer-header">
          {!treeVisible && !treeHidden && (
            <div className="workspace-docs-tree-toggle" data-testid="workspace-docs-tree-toggle">
              <button
                className="workspace-docs-tree-toggle-btn"
                onClick={() => setTreeOverlayVisible((v) => !v)}
                title="Show document tree"
              >
                Docs &triangleright;
              </button>
              {/* Tree overlay dropdown when collapsed */}
              {treeOverlayVisible && (
                <div className="workspace-docs-tree-overlay" data-testid="workspace-docs-tree-overlay">
                  <div className="workspace-docs-tree-overlay-header">
                    <span className="workspace-docs-tree-overlay-title">
                      Docs & Specs ({files.length} files)
                    </span>
                    <button
                      className="workspace-docs-tree-overlay-close"
                      onClick={() => setTreeOverlayVisible(false)}
                      title="Close overlay"
                      data-testid="workspace-docs-tree-overlay-close"
                    >
                      &times;
                    </button>
                  </div>
                  {treeContent}
                </div>
              )}
            </div>
          )}
          {selectedDoc && (
            <span className="workspace-docs-viewer-path">{selectedDoc.path}</span>
          )}
        </div>

        {/* Content area */}
        {docLoading ? (
          <div className="state-message">Loading document...</div>
        ) : docError ? (
          <div className="state-error">{docError}</div>
        ) : selectedDoc ? (
          <div className="workspace-docs-content">
            <div className="workspace-docs-viewer-body">
              <MarkdownMessage
                content={selectedDoc.content}
                testId="workspace-docs-markdown"
                onNavigateDoc={handleNavigateDoc}
              />
            </div>
          </div>
        ) : (
          <div className="workspace-docs-empty" data-testid="workspace-docs-empty">
            <p className="state-message">Select a document from the tree to view its contents.</p>
          </div>
        )}
      </div>
    </div>
  );
}
