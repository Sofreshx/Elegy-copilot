import type { RepoDocEntry } from './api/repoDocs';

export interface DocTreeNode {
  /** Display name (file or folder name) */
  name: string;
  /** Full relative path */
  path: string;
  /** Node type */
  type: 'file' | 'folder';
  /** Nesting level (0 = root) */
  depth: number;
  /** Child nodes (folders only) */
  children: DocTreeNode[];
  /** Original API entry (files only) */
  entry?: RepoDocEntry;
}

/**
 * Build a folder tree from flat file paths.
 * Pure function — no side effects, no React hooks.
 *
 * Algorithm:
 * 1. Filters out hidden files (paths with segments starting with '.')
 * 2. Groups files by directory prefix
 * 3. Sorts alphabetically with folders first, then files
 * 4. Tracks depth for indentation
 */
export function buildDocTree(files: RepoDocEntry[]): DocTreeNode[] {
  // Exclude hidden files (any path segment starting with '.')
  const visibleFiles = files.filter(f => {
    const parts = f.path.split('/');
    return !parts.some(part => part.startsWith('.'));
  });

  const root: DocTreeNode = {
    name: '',
    path: '',
    type: 'folder',
    depth: -1,
    children: [],
  };

  // Build nested tree structure
  for (const file of visibleFiles) {
    const parts = file.path.split('/');
    let currentNode = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join('/');

      if (isLast) {
        // File node — attach the API entry
        currentNode.children.push({
          name: part,
          path: nodePath,
          type: 'file',
          depth: i,
          children: [],
          entry: file,
        });
      } else {
        // Folder node — find or create
        let folderNode = currentNode.children.find(
          c => c.name === part && c.type === 'folder'
        );
        if (!folderNode) {
          folderNode = {
            name: part,
            path: nodePath,
            type: 'folder',
            depth: i,
            children: [],
          };
          currentNode.children.push(folderNode);
        }
        currentNode = folderNode;
      }
    }
  }

  // Recursive sort: folders first, then files, alphabetical within each group
  function sortNodes(nodes: DocTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  }
  sortNodes(root.children);

  return root.children;
}

/**
 * Returns an emoji icon for common file/folder types.
 */
export function getFileIcon(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'readme.md' || lower === 'readme') return '📘';
  if (lower.startsWith('changelog')) return '📋';
  if (lower.endsWith('.md')) return '📄';
  return '📄';
}
