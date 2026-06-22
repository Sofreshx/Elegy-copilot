import { useState } from 'react';
import { useStoreValue } from '../../lib/store';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';
import type { CheckHarnessAssetResult } from '../../lib/api';
import QualityTab from './QualityTab';

const HARNESS_SCOPE_OPTIONS = [
  { value: '', label: 'All harnesses' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'claude-code', label: 'Claude Code' },
];

export default function DiagnosticsTab() {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [checkHarnessScope, setCheckHarnessScope] = useState('');
  const [checkResults, setCheckResults] = useState<CheckHarnessAssetResult[] | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);

  async function handleRunCheck() {
    setCheckRunning(true);
    setCheckResults(null);
    try {
      const results = await catalogWorkspaceStore.checkHarnessAssets(
        checkHarnessScope || undefined,
        undefined,
      );
      setCheckResults(results);
    } catch (_) {
      // Error surfaced via store state
    } finally {
      setCheckRunning(false);
    }
  }

  return (
    <div data-testid="diagnostics-tab">
      {/* CLI Tools Section — placeholder for Elegy CLI binary surfaces */}
      <section className="diagnostics-section" data-testid="diagnostics-cli-tools">
        <h3>CLI Tools</h3>
        <p className="state-message">
          Elegy CLI binary surfaces are managed through the Tooling Updates panel in Settings.
        </p>
      </section>

      {/* Deep Check Runner */}
      <section className="diagnostics-section" data-testid="diagnostics-deep-check">
        <h3>Deep Check</h3>
        <p>Validate asset integrity across harnesses. Checks for drift, missing files, and hash mismatches without modifying anything.</p>
        
        <div className="diagnostics-check-controls" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: 'var(--space-sm)' }}>
          <select
            value={checkHarnessScope}
            onChange={(e) => setCheckHarnessScope(e.target.value)}
            className="form-select"
            data-testid="diagnostics-check-scope"
          >
            {HARNESS_SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className="button button-primary button-sm"
            disabled={checkRunning}
            onClick={() => void handleRunCheck()}
            data-testid="diagnostics-check-run"
            type="button"
          >
            {checkRunning ? 'Checking...' : 'Run Check'}
          </button>
        </div>

        {catalogState.error && (
          <p className="state-message state-error" role="alert" style={{ marginTop: 'var(--space-sm)' }}>
            {catalogState.error}
          </p>
        )}

        {checkResults && checkResults.length > 0 && (
          <div className="diagnostics-check-results" data-testid="diagnostics-check-results" style={{ marginTop: 'var(--space-md)' }}>
            <h4>Results ({checkResults.length} assets)</h4>
            <table className="diagnostics-check-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 'var(--space-xs)' }}>Asset</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-xs)' }}>Harness</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-xs)' }}>State</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-xs)' }}>Drift</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-xs)' }}>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {checkResults.map((r, i) => (
                  <tr key={`${r.assetId}-${r.harnessId}-${i}`} data-testid={`diagnostics-check-row-${i}`}>
                    <td style={{ padding: 'var(--space-xs)' }}>{r.assetId}</td>
                    <td style={{ padding: 'var(--space-xs)' }}>{r.harnessId}</td>
                    <td style={{ padding: 'var(--space-xs)' }}>
                      <span className={`state-badge ${r.state === 'installed' ? 'state-badge--ok' : r.state === 'stale' ? 'state-badge--warn' : r.state === 'conflict' ? 'state-badge--error' : r.state === 'unmanaged' ? 'state-badge--warn' : 'state-badge--muted'}`}>
                        {r.state}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-xs)' }}>
                      {r.drift ? <span className="state-badge state-badge--warn">Drift</span> : '\u2014'}
                    </td>
                    <td style={{ padding: 'var(--space-xs)', maxWidth: '300px' }}>
                      {(r.warnings || []).length > 0
                        ? (r.warnings || []).map((w, j) => <div key={j} style={{ fontSize: '0.85em' }}>{w}</div>)
                        : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {checkResults && checkResults.length === 0 && (
          <p className="state-message" style={{ marginTop: 'var(--space-sm)' }}>No assets found to check.</p>
        )}
      </section>

      {/* Existing Quality diagnostics */}
      <section className="diagnostics-section" data-testid="diagnostics-quality">
        <h3>Skill Quality</h3>
        <QualityTab />
      </section>
    </div>
  );
}
