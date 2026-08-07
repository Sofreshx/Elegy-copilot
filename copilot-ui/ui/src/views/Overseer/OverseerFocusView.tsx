import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '../../components';
import { setOverseerWorkShellState } from './overseerWorkStore';
import './overseerFocus.css';

type FocusFreshness = 'fresh' | 'aging' | 'stale' | 'missing';

interface FocusIdea {
  id: string;
  name: string;
  maturity: string;
  readiness: string;
  confidence: string;
  summary: string;
  nextProof: string;
}

interface FocusSummary {
  format: string;
  asOf: string | null;
  freshness: { status: FocusFreshness; latestObservationAt?: string | null };
  recommendation: { title: string; summary: string; nextAction: string; confidence: string; horizon: string; rationale: string[]; counterpoint: string };
  activeOutcomes: Array<{ id: string; projectName: string; title: string; state: string; summary: string; blocker: string | null; nextAction: string; gateState: string; freshness: FocusFreshness; asOf: string | null; attention: boolean }>;
  horizon: Array<{ id: string; label: string; items: Array<{ id: string; kind: string; title: string; summary: string; status: string }> }>;
  ideas: FocusIdea[];
  attention: Array<{ id: string; reason: string; severity: string }>;
}

interface FocusIdeaDetail {
  id: string;
  name: string;
  maturity: string;
  readiness: string;
  confidence: string;
  reviewState: string;
  summary: { problem: string; beneficiary: string; productWedge: string; mvpBoundary: string; evidence: string; relationshipSummary: string; risks: string; nextDecision: string };
  nextProof: string;
}

interface FocusDetailResponse { idea: FocusIdeaDetail; related: Array<{ id: string; kind: string; name: string; summary: string }> }

interface OverseerStatus {
  status: 'ready' | 'starting' | 'stopped' | 'degraded' | 'unavailable' | 'prerequisite_missing';
  reasonCode?: string;
  description?: string;
  checkedAt?: string;
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null) as (T & { message?: string; error?: string }) | null;
  if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.');
  return payload as T;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function toneForFreshness(value: FocusFreshness): 'neutral' | 'brand' | 'danger' {
  if (value === 'stale' || value === 'missing') return 'danger';
  if (value === 'aging') return 'neutral';
  return 'brand';
}

function toneForState(value: string): 'neutral' | 'brand' | 'success' | 'danger' {
  if (value === 'blocked' || value === 'needs-attention') return 'danger';
  if (value === 'completed') return 'success';
  if (value === 'in-progress' || value === 'running' || value === 'ready') return 'brand';
  return 'neutral';
}

function stateLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function Recovery({ service, busy, onStart }: { service: OverseerStatus | null; busy: boolean; onStart: () => void }) {
  return (
    <section className="overseer-recovery" data-testid="overseer-focus-recovery">
      <div><p className="overseer-work-eyebrow">Source-owned service</p><h2>Overseer is unavailable</h2><p>{service?.description || 'Elegy cannot read Focus until the local Overseer service is ready.'}</p><span className="overseer-recovery-reason">{service?.reasonCode?.replaceAll('_', ' ') || 'connection unavailable'}</span></div>
      <div><Button onClick={onStart} disabled={busy} loading={busy} loadingLabel="Starting…">Start Overseer</Button><p className="overseer-form-help">Elegy holds no Overseer token in the browser.</p></div>
    </section>
  );
}

function Recommendation({ summary }: { summary: FocusSummary }) {
  const recommendation = summary.recommendation;
  return (
    <section className="overseer-focus-recommendation" data-testid="overseer-focus-recommendation">
      <div className="overseer-focus-section-heading"><div><p className="overseer-work-eyebrow">One recommendation</p><h2>{recommendation.title}</h2></div><Badge tone={toneForFreshness(summary.freshness.status)}>{stateLabel(summary.freshness.status)} evidence</Badge></div>
      <p className="overseer-focus-recommendation-summary">{recommendation.summary}</p>
      <div className="overseer-focus-recommendation-grid">
        <div><span className="overseer-focus-label">Next move</span><strong>{recommendation.nextAction}</strong></div>
        <div><span className="overseer-focus-label">Confidence</span><strong>{stateLabel(recommendation.confidence)}</strong></div>
        <div><span className="overseer-focus-label">Horizon</span><strong>{stateLabel(recommendation.horizon)}</strong></div>
      </div>
      <details className="overseer-focus-rationale"><summary>Why this focus</summary><ul>{(recommendation.rationale.length ? recommendation.rationale : ['Evidence is still being gathered.']).map((item) => <li key={item}>{item}</li>)}</ul><p><strong>Watch for:</strong> {recommendation.counterpoint}</p></details>
    </section>
  );
}

function ActiveOutcomes({ summary }: { summary: FocusSummary }) {
  return (
    <section className="overseer-focus-card" data-testid="overseer-focus-active">
      <div className="overseer-focus-section-heading"><div><p className="overseer-work-eyebrow">Portfolio now</p><h2>Active outcomes</h2></div><span className="overseer-focus-count">{summary.activeOutcomes.length}</span></div>
      <div className="overseer-focus-outcome-list">
        {summary.activeOutcomes.length ? summary.activeOutcomes.map((item) => (
          <article className={`overseer-focus-outcome${item.attention ? ' needs-attention' : ''}`} key={item.id}>
            <div className="overseer-focus-outcome-header"><div><strong>{item.projectName}</strong><span>{item.title}</span></div><Badge tone={toneForState(item.state)}>{stateLabel(item.state)}</Badge></div>
            <p>{item.blocker || item.summary}</p>
            <footer><span>Next: {item.nextAction}</span><span>{item.freshness} evidence</span></footer>
          </article>
        )) : <p className="state-copy">No active outcomes are recorded.</p>}
      </div>
    </section>
  );
}

function HorizonMap({ summary }: { summary: FocusSummary }) {
  return (
    <section className="overseer-focus-card" data-testid="overseer-focus-horizon">
      <div className="overseer-focus-section-heading"><div><p className="overseer-work-eyebrow">Portfolio shape</p><h2>Horizon map</h2></div></div>
      <div className="overseer-focus-horizon-grid">
        {summary.horizon.map((column) => <article className="overseer-focus-horizon-column" key={column.id}><h3>{column.label}</h3>{column.items.length ? column.items.map((item) => <div className="overseer-focus-horizon-item" key={item.id}><strong>{item.title}</strong><span>{item.summary}</span><small>{stateLabel(item.status)}</small></div>) : <p className="state-copy">Nothing mapped yet.</p>}</article>)}
      </div>
    </section>
  );
}

function IdeaDetail({ detail }: { detail: FocusDetailResponse | null }) {
  if (!detail) return <div className="overseer-focus-idea-detail-empty"><span aria-hidden="true">◇</span><h3>Select an idea</h3><p>Choose an idea to see its bounded problem, proof, and risks.</p></div>;
  const fields: Array<[string, string]> = [
    ['Problem', detail.idea.summary.problem],
    ['Who it helps', detail.idea.summary.beneficiary],
    ['Product wedge', detail.idea.summary.productWedge],
    ['MVP boundary', detail.idea.summary.mvpBoundary],
    ['Evidence', detail.idea.summary.evidence],
    ['Relationship', detail.idea.summary.relationshipSummary],
    ['Key risks', detail.idea.summary.risks],
    ['Next decision', detail.idea.summary.nextDecision],
  ];
  return <article className="overseer-focus-idea-detail"><header><div><p className="overseer-work-eyebrow">Idea detail</p><h3>{detail.idea.name}</h3></div><Badge tone={detail.idea.maturity === 'committed' ? 'brand' : 'neutral'}>{stateLabel(detail.idea.maturity)}</Badge></header><p className="overseer-focus-idea-next"><strong>Next proof:</strong> {detail.idea.nextProof}</p><dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{detail.related.length ? <footer><span>Related work</span>{detail.related.map((item) => <strong key={item.id}>{item.name}</strong>)}</footer> : null}</article>;
}

function Ideas({ summary, selectedId, detail, onSelect }: { summary: FocusSummary; selectedId: string | null; detail: FocusDetailResponse | null; onSelect: (id: string) => void }) {
  return (
    <section className="overseer-focus-card overseer-focus-ideas" data-testid="overseer-focus-ideas">
      <div className="overseer-focus-section-heading"><div><p className="overseer-work-eyebrow">Opportunity detail</p><h2>Ideas</h2></div><span className="overseer-focus-count">{summary.ideas.length}</span></div>
      <div className="overseer-focus-ideas-layout"><div className="overseer-focus-idea-list">{summary.ideas.length ? summary.ideas.map((idea) => <button type="button" className={`overseer-focus-idea-row${idea.id === selectedId ? ' is-selected' : ''}`} key={idea.id} onClick={() => onSelect(idea.id)} aria-label={`${idea.name}, ${stateLabel(idea.maturity)}`}><span className="overseer-focus-idea-mark">{idea.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong>{idea.name}</strong><small>{stateLabel(idea.maturity)} · {stateLabel(idea.readiness)}</small><em>{idea.summary}</em></span><span className="overseer-focus-idea-arrow" aria-hidden="true">→</span></button>) : <p className="state-copy">No ideas are recorded.</p>}</div><IdeaDetail detail={detail} /></div>
    </section>
  );
}

export default function OverseerFocusView() {
  const [summary, setSummary] = useState<FocusSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FocusDetailResponse | null>(null);
  const [service, setService] = useState<OverseerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [focusResult, serviceResult] = await Promise.allSettled([
      readJson<FocusSummary>('/api/overseer/focus/v1/summary'),
      readJson<OverseerStatus>('/api/intelligence-surfaces/overseer'),
    ]);
    if (serviceResult.status === 'fulfilled') {
      setService(serviceResult.value);
      setOverseerWorkShellState({ availability: serviceResult.value.status === 'ready' ? 'ready' : serviceResult.value.status === 'prerequisite_missing' ? 'unavailable' : serviceResult.value.status });
    } else {
      setService(null);
      setOverseerWorkShellState({ availability: 'unavailable' });
    }
    if (focusResult.status === 'fulfilled') {
      setSummary(focusResult.value);
      setSelectedId((current) => current && focusResult.value.ideas.some((idea) => idea.id === current) ? current : focusResult.value.ideas[0]?.id || null);
    } else {
      setSummary(null);
      setError(focusResult.reason instanceof Error ? focusResult.reason.message : 'Unable to read Focus from Overseer.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    void readJson<FocusDetailResponse>(`/api/overseer/focus/v1/ideas/${encodeURIComponent(selectedId)}`).then((value) => { if (!cancelled) setDetail(value); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to read idea detail.'); });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function startOverseer() {
    if (!service || !window.confirm('Start Overseer?')) return;
    setBusy(true);
    try {
      await readJson('/api/intelligence-surfaces/overseer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'start:overseer', observedAt: service.checkedAt }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const unavailable = service && service.status !== 'ready';
  return <div className="view-shell overseer-focus-view" data-testid="overseer-focus-view">
    <header className="overseer-focus-hostbar"><div><p className="overseer-work-eyebrow">Overseer · Focus</p><h1>Focus</h1><p>One recommendation, active outcomes, and the next proof.</p></div><div className="overseer-focus-hostbar-actions"><span className="overseer-work-authority">Source-owned local authority</span><Button variant="secondary" onClick={() => void load()} loading={loading} loadingLabel="Refreshing…">Refresh</Button></div></header>
    {error ? <p className="overseer-work-error" role="alert">{error}</p> : null}
    {unavailable ? <Recovery service={service} busy={busy} onStart={() => void startOverseer()} /> : null}
    <div className="view-scroll overseer-focus-scroll"><main className="overseer-focus-content">{loading && !summary ? <p className="state-message">Reading Focus from Overseer…</p> : null}{summary ? <><Recommendation summary={summary} /><div className="overseer-focus-two-column"><ActiveOutcomes summary={summary} /><HorizonMap summary={summary} /></div><Ideas summary={summary} selectedId={selectedId} detail={detail} onSelect={setSelectedId} /><footer className="overseer-focus-footer"><span>Projection as of {formatWhen(summary.asOf)}</span><span>Evidence {stateLabel(summary.freshness.status)}{summary.freshness.latestObservationAt ? ` · observed ${formatWhen(summary.freshness.latestObservationAt)}` : ''}</span></footer></> : null}</main></div>
  </div>;
}
