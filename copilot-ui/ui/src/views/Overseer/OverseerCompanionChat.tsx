import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components';
import './overseerCompanion.css';

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; topic?: string; mentions?: string[]; memory?: { decision?: string; reason?: string; written?: boolean } | null; requestedOperation?: { kind: string; label: string; state: string; queued?: boolean } | null; runner?: { kind: string; label: string } | null; unavailable?: boolean; activity?: Array<{ stage: string; message: string }> };
type SelectedEntity = { kind: string; id?: string; name?: string; summary?: string; [key: string]: unknown };
type CompanionProps = { topic: string; open: boolean; onClose: () => void; initialPrompt?: string | null; onPromptConsumed?: () => void; selectedEntity?: SelectedEntity | null };

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'The companion is unavailable.');
  return payload as T;
}

function mentionsFor(message: string): string[] {
  return [...new Set([...message.matchAll(/@([a-z][a-z0-9_-]{1,39}(?:\/[a-z0-9._:-]{1,80})?)/gi)].map((match) => match[1].toLowerCase()))].slice(0, 12);
}

export default function OverseerCompanionChat({ topic, open, onClose, initialPrompt = null, onPromptConsumed, selectedEntity = null }: CompanionProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startConversation = useCallback(async () => {
    setStarting(true); setError(null); setConversationId(null); setMessages([]);
    try {
      const result = await readJson<{ conversation: { id: string } }>('/api/overseer/chat/v1/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, selectedEntity }) });
      setConversationId(result.conversation.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The companion is unavailable.'); }
    finally { setStarting(false); }
  }, [selectedEntity, topic]);

  useEffect(() => { if (open) void startConversation(); }, [open, startConversation]);
  useEffect(() => {
    if (!open || !initialPrompt) return;
    setDraft(initialPrompt);
    onPromptConsumed?.();
  }, [initialPrompt, onPromptConsumed, open]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || !conversationId || sending) return;
    const mentions = mentionsFor(message);
    setDraft(''); setSending(true); setError(null);
    setMessages((current) => [...current, { id: `local:${Date.now()}`, role: 'user', text: message, topic, mentions }]);
    try {
      const result = await readJson<{ turn: ChatMessage }>(`/api/overseer/chat/v1/conversations/${encodeURIComponent(conversationId)}/turns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, topic, mentions, selectedEntity }) });
      setMessages((current) => [...current, result.turn]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The companion could not answer.'); }
    finally { setSending(false); }
  }, [conversationId, draft, sending, topic, selectedEntity]);

  const canSend = Boolean(conversationId && draft.trim() && !sending);
  const mentionHints = useMemo(() => ['@briefing', '@projects', '@knowledge', '@tasks', '@assistants'], []);
  if (!open) return null;
  return <aside className="overseer-companion" aria-label="Overseer companion" data-testid="overseer-companion-chat"><div className="overseer-companion-backdrop" onClick={onClose} aria-hidden="true" /><section className="overseer-companion-panel"><header className="overseer-companion-header"><div><p className="overseer-topic-eyebrow">Contextual companion</p><h2>Ask Overseer</h2><p>Topic <strong>{topic}</strong> · local state and labelled projection</p>{selectedEntity?.name ? <small className="overseer-companion-selected">Selected {selectedEntity.kind}: <strong>{selectedEntity.name}</strong></small> : null}<small>Chat can explain features, debate the current state, and queue visible Runs.</small></div><button type="button" className="overseer-companion-close" aria-label="Close companion" onClick={onClose}>×</button></header>{error ? <div className="overseer-companion-error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => void startConversation()}>Retry</Button></div> : null}<div className="overseer-companion-messages" aria-live="polite">{starting ? <p className="overseer-companion-empty">Resolving {topic} context…</p> : null}{!starting && !messages.length ? <div className="overseer-companion-empty"><strong>Ask about the state, gaps, or next move.</strong><span>Use a mention to bring another topic into the answer, or ask “what can Overseer do?”</span></div> : null}{messages.map((message) => <article key={message.id} className={`overseer-companion-message is-${message.role}`}><span className="overseer-companion-role">{message.role === 'assistant' ? 'Overseer' : 'You'}</span><p>{message.text}</p>{message.memory ? <small className="overseer-companion-memory">{message.memory.written ? 'Saved as an explicit local memory.' : message.memory.decision === 'proposed' ? 'Assistant interpretation remains a proposal.' : message.memory.decision === 'confirm' ? 'This memory needs confirmation before it can persist.' : null}</small> : null}{message.role === 'assistant' && message.runner ? <small className={`overseer-companion-runner${message.unavailable ? ' is-unavailable' : ''}`}>{message.runner.label}{message.unavailable ? ' · unavailable' : ''}</small> : null}{message.activity?.length ? <small className="overseer-companion-activity">{message.activity[message.activity.length - 1].message}</small> : null}{message.requestedOperation ? <div className="overseer-companion-operation"><strong>{message.requestedOperation.label}</strong><span>{message.requestedOperation.queued ? 'Queued as a visible Run.' : 'Could not queue this Run.'}</span></div> : null}</article>)}</div><footer className="overseer-companion-footer"><div className="overseer-companion-hints" aria-label="Context mentions">{mentionHints.map((hint) => <button type="button" key={hint} onClick={() => setDraft((current) => `${current}${current ? ' ' : ''}${hint} `)}>{hint}</button>)}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about this context…" rows={3} disabled={starting || sending} /><div className="overseer-companion-send"><small>{sending ? 'Thinking…' : 'Enter to send · Shift+Enter for a new line'}</small><Button onClick={() => void send()} disabled={!canSend} loading={sending} loadingLabel="Sending…">Send</Button></div></footer></section></aside>;
}
