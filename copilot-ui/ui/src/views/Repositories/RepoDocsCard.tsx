import { useState, useEffect } from 'react';
import { Button, Panel, MarkdownMessage } from '../../components';
import { listRepoDocs, readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry, RepoDocReadResponse } from '../../lib/api/repoDocs';

interface RepoDocsCardProps {
  repoPath: string;
}

export function RepoDocsCard({ repoPath }: RepoDocsCardProps) {
  const [files, setFiles] = useState<RepoDocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<RepoDocReadResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
    <Panel title="Docs & Specs" testId="repo-docs-card">
      <button
        type="button"
        className="repo-card-toggle-btn"
        onClick={() => setExpanded(!expanded)}
        data-testid="repo-docs-toggle"
      >
        {expanded ? 'Hide' : 'Show'} docs ({files.length} files)
      </button>

      {expanded ? (
        <div className="repo-docs-content">
          {loading ? (
            <div className="state-message">Loading...</div>
          ) : error ? (
            <div className="state-error">{error}</div>
          ) : files.length === 0 ? (
            <div className="state-message">No docs or specs found.</div>
          ) : (
            <div className="repo-docs-list" data-testid="repo-docs-list">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`repo-docs-item ${selectedDoc?.path === file.path ? 'repo-docs-item-active' : ''}`}
                  onClick={() => void handleSelectFile(file)}
                  data-testid={`repo-docs-item-${file.path}`}
                >
                  <span className="repo-docs-item-path">{file.path}</span>
                </button>
              ))}
            </div>
          )}

          {docLoading ? (
            <div className="state-message">Loading document...</div>
          ) : docError ? (
            <div className="state-error">{docError}</div>
          ) : selectedDoc ? (
            <div className="repo-docs-viewer" data-testid="repo-docs-viewer">
              <div className="repo-docs-viewer-header">
                <span className="repo-docs-viewer-path">{selectedDoc.path}</span>
              </div>
              <div className="repo-docs-viewer-content">
                <MarkdownMessage content={selectedDoc.content} testId="repo-docs-markdown" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
