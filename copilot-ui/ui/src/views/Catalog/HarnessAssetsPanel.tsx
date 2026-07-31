import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CatalogGlobalHarness,
  CatalogGlobalSection,
  CatalogSummaryResponse,
} from '../../lib/types';
import { getCatalogSummary } from '../../lib/api/catalog';
import HarnessTab from './HarnessTab';

export type DedicatedHarnessId = 'codex' | 'opencode' | 'claude-code';

interface HarnessAssetsPanelProps {
  harnessId: DedicatedHarnessId;
}

function normalizeSummary(response: CatalogSummaryResponse | null): {
  sections: CatalogGlobalSection[];
  harnesses: CatalogGlobalHarness[];
} {
  const inventory = response?.summary?.globalInventory;
  return {
    sections: Array.isArray(inventory?.sections) ? inventory.sections : [],
    harnesses: Array.isArray(inventory?.harnesses) ? inventory.harnesses : [],
  };
}

export default function HarnessAssetsPanel({ harnessId }: HarnessAssetsPanelProps) {
  const [response, setResponse] = useState<CatalogSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setResponse(await getCatalogSummary());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load harness assets.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { sections, harnesses } = useMemo(() => normalizeSummary(response), [response]);
  const harness = harnesses.find((candidate) => candidate.harnessId === harnessId);

  return (
    <section className="settings-panel harness-assets-panel" data-testid={`harness-assets-panel-${harnessId}`}>
      <div className="settings-panel-header">
        <div>
          <h3>Assets</h3>
          <p className="settings-panel-subtitle">
            Inspect {harness?.title || harnessId} assets by ownership, scope, and lifecycle status.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          data-testid={`harness-assets-refresh-${harnessId}`}
        >
          {refreshing ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>

      {loading ? <p className="state-message">Loading {harnessId} assets…</p> : null}
      {error ? <p className="state-message state-message-error">{error}</p> : null}

      {!loading && !error ? (
        <HarnessTab
          harnessId={harnessId}
          sections={sections}
          harnesses={harnesses}
          onRefresh={() => void load(true)}
          mutating={refreshing}
        />
      ) : null}
    </section>
  );
}
