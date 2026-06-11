import { useState } from 'react';
import type { CatalogExternalSourceProjection } from '../../lib/types';
import { Button, FormInput, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';

interface SourcesTabProps {
  externalSources: CatalogExternalSourceProjection[];
  onSourceChanged: () => void;
}

interface AddToolForm {
  url: string;
  title: string;
  sourceId: string;
  description: string;
}

const DEFAULT_FORM: AddToolForm = { url: '', title: '', sourceId: '', description: '' };

export default function SourcesTab({ externalSources, onSourceChanged }: SourcesTabProps) {
  const [showAddTool, setShowAddTool] = useState(false);
  const [addToolForm, setAddToolForm] = useState<AddToolForm>(DEFAULT_FORM);
  const [confirmRemoveSourceId, setConfirmRemoveSourceId] = useState<string | null>(null);
  const catalogState = useStoreValue(catalogWorkspaceStore);

  async function handleSubmit() {
    if (!addToolForm.url.trim()) return;
    try {
      await catalogWorkspaceStore.addExternalSource({
        url: addToolForm.url.trim(),
        title: addToolForm.title.trim() || undefined,
        sourceId: addToolForm.sourceId.trim() || undefined,
        description: addToolForm.description.trim() || undefined,
      });
      setAddToolForm(DEFAULT_FORM);
      setShowAddTool(false);
    } catch (err) {
      console.error('SourcesTab: addExternalSource failed', err);
    } finally {
      onSourceChanged();
    }
  }

  function handleField<K extends keyof AddToolForm>(field: K, value: AddToolForm[K]) {
    setAddToolForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleRefreshSource(sourceId: string) {
    try {
      await catalogWorkspaceStore.refreshExternalSource(sourceId);
    } catch (err) {
      console.error('SourcesTab: refreshExternalSource failed', err);
    } finally {
      onSourceChanged();
    }
  }

  async function handleSyncSource(sourceId: string) {
    try {
      await catalogWorkspaceStore.syncInstallVerifyExternalSource({ sourceId });
    } catch (err) {
      console.error('SourcesTab: syncInstallVerifyExternalSource failed', err);
    } finally {
      onSourceChanged();
    }
  }

  async function handleRemoveSource(sourceId: string) {
    try {
      await catalogWorkspaceStore.removeExternalSource(sourceId);
      setConfirmRemoveSourceId(null);
    } catch (err) {
      console.error('SourcesTab: removeExternalSource failed', err);
    } finally {
      onSourceChanged();
    }
  }

  return (
    <div data-testid="assets-tools-sources" className="sources-tab-layout">
      <Panel
        title={`External Sources (${externalSources.length})`}
        subtitle="Manage externally-added tools, MCP servers, and skill folders"
        actions={
          <Button onClick={() => setShowAddTool(true)} testId="sources-add-tool" variant="secondary">
            Add Source
          </Button>
        }
      >
        {externalSources.length === 0 ? (
          <p className="assets-tools-empty">No external sources configured.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {externalSources.map((src) => {
              const safeId = String(src.sourceId || src.url || '');
              return (
                <div key={safeId} className="assets-tools-item-card">
                  <div className="assets-tools-item-header">
                    <span>{src.title || src.sourceId || src.url || 'Unknown source'}</span>
                  </div>
                  <p className="assets-tools-item-description">
                    {src.url && <span>URL: {src.url}</span>}
                    {src.description && <span> \u2014 {src.description}</span>}
                  </p>
                  {src.sync?.status && (
                    <div className="assets-tools-item-badges">
                      <span className="catalog-inline-note">Status: {src.sync.status}</span>
                    </div>
                  )}
                  <div className="sources-card-actions">
                    <button
                      className="button button-sm"
                      disabled={catalogState.mutating}
                      onClick={() => void handleRefreshSource(safeId)}
                      data-testid={`sources-refresh-${safeId}`}
                    >
                      Refresh
                    </button>
                    <button
                      className="button button-sm"
                      disabled={catalogState.mutating}
                      onClick={() => void handleSyncSource(safeId)}
                      data-testid={`sources-sync-${safeId}`}
                    >
                      Sync & Install
                    </button>
                    {confirmRemoveSourceId === safeId ? (
                      <span className="sources-confirm-group">
                        <span className="sources-confirm-text">Remove?</span>
                        <button
                          className="button button-sm button-danger"
                          disabled={catalogState.mutating}
                          onClick={() => void handleRemoveSource(safeId)}
                          data-testid={`sources-remove-confirm-${safeId}`}
                        >
                          Yes
                        </button>
                        <button
                          className="button button-sm button-ghost"
                          disabled={catalogState.mutating}
                          onClick={() => setConfirmRemoveSourceId(null)}
                          data-testid={`sources-remove-cancel-${safeId}`}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        className="button button-sm"
                        disabled={catalogState.mutating}
                        onClick={() => setConfirmRemoveSourceId(safeId)}
                        data-testid={`sources-remove-${safeId}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Add source overlay */}
      {showAddTool && (
        <div className="assets-tools-add-panel" data-testid="assets-tools-add-panel">
          <div className="assets-tools-add-panel-header">
            <h3>Add External Source</h3>
            <Button onClick={() => setShowAddTool(false)} variant="ghost" testId="sources-add-close">
              Close
            </Button>
          </div>
          <div className="assets-tools-add-panel-body">
            <div className="assets-tools-add-panel-form">
              <FormInput
                label="URL"
                required
                testId="sources-add-url"
                type="url"
                value={addToolForm.url}
                onValueChange={(v) => handleField('url', v)}
                placeholder="https://github.com/owner/repo"
              />
              <FormInput
                label="Title"
                testId="sources-add-title"
                value={addToolForm.title}
                onValueChange={(v) => handleField('title', v)}
                placeholder="(optional) My Tool"
              />
              <FormInput
                label="Source ID"
                testId="sources-add-source-id"
                value={addToolForm.sourceId}
                onValueChange={(v) => handleField('sourceId', v)}
                placeholder="(optional) my-tool"
              />
              <FormInput
                label="Description"
                testId="sources-add-description"
                value={addToolForm.description}
                onValueChange={(v) => handleField('description', v)}
                placeholder="(optional) Brief description"
              />
              <Button
                disabled={!addToolForm.url.trim() || catalogState.mutating}
                onClick={() => void handleSubmit()}
                testId="sources-add-submit"
                variant="primary"
              >
                {catalogState.mutating ? 'Adding...' : 'Add Source'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
