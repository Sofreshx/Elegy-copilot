import { useState, useEffect, useCallback } from 'react';
import { MarkdownMessage } from '../../components';
import { listRepoDocsTree, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocTreeNode, RepoDocTreeFileNode, RepoDocTreeDirNode, RepoDocReadResponse } from '../../lib/api/repoDocs';
import DocTreeView from './DocTreeView';

// ── Tree filtering ──

function filterTreeForAssets(nodes: RepoDocTreeNode[]): RepoDocTreeNode[] {
  return nodes
    .map((node) => {
      if (node.kind === 'directory') {
        const dir = node as RepoDocTreeDirNode;
        // Skip docs/specs directories entirely
        if (dir.dirKind === 'specs' || dir.dirKind === 'docs') return null;
        // Recursively filter children
        const filteredChildren = filterTreeForAssets(dir.children || []);
        if (filteredChildren.length === 0) return null;
        return { ...dir, children: filteredChildren };
      }

      // File node
      const file = node as RepoDocTreeFileNode;

      // Agent, skill, config files by their fileKind classification
      if (
        file.fileKind === 'agent' ||
        file.fileKind === 'skill' ||
        file.fileKind === 'config'
      ) {
        return node;
      }

      // Files inside harness dot-directories
      if (
        file.path.startsWith('.agents/') ||
        file.path.startsWith('.github/') ||
        file.path.startsWith('.opencode/') ||
        file.path.startsWith('.codex/') ||
        file.path.startsWith('.copilot/') ||
        file.path.startsWith('.gemini/') ||
        file.path.startsWith('.antigravity/')
      ) {
        return node;
      }

      // Root-level convention files
      if (file.path === 'AGENTS.md' || file.path === 'CLAUDE.md' || file.path === 'GEMINI.md') {
        return node;
      }

      return null;
    })
    .filter((node): node is RepoDocTreeNode => node !== null);
}

// ── Main tab component ──

interface Props {
  repoPath: string;
}

export default function WorkspaceAssetsTab({ repoPath }: Props) {
  const [tree, setTree] = useState<RepoDocTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<RepoDocReadResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [assetCount, setAssetCount] = useState(0);

  // ── Load tree ──

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listRepoDocsTree(repoPath);
        if (!cancelled) {
          const filtered = filterTreeForAssets(data.tree);
          setTree(filtered);
          setAssetCount(countFiles(filtered));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // ── Count files in filtered tree ──

  function countFiles(nodes: RepoDocTreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.kind === 'file') {
        count++;
      } else if (node.kind === 'directory') {
        count += countFiles((node as RepoDocTreeDirNode).children || []);
      }
    }
    return count;
  }

  // ── Select / read file ──

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
    }
  }

  const handleSelectFileCb = useCallback(
    (filePath: string) => {
      void handleSelectFile(filePath);
    },
    [repoPath],
  );

  // ── Relative doc link navigation ──

  function handleNavigateDoc(docPath: string) {
    let targetPath = docPath;

    // Resolve relative path against current doc's directory
    if (targetPath.startsWith('./') || targetPath.startsWith('../')) {
      if (selectedDoc?.path) {
        const currentDir = selectedDoc.path.substring(
          0,
          selectedDoc.path.lastIndexOf('/') + 1,
        );
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

    void handleSelectFile(targetPath);
  }

  // ── Tree sidebar content ──

  const treeContent = (
    <>
      {loading ? (
        <div className="state-message">Loading assets...</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : tree.length > 0 ? (
        <DocTreeView
          tree={tree}
          selectedPath={selectedDoc?.path ?? null}
          onSelectFile={handleSelectFileCb}
        />
      ) : (
        <div className="workspace-assets-empty" data-testid="workspace-assets-empty-tree">
          <p className="state-message">
            No agents, skills, or configs found in this repository.
          </p>
        </div>
      )}
    </>
  );

  // ── Render ──

  return (
    <div className="workspace-assets-center" data-testid="workspace-assets-center">
      {/* Tree sidebar */}
      <div className="workspace-assets-tree" data-testid="workspace-assets-tree">
        <div className="workspace-assets-tree-header">
          <span className="workspace-assets-tree-title">Agents & Skills</span>
          <span className="workspace-assets-tree-count">
            {assetCount} {assetCount === 1 ? 'file' : 'files'}
          </span>
        </div>
        {treeContent}
      </div>

      {/* Viewer */}
      <div className="workspace-assets-viewer" data-testid="workspace-assets-viewer">
        <div className="workspace-assets-viewer-header">
          {selectedDoc ? (
            <span className="workspace-assets-viewer-path">{selectedDoc.path}</span>
          ) : (
            <span className="workspace-assets-viewer-path">No file selected</span>
          )}
        </div>

        {docLoading ? (
          <div className="state-message">Loading file...</div>
        ) : docError ? (
          <div className="state-error">{docError}</div>
        ) : selectedDoc ? (
          <div className="workspace-assets-content">
            <div className="workspace-assets-viewer-body">
              <MarkdownMessage
                content={selectedDoc.content}
                testId="workspace-assets-markdown"
                onNavigateDoc={handleNavigateDoc}
              />
            </div>
          </div>
        ) : (
          <div className="workspace-assets-empty" data-testid="workspace-assets-empty">
            <p className="state-message">
              Select a file from the tree to view its contents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
