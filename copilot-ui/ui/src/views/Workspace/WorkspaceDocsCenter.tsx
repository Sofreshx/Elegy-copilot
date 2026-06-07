import { useState, useEffect, useCallback } from 'react';
import { Panel, MarkdownMessage } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { listRepoDocs, listRepoDocsTree, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse, RepoDocTreeNode, RepoDocTreeFileNode, RepoDocTreeDirNode, RepoDocsTreeResponse } from '../../lib/api/repoDocs';

// ── Dir/File icon helpers ──

function dirIcon(dirKind?: string): string {
  switch (dirKind) {
    case 'specs': return '\u{1F4CB}'; // 📋
    case 'docs': return '\u{1F4C1}';  // 📁
    case 'skills': return '\u{26A1}';  // ⚡
    case 'agents': return '\u{2699}';  // ⚙
    case 'harness': return '\u{2B1E}'; // ⬞
    default: return '\u{1F4C1}';       // 📁
  }
}

function fileIcon(fileKind?: string): string {
  switch (fileKind) {
    case 'agent': return '\u{1F916}';   // 🤖
    case 'skill': return '\u{26A1}';    // ⚡
    case 'config': return '\u{2699}';   // ⚙
    case 'manifest': return '\u{1F4CB}'; // 📋
    default: return '\u{1F4C4}';         // 📄
  }
}

// ── Recursive Tree Node Component ──

interface DocTreeNodeProps {
  node: RepoDocTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function DocTreeNode({ node, depth, selectedPath, onSelectFile }: DocTreeNodeProps) {
  const [collapsed, setCollapsed] = useState(node.kind === 'directory' ? (node.collapsed ?? true) : false);

  if (node.kind === 'directory') {
    const dirNode = node as RepoDocTreeDirNode;
    const hasSelectedChild = dirNode.children?.some((c) => c.path === selectedPath) ?? false;

    return (
      <div className="workspace-docs-tree-node" style={{ paddingLeft: `${depth * 16}px` }}>
        <div
          className={`workspace-docs-tree-folder${hasSelectedChild ? ' workspace-docs-tree-item-active' : ''}`}
          onClick={() => setCollapsed((c) => !c)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((c) => !c); } }}
          title={dirNode.path}
        >
          <span className="workspace-docs-tree-toggle" aria-hidden="true">
            {collapsed ? '\u25B6' : '\u25BC'}
          </span>
          <span className="workspace-docs-tree-icon">{dirIcon(dirNode.dirKind)}</span>
          <span>{dirNode.name}</span>
        </div>
        {!collapsed && dirNode.children && (
          <div className="workspace-docs-tree-children">
            {dirNode.children.map((child) => (
              <DocTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const fileNode = node as RepoDocTreeFileNode;
  const isBlocked = !!fileNode.blockedReason;
  const isActive = selectedPath === fileNode.path;

  return (
    <div
      className={`workspace-docs-tree-node${isActive ? ' workspace-docs-tree-item-active' : ''}`}
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      <button
        type="button"
        className={`workspace-docs-tree-file${isBlocked ? ' workspace-docs-item-blocked' : ''}${isActive ? ' workspace-docs-item-active' : ''}`}
        onClick={() => { if (!isBlocked) onSelectFile(fileNode.path); }}
        disabled={isBlocked}
        title={fileNode.blockedReason || (fileNode.isSymlink ? `Symlink \u2192 ${fileNode.resolvedPath}` : fileNode.path)}
      >
        <span className="workspace-docs-tree-icon">{fileIcon(fileNode.fileKind)}</span>
        <span className="workspace-docs-tree-file-name">{fileNode.name}</span>
        {fileNode.harness && (
          <span className="workspace-docs-tree-harness-badge" title={`Harness: ${fileNode.harness}`}>
            {fileNode.harness}
          </span>
        )}
        {fileNode.isSymlink && !isBlocked && (
          <span className="workspace-docs-item-symlink-indicator" title={`Resolves to: ${fileNode.resolvedPath}`}>&#x2197;</span>
        )}
        {isBlocked && (
          <span className="workspace-docs-item-warning" title={fileNode.blockedReason}>&#x26A0;</span>
        )}
      </button>
    </div>
  );
}

// ── Tree view component ──

interface DocTreeViewProps {
  tree: RepoDocTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function DocTreeView({ tree, selectedPath, onSelectFile }: DocTreeViewProps) {
  if (!tree || tree.length === 0) return null;
  return (
    <div className="workspace-docs-tree-view">
      {tree.map((node) => (
        <DocTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}

// ── Main component ──

interface WorkspaceDocsCenterProps {
  repoPath: string;
  isFocused?: boolean;
  treeVisible?: boolean;
  onToggleTree?: () => void;
}

export default function WorkspaceDocsCenter({ repoPath, isFocused, treeVisible = true, onToggleTree }: WorkspaceDocsCenterProps) {
  const [tree, setTree] = useState<RepoDocTreeNode[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalDirs, setTotalDirs] = useState(0);
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
    try {
      const doc = await readRepoDoc(repoPath, filePath);
      setSelectedDoc(doc);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocLoading(false);
      // Auto-minimize tree overlay when a document is selected from the overlay
      setTreeOverlayVisible(false);
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

  // Shared tree content for both inline and overlay
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

  const treeHidden = isFocused;

  return (
    <div className={`workspace-docs-center${treeHidden ? ' workspace-docs-tree-collapsed' : ''}`} data-testid="workspace-docs-center">
      {/* Inline tree sidebar */}
      {treeVisible && !treeHidden && (
        <div className="workspace-docs-tree" data-testid="workspace-docs-tree">
          <div className="workspace-docs-tree-header">
            <span className="workspace-docs-tree-title">Docs & Specs</span>
            <span className="workspace-docs-tree-count">
              {tree.length > 0 ? `${totalFiles} files, ${totalDirs} dirs` : `${files.length} files`}
            </span>
            {onToggleTree && (
              <button
                className="workspace-docs-tree-header-close"
                onClick={onToggleTree}
                data-testid="workspace-docs-tree-close"
                title="Hide tree"
                aria-label="Hide tree"
              >
                &times;
              </button>
            )}
          </div>
          {treeContent}
        </div>
      )}

      <div className="workspace-docs-viewer" data-testid="workspace-docs-viewer">
        {/* Viewer header with tree toggle for collapsed mode */}
        <div className="workspace-docs-viewer-header">
          {!treeVisible && !treeHidden && (
            <button
              className="workspace-docs-viewer-tree-restore"
              onClick={() => setTreeOverlayVisible((v) => !v)}
              title="Show document tree"
              aria-label="Show document tree"
              data-testid="workspace-docs-tree-toggle"
            >
              <span aria-hidden="true">&#9776;</span>
            </button>
          )}
          {selectedDoc && (
            <>
              <span className="workspace-docs-viewer-path">{selectedDoc.path}</span>
              <button
                className="workspace-docs-viewer-focus-btn"
                onClick={() => navigationStore.toggleWorkspaceCenterFocus()}
                aria-label={isFocused ? 'Exit focus' : 'Focus'}
                title={isFocused ? 'Exit focus' : 'Focus'}
                data-testid="workspace-docs-focus-toggle"
              >
                <span aria-hidden="true">{isFocused ? '\u25A3' : '\u25A1'}</span>
              </button>
            </>
          )}
          {!selectedDoc && !treeVisible && !treeHidden && (
            <span className="workspace-docs-viewer-path">No document selected</span>
          )}
        </div>

        {/* Tree overlay when collapsed */}
        {treeOverlayVisible && (
          <div className="workspace-docs-tree-overlay" data-testid="workspace-docs-tree-overlay">
            <div className="workspace-docs-tree-overlay-header">
              <span className="workspace-docs-tree-overlay-title">
                Docs & Specs ({tree.length > 0 ? `${totalFiles} files` : `${files.length} files`})
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
