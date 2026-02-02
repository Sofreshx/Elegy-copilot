import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  getClients,
  disconnectClient,
  subscribeToClientEvents,
  type Client,
} from '../services/relayApi';

/**
 * Query key for clients list
 */
export const CLIENTS_QUERY_KEY = ['clients'] as const;

/**
 * Hook to fetch and manage the list of connected clients.
 * Automatically updates when WebSocket events are received.
 */
export function useClients() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CLIENTS_QUERY_KEY,
    queryFn: getClients,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute as fallback
    refetchOnWindowFocus: true,
  });

  // Subscribe to real-time client events
  useEffect(() => {
    const unsubscribe = subscribeToClientEvents(
      // On client connected
      (newClient) => {
        queryClient.setQueryData<Client[]>(CLIENTS_QUERY_KEY, (oldClients) => {
          if (!oldClients) return [newClient];
          // Check if client already exists (reconnection)
          const existingIndex = oldClients.findIndex(
            (c) => c.clientId === newClient.clientId
          );
          if (existingIndex >= 0) {
            const updated = [...oldClients];
            updated[existingIndex] = newClient;
            return updated;
          }
          return [...oldClients, newClient];
        });
      },
      // On client disconnected
      (clientId) => {
        queryClient.setQueryData<Client[]>(CLIENTS_QUERY_KEY, (oldClients) => {
          if (!oldClients) return [];
          return oldClients.map((client) =>
            client.clientId === clientId
              ? { ...client, isOnline: false, lastSeen: new Date().toISOString() }
              : client
          );
        });
      },
      // On client updated
      (updatedClient) => {
        queryClient.setQueryData<Client[]>(CLIENTS_QUERY_KEY, (oldClients) => {
          if (!oldClients) return [updatedClient];
          return oldClients.map((client) =>
            client.clientId === updatedClient.clientId ? updatedClient : client
          );
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return {
    clients: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}

/**
 * Hook to disconnect a client.
 * Provides optimistic updates and error handling.
 */
export function useDisconnectClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectClient,
    // Optimistic update
    onMutate: async (clientId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: CLIENTS_QUERY_KEY });

      // Snapshot the previous value
      const previousClients = queryClient.getQueryData<Client[]>(CLIENTS_QUERY_KEY);

      // Optimistically update to mark client as offline
      queryClient.setQueryData<Client[]>(CLIENTS_QUERY_KEY, (oldClients) => {
        if (!oldClients) return [];
        return oldClients.map((client) =>
          client.clientId === clientId
            ? { ...client, isOnline: false, lastSeen: new Date().toISOString() }
            : client
        );
      });

      return { previousClients };
    },
    // If the mutation fails, rollback to previous value
    onError: (_error, _clientId, context) => {
      if (context?.previousClients) {
        queryClient.setQueryData(CLIENTS_QUERY_KEY, context.previousClients);
      }
    },
    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY });
    },
  });
}
