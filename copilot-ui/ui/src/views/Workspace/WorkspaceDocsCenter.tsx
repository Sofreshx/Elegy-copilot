import { useState, useEffect, useMemo, useRef } from 'react';
import { Panel, MarkdownMessage } from '../../components';
import { listRepoDocs, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse } from '../../lib/api/repoDocs';
import { buildDocTree } from '../../lib/docTree';
import type { DocTreeNode } from '../../lib/docTree';

interface WorkspaceDocsCenterProps {
  repoPath: string;
  isFocused?: boolean;
  files?: RepoDocEntry[];
  externalSelectPath?: string | null;
}

export default function WorkspaceDocsCenter({ repoPath, isFocused = false, files: externalFiles, externalSelectPath }: WorkspaceDocsCenterProps) {
  const [files, setFiles] = useState<RepoDocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<RepoDocReadResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Use external files if provided, otherwise fetch
  useEffect(() => {
    if (externalFiles) {
      setFiles(externalFiles);
      setLoading(false);
      setError(null);
      return;
    }
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
  }, [repoPath, externalFiles]);

  // Handle external select path (e.g. from graph view)
  const previousSelectPath = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (externalSelectPath && externalSelectPath !== previousSelectPath.current) {
      previousSelectPath.current = externalSelectPath;
      const file = files.find(f => f.path === externalSelectPath);
      if (file) {
        void handleSelectFile(file);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSelectPath, files]);

  const docTree = useMemo(() => buildDocTree(files), [files]);

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

  function toggleFolder(path: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  /** Recursively count all file descendants in a tree node */
  function countFilesInNode(node: DocTreeNode): number {
    let count = 0;
    for (const child of node.children) {
      if (child.type === 'file') {
        count++;
      } else {
        count += countFilesInNode(child);
      }
    }
    return count;
  }

  /** Recursive tree renderer */
  function renderTreeNodes(nodes: DocTreeNode[]): React.ReactNode {
    return nodes.map((node) => {
      if (node.type === 'folder') {
        const isExpanded = expandedFolders.has(node.path);
        const fileCount = countFilesInNode(node);
        return (
          <div key={node.path}>
            <button
              type="button"
              className="workspace-tree-folder"
              style={{ paddingLeft: `calc(var(--space-sm) + ${node.depth * 12}px)` }}
              onClick={() => toggleFolder(node.path)}
              data-testid={`workspace-tree-folder-${node.path}`}
              title={node.path}
            >
              <span className="workspace-tree-folder-chevron">
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <span className="workspace-tree-folder-name">{node.name}</span>
              <span className="workspace-tree-folder-count">({fileCount} files)</span>
            </button>
            {isExpanded && (
              <div className="workspace-tree-children">
                {renderTreeNodes(node.children)}
              </div>
            )}
          </div>
        );
      }

      // File node
      const file = node.entry!;
      return (
        <div key={node.path}>
          <button
            type="button"
            className={
              `workspace-docs-item` +
              (file.blockedReason ? ` workspace-docs-item-blocked` : '') +
              (!file.blockedReason && selectedDoc?.path === file.path ? ` workspace-docs-item-active` : '') +
              (file.isSymlink && !file.blockedReason ? ` workspace-docs-item-symlink` : '')
            }
            style={{ paddingLeft: `calc(var(--space-sm) + ${node.depth * 12}px)` }}
            onClick={() => void handleSelectFile(file)}
            disabled={!!file.blockedReason}
            data-testid={`workspace-docs-item-${file.path}`}
            title={file.blockedReason || (file.isSymlink ? `Symlink \u2192 ${file.resolvedPath}` : file.path)}
          >
            <span className="workspace-docs-item-path">{node.name}</span>
            {file.isSymlink && !file.blockedReason && (
              <span className="workspace-docs-item-symlink-indicator" title={`Resolves to: ${file.resolvedPath}`}>&#x2197;</span>
            )}
            {file.blockedReason && (
              <span className="workspace-docs-item-warning" title={file.blockedReason}>&#x26A0;</span>
            )}
          </button>
        </div>
      );
    });
  }

  return (
    <div className="workspace-docs-center" data-testid="workspace-docs-center">
      {!isFocused && (
        <div className="workspace-docs-tree" data-testid="workspace-docs-tree">
          <Panel title="Docs & Specs" subtitle={`${files.length} files`} testId="workspace-docs-panel">
            {loading ? (
              <div className="state-message">Loading...</div>
            ) : error ? (
              <div className="state-error">{error}</div>
            ) : files.length === 0 ? (
              <div className="state-message">No docs or specs found in this repository.</div>
            ) : (
              <div className="workspace-docs-tree-list" data-testid="workspace-docs-list">
                {renderTreeNodes(docTree)}
              </div>
            )}
          </Panel>
        </div>
      )}

      <div className="workspace-docs-viewer" data-testid="workspace-docs-viewer">
        {docLoading ? (
          <div className="state-message">Loading document...</div>
        ) : docError ? (
          <div className="state-error">{docError}</div>
        ) : selectedDoc ? (
          <div className="workspace-docs-content">
            <div className="workspace-docs-viewer-header">
              <span className="workspace-docs-viewer-path">{selectedDoc.path}</span>
            </div>
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
