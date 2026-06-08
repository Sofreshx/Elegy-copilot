import { useState } from 'react';
import type { RepoDocTreeNode, RepoDocTreeFileNode, RepoDocTreeDirNode } from '../../lib/api/repoDocs';

// ── Icon helpers ──

function dirIcon(dirKind?: string): string {
  switch (dirKind) {
    case 'skills':
      return '⚡';
    case 'agents':
      return '⚙';
    case 'harness':
      return '⬞';
    default:
      return '📁';
  }
}

function fileIcon(fileKind?: string): string {
  switch (fileKind) {
    case 'agent':
      return '🤖';
    case 'skill':
      return '⚡';
    case 'config':
      return '⚙';
    default:
      return '📄';
  }
}

// ── Tree node component ──

interface DocTreeNodeProps {
  node: RepoDocTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  depth: number;
}

function DocTreeNode({ node, selectedPath, onSelectFile, depth }: DocTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  // Indent guide lines for ancestor levels
  const indentGuides = depth > 0
    ? Array.from({ length: depth }, (_, i) => (
        <span
          key={`indent-${i}`}
          className="workspace-docs-tree-indent"
          style={{ left: `${i * 16 + 8}px` }}
          aria-hidden="true"
        />
      ))
    : null;

  if (node.kind === 'directory') {
    const dir = node as RepoDocTreeDirNode;
    const hasChildren = dir.children && dir.children.length > 0;

    return (
      <li className="workspace-docs-tree-node" style={{ '--depth': depth } as React.CSSProperties}>
        {indentGuides}
        <div
          className="workspace-docs-tree-folder"
          onClick={() => hasChildren && setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              hasChildren && setExpanded((v) => !v);
            }
          }}
        >
          <span className="workspace-docs-tree-toggle">
            {hasChildren ? (expanded ? '▼' : '▶') : '  '}
          </span>
          <span className="workspace-docs-tree-icon">{dirIcon(dir.dirKind)}</span>
          <span className="workspace-docs-tree-folder-name">{dir.name}</span>
        </div>
        {expanded && hasChildren && (
          <div className="workspace-docs-tree-children">
            <ul className="workspace-docs-tree-list">
              {dir.children.map((child) => (
                <DocTreeNode
                  key={child.path}
                  node={child}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  }

  // File node
  const file = node as RepoDocTreeFileNode;
  const isActive = selectedPath === file.path;

  return (
    <li className="workspace-docs-tree-node" style={{ '--depth': depth } as React.CSSProperties}>
      {indentGuides}
      <button
        type="button"
        className={
          `workspace-docs-tree-file` +
          (isActive ? ' workspace-docs-tree-item-active' : '')
        }
        onClick={() => onSelectFile(file.path)}
      >
        <span className="workspace-docs-tree-icon">{fileIcon(file.fileKind)}</span>
        <span className="workspace-docs-tree-file-name">{file.name}</span>
      </button>
    </li>
  );
}

// ── Tree view component ──

export interface DocTreeViewProps {
  tree: RepoDocTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

function DocTreeView({ tree, selectedPath, onSelectFile }: DocTreeViewProps) {
  return (
    <ul className="workspace-docs-tree-list" data-testid="workspace-assets-tree-list">
      {tree.map((node) => (
        <DocTreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          depth={0}
        />
      ))}
    </ul>
  );
}

export default DocTreeView;
