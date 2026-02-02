import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  getSessions,
  getSessionDetails,
  startSession,
  cancelSession,
  getAgents,
  subscribeToSessionEvents,
  type Session,
  type ToolCall,
} from '../services/relayApi';

/**
 * Query keys for sessions
 */
export const SESSIONS_QUERY_KEY = ['sessions'] as const;
export const SESSION_DETAILS_QUERY_KEY = (sessionId: string) => ['session', sessionId] as const;
export const AGENTS_QUERY_KEY = ['agents'] as const;

/**
 * Hook to fetch and manage the list of sessions.
 * Automatically updates when WebSocket events are received.
 */
export function useSessions() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: getSessions,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute as fallback
    refetchOnWindowFocus: true,
  });

  // Subscribe to real-time session events
  useEffect(() => {
    const unsubscribe = subscribeToSessionEvents({
      onSessionStarted: (session) => {
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [session];
          // Check if session already exists
          const existingIndex = oldSessions.findIndex(
            (s) => s.sessionId === session.sessionId
          );
          if (existingIndex >= 0) {
            const updated = [...oldSessions];
            updated[existingIndex] = session;
            return updated;
          }
          return [session, ...oldSessions];
        });
      },
      onSessionMessage: (sessionId, message) => {
        // Update session in list
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [];
          return oldSessions.map((session) =>
            session.sessionId === sessionId
              ? { ...session, messages: [...session.messages, message] }
              : session
          );
        });
        // Update session details if cached
        queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
          if (!oldSession) return undefined;
          return { ...oldSession, messages: [...oldSession.messages, message] };
        });
      },
      onSessionToolCall: (sessionId, toolCall) => {
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [];
          return oldSessions.map((session) =>
            session.sessionId === sessionId
              ? { ...session, toolCalls: [...session.toolCalls, toolCall] }
              : session
          );
        });
        queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
          if (!oldSession) return undefined;
          return { ...oldSession, toolCalls: [...oldSession.toolCalls, toolCall] };
        });
      },
      onSessionToolResult: (sessionId, toolCallId, result) => {
        const updateToolCalls = (toolCalls: ToolCall[]) =>
          toolCalls.map((tc) =>
            tc.id === toolCallId
              ? { ...tc, result, status: 'completed' as const, completedAt: new Date().toISOString() }
              : tc
          );

        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [];
          return oldSessions.map((session) =>
            session.sessionId === sessionId
              ? { ...session, toolCalls: updateToolCalls(session.toolCalls) }
              : session
          );
        });
        queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
          if (!oldSession) return undefined;
          return { ...oldSession, toolCalls: updateToolCalls(oldSession.toolCalls) };
        });
      },
      onSessionCompleted: (session) => {
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [session];
          return oldSessions.map((s) =>
            s.sessionId === session.sessionId ? session : s
          );
        });
        queryClient.setQueryData(SESSION_DETAILS_QUERY_KEY(session.sessionId), session);
      },
      onSessionFailed: (sessionId, error) => {
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [];
          return oldSessions.map((session) =>
            session.sessionId === sessionId
              ? { ...session, status: 'failed' as const, error, completedAt: new Date().toISOString() }
              : session
          );
        });
        queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
          if (!oldSession) return undefined;
          return { ...oldSession, status: 'failed' as const, error, completedAt: new Date().toISOString() };
        });
      },
      onSessionCancelled: (sessionId) => {
        queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
          if (!oldSessions) return [];
          return oldSessions.map((session) =>
            session.sessionId === sessionId
              ? { ...session, status: 'cancelled' as const, completedAt: new Date().toISOString() }
              : session
          );
        });
        queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
          if (!oldSession) return undefined;
          return { ...oldSession, status: 'cancelled' as const, completedAt: new Date().toISOString() };
        });
      },
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}

/**
 * Hook to fetch details for a specific session
 */
export function useSessionDetails(sessionId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSION_DETAILS_QUERY_KEY(sessionId || ''),
    queryFn: () => getSessionDetails(sessionId!),
    enabled: !!sessionId,
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: (query) => {
      // Only refetch if session is still running
      const data = query.state.data;
      if (data?.status === 'running' || data?.status === 'pending') {
        return 1000 * 5; // 5 seconds
      }
      return false;
    },
  });

  // Subscribe to real-time events for this specific session
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = subscribeToSessionEvents({
      onSessionMessage: (msgSessionId, message) => {
        if (msgSessionId === sessionId) {
          queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
            if (!oldSession) return undefined;
            return { ...oldSession, messages: [...oldSession.messages, message] };
          });
        }
      },
      onSessionToolCall: (tcSessionId, toolCall) => {
        if (tcSessionId === sessionId) {
          queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
            if (!oldSession) return undefined;
            return { ...oldSession, toolCalls: [...oldSession.toolCalls, toolCall] };
          });
        }
      },
      onSessionToolResult: (trSessionId, toolCallId, result) => {
        if (trSessionId === sessionId) {
          queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
            if (!oldSession) return undefined;
            return {
              ...oldSession,
              toolCalls: oldSession.toolCalls.map((tc) =>
                tc.id === toolCallId
                  ? { ...tc, result, status: 'completed' as const, completedAt: new Date().toISOString() }
                  : tc
              ),
            };
          });
        }
      },
      onSessionCompleted: (session) => {
        if (session.sessionId === sessionId) {
          queryClient.setQueryData(SESSION_DETAILS_QUERY_KEY(sessionId), session);
        }
      },
      onSessionFailed: (failedSessionId, error) => {
        if (failedSessionId === sessionId) {
          queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
            if (!oldSession) return undefined;
            return { ...oldSession, status: 'failed' as const, error, completedAt: new Date().toISOString() };
          });
        }
      },
      onSessionCancelled: (cancelledSessionId) => {
        if (cancelledSessionId === sessionId) {
          queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
            if (!oldSession) return undefined;
            return { ...oldSession, status: 'cancelled' as const, completedAt: new Date().toISOString() };
          });
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, queryClient]);

  return {
    session: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch available agents
 */
export function useAgents() {
  const query = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: getAgents,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Hook to start a new session
 */
export function useStartSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, agentName, prompt }: { clientId: string; agentName: string; prompt: string }) =>
      startSession(clientId, agentName, prompt),
    onSuccess: (session) => {
      // Add new session to the list
      queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
        if (!oldSessions) return [session];
        return [session, ...oldSessions];
      });
      // Set session details cache
      queryClient.setQueryData(SESSION_DETAILS_QUERY_KEY(session.sessionId), session);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });
}

/**
 * Hook to cancel a session
 */
export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelSession,
    // Optimistic update
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });

      const previousSessions = queryClient.getQueryData<Session[]>(SESSIONS_QUERY_KEY);
      const previousSession = queryClient.getQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId));

      // Optimistically update session status
      queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, (oldSessions) => {
        if (!oldSessions) return [];
        return oldSessions.map((session) =>
          session.sessionId === sessionId
            ? { ...session, status: 'cancelled' as const, completedAt: new Date().toISOString() }
            : session
        );
      });

      queryClient.setQueryData<Session>(SESSION_DETAILS_QUERY_KEY(sessionId), (oldSession) => {
        if (!oldSession) return undefined;
        return { ...oldSession, status: 'cancelled' as const, completedAt: new Date().toISOString() };
      });

      return { previousSessions, previousSession, sessionId };
    },
    onError: (_error, sessionId, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previousSessions);
      }
      if (context?.previousSession) {
        queryClient.setQueryData(SESSION_DETAILS_QUERY_KEY(sessionId), context.previousSession);
      }
    },
    onSettled: (_, __, sessionId) => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SESSION_DETAILS_QUERY_KEY(sessionId) });
    },
  });
}
