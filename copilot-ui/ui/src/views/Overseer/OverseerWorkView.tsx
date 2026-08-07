import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '../../components';
import { setOverseerWorkShellState } from './overseerWorkStore';
import './overseerWork.css';

type WorkBucket = 'needs-you' | 'active' | 'history';
type WorkKind = 'task' | 'source-intake' | 'repository-analysis' | 'research-mandate' | 'system-review';
type WorkState = 'queued' | 'claimed' | 'running' | 'waiting-user' | 'waiting-external' | 'ready-for-review' | 'completed' | 'needs-attention' | 'cancelled';

interface WorkItem {
  id: string;
  title: string;
  summary: string;
  kind: string;
  bucket: WorkBucket;
  state: WorkState;
  stage: string;
  runner: { kind: 'hermes' | 'local'; label: string };
  privacy: 'hosted-redacted' | 'local-only' | 'public-safe';
  createdAt: string | null;
  updatedAt: string | null;
  currentMessage: string;
  availableActions: string[];
  safeError?: { code: string; message: string } | null;
}

interface TimelineEvent {
  stage: string;
  timestamp: string;
  actor: string;
  reasonCode: string;
  message: string;
}

interface WorkDetail extends WorkItem {
  timeline: TimelineEvent[];
  technicalDetails?: {
    actionId?: string | null;
    profileId?: string | null;
    requestedModel?: string | null;
    effectiveProvider?: string | null;
    effectiveModel?: string | null;
    attemptCount?: number;
    inputAvailable?: boolean;
    receiptAvailable?: boolean;
  };
}

interface WorkListResponse {
  items: WorkItem[];
  counts?: Partial<Record<WorkBucket, number>>;
}

interface OverseerStatus {
  id: string;
  status: 'ready' | 'starting' | 'stopped' | 'degraded' | 'unavailable' | 'prerequisite_missing';
  reasonCode?: string;
  description?: string;
  checkedAt?: string;
  prerequisites?: string[];
}

interface PreviewPayload {
  preview_id?: string;
  target_path?: string;
  content?: string;
  stale?: boolean;
  requires_confirmation?: boolean;
}

const TABS: Array<{ id: WorkBucket; label: string }> = [
  { id: 'needs-you', label: 'Needs you' },
  { id: 'active', label: 'Active' },
  { id: 'history', label: 'History' },
];

const KIND_LABELS: Record<WorkKind, string> = {
  task: 'Task',
  'source-intake': 'Source intake',
  'repository-analysis': 'Repository analysis',
  'research-mandate': 'Research mandate',
  'system-review': 'System review',
};

function toneForState(state: WorkState): 'neutral' | 'brand' | 'success' | 'danger' {
  if (state === 'needs-attention') return 'danger';
  if (state === 'ready-for-review') return 'brand';
  if (state === 'completed') return 'success';
  if (['claimed', 'running', 'waiting-external'].includes(state)) return 'brand';
  return 'neutral';
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null) as (T & { message?: string; error?: string; code?: string }) | null;
  if (!response.ok) {
    const error = new Error(typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.');
    (error as Error & { code?: string }).code = payload?.code;
    throw error;
  }
  return payload as T;
}

function groupTitle(bucket: WorkBucket, state: WorkState): string {
  if (bucket === 'history') return state === 'cancelled' ? 'Cancelled' : 'Completed';
  if (state === 'ready-for-review') return 'Needs review';
  if (state === 'waiting-user') return 'Waiting for you';
  if (state === 'needs-attention') return 'Needs attention';
  if (state === 'waiting-external') return 'Waiting external';
  return state === 'queued' ? 'Queued' : 'Running';
}

function groupItems(items: WorkItem[]): Array<{ title: string; items: WorkItem[] }> {
  const groups: Array<{ title: string; items: WorkItem[] }> = [];
  for (const item of items) {
    const title = groupTitle(item.bucket, item.state);
    const group = groups.find((candidate) => candidate.title === title);
    if (group) group.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return groups;
}

function WorkRow({ item, selected, onSelect, onRetry }: { item: WorkItem; selected: boolean; onSelect: () => void; onRetry: () => void }) {
  const isActive = ['queued', 'claimed', 'running', 'waiting-external'].includes(item.state);
  return (
    <li>
      <button
        type="button"
        className={`overseer-work-row${selected ? ' is-selected' : ''}`}
        onClick={onSelect}
        data-testid={`overseer-work-row-${item.id}`}
      >
        <span className={`overseer-work-row-marker marker-${toneForState(item.state)}`} aria-hidden="true">{isActive ? '↻' : item.state === 'needs-attention' ? '!' : item.state === 'completed' ? '✓' : '•'}</span>
        <span className="overseer-work-row-copy">
          <span className="overseer-work-row-title">{item.title}</span>
          <span className="overseer-work-row-meta">{item.runner.label} <span aria-hidden="true">·</span> {item.privacy === 'local-only' ? 'On this device' : item.privacy === 'public-safe' ? 'Public-safe' : 'Hosted-safe'}</span>
          <span className="overseer-work-row-summary">{item.currentMessage}</span>
        </span>
        <span className="overseer-work-row-status">
          <span>{item.state === 'running' ? 'Hermes working' : item.state === 'needs-attention' ? 'Needs attention' : item.state === 'ready-for-review' ? 'Ready for review' : item.state.replaceAll('-', ' ')}</span>
          <time dateTime={item.updatedAt || undefined}>{shortWhen(item.updatedAt)}</time>
          {item.state === 'needs-attention' && item.availableActions.includes('retry') ? <Button variant="secondary" size="sm" testId={`overseer-retry-${item.id}`} onClick={(event) => { event.stopPropagation(); onRetry(); }}>Retry</Button> : null}
        </span>
      </button>
    </li>
  );
}

function NewWorkDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (itemId?: string) => void }) {
  const [kind, setKind] = useState<WorkKind>('task');
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [doneWhen, setDoneWhen] = useState('');
  const [context, setContext] = useState('');
  const [project, setProject] = useState('');
  const [url, setUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [question, setQuestion] = useState('');
  const [systemId, setSystemId] = useState('overseer');
  const [privacy, setPrivacy] = useState<'hosted-safe' | 'local-only' | 'public-safe'>('hosted-safe');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (kind === 'source-intake' && file) {
        const response = await fetch('/api/overseer/work/v1/intake-file', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name, 'X-Mime-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        const payload = await response.json().catch(() => null) as { item?: WorkItem; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || 'Unable to intake this file.');
        onCreated(payload?.item?.id);
        return;
      }
      const body: Record<string, unknown> = { kind, privacy };
      if (kind === 'task') Object.assign(body, { title, outcome, done_when: doneWhen, context, project, sensitivity: undefined });
      if (kind === 'source-intake') Object.assign(body, { title: title || 'Source intake', url: url || undefined, text: sourceText || undefined });
      if (kind === 'repository-analysis') Object.assign(body, { repository_id: repositoryId });
      if (kind === 'research-mandate') Object.assign(body, { question });
      if (kind === 'system-review') Object.assign(body, { system_id: systemId });
      const payload = await readJson<{ item?: WorkItem }>('/api/overseer/work/v1/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onCreated(payload.item?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const isSource = kind === 'source-intake';
  const canSubmit = kind === 'task' ? Boolean(title.trim() && outcome.trim() && doneWhen.trim() && project.trim())
    : kind === 'source-intake' ? Boolean(file || url.trim() || sourceText.trim())
      : kind === 'repository-analysis' ? Boolean(repositoryId.trim())
        : kind === 'research-mandate' ? Boolean(question.trim()) : Boolean(systemId.trim());

  return (
    <div className="overseer-drawer-backdrop" onMouseDown={onClose}>
      <aside className="overseer-new-work-drawer" data-testid="overseer-new-work-drawer" role="dialog" aria-modal="true" aria-labelledby="overseer-new-work-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="overseer-drawer-header">
          <div><h2 id="overseer-new-work-title">New work</h2><p>Choose an outcome. Overseer will organize the details.</p></div>
          <Button variant="ghost" size="sm" aria-label="Close new work" onClick={onClose}>×</Button>
        </header>
        <div className="overseer-work-kind-tabs" role="tablist" aria-label="Work kind">
          {(Object.keys(KIND_LABELS) as WorkKind[]).map((candidate) => (
            <button key={candidate} type="button" role="tab" aria-selected={kind === candidate} className={kind === candidate ? 'is-selected' : ''} onClick={() => { setKind(candidate); setPrivacy(candidate === 'source-intake' ? 'public-safe' : 'hosted-safe'); }}>
              <span className="overseer-kind-icon" aria-hidden="true">{candidate === 'task' ? '✓' : candidate === 'source-intake' ? '◇' : candidate === 'repository-analysis' ? '▣' : candidate === 'research-mandate' ? '!' : '◈'}</span>
              {KIND_LABELS[candidate]}
            </button>
          ))}
        </div>
        <form className="overseer-new-work-form" onSubmit={submit}>
          {kind === 'task' ? <>
            <label>Title *<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short, recognizable name" /></label>
            <label>Outcome *<textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What should change?" rows={2} /></label>
            <label>Done when *<textarea value={doneWhen} onChange={(event) => setDoneWhen(event.target.value)} placeholder="How will you know it is complete?" rows={2} /></label>
            <label>Project or repository *<input value={project} onChange={(event) => setProject(event.target.value)} placeholder="Select a known project" /></label>
            <label>Context<textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Optional background or constraints" rows={2} /></label>
          </> : null}
          {isSource ? <>
            <label>Title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name this source" /></label>
            <label>Public URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
            <label>Or paste source text<textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste a bounded source excerpt" rows={5} /></label>
            <label>Or choose a file<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
            <p className="overseer-form-help">Public URL intake is explicitly public-safe. Local files stay on this device.</p>
          </> : null}
          {kind === 'repository-analysis' ? <label>Repository identifier *<input autoFocus value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} placeholder="Select a known repository" /></label> : null}
          {kind === 'research-mandate' ? <label>Research question *<textarea autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What decision should this research support?" rows={4} /></label> : null}
          {kind === 'system-review' ? <label>System to review *<input autoFocus value={systemId} onChange={(event) => setSystemId(event.target.value)} placeholder="overseer" /></label> : null}
          {!isSource ? <fieldset className="overseer-privacy-choice"><legend>Where can this run? *</legend>
            <label><input type="radio" checked={privacy === 'hosted-safe'} onChange={() => setPrivacy('hosted-safe')} /> <span><strong>Hosted-safe</strong><small>Uses Hermes for planning and execution.</small></span></label>
            <label><input type="radio" checked={privacy === 'local-only'} onChange={() => setPrivacy('local-only')} /> <span><strong>Keep on this device</strong><small>Uses deterministic local organization. Nothing is sent to Hermes.</small></span></label>
          </fieldset> : null}
          {error ? <p className="state-message state-error" role="alert">{error}</p> : null}
          <div className="overseer-drawer-footer"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!canSubmit || saving} loading={saving} loadingLabel="Creating…">Create {kind === 'task' ? 'task' : 'work'}</Button></div>
        </form>
      </aside>
    </div>
  );
}

function WorkDetailPanel({ detail, onAction, onAnswer, answer, setAnswer, preview, onConfirmPreview, onLoadPreview, busy }: {
  detail: WorkDetail | null;
  onAction: (action: string) => void;
  onAnswer: () => void;
  answer: string;
  setAnswer: (value: string) => void;
  preview: PreviewPayload | null;
  onConfirmPreview: () => void;
  onLoadPreview: () => void;
  busy: string | null;
}) {
  if (!detail) return <div className="overseer-detail-empty"><span className="overseer-detail-empty-mark">◇</span><h2>Select a work item</h2><p>Choose a row to see what Overseer is doing and what happens next.</p></div>;
  const isTodoReview = detail.kind === 'todo-create' && detail.state === 'ready-for-review';
  return (
    <section className="overseer-detail-panel" data-testid="overseer-work-detail">
      <header className="overseer-detail-header">
        <div><h2>{detail.title}</h2><div className="overseer-detail-meta"><span className={`overseer-runner runner-${detail.runner.kind}`}><span aria-hidden="true">◉</span>{detail.runner.label}</span><span aria-hidden="true">·</span><span>{detail.privacy === 'local-only' ? 'On this device' : detail.privacy === 'public-safe' ? 'Public-safe' : 'Hosted-safe'}</span></div></div>
        <div className="overseer-detail-actions">
          {detail.availableActions.includes('cancel') ? <Button variant="secondary" size="sm" onClick={() => onAction('cancel')} disabled={Boolean(busy)} loading={busy === 'cancel'} loadingLabel="Cancelling…">Cancel</Button> : null}
          {detail.availableActions.includes('review') && !isTodoReview ? <Button size="sm" onClick={() => onAction('review')} disabled={Boolean(busy)} loading={busy === 'review'} loadingLabel="Reviewing…">Review result</Button> : null}
          <details className="overseer-technical-details"><summary>View technical details</summary><dl><dt>Action</dt><dd>{detail.technicalDetails?.actionId || 'Available on request'}</dd><dt>Profile</dt><dd>{detail.technicalDetails?.profileId || '—'}</dd><dt>Attempts</dt><dd>{detail.technicalDetails?.attemptCount ?? 0}</dd></dl></details>
        </div>
      </header>
      <p className="overseer-detail-summary">{detail.summary}</p>
      {detail.safeError ? <div className="overseer-detail-error" role="alert"><strong>{detail.safeError.message}</strong><span>Reason: {detail.safeError.code.replaceAll('-', ' ')}</span>{detail.availableActions.includes('retry') ? <Button size="sm" onClick={() => onAction('retry')} disabled={Boolean(busy)} loading={busy === 'retry'} loadingLabel="Retrying…">Retry</Button> : null}</div> : null}
      {detail.state === 'waiting-user' ? <div className="overseer-answer-box"><label htmlFor="overseer-answer">Your answer</label><textarea id="overseer-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer the clarification so Hermes can continue…" rows={3} /><Button size="sm" disabled={!answer.trim() || Boolean(busy)} onClick={onAnswer} loading={busy === 'answer'} loadingLabel="Sending…">Send answer</Button></div> : null}
      {isTodoReview && !preview ? <div className="overseer-review-callout"><div><strong>Result ready for review</strong><p>Inspect the exact note preview before anything is written.</p></div><Button size="sm" onClick={onLoadPreview} loading={busy === 'preview'} loadingLabel="Preparing…">View preview</Button></div> : null}
      {preview ? <div className="overseer-preview-box"><div className="overseer-preview-heading"><div><strong>Exact write preview</strong><p>Nothing has been written. Confirm only if this is exactly right.</p></div><Badge tone={preview.stale ? 'danger' : 'brand'}>{preview.stale ? 'Refresh required' : 'Ready to confirm'}</Badge></div><p className="overseer-preview-target">Target: <span>{preview.target_path || 'Local task note'}</span></p><pre>{preview.content || 'No preview content returned.'}</pre><Button onClick={onConfirmPreview} disabled={Boolean(preview.stale) || Boolean(busy)} loading={busy === 'confirm'} loadingLabel="Confirming…">Confirm exact write</Button></div> : null}
      <div className="overseer-timeline"><h3>What happened</h3>{detail.timeline?.length ? <ol>{detail.timeline.map((event, index) => <li key={`${event.timestamp}-${event.stage}-${index}`} className={event.stage === detail.stage ? 'is-current' : ''}><span className="overseer-timeline-dot" aria-hidden="true">{event.stage === detail.stage ? '↻' : '✓'}</span><div><strong>{event.stage.replaceAll('-', ' ')}</strong><p>{event.message}</p><small>{event.actor} · {formatWhen(event.timestamp)}</small></div></li>)}</ol> : <p className="state-copy">Timeline details will appear as the work moves.</p>}</div>
      <footer className="overseer-detail-footer"><span>Created {formatWhen(detail.createdAt)}</span><span>Last updated {formatWhen(detail.updatedAt)}</span></footer>
    </section>
  );
}

export default function OverseerWorkView() {
  const [bucket, setBucket] = useState<WorkBucket>('needs-you');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [counts, setCounts] = useState<Partial<Record<WorkBucket, number>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [service, setService] = useState<OverseerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [workResult, serviceResult] = await Promise.allSettled([
      readJson<WorkListResponse>(`/api/overseer/work/v1/items?bucket=${bucket}`),
      readJson<OverseerStatus>('/api/intelligence-surfaces/overseer'),
    ]);
    if (serviceResult.status === 'fulfilled') {
      setService(serviceResult.value);
      const availability = serviceResult.value.status === 'ready' ? 'ready' : serviceResult.value.status === 'prerequisite_missing' ? 'unavailable' : serviceResult.value.status;
      setOverseerWorkShellState({ availability });
    } else {
      setService(null);
      setOverseerWorkShellState({ availability: 'unavailable' });
    }
    if (workResult.status === 'fulfilled') {
      setItems(workResult.value.items || []);
      setCounts(workResult.value.counts || {});
      setSelectedId((current) => current && workResult.value.items.some((item) => item.id === current) ? current : workResult.value.items[0]?.id || null);
      const attentionCount = Object.values(workResult.value.items || []).filter((item) => item.bucket === 'needs-you').length;
      setOverseerWorkShellState({ attentionCount });
    } else {
      setItems([]);
      setError(workResult.reason instanceof Error ? workResult.reason.message : 'Unable to read Work from Overseer.');
    }
    setLoading(false);
  }, [bucket]);

  useEffect(() => { void load(); }, [load]);

  const hasActiveWork = items.some((item) => item.bucket === 'active');
  useEffect(() => {
    const poll = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(poll, hasActiveWork ? 2000 : 10000);
    document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [load, hasActiveWork]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    void readJson<{ item: WorkDetail }>(`/api/overseer/work/v1/items/${encodeURIComponent(selectedId)}`).then((payload) => { if (!cancelled) setDetail(payload.item); }).catch(() => {
      if (!cancelled) setDetail(items.find((item) => item.id === selectedId) as WorkDetail || null);
    });
    return () => { cancelled = true; };
  }, [selectedId, items]);

  const groups = useMemo(() => groupItems(items), [items]);

  async function mutate(action: string, body: Record<string, unknown> = {}) {
    if (!selectedId) return;
    setBusy(action);
    setError(null);
    try {
      const result = await readJson<{ item: WorkDetail }>(`/api/overseer/work/v1/items/${encodeURIComponent(selectedId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setDetail(result.item);
      setPreview(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(null); }
  }

  async function loadPreview() {
    if (!selectedId) return;
    setBusy('preview');
    try {
      const result = await readJson<{ preview: PreviewPayload }>(`/api/overseer/work/v1/items/${encodeURIComponent(selectedId)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setPreview(result.preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }

  async function confirmPreview() {
    if (!selectedId || !preview?.preview_id) return;
    await mutate('confirm', { confirm: preview.preview_id });
  }

  async function startOverseer() {
    if (!service || !window.confirm('Start Overseer?')) return;
    setBusy('start');
    try {
      await readJson('/api/intelligence-surfaces/overseer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'start:overseer', observedAt: service.checkedAt }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }

  function handleCreated(id?: string) {
    setDrawerOpen(false);
    if (id) setSelectedId(id);
    void load();
  }

  const unavailable = service && service.status !== 'ready';

  return (
    <div className="view-shell overseer-work-view" data-testid="overseer-work-view">
      <header className="overseer-work-hostbar">
        <div><p className="overseer-work-eyebrow">Overseer</p><h1>Work</h1><p>Create, follow, and review</p></div>
        <div className="overseer-work-hostbar-actions"><span className="overseer-work-authority">Source-owned local authority</span><Button testId="overseer-new-work" onClick={() => setDrawerOpen(true)}>＋ New work</Button></div>
      </header>
      <nav className="overseer-work-tabs" aria-label="Work buckets" role="tablist">
        {TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={bucket === tab.id} className={bucket === tab.id ? 'is-selected' : ''} onClick={() => setBucket(tab.id)}>{tab.label}<span>{counts[tab.id] ?? 0}</span></button>)}
      </nav>
      {error ? <p className="overseer-work-error" role="alert">{error}</p> : null}
      {unavailable ? <section className="overseer-recovery" data-testid="overseer-recovery"><div><p className="overseer-work-eyebrow">Source-owned service</p><h2>Overseer is unavailable</h2><p>{service?.description || 'Elegy cannot read Work until the local Overseer service is ready.'}</p><span className="overseer-recovery-reason">{service?.reasonCode?.replaceAll('_', ' ') || 'connection unavailable'}</span></div><div><Button onClick={() => void startOverseer()} disabled={busy === 'start'} loading={busy === 'start'} loadingLabel="Starting…">Start Overseer</Button><p className="overseer-form-help">Elegy holds no Overseer token in the browser.</p></div></section> : null}
      <div className="view-scroll overseer-work-scroll">
        <div className="overseer-work-layout">
          <section className="overseer-work-queue" aria-label={`${bucket} work`}>
            {loading && !items.length ? <p className="state-message">Reading Work from Overseer…</p> : null}
            {!loading && !items.length ? <div className="overseer-empty"><span aria-hidden="true">◇</span><h2>{bucket === 'needs-you' ? 'Nothing needs you right now' : bucket === 'active' ? 'No active work' : 'No history yet'}</h2><p>{bucket === 'needs-you' ? 'New clarification questions and review-ready results will appear here.' : 'Create a work item to see its lifecycle here.'}</p><Button size="sm" onClick={() => setDrawerOpen(true)}>＋ New work</Button></div> : null}
            {groups.map((group) => <section className="overseer-work-group" key={group.title}><div className="overseer-work-group-heading"><h2>{group.title}</h2><span>{group.items.length}</span></div><ul>{group.items.map((item) => <WorkRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => { setSelectedId(item.id); setPreview(null); }} onRetry={() => { setSelectedId(item.id); void mutate('retry'); }} />)}</ul></section>)}
          </section>
          <WorkDetailPanel detail={detail} onAction={(action) => void mutate(action)} onAnswer={() => void mutate('answer', { answer })} answer={answer} setAnswer={setAnswer} preview={preview} onConfirmPreview={() => void confirmPreview()} onLoadPreview={() => void loadPreview()} busy={busy} />
        </div>
      </div>
      {drawerOpen ? <NewWorkDrawer onClose={() => setDrawerOpen(false)} onCreated={handleCreated} /> : null}
    </div>
  );
}
