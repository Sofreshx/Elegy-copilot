import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Panel } from '../../components';

export type IntelligenceSurfaceId = 'overseer' | 'opportunity-world-model';
type SurfaceStatus = 'loading' | 'stopped' | 'starting' | 'ready' | 'degraded' | 'unavailable' | 'prerequisite_missing';

interface IntelligenceSurfaceStatus {
  message?: string;
  schema?: string;
  id: IntelligenceSurfaceId;
  name: string;
  description: string;
  status: SurfaceStatus;
  reasonCode: string;
  consoleUrl: string;
  healthUrl: string;
  checkedAt?: string;
  prerequisites: string[];
  health?: Record<string, unknown>;
}

interface OieProviderStatus {
  id: 'local_searxng' | 'public_http_capture' | 'playwright_browser' | 'brave_web_search';
  name: string;
  configured: boolean;
  required: boolean;
  status: 'ready' | 'setup_required' | 'setup_optional' | 'unavailable';
  reason_code: string;
  credential_storage: 'windows_dpapi' | 'none' | 'unavailable';
  external_setup_required: boolean;
}

interface OieProviderProjection {
  research_ready: boolean;
  monetary_cost_ceiling_minor: 0 | null;
  providers: OieProviderStatus[];
}

const LABELS: Record<IntelligenceSurfaceId, string> = {
  overseer: 'Overseer',
  'opportunity-world-model': 'Opportunity Intelligence Engine',
};

function statusTone(status: SurfaceStatus): 'neutral' | 'brand' | 'success' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'starting') return 'brand';
  if (status === 'degraded' || status === 'prerequisite_missing') return 'danger';
  return 'neutral';
}

function isSafeConsoleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && (url.port === '4173' || url.port === '7400');
  } catch {
    return false;
  }
}

function standaloneConsoleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete('embed');
    return url.toString();
  } catch {
    return value;
  }
}

async function readStatus(surfaceId: IntelligenceSurfaceId): Promise<IntelligenceSurfaceStatus> {
  const response = await fetch(`/api/intelligence-surfaces/${surfaceId}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => null) as Partial<IntelligenceSurfaceStatus> | null;
  if (!response.ok || !payload || typeof payload.id !== 'string') {
    throw new Error(typeof payload?.message === 'string' ? payload.message : `Unable to inspect ${LABELS[surfaceId]}.`);
  }
  return {
    id: surfaceId,
    name: typeof payload.name === 'string' ? payload.name : LABELS[surfaceId],
    description: typeof payload.description === 'string' ? payload.description : '',
    status: payload.status || 'unavailable',
    reasonCode: typeof payload.reasonCode === 'string' ? payload.reasonCode : 'unknown',
    consoleUrl: typeof payload.consoleUrl === 'string' ? payload.consoleUrl : '',
    healthUrl: typeof payload.healthUrl === 'string' ? payload.healthUrl : '',
    checkedAt: payload.checkedAt,
    prerequisites: Array.isArray(payload.prerequisites) ? payload.prerequisites.filter((item): item is string => typeof item === 'string') : [],
    health: payload.health,
  };
}

async function readOieProviders(): Promise<OieProviderProjection> {
  const response = await fetch('/api/intelligence-surfaces/opportunity-world-model/providers', { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => null) as Partial<OieProviderProjection> | null;
  if (!response.ok || !payload) throw new Error('Unable to read zero-cost web research readiness.');
  return {
    research_ready: payload.research_ready === true,
    monetary_cost_ceiling_minor: payload.monetary_cost_ceiling_minor === 0 ? 0 : null,
    providers: Array.isArray(payload.providers) ? payload.providers : [],
  };
}

export default function IntelligenceSurfaceView({ surfaceId }: { surfaceId: IntelligenceSurfaceId }) {
  const label = LABELS[surfaceId];
  const [surface, setSurface] = useState<IntelligenceSurfaceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerProjection, setProviderProjection] = useState<OieProviderProjection | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSurface(await readStatus(surfaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [surfaceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (surfaceId !== 'opportunity-world-model' || surface?.status !== 'ready') {
      setProviderProjection(null);
      return;
    }
    let cancelled = false;
    void readOieProviders()
      .then((value) => { if (!cancelled) { setProviderProjection(value); setProviderError(null); } })
      .catch((cause) => { if (!cancelled) setProviderError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [surface?.status, surfaceId]);

  const canEmbed = useMemo(
    () => surface?.status === 'ready' && isSafeConsoleUrl(surface.consoleUrl),
    [surface],
  );

  async function runAction(nextAction: 'start' | 'stop') {
    if (!surface || action) return;
    if (!window.confirm(`${nextAction === 'start' ? 'Start' : 'Stop'} ${label}?`)) return;
    setAction(nextAction);
    setError(null);
    setSurface((current) => current ? { ...current, status: nextAction === 'start' ? 'starting' : 'degraded' } : current);
    try {
      const response = await fetch(`/api/intelligence-surfaces/${surfaceId}/${nextAction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirmation: `${nextAction}:${surfaceId}`, observedAt: surface.checkedAt }),
      });
      const payload = await response.json().catch(() => null) as Partial<IntelligenceSurfaceStatus> | null;
      if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : `Unable to ${nextAction} ${label}.`);
      setSurface(await readStatus(surfaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await load();
    } finally {
      setAction(null);
    }
  }

  function openExternally() {
    if (!surface || !isSafeConsoleUrl(surface.consoleUrl)) return;
    window.open(standaloneConsoleUrl(surface.consoleUrl), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="view-shell intelligence-surface-view" data-testid={`intelligence-surface-${surfaceId}`}>
      <div className="intelligence-surface-hostbar" data-testid="intelligence-surface-hostbar">
        <div className="intelligence-surface-heading">
          <div>
            <p className="intelligence-surface-eyebrow">Elegy Intelligence</p>
            <h1>{label}</h1>
          </div>
          {surface ? <Badge tone={statusTone(surface.status)} testId="intelligence-surface-status">{surface.status.replace('_', ' ')}</Badge> : null}
        </div>
        <div className="intelligence-surface-actions">
          <Button variant="secondary" size="sm" testId="intelligence-surface-refresh" onClick={() => void load()} disabled={loading || Boolean(action)}>
            {loading ? 'Checking…' : 'Refresh'}
          </Button>
          {surface?.status === 'ready' || surface?.status === 'degraded' ? (
            <Button variant="danger" size="sm" onClick={() => void runAction('stop')} disabled={Boolean(action)} loading={action === 'stop'} loadingLabel="Stopping…">
              Stop {label}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void runAction('start')} disabled={Boolean(action) || !surface || surface.status === 'prerequisite_missing'} loading={action === 'start'} loadingLabel="Starting…">
              Start {label}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={openExternally} disabled={!surface || !isSafeConsoleUrl(surface.consoleUrl)}>
            Open externally
          </Button>
        </div>
      </div>

      {error ? <p className="intelligence-surface-error" role="alert">{error}</p> : null}

      <div className="view-scroll intelligence-surface-content">
        {surfaceId === 'opportunity-world-model' && surface?.status === 'ready' ? (
          <Panel title="Zero-cost web research" subtitle={providerProjection?.research_ready ? 'Ready for autonomous search and evidence capture.' : 'Checking local research routes.'} testId="oie-provider-setup">
            {providerError ? <p className="intelligence-surface-error" role="alert">{providerError}</p> : null}
            <div className="intelligence-surface-provider-actions">
              <p className="state-message">Local SearXNG discovers leads, direct HTTP captures efficient public reads, and a read-only headless browser handles pages that require rendering. Monetary cost ceiling: {providerProjection?.monetary_cost_ceiling_minor === 0 ? '0' : 'unavailable'}.</p>
              {providerProjection?.providers.filter((item) => item.id !== 'brave_web_search').map((item) => (
                <span key={item.id}><Badge tone={item.status === 'ready' ? 'success' : 'neutral'}>{item.name}: {item.status.replace('_', ' ')}</Badge></span>
              ))}
            </div>
          </Panel>
        ) : null}
        {loading && !surface ? (
          <Panel title={`Checking ${label}`} subtitle="Reading the source-owned service status." testId="intelligence-surface-loading">
            <p className="state-message">The service host is checking its fixed health and operator contracts.</p>
          </Panel>
        ) : null}

        {surface && !canEmbed ? (
          <Panel title={`${label} is ${surface.status.replace('_', ' ')}`} subtitle={surface.description} testId="intelligence-surface-status-panel">
            <p className="state-message">{surface.reasonCode.replace(/_/g, ' ')}</p>
            {surface.prerequisites.length > 0 ? (
              <ul className="intelligence-surface-prerequisites">
                {surface.prerequisites.map((item) => <li key={item}>{item.replace(/_/g, ' ')}</li>)}
              </ul>
            ) : null}
            <p className="intelligence-surface-boundary">Elegy hosts this console, but the service keeps its own data, session, and approval boundary.</p>
          </Panel>
        ) : null}

        {canEmbed && surface ? (
          <iframe
            className="intelligence-surface-frame"
            title={`${label} console`}
            src={surface.consoleUrl}
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    </div>
  );
}
