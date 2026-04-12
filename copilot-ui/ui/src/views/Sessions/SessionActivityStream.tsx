import { useEffect, useRef, useMemo, useState } from 'react';
import { Button, CopyButton, MarkdownMessage, StatusBadge } from '../../components';
import { formatTimestampLabel } from '../../lib/stateDiagnostics';
import { sessionDetailStore } from './sessionDetailStore';
import type { SessionDetailState } from './sessionDetailStore';
import type { ActivityStreamEntry } from '../../lib/types';
import CollapsibleBlock from './CollapsibleBlock';
import QuestionCard from './QuestionCard';

interface Props {
  state: SessionDetailState;
  onSend: (prompt: string) => void;
  onComposerChange: (value: string) => void;
}

function StreamStatusIndicator({ status }: { status: string }) {
  return (
    <span className="session-stream-status" data-testid="stream-status-indicator">
      <StatusBadge status={status} testId="stream-status-badge" />
    </span>
  );
}

function buildTimeline(state: SessionDetailState): ActivityStreamEntry[] {
  const entries: ActivityStreamEntry[] = [];

  for (const msg of state.sdkMessages) {
    entries.push({
      id: `msg-${msg.id}`,
      kind: 'message',
      timestamp: msg.createdAtMs,
      message: msg,
    });
  }

  for (const tc of state.toolCalls) {
    entries.push({
      id: `tc-${tc.toolCallId}`,
      kind: 'tool-call',
      timestamp: tc.startedAtMs,
      toolCall: tc,
    });
  }

  if (state.sdkPendingContent || state.sdkPendingReasoning) {
    entries.push({
      id: 'pending',
      kind: 'pending',
      timestamp: Date.now(),
      pendingContent: state.sdkPendingContent || undefined,
      pendingReasoning: state.sdkPendingReasoning || undefined,
    });
  }

  for (const q of state.pendingQuestions) {
    entries.push({
      id: `q-${q.questionId}`,
      kind: 'question',
      timestamp: q.askedAtMs,
      question: q,
    });
  }

  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
}

function ToolCallEntry({ entry }: { entry: ActivityStreamEntry }) {
  const tc = entry.toolCall!;
  const isCompleted = tc.status === 'completed';
  const titleSuffix = isCompleted ? ' ✓' : tc.status === 'error' ? ' ✗' : '';
  const title = `${tc.toolName}${titleSuffix}`;

  return (
    <div className="session-message session-message-tool-call" data-testid="session-tool-call-entry">
      <CollapsibleBlock
        title={title}
        variant="tool"
        defaultOpen={false}
        timestamp={formatTimestampLabel(tc.startedAtMs)}
        status={tc.status}
        testId="tool-call-block"
      >
        {tc.arguments && (
          <div className="tool-call-arguments" data-testid="tool-call-arguments">
            <div className="tool-call-section-label">Arguments</div>
            <pre className="tool-call-json">{JSON.stringify(tc.arguments, null, 2)}</pre>
          </div>
        )}
        {tc.output !== undefined && (
          <div className="tool-call-output" data-testid="tool-call-output">
            <div className="tool-call-section-label">Output</div>
            <pre className="tool-call-json">{tc.output}</pre>
          </div>
        )}
        {tc.status === 'executing' && (
          <div className="tool-call-executing" data-testid="tool-call-executing">
            <span className="session-message-streaming">●</span> Executing…
          </div>
        )}
      </CollapsibleBlock>
    </div>
  );
}

function MessageEntry({ entry }: { entry: ActivityStreamEntry }) {
  const msg = entry.message!;

  if (msg.role === 'user') {
    return (
      <div
        className="session-message session-message-user"
        data-testid="session-message-item"
      >
        <div className="session-message-header">
          <StatusBadge status={msg.role} testId="message-role-badge" />
          <span className="session-message-time">
            {formatTimestampLabel(msg.createdAtMs)}
          </span>
        </div>
        <div className="session-message-content" data-testid="message-content">
          <MarkdownMessage content={msg.content} testId="message-content-md" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`session-message session-message-${msg.role}`}
      data-testid="session-message-item"
    >
      <div className="session-message-header">
        <StatusBadge status={msg.role} testId="message-role-badge" />
        <span className="session-message-time">
          {formatTimestampLabel(msg.createdAtMs)}
        </span>
        {msg.status === 'streaming' && (
          <span className="session-message-streaming">●</span>
        )}
        <CopyButton text={msg.content} testId="message-copy-button" />
      </div>
      {msg.reasoning && (
        <CollapsibleBlock
          title="Reasoning"
          variant="reasoning"
          defaultOpen={false}
          testId="message-reasoning-block"
        >
          <div className="session-message-reasoning" data-testid="message-reasoning">
            <MarkdownMessage content={msg.reasoning} testId="message-reasoning-md" />
          </div>
        </CollapsibleBlock>
      )}
      <div className="session-message-content" data-testid="message-content">
        <MarkdownMessage content={msg.content} testId="message-content-md" />
      </div>
    </div>
  );
}

function PendingEntry({ entry }: { entry: ActivityStreamEntry }) {
  return (
    <div className="session-message session-message-pending" data-testid="pending-message">
      <div className="session-message-header">
        <StatusBadge status="assistant" testId="pending-role-badge" />
        <span className="session-message-streaming">●</span>
      </div>
      {entry.pendingReasoning && (
        <CollapsibleBlock
          title="Reasoning"
          variant="reasoning"
          defaultOpen={false}
          testId="pending-reasoning-block"
        >
          <div className="session-message-reasoning">
            <MarkdownMessage content={entry.pendingReasoning} />
          </div>
        </CollapsibleBlock>
      )}
      {entry.pendingContent && (
        <div className="session-message-content">
          <MarkdownMessage content={entry.pendingContent} />
        </div>
      )}
    </div>
  );
}

function QuestionEntry({ entry, onAnswer }: { entry: ActivityStreamEntry; onAnswer: (toolCallId: string, answer: string) => void }) {
  const q = entry.question!;
  return (
    <div className="session-message session-message-question" data-testid="session-question-entry">
      <QuestionCard question={q} onAnswer={onAnswer} />
    </div>
  );
}

function TimelineEntry({ entry, onAnswer }: { entry: ActivityStreamEntry; onAnswer: (toolCallId: string, answer: string) => void }) {
  switch (entry.kind) {
    case 'message':
      return <MessageEntry entry={entry} />;
    case 'tool-call':
      return <ToolCallEntry entry={entry} />;
    case 'question':
      return <QuestionEntry entry={entry} onAnswer={onAnswer} />;
    case 'pending':
      return <PendingEntry entry={entry} />;
    default:
      return null;
  }
}

export default function SessionActivityStream({ state, onSend, onComposerChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const lastSeenCount = useRef(0);
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);

  function handleAnswer(toolCallId: string, answer: string) {
    sessionDetailStore.answerQuestion(toolCallId, answer);
  }

  const timeline = useMemo(() => buildTimeline(state), [
    state.sdkMessages,
    state.toolCalls,
    state.sdkPendingContent,
    state.sdkPendingReasoning,
    state.pendingQuestions,
  ]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    userScrolledUp.current = !isNearBottom;
    if (isNearBottom) {
      setShowNewMessagesPill(false);
      lastSeenCount.current = timeline.length;
    }
  }

  useEffect(() => {
    if (!scrollRef.current) return;
    if (!userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastSeenCount.current = timeline.length;
    } else if (timeline.length > lastSeenCount.current) {
      setShowNewMessagesPill(true);
    }
  }, [timeline]);

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      userScrolledUp.current = false;
      setShowNewMessagesPill(false);
      lastSeenCount.current = timeline.length;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.composerPrompt.trim()) {
        onSend(state.composerPrompt);
      }
    }
  }

  function handleSendClick() {
    if (state.composerPrompt.trim()) {
      onSend(state.composerPrompt);
    }
  }

  return (
    <div className="session-activity-stream" data-testid="session-activity-stream">
      <div className="session-activity-header">
        <StreamStatusIndicator status={state.sdkStreamStatus} />
        <span className="session-message-count">
          {state.sdkMessages.length} message{state.sdkMessages.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="session-messages-feed" ref={scrollRef} onScroll={handleScroll} data-testid="session-messages-feed">
        {timeline.length === 0 && (
          <div className="session-empty-state" data-testid="activity-empty-state">
            No messages yet. Send a prompt to start the conversation.
          </div>
        )}

        {timeline.map((entry) => (
          <TimelineEntry key={entry.id} entry={entry} onAnswer={handleAnswer} />
        ))}
      </div>

      {showNewMessagesPill && (
        <button
          className="session-new-messages-pill"
          data-testid="new-messages-pill"
          onClick={scrollToBottom}
          type="button"
        >
          ↓ New messages
        </button>
      )}

      {state.sendError && (
        <div className="session-send-error" data-testid="session-send-error">
          <span className="session-send-error-text">⚠ {state.sendError}</span>
          <button
            className="session-send-error-retry"
            data-testid="session-send-error-retry"
            onClick={() => sessionDetailStore.retrySend()}
            type="button"
          >
            Retry
          </button>
          <button
            className="session-send-error-dismiss"
            data-testid="session-send-error-dismiss"
            onClick={() => sessionDetailStore.dismissSendError()}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="session-composer" data-testid="session-composer">
        <textarea
          className="session-composer-input"
          data-testid="composer-input"
          placeholder="Send a message…"
          rows={2}
          value={state.composerPrompt}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="primary"
          size="sm"
          testId="composer-send-button"
          disabled={!state.composerPrompt.trim()}
          onClick={handleSendClick}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
