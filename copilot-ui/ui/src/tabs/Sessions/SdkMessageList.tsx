import { useEffect, useRef } from 'react';
import type { SdkMessageEntry, SdkStreamStatus } from '../../lib/types';

interface SdkMessageListProps {
  messages: SdkMessageEntry[];
  pendingContent: string;
  pendingReasoning: string;
  streamStatus: SdkStreamStatus;
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Unknown time';
  }

  return new Date(value).toLocaleTimeString();
}

export default function SdkMessageList({
  messages,
  pendingContent,
  pendingReasoning,
  streamStatus,
}: SdkMessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingContent, pendingReasoning]);

  const hasPending = pendingContent.trim().length > 0 || pendingReasoning.trim().length > 0;

  return (
    <section className="sdk-message-list" data-testid="sdk-message-list">
      {messages.length === 0 && !hasPending ? (
        <p className="state-message">No SDK messages yet.</p>
      ) : (
        <ul className="sdk-message-items">
          {messages.map((message) => (
            <li className={`sdk-message sdk-message-${message.role}`} key={message.id}>
              <div className="sdk-message-meta">
                <span className="sdk-message-role">{message.role}</span>
                <span className="sdk-message-time">{formatTimestamp(message.createdAtMs)}</span>
                <span className="sdk-message-status">{message.status}</span>
              </div>

              <p className="sdk-message-content">{message.content}</p>

              {message.reasoning ? (
                <details className="sdk-message-reasoning">
                  <summary>Reasoning</summary>
                  <pre>{message.reasoning}</pre>
                </details>
              ) : null}
            </li>
          ))}

          {hasPending ? (
            <li className="sdk-message sdk-message-assistant sdk-message-pending">
              <div className="sdk-message-meta">
                <span className="sdk-message-role">assistant</span>
                <span className="sdk-message-time">streaming</span>
                <span className="sdk-message-status">{streamStatus}</span>
              </div>

              {pendingContent.trim() ? <p className="sdk-message-content">{pendingContent}</p> : null}

              {pendingReasoning.trim() ? (
                <details className="sdk-message-reasoning" open>
                  <summary>Reasoning (delta)</summary>
                  <pre>{pendingReasoning}</pre>
                </details>
              ) : null}
            </li>
          ) : null}
        </ul>
      )}

      <div ref={endRef} />
    </section>
  );
}
