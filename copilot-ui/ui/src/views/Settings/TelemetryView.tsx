import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { getHarnessTelemetry } from '../../lib/api/telemetry';
import type { HarnessTelemetryData, HarnessTelemetryEvent, HarnessTelemetryResponse } from '../../lib/types';

type HarnessId = 'opencode' | 'codex';
type EventFilter = 'all' | 'errors' | 'tools' | 'requests';

const HARNESS_TABS: Array<{ id: HarnessId; label: string }> = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'codex', label: 'Codex' },
];

const EVENT_FILTERS: Array<{ id: EventFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'errors', label: 'Errors' },
  { id: 'tools', label: 'Tools' },
  { id: 'requests', label: 'Requests' },
];

function formatValue(value: number | null): string {
  return value == null ? 'Limited' : String(value);
}

function filterEvents(events: HarnessTelemetryEvent[], filter: EventFilter, query: string) {
  const q = query.trim().toLowerCase();
  return events.filter((event) => {
    if (filter === 'errors' && event.type !== 'error' && !event.type.includes('error') && event.source !== 'recent-errors') return false;
    if (filter === 'tools' && event.type !== 'tool') return false;
    if (filter === 'requests' && event.type !== 'request' && event.type !== 'session') return false;
    if (!q) return true;
    return [
      event.timestamp,
      event.type,
      event.source,
      event.label || '',
      event.message,
    ].join(' ').toLowerCase().includes(q);
  });
}

function CountTable({
  title,
  empty,
  rows,
  subtitle,
  testId,
}: {
  title: string;
  empty: string;
  rows: Array<{ name: string; count: number; provider?: string }>;
  subtitle?: string;
  testId: string;
}) {
  return (
    <Panel title={title} subtitle={subtitle} testId={testId}>
      {rows.length === 0 ? (
        <p className="state-message">{empty}</p>
      ) : (
        <div className="telemetry-table-wrap">
          <table className="telemetry-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Count</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.provider || ''}`}>
                  <td><code>{row.name}</code></td>
                  <td>{row.count}</td>
                  <td>{row.provider || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function EventTable({ events }: { events: HarnessTelemetryEvent[] }) {
  if (events.length === 0) {
    return <p className="state-message" data-testid="telemetry-events-empty">No events match the current filters.</p>;
  }

  return (
    <div className="telemetry-table-wrap telemetry-events-table-wrap">
      <table className="telemetry-table" data-testid="telemetry-events-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Source</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.timestamp}-${event.source}-${index}`}>
              <td><code>{event.timestamp || '-'}</code></td>
              <td><Badge tone={event.type.includes('error') ? 'danger' : event.type === 'tool' ? 'brand' : 'neutral'}>{event.type}</Badge></td>
              <td><code>{event.source}</code></td>
              <td>
                {event.label ? <strong>{event.label}: </strong> : null}
                {event.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HarnessPanel({
  harness,
  eventFilter,
  search,
  onEventFilterChange,
  onSearchChange,
}: {
  harness: HarnessTelemetryData;
  eventFilter: EventFilter;
  search: string;
  onEventFilterChange: (filter: EventFilter) => void;
  onSearchChange: (query: string) => void;
}) {
  const events = useMemo(
    () => {
      const baseEvents = eventFilter === 'errors'
        ? [
            ...(harness.recentErrors || []).map((event) => ({
              ...event,
              type: 'error',
              label: event.label || event.type,
            })),
            ...(harness.recentEvents || []),
          ]
        : (harness.recentEvents || []);
      const seen = new Set<string>();
      const deduped = baseEvents.filter((event) => {
        const key = `${event.timestamp}|${event.type}|${event.source}|${event.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return filterEvents(deduped, eventFilter, search);
    },
    [harness.recentErrors, harness.recentEvents, eventFilter, search],
  );

  return (
    <div className="telemetry-harness" data-testid={`telemetry-harness-${harness.id}`}>
      <Panel title={`${harness.label} Coverage`} subtitle="Session data collected by this harness" testId="telemetry-coverage">
        <div className="opencode-readiness-cards telemetry-summary-cards">
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Coverage</span>
            <code className="opencode-readiness-value">{harness.coverage}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Source</span>
            <code className="opencode-readiness-value">{harness.source.path}</code>
          </div>
          {harness.source.logsPath ? (
            <div className="opencode-readiness-card">
              <span className="opencode-readiness-label">Logs</span>
              <code className="opencode-readiness-value">{harness.source.logsPath}</code>
            </div>
          ) : null}
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Log Files</span>
            <span className="opencode-readiness-value">{harness.sample.logFiles}</span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Sampled Lines</span>
            <span className="opencode-readiness-value">{harness.sample.sampledLines}</span>
          </div>
          {harness.id === 'opencode' ? (
            <div className="opencode-readiness-card">
              <span className="opencode-readiness-label">OpenTelemetry Flag</span>
              <span className="opencode-readiness-value">
                {harness.source.openTelemetry == null
                  ? 'Unknown'
                  : harness.source.openTelemetry ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Summary" subtitle="Overview of telemetry events collected across all harnesses" testId="telemetry-summary">
        <div className="opencode-readiness-cards telemetry-summary-cards">
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Requests</span>
            <strong>{formatValue(harness.summary.requests)}</strong>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Sampled Requests</span>
            <strong>{formatValue(harness.summary.sampledRequests)}</strong>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Errors</span>
            <strong>{harness.summary.errors}</strong>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Tool Events</span>
            <strong>{harness.summary.toolEvents}</strong>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Sessions</span>
            <strong>{formatValue(harness.summary.sessions)}</strong>
          </div>
        </div>
      </Panel>

      <div className="telemetry-grid">
        <CountTable
          title="Most Used Tools"
          subtitle="Tools invoked most frequently across sessions"
          empty="No tool usage was detected in the sampled data."
          rows={harness.topTools || []}
          testId="telemetry-tools"
        />
        <CountTable
          title="Errors By Type"
          subtitle="Error frequency breakdown by error type"
          empty="No errors were detected in the sampled data."
          rows={harness.errorsByType || []}
          testId="telemetry-errors"
        />
      </div>

      <Panel title="Recent Events" subtitle="Latest session and tool events across harnesses" testId="telemetry-events">
        <div className="telemetry-filters">
          <div className="workspace-nav telemetry-filter-tabs" role="tablist" aria-label="Telemetry event filters">
            {EVENT_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                className={`opencode-tab${eventFilter === filter.id ? ' opencode-tab-active' : ''}`}
                data-testid={`telemetry-filter-${filter.id}`}
                onClick={() => onEventFilterChange(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <input
            className="telemetry-search-input"
            aria-label="Search telemetry events"
            data-testid="telemetry-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events"
          />
        </div>
        <EventTable events={events} />
      </Panel>
    </div>
  );
}

export default function TelemetryView() {
  const [data, setData] = useState<HarnessTelemetryResponse | null>(null);
  const [activeHarness, setActiveHarness] = useState<HarnessId>('opencode');
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getHarnessTelemetry({ limit: 200 });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const harness = data ? data.harnesses[activeHarness] : null;

  return (
    <div className="view-shell telemetry-settings-view" data-testid="telemetry-settings-view">
      <div className="view-static">
        <Toolbar testId="telemetry-toolbar">
          <h2>Telemetry</h2>
          <Button
            variant="secondary"
            size="sm"
            testId="telemetry-refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </Toolbar>
        <div className="workspace-nav" role="tablist" aria-label="Telemetry harnesses">
          {HARNESS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`opencode-tab${activeHarness === tab.id ? ' opencode-tab-active' : ''}`}
              data-testid={`telemetry-tab-${tab.id}`}
              onClick={() => {
                setActiveHarness(tab.id);
                setEventFilter('all');
                setSearch('');
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="view-scroll telemetry-settings-content" data-testid="telemetry-settings-content">
        {loading && !data ? <p className="state-message" data-testid="telemetry-loading">Loading telemetry...</p> : null}
        {error ? <p className="opencode-error" data-testid="telemetry-error">{error}</p> : null}
        {data ? (
          <p className="state-message telemetry-generated" data-testid="telemetry-generated">
            Generated {data.generatedAt}. Local sampled telemetry only.
          </p>
        ) : null}
        {harness ? (
          <HarnessPanel
            harness={harness}
            eventFilter={eventFilter}
            search={search}
            onEventFilterChange={setEventFilter}
            onSearchChange={setSearch}
          />
        ) : null}
      </div>
    </div>
  );
}
