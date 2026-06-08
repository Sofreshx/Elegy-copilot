import { useState, useEffect, useCallback } from 'react';
import { MarkdownMessage } from '../../components';
import { listRepoDocs, listRepoDocsTree, readRepoDoc, writeRepoDoc, deleteRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse, RepoDocTreeNode } from '../../lib/api/repoDocs';
import DocTreeView from './DocTreeView';

interface WorkspaceDocsCenterProps {
  repoPath: string;
}

export default function WorkspaceDocsCenter({ repoPath }: WorkspaceDocsCenterProps) {
  const [files, setFiles] = useState<RepoDocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<RepoDocReadResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tree, setTree] = useState<RepoDocTreeNode[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalDirs, setTotalDirs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listRepoDocsTree(repoPath);
        if (!cancelled) {
          setTree(data.tree);
          setTotalFiles(data.totalFiles);
          setTotalDirs(data.totalDirs);
        }
      } catch (err) {
        // Fallback: try flat list API
        try {
          const flatData = await listRepoDocs(repoPath);
          if (!cancelled) {
            setFiles(flatData.files);
            setTree([]);
          }
        } catch (flatErr) {
          if (!cancelled) {
            setError(flatErr instanceof Error ? flatErr.message : String(flatErr));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  async function handleSelectFile(filePath: string) {
    setDocLoading(true);
    setDocError(null);
    setSelectedDoc(null);
    setEditMode(false);
    try {
      const doc = await readRepoDoc(repoPath, filePath);
      setSelectedDoc(doc);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocLoading(false);
    }
  }

  function handleStartEdit() {
    if (!selectedDoc) return;
    setEditContent(selectedDoc.content);
    setEditMode(true);
  }

  async function handleSave() {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const result = await writeRepoDoc(repoPath, selectedDoc.path, editContent);
      setSelectedDoc({
        ...selectedDoc,
        content: editContent,
        size: result.size,
        modifiedAt: result.modifiedAt,
      });
      setEditMode(false);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedDoc) return;
    if (!window.confirm(`Delete ${selectedDoc.path}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteRepoDoc(repoPath, selectedDoc.path);
      setSelectedDoc(null);
      setEditMode(false);
      // Refresh the tree after deletion
      const treeData = await listRepoDocsTree(repoPath);
      setTree(treeData.tree);
      setTotalFiles(treeData.totalFiles);
      setTotalDirs(treeData.totalDirs);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  const handleSelectFileCb = useCallback((filePath: string) => {
    void handleSelectFile(filePath);
  }, [repoPath]);

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

    // If tree API was used, we don't have a flat files list to search;
    // try reading directly — the backend will validate the path
    void handleSelectFile(targetPath);
  }

  // Shared file list content for the tree sidebar
  const treeContent = (
    <>
      {loading ? (
        <div className="state-message">Loading...</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : tree.length > 0 ? (
        <DocTreeView tree={tree} selectedPath={selectedDoc?.path ?? null} onSelectFile={handleSelectFileCb} />
      ) : files.length === 0 ? (
        <div className="state-message">No docs or specs found in this repository.</div>
      ) : (
        /* Flat list fallback */
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
                onClick={() => void handleSelectFile(file.path)}
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

  return (
    <div className="workspace-docs-center" data-testid="workspace-docs-center">
      {/* Tree sidebar — always visible */}
      <div className="workspace-docs-tree" data-testid="workspace-docs-tree">
        <div className="workspace-docs-tree-header">
          <span className="workspace-docs-tree-title">Docs & Specs</span>
          <span className="workspace-docs-tree-count">{tree.length > 0 ? `${totalFiles} files, ${totalDirs} dirs` : `${files.length} files`}</span>
        </div>
        {treeContent}
      </div>

      <div className="workspace-docs-viewer" data-testid="workspace-docs-viewer">
        {/* Viewer header */}
        <div className="workspace-docs-viewer-header">
          {selectedDoc && (
            <>
              <span className="workspace-docs-viewer-path">
                {editMode ? `Editing: ${selectedDoc.path}` : selectedDoc.path}
              </span>
              <div className="workspace-docs-viewer-actions">
                {!editMode && (
                  <button
                    className="workspace-docs-viewer-edit-btn"
                    onClick={handleStartEdit}
                    aria-label="Edit document"
                    title="Edit document"
                    type="button"
                  >
                    &#x270E;
                  </button>
                )}
                {editMode && (
                  <>
                    <button
                      className="workspace-docs-viewer-cancel-btn"
                      onClick={() => { setEditMode(false); setDocError(null); }}
                      aria-label="Cancel editing"
                      title="Cancel editing"
                      type="button"
                    >
                      &#x2190;
                    </button>
                    <button
                      className="workspace-docs-viewer-save-btn"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      aria-label="Save document"
                      title={saving ? 'Saving...' : 'Save document'}
                      type="button"
                    >
                      {saving ? '...' : '\u2713'}
                    </button>
                    <button
                      className="workspace-docs-viewer-delete-btn"
                      onClick={() => void handleDelete()}
                      disabled={deleting}
                      aria-label="Delete document"
                      title={deleting ? 'Deleting...' : 'Delete document'}
                      type="button"
                    >
                      &#x1F5D1;
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {!selectedDoc && (
            <span className="workspace-docs-viewer-path">No document selected</span>
          )}
        </div>

        {/* Content area */}
        {docLoading ? (
          <div className="state-message">Loading document...</div>
        ) : docError ? (
          <div className="state-error">{docError}</div>
        ) : selectedDoc ? (
          editMode ? (
            <div className="workspace-docs-viewer-body">
              <textarea
                className="workspace-docs-editor"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                data-testid="workspace-docs-editor"
              />
            </div>
          ) : (
            <div className="workspace-docs-content">
              <div className="workspace-docs-viewer-body">
                <MarkdownMessage
                  content={selectedDoc.content}
                  testId="workspace-docs-markdown"
                  onNavigateDoc={handleNavigateDoc}
                />
              </div>
            </div>
          )
        ) : (
          <div className="workspace-docs-empty" data-testid="workspace-docs-empty">
            <p className="state-message">Select a document from the tree to view its contents.</p>
          </div>
        )}
      </div>
    </div>
  );
}
