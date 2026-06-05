import { useState, useEffect } from 'react';
import { Panel, MarkdownMessage } from '../../components';
import { listRepoDocs, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse } from '../../lib/api/repoDocs';

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

  return (
    <div className="workspace-docs-center" data-testid="workspace-docs-center">
      <div className="workspace-docs-tree" data-testid="workspace-docs-tree">
        <Panel title="Docs & Specs" subtitle={`${files.length} files`} testId="workspace-docs-panel">
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
                    className={`workspace-docs-item ${selectedDoc?.path === file.path ? 'workspace-docs-item-active' : ''}`}
                    onClick={() => void handleSelectFile(file)}
                    data-testid={`workspace-docs-item-${file.path}`}
                  >
                    <span className="workspace-docs-item-path">{file.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

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
              <MarkdownMessage content={selectedDoc.content} testId="workspace-docs-markdown" />
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
