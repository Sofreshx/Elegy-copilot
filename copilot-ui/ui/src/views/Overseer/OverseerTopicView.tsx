import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '../../components';
import './overseerTopic.css';

export type OverseerTopic = 'briefing' | 'projects' | 'knowledge' | 'tasks';
export type OverseerEntity = { kind: string; id?: string; name?: string; summary?: string; [key: string]: unknown };

type TopicAction = { key: string; label: string; description: string; operation: string | null; mode: 'queue' | 'navigate'; requires?: string[]; section?: string | null; enabled: boolean };
type TopicSnapshot = {
  topic: OverseerTopic;
  state: Record<string, any>;
  projection: Record<string, any>;
  actions: TopicAction[];
  freshness: { status: string; observedAt: string | null };
  source: { status: string; label: string };
};

const META: Record<OverseerTopic, { title: string; description: string }> = {
  briefing: { title: 'Briefing', description: 'A calm read of what matters now, what changed, and where an assistant can help.' },
  projects: { title: 'Projects', description: 'Repository facts, checkout context, pull requests, and analysis with its evidence window.' },
  knowledge: { title: 'Knowledge', description: 'What Overseer knows, how fresh it is, and which gaps still need evidence.' },
  tasks: { title: 'Tasks', description: 'Tasks as an operational queue: context, review pressure, and proposed cleanup.' },
};

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Overseer could not complete this request.');
  return payload as T;
}

function label(value: unknown): string { return String(value ?? 'not recorded').replaceAll('-', ' '); }
function when(value: unknown): string { if (!value) return 'Not recorded'; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function tone(value: unknown): 'neutral' | 'brand' | 'success' | 'danger' { const text = String(value ?? '').toLowerCase(); if (['fresh', 'ready', 'active', 'clean'].includes(text)) return 'success'; if (['running', 'queued', 'aging'].includes(text)) return 'brand'; if (['stale', 'missing', 'unavailable', 'blocked', 'dirty', 'needs-attention'].includes(text)) return 'danger'; return 'neutral'; }
function count(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }

function Metric({ value, label: metricLabel, tone: metricTone = 'neutral' }: { value: string | number; label: string; tone?: 'neutral' | 'brand' | 'success' | 'danger' }) {
  const badgeLabel = metricTone === 'danger' ? 'review' : metricTone === 'brand' ? 'active' : metricTone === 'success' ? 'healthy' : 'observed';
  return <div className="overseer-topic-metric"><strong>{value}</strong><span>{metricLabel}</span><Badge tone={metricTone}>{badgeLabel}</Badge></div>;
}

function Recovery({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section className="overseer-topic-recovery" role="alert" data-testid="overseer-topic-recovery"><div><p className="overseer-topic-eyebrow">Local authority unavailable</p><h2>Overseer needs attention</h2><p>{error}</p><small>Elegy never receives the Overseer session token. Start or recover the local service, then refresh.</small></div><Button onClick={onRetry}>Try again</Button></section>;
}

function BriefingContent({ snapshot, onAction, onSelectEntity }: { snapshot: TopicSnapshot; onAction: (action: TopicAction) => void; onSelectEntity?: (entity: OverseerEntity) => void }) {
  const recommendation = snapshot.projection.recommendation;
  const projects = snapshot.state.activeProjects ?? [];
  const concerns = snapshot.projection.rankedConcerns ?? [];
  const needsYou = snapshot.state.needsYou ?? [];
  return <>
    <section className="overseer-topic-hero"><div><p className="overseer-topic-eyebrow">Projection · one clear next move</p><h2>{recommendation?.title ?? 'No current recommendation yet.'}</h2><p>{recommendation?.summary ?? 'Overseer is still gathering enough evidence to make a recommendation.'}</p></div><div className="overseer-topic-hero-next"><span>Next action</span><strong>{recommendation?.nextAction ?? 'Review the evidence gaps.'}</strong><small>Confidence: {label(snapshot.projection.confidence)}</small></div></section>
    <div className="overseer-topic-metrics"><Metric value={projects.length} label="active projects" tone="brand" /><Metric value={count(snapshot.state.taskPressure?.open)} label="open tasks" tone={count(snapshot.state.taskPressure?.needsReview) ? 'danger' : 'success'} /><Metric value={snapshot.state.activeRuns?.length ?? 0} label="active runs" tone="brand" /><Metric value={needsYou.length} label="needs you" tone={needsYou.length ? 'danger' : 'success'} /></div>
    <div className="overseer-topic-grid">
      <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">State · observed work</p><h3>What is moving</h3></div><Badge tone="brand">{projects.length} projects</Badge></header>{projects.length ? <div className="overseer-topic-list">{projects.map((item: any) => <article className={onSelectEntity ? 'overseer-topic-entity-row' : undefined} key={item.id} role={onSelectEntity ? 'button' : undefined} tabIndex={onSelectEntity ? 0 : undefined} onClick={onSelectEntity ? () => onSelectEntity({ kind: 'project', id: item.id, name: item.name, summary: item.blocker ?? item.summary, state: item.state }) : undefined} onKeyDown={onSelectEntity ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEntity({ kind: 'project', id: item.id, name: item.name, summary: item.blocker ?? item.summary, state: item.state }); } } : undefined}><div><strong>{item.name}</strong><Badge tone={tone(item.state)}>{label(item.state)}</Badge></div><p>{item.blocker ?? item.summary}</p></article>)}</div> : <p className="overseer-topic-empty">No active project outcomes are recorded.</p>}</section>
      <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Projection · ranked concern</p><h3>What deserves attention</h3></div><Badge tone={concerns.length ? 'danger' : 'success'}>{concerns.length}</Badge></header>{concerns.length ? <div className="overseer-topic-list">{concerns.map((item: any) => <article key={item.id}><div><strong>{item.reason}</strong><Badge tone={tone(item.severity)}>{label(item.severity)}</Badge></div></article>)}</div> : <p className="overseer-topic-empty">No ranked concerns are currently projected.</p>}</section>
    </div>
    <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Actions · bounded operations</p><h3>What you can ask Overseer to do</h3></div></header><div className="overseer-topic-actions">{snapshot.actions.map((item) => <button type="button" key={item.key} disabled={!item.enabled} onClick={() => onAction(item)}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div></section>
  </>;
}

function ProjectsContent({ snapshot, onAction, onSelectEntity }: { snapshot: TopicSnapshot; onAction: (action: TopicAction) => void; onSelectEntity?: (entity: OverseerEntity) => void }) {
  const repositories = snapshot.state.repositories ?? [];
  const changes = snapshot.state.changes ?? [];
  return <>
    <div className="overseer-topic-metrics"><Metric value={repositories.length} label="known repositories" tone="brand" /><Metric value={snapshot.state.checkedOutContext ?? 0} label="with checkout context" tone="success" /><Metric value={(snapshot.state.pullRequestStatus ?? []).length} label="PR observations" tone="neutral" /><Metric value={changes.length} label="recent observations" tone={changes.length ? 'brand' : 'neutral'} /></div>
    <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">State · repository facts</p><h3>Repositories</h3><p>Each row says what was observed, when, and how much context is available.</p></div><Badge tone={tone(snapshot.freshness.status)}>{label(snapshot.freshness.status)}</Badge></header>{repositories.length ? <div className="overseer-project-list">{repositories.map((item: any) => <article className={onSelectEntity ? 'overseer-topic-entity-row' : undefined} key={item.id} role={onSelectEntity ? 'button' : undefined} tabIndex={onSelectEntity ? 0 : undefined} onClick={onSelectEntity ? () => onSelectEntity({ kind: 'repository', id: item.id, name: item.name, summary: item.latestAnalysis, state: item.state, branch: item.branch }) : undefined} onKeyDown={onSelectEntity ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEntity({ kind: 'repository', id: item.id, name: item.name, summary: item.latestAnalysis, state: item.state, branch: item.branch }); } } : undefined}><div className="overseer-project-title"><div><strong>{item.name}</strong><span>{item.scope} · observed {when(item.observedAt)}</span></div><Badge tone={tone(item.state)}>{label(item.state)}</Badge></div><div className="overseer-project-facts"><span>Branch <b>{item.branch}</b></span><span>Checkout <b>{label(item.dirty)}</b></span><span>Ahead/behind <b>{item.aheadBehind}</b></span><span>PRs <b>{item.pullRequestObservation === 'observed' ? `${item.pullRequests?.length ?? 0} observed` : 'not observed'}</b></span></div><p>{item.latestAnalysis}</p>{item.recentCommits?.length ? <small>Recent commits: {item.recentCommits.slice(0, 3).map((commit: any) => commit.subject).join(' · ')}</small> : null}{item.risks?.length ? <small>Risks: {item.risks.join(' · ')}</small> : null}</article>)}</div> : <p className="overseer-topic-empty">No repository observations are available yet.</p>}</section>
    <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">State · context window</p><h3>What changed recently</h3><p>These are observations, not an automatic story. The time, evidence basis, branch context, and analysis age stay visible.</p></div></header>{changes.length ? <div className="overseer-topic-list">{changes.map((item: any, index: number) => <article key={`${item.title}-${index}`}><strong>{item.title}</strong><p>{item.summary}</p><small>{item.evidenceBasis} · {item.context} · observed {when(item.observedAt)} · analysis {item.analysisAge}</small></article>)}</div> : <p className="overseer-topic-empty">No recent repository analysis is recorded.</p>}</section>
    <TopicActions actions={snapshot.actions} onAction={onAction} />
  </>;
}

function KnowledgeContent({ snapshot, onAction }: { snapshot: TopicSnapshot; onAction: (action: TopicAction) => void }) {
  const gaps = snapshot.state.gaps ?? [];
  return <>
    <div className="overseer-topic-metrics"><Metric value={count(snapshot.state.governedSources)} label="governed sources" tone="brand" /><Metric value={count(snapshot.state.records)} label="visible records" tone="success" /><Metric value={count(snapshot.state.relationships)} label="relationships" tone="neutral" /><Metric value={gaps.length} label="coverage gaps" tone={gaps.length ? 'danger' : 'success'} /></div>
    <div className="overseer-topic-grid"><section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">State · governed knowledge</p><h3>What Overseer knows</h3></div><Badge tone={tone(snapshot.state.search?.status)}>{label(snapshot.state.search?.status)}</Badge></header><dl className="overseer-topic-facts"><div><dt>Search</dt><dd>{snapshot.state.search?.total ?? 0} results{snapshot.state.search?.query ? ` for “${snapshot.state.search.query}”` : ''}</dd></div><div><dt>Repositories</dt><dd>{snapshot.state.repositories?.length ?? 0} repository signals</dd></div><div><dt>Freshness</dt><dd>{label(snapshot.freshness.status)} · observed {when(snapshot.freshness.observedAt)}</dd></div></dl></section><section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Projection · deterministic gaps</p><h3>Where coverage is thin</h3></div><Badge tone={gaps.length ? 'danger' : 'success'}>{gaps.length}</Badge></header>{gaps.length ? <div className="overseer-topic-list">{gaps.map((gap: any) => <article key={gap.code}><strong>{gap.label}</strong><p>{gap.reason}</p></article>)}</div> : <p className="overseer-topic-empty">No deterministic coverage gaps are currently visible.</p>}</section></div>
    <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Projection · assistant interpretation</p><h3>What this may mean</h3></div><Badge tone="neutral">Interpretation</Badge></header><p>{snapshot.projection.interpretation}</p>{snapshot.projection.missingCoverage?.length ? <small>Interpretation is bounded by: {snapshot.projection.missingCoverage.join(' · ')}</small> : null}</section>
    <TopicActions actions={snapshot.actions} onAction={onAction} />
  </>;
}

function TasksContent({ snapshot, onAction, onSelectEntity }: { snapshot: TopicSnapshot; onAction: (action: TopicAction) => void; onSelectEntity?: (entity: OverseerEntity) => void }) {
  const items = snapshot.state.items ?? [];
  const recommendations = snapshot.projection.cleanupRecommendations ?? [];
  return <>
    <div className="overseer-topic-metrics"><Metric value={count(snapshot.state.openCount)} label="open tasks" tone="brand" /><Metric value={count(snapshot.state.needsReviewCount)} label="review warnings" tone={recommendations.length ? 'danger' : 'success'} /><Metric value={count(snapshot.state.legacyMigration?.pending)} label="legacy rows" tone={snapshot.state.legacyMigration?.pending ? 'danger' : 'success'} /><Metric value={snapshot.state.lanes?.length ?? 0} label="lanes" tone="neutral" /></div>
    <div className="overseer-topic-grid"><section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">State · task records</p><h3>Current tasks</h3></div><Badge tone="brand">{items.length}</Badge></header>{items.length ? <div className="overseer-topic-list">{items.slice(0, 12).map((item: any) => <article className={onSelectEntity ? 'overseer-topic-entity-row' : undefined} key={item.id} role={onSelectEntity ? 'button' : undefined} tabIndex={onSelectEntity ? 0 : undefined} onClick={onSelectEntity ? () => onSelectEntity({ kind: 'task', id: item.id, name: item.title, summary: item.description ?? item.title, status: item.status }) : undefined} onKeyDown={onSelectEntity ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEntity({ kind: 'task', id: item.id, name: item.title, summary: item.description ?? item.title, status: item.status }); } } : undefined}><div><strong>{item.title}</strong><Badge tone={tone(item.status)}>{label(item.status)}</Badge></div><p>{item.projects?.length ? `Linked to ${item.projects.join(', ')}` : 'Missing project context.'}</p></article>)}</div> : <p className="overseer-topic-empty">No indexed task notes are available.</p>}</section><section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Projection · cleanup candidates</p><h3>What may need a decision</h3></div><Badge tone={recommendations.length ? 'danger' : 'success'}>{recommendations.length}</Badge></header>{recommendations.length ? <div className="overseer-topic-list">{recommendations.slice(0, 8).map((item: any, index: number) => <article key={`${item.todoId}-${index}`}><strong>{item.message}</strong><small>{item.todoId ?? 'task record'} · {label(item.code)}</small></article>)}</div> : <p className="overseer-topic-empty">No task review warnings are projected.</p>}</section></div>
    <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Advanced operation</p><h3>Legacy migration</h3><p>Moved here because it changes task records, not runtime health. Originals remain preserved.</p></div><Badge tone={snapshot.state.legacyMigration?.pending ? 'danger' : 'success'}>{snapshot.state.legacyMigration?.pending ?? 0} pending</Badge></header><p>{snapshot.state.legacyMigration?.batches ?? 0} bounded batches · {snapshot.state.legacyMigration?.accepted ?? 0} accepted mappings.</p><details><summary>Why this is here</summary><p>Migration is an actionable task operation. It only becomes a canonical write after review and exact confirmation.</p></details></section>
    <TopicActions actions={snapshot.actions} onAction={onAction} />
  </>;
}

function TopicActions({ actions, onAction }: { actions: TopicAction[]; onAction: (action: TopicAction) => void }) {
  return <section className="overseer-topic-card"><header><div><p className="overseer-topic-eyebrow">Actions · explicit only</p><h3>Available operations</h3></div></header><div className="overseer-topic-actions">{actions.map((item) => <button type="button" key={item.key} disabled={!item.enabled} onClick={() => onAction(item)}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div></section>;
}

export default function OverseerTopicView({ topic, onAction, onSelectEntity }: { topic: OverseerTopic; onAction?: (action: TopicAction) => void; onSelectEntity?: (entity: OverseerEntity) => void }) {
  const [snapshot, setSnapshot] = useState<TopicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const meta = META[topic];
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await readJson<TopicSnapshot>(`/api/overseer/${topic}/v1/summary`)); }
    catch (cause) { setSnapshot(null); setError(cause instanceof Error ? cause.message : 'Overseer is unavailable.'); }
    finally { setLoading(false); }
  }, [topic]);
  useEffect(() => { void load(); }, [load]);
  const dispatchAction = useCallback((action: TopicAction) => {
    if (onAction) onAction(action);
    else window.dispatchEvent(new CustomEvent('overseer:action', { detail: action }));
  }, [onAction]);
  const content = useMemo(() => {
    if (!snapshot) return null;
    if (topic === 'briefing') return <BriefingContent snapshot={snapshot} onAction={dispatchAction} onSelectEntity={onSelectEntity} />;
    if (topic === 'projects') return <ProjectsContent snapshot={snapshot} onAction={dispatchAction} onSelectEntity={onSelectEntity} />;
    if (topic === 'knowledge') return <KnowledgeContent snapshot={snapshot} onAction={dispatchAction} />;
    return <TasksContent snapshot={snapshot} onAction={dispatchAction} onSelectEntity={onSelectEntity} />;
  }, [dispatchAction, onSelectEntity, snapshot, topic]);
  return <div className="view-shell overseer-topic-view" data-testid={`overseer-${topic}-view`}><header className="overseer-topic-header"><div><p className="overseer-topic-eyebrow">Overseer · {meta.title}</p><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="overseer-topic-header-actions"><span className="overseer-topic-authority"><i aria-hidden="true" /> Local authority</span><Button variant="secondary" onClick={() => void load()} loading={loading} loadingLabel="Refreshing…">Refresh</Button></div></header><div className="overseer-topic-scroll"><main className="overseer-topic-content">{error ? <Recovery error={error} onRetry={() => void load()} /> : null}{loading && !snapshot ? <p className="state-message">Reading {meta.title} from Overseer…</p> : null}{content}{snapshot ? <footer className="overseer-topic-footer"><span>State observed {when(snapshot.freshness.observedAt)}</span><span>Source {snapshot.source.label}</span><span>Freshness <Badge tone={tone(snapshot.freshness.status)}>{label(snapshot.freshness.status)}</Badge></span></footer> : null}</main></div></div>;
}
