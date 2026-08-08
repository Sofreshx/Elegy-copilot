import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '../../components';
import './overseerCompanion.css';

type ChatMessage = {
  id: string; role: 'user' | 'assistant'; text: string; topic?: string; mentions?: string[];
  memory?: { decision?: string; reason?: string; written?: boolean } | null;
  requestedOperation?: { kind: string; label: string; state: string; queued?: boolean; runId?: string } | null;
  unavailable?: boolean; reasonCode?: string | null; recovery?: string | null;
};
type Conversation = { id: string; topic: string; state: string; createdAt: string; updatedAt: string; turnCount?: number; selectedEntity?: SelectedEntity | null };
type Run = { id: string; title: string; operationLabel: string; state: string; bucket: string; currentMessage: string; updatedAt: string | null; result?: unknown; clarificationQuestions?: string[] };
type SelectedEntity = { kind: string; id?: string; name?: string; summary?: string; [key: string]: unknown };
type TopicAction = { key: string; label: string; description: string; operation: string | null; mode: 'queue' | 'navigate'; requires?: string[]; section?: string | null };
type CompanionProps = {
  topic: string; open: boolean; onClose: () => void; initialPrompt?: string | null; onPromptConsumed?: () => void;
  selectedEntity?: SelectedEntity | null; pendingAction?: TopicAction | null; onActionConsumed?: () => void; onNavigate?: (section: string) => void;
};

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : 'Overseer could not complete this request.');
  return payload as T;
}
function mentionsFor(message: string): string[] { return [...new Set([...message.matchAll(/@([a-z][a-z0-9_-]{1,39}(?:\/[a-z0-9._:-]{1,80})?)/gi)].map((match) => match[1].toLowerCase()))].slice(0, 12); }
function when(value: string | null | undefined): string { if (!value) return 'not recorded'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function tone(value: string): 'neutral' | 'brand' | 'success' | 'danger' { if (['waiting-user', 'ready-for-review', 'needs-attention'].includes(value)) return 'danger'; if (value === 'completed') return 'success'; if (['queued', 'claimed', 'running', 'waiting-external'].includes(value)) return 'brand'; return 'neutral'; }
function operationIdempotencyKey(actionKey: string): string { return `elegy-work:${actionKey}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`; }

export default function OverseerCompanionChat({ topic, open, onClose, initialPrompt = null, onPromptConsumed, selectedEntity = null, pendingAction = null, onActionConsumed, onNavigate }: CompanionProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<'chat' | 'active' | 'recent'>('chat');
  const [draft, setDraft] = useState('');
  const [operationRequest, setOperationRequest] = useState('');
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const next = await readJson<{ items?: Run[] }>('/api/overseer/runs/v1/items?limit=30');
    setRuns(next.items ?? []);
  }, []);
  const loadConversation = useCallback(async (id: string) => {
    const result = await readJson<{ conversation: Conversation; turns?: ChatMessage[] }>(`/api/overseer/chat/v1/conversations/${encodeURIComponent(id)}`);
    setConversationId(result.conversation.id);
    setMessages(result.turns ?? []);
  }, []);
  const loadConversations = useCallback(async (resume = true) => {
    const result = await readJson<{ items?: Conversation[] }>('/api/overseer/chat/v1/conversations?limit=30');
    const items = result.items ?? [];
    setConversations(items);
    if (resume && !conversationId && items[0]) await loadConversation(items[0].id);
  }, [conversationId, loadConversation]);
  const loadRunDetail = useCallback(async (id: string) => {
    const result = await readJson<{ item: Run }>(`/api/overseer/runs/v1/items/${encodeURIComponent(id)}`);
    setSelectedRun(result.item);
  }, []);
  const openRun = useCallback((id?: string) => {
    if (!id) return;
    setTab('active');
    void loadRuns();
    void loadRunDetail(id).catch((cause) => setError(cause instanceof Error ? cause.message : 'The Run could not be opened.'));
  }, [loadRunDetail, loadRuns]);
  const createConversation = useCallback(async () => {
    setStarting(true); setError(null);
    try {
      const result = await readJson<{ conversation: Conversation }>('/api/overseer/chat/v1/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, selectedEntity }),
      });
      setConversationId(result.conversation.id);
      setMessages([]);
      setConversations((current) => [result.conversation, ...current.filter((item) => item.id !== result.conversation.id)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The companion is unavailable.'); }
    finally { setStarting(false); }
  }, [selectedEntity, topic]);

  useEffect(() => {
    if (!open) return;
    void loadConversations().catch((cause) => setError(cause instanceof Error ? cause.message : 'The companion is unavailable.'));
    void loadRuns().catch(() => undefined);
  }, [loadConversations, loadRuns, open]);
  useEffect(() => { if (open && initialPrompt) { setDraft(initialPrompt); onPromptConsumed?.(); } }, [initialPrompt, onPromptConsumed, open]);
  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.mode === 'navigate' && pendingAction.section) { onNavigate?.(pendingAction.section); onActionConsumed?.(); return; }
    setTab('chat'); setOperationRequest(''); setOperationKey(operationIdempotencyKey(pendingAction.key));
  }, [onActionConsumed, onNavigate, pendingAction]);
  useEffect(() => {
    if (!open || tab !== 'active') return undefined;
    const timer = window.setInterval(() => { void loadRuns().catch(() => undefined); }, runs.some((item) => item.bucket === 'active') ? 2_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [loadRuns, open, runs, tab]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || !conversationId || sending) return;
    const mentions = mentionsFor(message);
    setDraft(''); setSending(true); setError(null);
    setMessages((current) => [...current, { id: `local:${Date.now()}`, role: 'user', text: message, topic, mentions }]);
    try {
      const result = await readJson<{ turn: ChatMessage }>(`/api/overseer/chat/v1/conversations/${encodeURIComponent(conversationId)}/turns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, topic, mentions, selectedEntity }),
      });
      setMessages((current) => [...current, result.turn]);
      void loadConversations(false); void loadRuns();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The companion could not answer.'); }
    finally { setSending(false); }
  }, [conversationId, draft, loadConversations, loadRuns, selectedEntity, sending, topic]);
  const queueAction = useCallback(async () => {
    if (!pendingAction?.operation || queueing) return;
    const request = operationRequest.trim();
    const requiresRequest = pendingAction.requires?.some((item) => ['request', 'urlOrText'].includes(item));
    if (requiresRequest && !request) { setError('Add the bounded request before queueing this operation.'); return; }
    if (pendingAction.requires?.includes('repositoryId') && !selectedEntity?.id) { setError('Select a repository before queueing this operation.'); return; }
    setQueueing(true); setError(null);
    try {
      const body: Record<string, unknown> = { kind: pendingAction.operation, request, repository_id: selectedEntity?.id, source_ref: conversationId ? `chat:${conversationId}` : undefined, idempotency_key: operationKey ?? operationIdempotencyKey(pendingAction.key) };
      if (pendingAction.operation === 'source-intake') {
        if (/^https?:\/\//i.test(request)) { body.url = request; body.privacy = 'public-safe'; }
        else body.text = request;
      }
      const result = await readJson<{ item: Run }>('/api/overseer/runs/v1/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setRuns((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setSelectedRun(result.item);
      setTab('active');
      onActionConsumed?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation could not be queued.'); }
    finally { setQueueing(false); }
  }, [conversationId, onActionConsumed, operationKey, operationRequest, pendingAction, queueing, selectedEntity?.id]);

  const canSend = Boolean(conversationId && draft.trim() && !sending);
  const mentionHints = useMemo(() => ['@briefing', '@projects', '@knowledge', '@tasks', '@assistants'], []);
  const activeRuns = runs.filter((item) => ['needs-you', 'active'].includes(item.bucket));
  const recentRuns = runs.filter((item) => item.bucket === 'history');
  if (!open) return null;

  return <aside className="overseer-companion" aria-label="Overseer work panel" data-testid="overseer-companion-chat">
    <div className="overseer-companion-backdrop" onClick={onClose} aria-hidden="true" />
    <section className="overseer-companion-panel">
      <header className="overseer-companion-header"><div><p className="overseer-topic-eyebrow">Overseer work</p><h2>Work</h2><p>Resumable local conversations and visible bounded Runs.</p></div><button type="button" className="overseer-companion-close" aria-label="Close work panel" onClick={onClose}>×</button></header>
      <nav className="overseer-work-tabs" aria-label="Work panel views">
        <button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>Chat</button>
        <button type="button" className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>Active {activeRuns.length ? <Badge tone="brand">{activeRuns.length}</Badge> : null}</button>
        <button type="button" className={tab === 'recent' ? 'is-active' : ''} onClick={() => setTab('recent')}>Recent</button>
      </nav>
      {error ? <div className="overseer-companion-error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => { setError(null); void loadConversations(); }}>Retry</Button></div> : null}
      {tab === 'chat' ? <>
        <div className="overseer-companion-chat-toolbar"><select aria-label="Recent conversations" value={conversationId ?? ''} onChange={(event) => void loadConversation(event.target.value)} disabled={starting}><option value="">Select a conversation</option>{conversations.map((item) => <option key={item.id} value={item.id}>{item.topic} · {when(item.updatedAt)}</option>)}</select><Button variant="secondary" onClick={() => void createConversation()} loading={starting} loadingLabel="Starting…">New</Button></div>
        {pendingAction?.mode === 'queue' ? <section className="overseer-operation-review" data-testid="overseer-operation-review"><p className="overseer-topic-eyebrow">Review before queueing</p><h3>{pendingAction.label}</h3><p>{pendingAction.description}</p>{selectedEntity?.name ? <small>Context: {selectedEntity.name}</small> : null}<textarea value={operationRequest} onChange={(event) => setOperationRequest(event.target.value)} rows={3} placeholder={pendingAction.requires?.includes('urlOrText') ? 'Public URL or bounded source text…' : 'Describe the bounded request…'} /><div><Button variant="secondary" onClick={onActionConsumed}>Cancel</Button><Button onClick={() => void queueAction()} loading={queueing} loadingLabel="Queueing…">Queue Run</Button></div></section> : null}
        <div className="overseer-companion-messages" aria-live="polite">
          {starting ? <p className="overseer-companion-empty">Restoring work context…</p> : null}
          {!starting && !messages.length ? <div className="overseer-companion-empty"><strong>{conversationId ? 'Continue this conversation.' : 'Start or select a conversation.'}</strong><span>Use a mention to bring another topic into the answer.</span></div> : null}
          {messages.map((message) => <article key={message.id} className={`overseer-companion-message is-${message.role}`}><span className="overseer-companion-role">{message.role === 'assistant' ? 'Overseer' : 'You'}</span><p>{message.text}</p>{message.recovery ? <small className="overseer-companion-runner is-unavailable">{message.recovery}</small> : null}{message.memory?.written ? <small className="overseer-companion-memory">Saved as explicit local memory.</small> : null}{message.requestedOperation ? <button type="button" className="overseer-companion-operation" onClick={() => openRun(message.requestedOperation?.runId)} disabled={!message.requestedOperation.runId}><strong>{message.requestedOperation.label}</strong><span>{message.requestedOperation.queued ? 'Queued as a visible Run. Open its details.' : 'Could not queue this Run.'}</span></button> : null}</article>)}
        </div>
        <footer className="overseer-companion-footer"><div className="overseer-companion-hints" aria-label="Context mentions">{mentionHints.map((hint) => <button type="button" key={hint} onClick={() => setDraft((current) => `${current}${current ? ' ' : ''}${hint} `)}>{hint}</button>)}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about this context…" rows={3} disabled={starting || sending || !conversationId} /><div className="overseer-companion-send"><small>{sending ? 'Thinking…' : 'Enter to send · Shift+Enter for a new line'}</small><Button onClick={() => void send()} disabled={!canSend} loading={sending} loadingLabel="Sending…">Send</Button></div></footer>
      </> : <RunList title={tab === 'active' ? 'Needs you and active work' : 'Recent Runs'} items={tab === 'active' ? activeRuns : recentRuns} selectedId={selectedRun?.id} onSelect={openRun} />}
      {tab !== 'chat' && selectedRun ? <RunDetail item={selectedRun} /> : null}
      {tab === 'recent' ? <section className="overseer-recent-conversations"><p className="overseer-topic-eyebrow">Recent conversations</p>{conversations.map((item) => <button type="button" key={item.id} onClick={() => { void loadConversation(item.id); setTab('chat'); }}><strong>{item.topic}</strong><span>{item.turnCount ?? 0} turns · {when(item.updatedAt)}</span></button>)}</section> : null}
    </section>
  </aside>;
}

function RunList({ title, items, selectedId, onSelect }: { title: string; items: Run[]; selectedId?: string; onSelect: (id: string) => void }) {
  return <section className="overseer-work-runs"><p className="overseer-topic-eyebrow">Execution transparency</p><h3>{title}</h3>{items.length ? items.map((item) => <button type="button" key={item.id} className={item.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(item.id)}><div><strong>{item.title}</strong><Badge tone={tone(item.state)}>{item.state.replaceAll('-', ' ')}</Badge></div><small>{item.operationLabel} · {when(item.updatedAt)}</small><p>{item.currentMessage}</p></button>) : <p className="overseer-companion-empty">No matching Runs.</p>}</section>;
}

function RunDetail({ item }: { item: Run }) {
  return <section className="overseer-run-detail" aria-label="Selected Run detail"><p className="overseer-topic-eyebrow">Selected Run</p><h3>{item.title}</h3><p>{item.currentMessage}</p><small>{item.id} · {item.operationLabel} · {when(item.updatedAt)}</small>{item.clarificationQuestions?.length ? <p>Needs: {item.clarificationQuestions.join(' ')}</p> : null}</section>;
}
