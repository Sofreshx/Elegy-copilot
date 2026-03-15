import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, StatusBadge, Toolbar } from '../../components';
import { formatTimestampLabel, summarizeSdkHealth } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import GatewayView from '../Gateway/GatewayView';
import LspView from '../LSP/LspView';
import TrackerView from '../Tracker/TrackerView';
import { stateOverviewStore } from './stateOverviewStore';

type StateSectionId = 'overview' | 'gateway' | 'tracker' | 'lsp';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : null;
}

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? String(record[key]).trim() : '';
}

function buildStatusToken(record: Record<string, unknown>, fallback: string): string {
  const status = readString(record, 'status');
  if (status) {
    return status;
  }

  const ready = readBoolean(record, 'ready');
  if (ready === true) {
    return 'ready';
  }
  if (ready === false) {
    return 'not_ready';
  }

  const usable = readBoolean(record, 'usable');
  if (usable === true) {
    return 'usable';
  }

  const ok = readBoolean(record, 'ok');
  if (ok === true) {
    return 'healthy';
  }
  if (ok === false) {
    return 'degraded';
  }

  return fallback;
}

function joinDetails(parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' | ');
}

export default function StateView() {
  const [activeSection, setActiveSection] = useState<StateSectionId>('overview');
  const overviewState = useStoreValue(stateOverviewStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);

  useEffect(() => {
    stateOverviewStore.startPolling();
    return () => {
      stateOverviewStore.stopPolling();
    };
  }, []);

  const runtimeCard = useMemo(() => {
    const runtime = asRecord(overviewState.health?.runtime);
    const status = buildStatusToken(runtime, overviewState.health?.ok ? 'healthy' : 'unknown');
    const detail = joinDetails([
      readString(runtime, 'statusMessage'),
      readString(runtime, 'mode'),
      overviewState.health?.engineRoot ? `engine: ${overviewState.health.engineRoot}` : '',
    ]) || 'Local runtime diagnostics from /api/health.';

    return {
      title: 'Runtime',
      status,
      copy: overviewState.health?.ok ? 'Backend health endpoint is responding.' : 'Runtime health needs attention.',
      detail,
    };
  }, [overviewState.health]);

  const persistenceCard = useMemo(() => {
    const persistence = asRecord(overviewState.health?.planningPersistence);
    const status = buildStatusToken(persistence, 'unknown');
    const detail = joinDetails([
      readBoolean(persistence, 'configured') === true ? 'configured' : '',
      readBoolean(persistence, 'usable') === true ? 'usable' : '',
      readBoolean(persistence, 'required') === true ? 'required' : '',
      readBoolean(persistence, 'initRequired') === true ? 'init required' : '',
      readString(persistence, 'message'),
    ]) || 'Planning persistence and database readiness.';

    return {
      title: 'Planning DB',
      status,
      copy: 'Tracks planning persistence, authority state, and dependency gates.',
      detail,
    };
  }, [overviewState.health]);

  const catalogCard = useMemo(() => {
    const projection = overviewState.catalogHealth?.projection;
    const freshness = projection?.freshness?.status || '';
    const readMode = projection?.readMode || '';
    const status = overviewState.catalogHealth?.ok ? (freshness || 'healthy') : 'degraded';
    const detail = joinDetails([
      readMode ? `mode: ${readMode}` : '',
      freshness ? `freshness: ${freshness}` : '',
      overviewState.catalogHealth?.audit?.exists ? 'audit log present' : 'audit log missing',
    ]) || 'Catalog projection and audit runtime health.';

    return {
      title: 'Catalog',
      status,
      copy: 'Confirms projection persistence, freshness, and audit storage.',
      detail,
    };
  }, [overviewState.catalogHealth]);

  const sdkCard = useMemo(() => {
    const summary = summarizeSdkHealth(sdkHealthState.health, sdkHealthState.error);
    return {
      title: 'Copilot SDK',
      status: summary.status.toLowerCase().replace(/\s+/g, '_'),
      copy: 'Reports bridge readiness for SDK-backed planning and session flows.',
      detail: summary.detail,
    };
  }, [sdkHealthState.error, sdkHealthState.health]);

  const policyCard = useMemo(() => {
    const policy = asRecord(overviewState.health?.policy);
    const status = buildStatusToken(policy, readString(policy, 'reason') || 'unknown');
    const detail = joinDetails([
      readString(policy, 'message'),
      readString(policy, 'checkedAt'),
    ]) || 'Mutating action preflight state.';

    return {
      title: 'Policy Gate',
      status,
      copy: 'Surfaces whether mutating actions are currently blocked.',
      detail,
    };
  }, [overviewState.health]);

  const cards = [runtimeCard, persistenceCard, catalogCard, sdkCard, policyCard];
  const sectionLabel =
    activeSection === 'overview'
      ? 'System Overview'
      : activeSection === 'gateway'
        ? 'Gateway'
        : activeSection === 'tracker'
          ? 'Tracker'
          : 'LSP';

  return (
    <section className="workspace-stack state-view" data-testid="state-view">
      <Toolbar testId="state-view-toolbar">
        <div className="state-summary">
          <p className="state-title">System State</p>
          <p className="state-copy">
            Unified readiness view for runtime health, planning persistence, catalog projection,
            SDK bridge state, and operator tools.
          </p>
        </div>

        <div className="state-toolbar-actions">
          <Button
            disabled={overviewState.loading}
            onClick={() => {
              void stateOverviewStore.refresh();
            }}
            testId="state-refresh-button"
            variant="secondary"
          >
            {overviewState.loading ? 'Refreshing...' : 'Refresh state'}
          </Button>
        </div>
      </Toolbar>

      <div className="workspace-nav" role="tablist" aria-label="State workspaces">
        <Button
          onClick={() => setActiveSection('overview')}
          testId="state-section-overview"
          variant={activeSection === 'overview' ? 'primary' : 'ghost'}
        >
          Overview
        </Button>
        <Button
          onClick={() => setActiveSection('gateway')}
          testId="state-section-gateway"
          variant={activeSection === 'gateway' ? 'primary' : 'ghost'}
        >
          Gateway
        </Button>
        <Button
          onClick={() => setActiveSection('tracker')}
          testId="state-section-tracker"
          variant={activeSection === 'tracker' ? 'primary' : 'ghost'}
        >
          Tracker
        </Button>
        <Button
          onClick={() => setActiveSection('lsp')}
          testId="state-section-lsp"
          variant={activeSection === 'lsp' ? 'primary' : 'ghost'}
        >
          LSP
        </Button>
      </div>

      <p className="workspace-section-label">{sectionLabel}</p>

      {overviewState.error ? (
        <p className="state-error" role="alert">
          {overviewState.error}
        </p>
      ) : null}

      {activeSection === 'overview' ? (
        <div className="state-grid">
          <Panel
            subtitle="Current readiness snapshot from lifecycle, catalog, and SDK health endpoints."
            testId="state-overview-panel"
            title="System Overview"
            footer={
              <p>
                Last updated: {formatTimestampLabel(overviewState.lastUpdatedAtMs)}
              </p>
            }
          >
            <div className="state-card-grid">
              {cards.map((card) => (
                <article className="state-card" key={card.title}>
                  <div className="state-card-header">
                    <p className="state-card-title">{card.title}</p>
                    <StatusBadge status={card.status} testId="state-card-status" />
                  </div>
                  <p className="state-card-copy">{card.copy}</p>
                  <p className="state-card-detail">{card.detail}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel
            subtitle="Raw high-signal details for debugging and readiness checks."
            testId="state-details-panel"
            title="Diagnostics"
          >
            <div className="state-meta-grid">
              <div className="state-meta-card">
                <p className="state-meta-label">Health Endpoint</p>
                <pre className="code-block">{JSON.stringify(overviewState.health, null, 2) || '{}'}</pre>
              </div>
              <div className="state-meta-card">
                <p className="state-meta-label">Catalog Health</p>
                <pre className="code-block">{JSON.stringify(overviewState.catalogHealth, null, 2) || '{}'}</pre>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeSection === 'gateway' ? <GatewayView /> : null}
      {activeSection === 'tracker' ? <TrackerView /> : null}
      {activeSection === 'lsp' ? <LspView /> : null}
    </section>
  );
}