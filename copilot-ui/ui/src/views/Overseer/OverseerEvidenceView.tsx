import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '../../components';
import { setOverseerWorkShellState } from './overseerWorkStore';
import './overseerEvidence.css';

type EvidenceFreshness = 'fresh' | 'aging' | 'stale' | 'missing' | string;

interface EvidenceSearchResult {
  title: string;
  snippet: string;
  kind: string;
  score: number | null;
  freshness: string | null;
  technical: { id: string | null; subjectId: string | null };
}

interface EvidenceNode {
  label: string;
  kind: string;
  status: string;
  summary: string;
  scope: string;
  reviewState: string;
  freshness: string | null;
  technical: { id: string | null };
}

interface EvidenceEdge {
  from: string;
  relation: string;
  to: string;
  rationale: string;
  technical: { from: string | null; to: string | null };
}

interface EvidenceSummary {
  format: string;
  asOf: string | null;
  query: string | null;
  search: { status: string; mode: string; total: number; results: EvidenceSearchResult[] };
  graph: { focus: string | null; depth: number; nodes: EvidenceNode[]; edges: EvidenceEdge[] };
  repositories: { status: string; items: Array<{ label: string; state: string; scope: string; summary: string; nextActions: string[]; updatedAt: string | null; technical: { id: string | null } }> };
}

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

function stateLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function toneForState(value: string): 'neutral' | 'brand' | 'success' | 'danger' {
  if (['failed', 'needs-attention', 'stale', 'unavailable'].includes(value)) return 'danger';
  if (['completed', 'active', 'ready'].includes(value)) return 'success';
  if (['queued', 'running', 'fresh'].includes(value)) return 'brand';
  return 'neutral';
}

function Recovery({ service, busy, onStart }: { service: OverseerStatus | null; busy: boolean; onStart: () => void }) {
  return (
    <section className="overseer-recovery" data-testid="overseer-evidence-recovery">
      <div><p className="overseer-work-eyebrow">Source-owned service</p><h2>Overseer is unavailable</h2><p>{service?.description || 'Elegy cannot read Evidence until the local Overseer service is ready.'}</p><span className="overseer-recovery-reason">{service?.reasonCode?.replaceAll('_', ' ') || 'connection unavailable'}</span></div>
      <div><Button onClick={onStart} disabled={busy} loading={busy} loadingLabel="Starting…">Start Overseer</Button><p className="overseer-form-help">Elegy holds no Overseer token in the browser.</p></div>
    </section>
  );
}

function SearchPanel({ query, onQueryChange, onSubmit, loading }: { query: string; onQueryChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; loading: boolean }) {
  return (
    <section className="overseer-evidence-search-panel" data-testid="overseer-evidence-search">
      <div className="overseer-evidence-section-heading"><div><p className="overseer-work-eyebrow">Knowledge search</p><h2>Find the proof behind a decision</h2><p>Search local knowledge, then follow its relationships and repository signals.</p></div><Badge tone="brand">Shared, redacted</Badge></div>
      <form className="overseer-evidence-search-form" onSubmit={onSubmit}>
        <label htmlFor="overseer-evidence-query">Search notes, decisions, and repository evidence</label>
        <div><input id="overseer-evidence-query" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Try “ReplyGuard” or “evidence gate”" autoComplete="off" /><Button type="submit" loading={loading} loadingLabel="Searching…">Search</Button></div>
        <p className="overseer-form-help">Search stays on the local Overseer index. Source intake starts from New Work.</p>
      </form>
    </section>
  );
}

function SearchResults({ summary, selectedSubjectId, onFocus }: { summary: EvidenceSummary; selectedSubjectId: string | null; onFocus: (result: EvidenceSearchResult) => void }) {
  const { search } = summary;
  return (
    <section className="overseer-evidence-card" data-testid="overseer-evidence-results">
      <div className="overseer-evidence-section-heading"><div><p className="overseer-work-eyebrow">Knowledge</p><h2>Search results</h2></div><span className="overseer-evidence-count">{search.total}</span></div>
      {search.status === 'unavailable' ? <p className="overseer-evidence-state">The local search index is unavailable. Relationship context and repository signals are still shown below.</p> : null}
      {search.status === 'idle' ? <p className="overseer-evidence-state">Search for a phrase to see the supporting notes and decisions.</p> : null}
      {search.status === 'ready' && !search.results.length ? <p className="overseer-evidence-state">No matching evidence was found. Try a broader phrase.</p> : null}
      <div className="overseer-evidence-result-list">
        {search.results.map((result) => {
          const selected = Boolean(selectedSubjectId && result.technical.subjectId === selectedSubjectId);
          return <article className={`overseer-evidence-result${selected ? ' is-selected' : ''}`} key={result.technical.id || result.title}>
            <div className="overseer-evidence-result-head"><div><strong>{result.title}</strong><span>{stateLabel(result.kind)}</span></div>{result.technical.subjectId ? <button type="button" className="overseer-evidence-link" onClick={() => onFocus(result)}>{selected ? 'Focused' : 'Show context'}</button> : null}</div>
            <p>{result.snippet}</p>
            <footer><span>{result.freshness ? `Observed ${formatWhen(result.freshness)}` : 'Observation date not recorded'}</span></footer>
          </article>;
        })}
      </div>
    </section>
  );
}

function RelationshipContext({ summary }: { summary: EvidenceSummary }) {
  const visibleNodes = summary.graph.nodes.slice(0, 10);
  return (
    <section className="overseer-evidence-card" data-testid="overseer-evidence-graph">
      <div className="overseer-evidence-section-heading"><div><p className="overseer-work-eyebrow">Relationship context</p><h2>{summary.graph.focus ? 'Focused evidence' : 'Portfolio graph'}</h2></div><span className="overseer-evidence-count">{summary.graph.nodes.length}</span></div>
      <p className="overseer-evidence-card-copy">Relationships are descriptive context, not automatic writes.</p>
      <div className="overseer-evidence-node-list">{visibleNodes.length ? visibleNodes.map((node) => <div className="overseer-evidence-node" key={node.technical.id || node.label}><span className="overseer-evidence-node-mark" aria-hidden="true">{node.kind.slice(0, 1).toUpperCase()}</span><div><strong>{node.label}</strong><span>{stateLabel(node.kind)} · {stateLabel(node.status)}</span><p>{node.summary}</p></div></div>) : <p className="overseer-evidence-state">No graph context is recorded.</p>}</div>
      {summary.graph.edges.length ? <details className="overseer-evidence-edges"><summary>{summary.graph.edges.length} recorded relationships</summary><ul>{summary.graph.edges.slice(0, 8).map((edge, index) => <li key={`${edge.technical.from}-${edge.technical.to}-${index}`}><strong>{edge.from}</strong> <span>{edge.relation}</span> <strong>{edge.to}</strong><small>{edge.rationale}</small></li>)}</ul></details> : null}
    </section>
  );
}

function RepositorySignals({ summary }: { summary: EvidenceSummary }) {
  const visibleItems = summary.repositories.items.slice(0, 6);
  return (
    <section className="overseer-evidence-card overseer-evidence-repositories" data-testid="overseer-evidence-repositories">
      <div className="overseer-evidence-section-heading"><div><p className="overseer-work-eyebrow">Repository intelligence</p><h2>What changed recently</h2></div><span className="overseer-evidence-count">{summary.repositories.items.length}</span></div>
      <p className="overseer-evidence-card-copy">Hermes analyses are shown as reviewable signals. They do not update canonical knowledge here.</p>
      <div className="overseer-evidence-repository-list">{visibleItems.length ? visibleItems.map((item) => <article className="overseer-evidence-repository" key={item.technical.id || item.label}><div><strong>{item.label}</strong><span>{stateLabel(item.scope)} · {stateLabel(item.state)}</span></div><Badge tone={toneForState(item.state)}>{stateLabel(item.state)}</Badge><p>{item.summary}</p><footer>{item.nextActions.length ? <span>Next: {item.nextActions[0]}</span> : <span>No next action recorded</span>}{item.updatedAt ? <span>{formatWhen(item.updatedAt)}</span> : null}</footer></article>) : <p className="overseer-evidence-state">No repository intelligence is recorded yet.</p>}</div>
      {summary.repositories.items.length > visibleItems.length ? <p className="overseer-form-help">Showing the latest {visibleItems.length} of {summary.repositories.items.length} repository signals.</p> : null}
    </section>
  );
}

export default function OverseerEvidenceView() {
  const [summary, setSummary] = useState<EvidenceSummary | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [service, setService] = useState<OverseerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (requestedQuery = '', focus: string | null = null) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ mode: 'hybrid' });
    if (requestedQuery.trim()) params.set('q', requestedQuery.trim());
    if (focus) params.set('focus', focus);
    const [evidenceResult, serviceResult] = await Promise.allSettled([
      readJson<EvidenceSummary>(`/api/overseer/evidence/v1/summary?${params.toString()}`),
      readJson<OverseerStatus>('/api/intelligence-surfaces/overseer'),
    ]);
    if (serviceResult.status === 'fulfilled') {
      setService(serviceResult.value);
      setOverseerWorkShellState({ availability: serviceResult.value.status === 'ready' ? 'ready' : serviceResult.value.status === 'prerequisite_missing' ? 'unavailable' : serviceResult.value.status });
    } else {
      setService(null);
      setOverseerWorkShellState({ availability: 'unavailable' });
    }
    if (evidenceResult.status === 'fulfilled') setSummary(evidenceResult.value);
    else {
      setSummary(null);
      setError(evidenceResult.reason instanceof Error ? evidenceResult.reason.message : 'Unable to read Evidence from Overseer.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function startOverseer() {
    if (!service || !window.confirm('Start Overseer?')) return;
    setBusy(true);
    try {
      await readJson('/api/intelligence-surfaces/overseer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'start:overseer', observedAt: service.checkedAt }) });
      await load(submittedQuery, selectedSubjectId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    setSubmittedQuery(next);
    setSelectedSubjectId(null);
    void load(next);
  }

  function focusResult(result: EvidenceSearchResult) {
    const subjectId = result.technical.subjectId;
    if (!subjectId) return;
    setSelectedSubjectId(subjectId);
    void load(submittedQuery, subjectId);
  }

  const unavailable = service && service.status !== 'ready';
  return <div className="view-shell overseer-evidence-view" data-testid="overseer-evidence-view">
    <header className="overseer-evidence-hostbar"><div><p className="overseer-work-eyebrow">Overseer · Evidence</p><h1>Evidence</h1><p>Search the proof, see its relationships, and understand what Hermes observed.</p></div><div className="overseer-evidence-hostbar-actions"><span className="overseer-work-authority">Source-owned local authority</span><Button variant="secondary" onClick={() => void load(submittedQuery, selectedSubjectId)} loading={loading} loadingLabel="Refreshing…">Refresh</Button></div></header>
    {error ? <p className="overseer-work-error" role="alert">{error}</p> : null}
    {unavailable ? <Recovery service={service} busy={busy} onStart={() => void startOverseer()} /> : null}
    <div className="view-scroll overseer-evidence-scroll"><main className="overseer-evidence-content"><SearchPanel query={query} onQueryChange={setQuery} onSubmit={submit} loading={loading} />{loading && !summary ? <p className="state-message">Reading Evidence from Overseer…</p> : null}{summary ? <><div className="overseer-evidence-two-column"><SearchResults summary={summary} selectedSubjectId={selectedSubjectId} onFocus={focusResult} /><RelationshipContext summary={summary} /></div><RepositorySignals summary={summary} /><footer className="overseer-evidence-footer"><span>Projection as of {formatWhen(summary.asOf)}</span><span>{summary.repositories.items.length} repository signals · graph depth {summary.graph.depth}</span></footer></> : null}</main></div>
  </div>;
}
