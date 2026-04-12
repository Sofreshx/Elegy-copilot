import { createStore } from '../lib/store';

export interface QuestionBadgeState {
  totalPendingQuestions: number;
  sessionIdsWithQuestions: string[];
  lastPollMs: number;
}

const INITIAL_STATE: QuestionBadgeState = {
  totalPendingQuestions: 0,
  sessionIdsWithQuestions: [],
  lastPollMs: 0,
};

function createQuestionBadgeStore() {
  const store = createStore<QuestionBadgeState>(INITIAL_STATE);
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  const sessionCounts = new Map<string, number>();

  function deriveState(): QuestionBadgeState {
    let total = 0;
    const ids: string[] = [];
    for (const [sid, count] of sessionCounts) {
      if (count > 0) {
        total += count;
        ids.push(sid);
      }
    }
    return { totalPendingQuestions: total, sessionIdsWithQuestions: ids, lastPollMs: Date.now() };
  }

  async function poll(): Promise<void> {
    try {
      const res = await fetch('/api/sessions/unified?limit=50');
      if (!res.ok) return;
      const sessions = await res.json();

      const polledIds = new Set<string>();

      if (Array.isArray(sessions)) {
        for (const session of sessions) {
          const status = (session.status || '').toLowerCase();
          if (status === 'active' || status === 'running' || status === 'idle') {
            polledIds.add(session.sessionId);
            try {
              const stateRes = await fetch(
                `/api/sdk/session/${encodeURIComponent(session.sessionId)}/state`,
              );
              if (stateRes.ok) {
                const stateData = await stateRes.json();
                const pendingCount = stateData?.pendingQuestionCount || 0;
                sessionCounts.set(session.sessionId, pendingCount);
              }
            } catch {
              // Session might not support state query — skip
            }
          }
        }
      }

      // Clean up sessions no longer in active list
      for (const sid of sessionCounts.keys()) {
        if (!polledIds.has(sid)) {
          sessionCounts.delete(sid);
        }
      }

      store.setState(() => deriveState());
    } catch {
      // Network error — don't update state
    }
  }

  function reportQuestion(sessionId: string, count: number): void {
    sessionCounts.set(sessionId, count);
    store.setState(() => deriveState());
  }

  function startPolling(intervalMs = 15000): void {
    if (pollInterval) return;
    void poll();
    pollInterval = setInterval(() => void poll(), intervalMs);
  }

  function stopPolling(): void {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    poll,
    reportQuestion,
    startPolling,
    stopPolling,
  };
}

export const questionBadgeStore = createQuestionBadgeStore();
