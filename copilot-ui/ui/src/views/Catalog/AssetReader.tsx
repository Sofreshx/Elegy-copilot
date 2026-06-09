import { useEffect, useState } from 'react';
import type { CatalogGlobalItem } from '../../lib/types';
import { getCatalogContent } from '../../lib/api';
import { Badge, Button } from '../../components';
import { normalizeProvenance } from './provenance';

interface AssetReaderProps {
  item: CatalogGlobalItem | null;
}

type ReaderTab = 'overview' | 'document' | 'paths' | 'resolution';

export default function AssetReader({ item }: AssetReaderProps) {
  const [activeReaderTab, setActiveReaderTab] = useState<ReaderTab>('overview');
  const [documentContent, setDocumentContent] = useState('');
  const [documentLoading, setDocumentLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setActiveReaderTab('overview');
    setDocumentContent('');
    setShowRaw(false);
  }, [item?.itemId]);

  useEffect(() => {
    if (activeReaderTab !== 'document' || !item) {
      return;
    }
    let cancelled = false;
    const readPath = item.readPath?.trim();
    if (!readPath) {
      setDocumentContent('No document path available.');
      return;
    }
    const contentPath = readPath as string;
    async function load() {
      setDocumentLoading(true);
      try {
        const content = await getCatalogContent({ mode: 'engine', path: contentPath });
        if (!cancelled) setDocumentContent(content || 'No content loaded.');
      } catch {
        if (!cancelled) setDocumentContent('Failed to load document content.');
      } finally {
        if (!cancelled) setDocumentLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeReaderTab, item]);

  if (!item) {
    return (
      <section className="assets-tools-list" data-testid="assets-tools-reader">
        <p className="assets-tools-empty">Select an asset to view details</p>
      </section>
    );
  }

  const provenance = normalizeProvenance(item.readPath, item.sourceId, item.sourceType);
  const aliases: string[] = Array.isArray((item as any).aliases) ? (item as any).aliases : [];
  const triggers: string[] = Array.isArray((item as any).triggers) ? (item as any).triggers : [];
  const loadMode = (item as any).loadMode ?? 'unknown';

  const READER_TABS: { key: ReaderTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'document', label: 'Document' },
    { key: 'paths', label: 'Paths' },
    { key: 'resolution', label: 'Resolution' },
  ];

  return (
    <section className="assets-tools-list" data-testid="assets-tools-reader">
      {/* Reader tab bar */}
      <div className="assets-tools-chip-row" style={{ marginBottom: 'var(--space-sm)' }}>
        {READER_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`assets-tools-chip catalog-chip ${activeReaderTab === tab.key ? 'active catalog-chip is-active' : ''}`}
            onClick={() => setActiveReaderTab(tab.key)}
            type="button"
            data-testid={`reader-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
        {activeReaderTab === 'document' && (
          <button
            className={`assets-tools-chip catalog-chip ${showRaw ? 'active catalog-chip is-active' : ''}`}
            onClick={() => setShowRaw(!showRaw)}
            type="button"
            data-testid="reader-raw-toggle"
            style={{ marginLeft: 'auto' }}
          >
            Raw
          </button>
        )}
      </div>

      {/* Overview tab */}
      {activeReaderTab === 'overview' && (
        <div className="assets-tools-inspector" style={{ overflow: 'auto', maxHeight: 'none' }}>
          <div className="assets-tools-inspector-section">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{item.title}</h3>
            <div className="assets-tools-item-badges">
              <Badge tone="neutral">{item.kind}</Badge>
              {item.sourceType ? <Badge tone="accent">{item.sourceType}</Badge> : null}
              <Badge tone="brand">{provenance.group}</Badge>
            </div>
          </div>

          {item.description ? (
            <div className="assets-tools-inspector-section">
              <h4>Purpose</h4>
              <p>{item.description}</p>
            </div>
          ) : null}

          <div className="assets-tools-inspector-section">
            <h4>Details</h4>
            <table>
              <tbody>
                <tr><td>Item Key</td><td>{item.itemKey}</td></tr>
                <tr><td>Kind</td><td>{item.kind}</td></tr>
                <tr><td>Source ID</td><td>{item.sourceId || '\u2014'}</td></tr>
                <tr><td>Provider</td><td>{item.providerId || '\u2014'}</td></tr>
                <tr><td>Provenance</td><td>{provenance.group}</td></tr>
                {loadMode !== 'unknown' && <tr><td>Load Mode</td><td>{loadMode}</td></tr>}
              </tbody>
            </table>
          </div>

          {aliases.length > 0 && (
            <div className="assets-tools-inspector-section">
              <h4>Aliases</h4>
              <div className="assets-tools-chip-row">
                {aliases.map((a) => <span key={a} className="assets-tools-chip catalog-chip">{a}</span>)}
              </div>
            </div>
          )}

          {triggers.length > 0 && (
            <div className="assets-tools-inspector-section">
              <h4>Triggers</h4>
              <div className="assets-tools-chip-row">
                {triggers.map((t) => <span key={t} className="assets-tools-chip catalog-chip">{t}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Document tab */}
      {activeReaderTab === 'document' && (
        <div className="assets-tools-inspector" style={{ overflow: 'auto', maxHeight: 'none' }}>
          {/* Metadata above document */}
          <div className="assets-tools-inspector-section">
            <table>
              <tbody>
                <tr><td>Content Path</td><td>{item.readPath || '\u2014'}</td></tr>
                <tr><td>Provenance</td><td>{provenance.group}</td></tr>
                <tr><td>Source ID</td><td>{item.sourceId || '\u2014'}</td></tr>
                <tr><td>Load Mode</td><td>{loadMode}</td></tr>
                {aliases.length > 0 && <tr><td>Aliases</td><td>{aliases.join(', ')}</td></tr>}
                {triggers.length > 0 && <tr><td>Triggers</td><td>{triggers.join(', ')}</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Content */}
          <div className="assets-tools-inspector-section">
            <h4>Document</h4>
            {documentLoading ? (
              <p className="assets-tools-empty">Loading document...</p>
            ) : showRaw ? (
              <pre className="assets-tools-inspector-content">{documentContent}</pre>
            ) : (
              <div className="assets-tools-inspector-content" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)' }}>
                {documentContent}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paths tab */}
      {activeReaderTab === 'paths' && (
        <div className="assets-tools-inspector" style={{ overflow: 'auto', maxHeight: 'none' }}>
          <div className="assets-tools-inspector-section">
            <h4>Content Path</h4>
            <p>{item.readPath || 'No path available'}</p>
          </div>
          <div className="assets-tools-inspector-section">
            <h4>Install Paths</h4>
            {(item.harnessStates || []).length === 0 ? (
              <p className="assets-tools-empty">No harness state data</p>
            ) : (
              <table>
                <tbody>
                  {(item.harnessStates || []).map((hs) => (
                    <tr key={hs.harnessId}>
                      <td>{hs.title}</td>
                      <td>{hs.installPath || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Resolution tab */}
      {activeReaderTab === 'resolution' && (
        <div className="assets-tools-inspector" style={{ overflow: 'auto', maxHeight: 'none' }}>
          <div className="assets-tools-inspector-section">
            <h4>Layer Resolution</h4>
            <table>
              <tbody>
                <tr><td>Item Key</td><td>{item.itemKey}</td></tr>
                <tr><td>Conceptual Key</td><td>{(item as any).conceptualKey || '\u2014'}</td></tr>
                <tr><td>Scope Kinds</td><td>{(item.scopeKinds || []).join(', ') || '\u2014'}</td></tr>
                <tr><td>Provenance</td><td>{provenance.group}</td></tr>
                <tr><td>Source Type</td><td>{item.sourceType || '\u2014'}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="assets-tools-inspector-section">
            <h4>Override State</h4>
            <table>
              <tbody>
                <tr><td>Central</td><td>{item.central ? 'Yes' : 'No'}</td></tr>
                <tr><td>Key Feature</td><td>{item.keyFeature ? `Yes (${item.keyFeatureLabel || '\u2014'})` : 'No'}</td></tr>
                <tr><td>Sync Status</td><td>{item.syncStatus || '\u2014'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
