/**
 * React hook for managing permission requests.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  PermissionRequest, 
  PermissionResponse, 
  PERMISSION_TIMEOUT_MS,
} from '../types/permissions';
import { getRelayConnection, RelayMessage } from '../services/relayConnection';

interface PermissionState {
  pending: PermissionRequest[];
  history: PermissionRequest[];
}

export function usePermissions() {
  const [state, setState] = useState<PermissionState>({
    pending: [],
    history: [],
  });
  const timeoutRefs = useRef<Map<string, number>>(new Map());

  // Handle incoming permission request
  const handlePermissionRequest = useCallback((request: PermissionRequest) => {
    setState((prev) => {
      // Avoid duplicates
      if (prev.pending.some((p) => p.id === request.id)) {
        return prev;
      }
      return {
        ...prev,
        pending: [...prev.pending, request],
      };
    });

    // Set auto-expiry timeout
    const timeout = window.setTimeout(() => {
      handleExpire(request.id);
    }, request.expiresAt - Date.now());
    
    timeoutRefs.current.set(request.id, timeout);

    // Trigger push notification if app is backgrounded
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Permission Request', {
        body: `${request.agentName}: ${request.description}`,
        icon: '/icon-192.png',
        tag: `permission-${request.id}`,
        requireInteraction: true,
      });
    }
  }, []);

  // Handle expiration
  const handleExpire = useCallback((requestId: string) => {
    setState((prev) => {
      const request = prev.pending.find((p) => p.id === requestId);
      if (!request) return prev;

      const updated: PermissionRequest = { ...request, status: 'expired' };
      return {
        pending: prev.pending.filter((p) => p.id !== requestId),
        history: [updated, ...prev.history].slice(0, 50), // Keep last 50
      };
    });

    // Clear timeout
    const timeout = timeoutRefs.current.get(requestId);
    if (timeout) {
      window.clearTimeout(timeout);
      timeoutRefs.current.delete(requestId);
    }

    // Send denied response for expired
    sendResponse(requestId, false);
  }, []);

  // Approve request
  const approve = useCallback((requestId: string) => {
    setState((prev) => {
      const request = prev.pending.find((p) => p.id === requestId);
      if (!request) return prev;

      const updated: PermissionRequest = { ...request, status: 'approved' };
      return {
        pending: prev.pending.filter((p) => p.id !== requestId),
        history: [updated, ...prev.history].slice(0, 50),
      };
    });

    // Clear timeout
    const timeout = timeoutRefs.current.get(requestId);
    if (timeout) {
      window.clearTimeout(timeout);
      timeoutRefs.current.delete(requestId);
    }

    sendResponse(requestId, true);
  }, []);

  // Deny request
  const deny = useCallback((requestId: string) => {
    setState((prev) => {
      const request = prev.pending.find((p) => p.id === requestId);
      if (!request) return prev;

      const updated: PermissionRequest = { ...request, status: 'denied' };
      return {
        pending: prev.pending.filter((p) => p.id !== requestId),
        history: [updated, ...prev.history].slice(0, 50),
      };
    });

    // Clear timeout
    const timeout = timeoutRefs.current.get(requestId);
    if (timeout) {
      window.clearTimeout(timeout);
      timeoutRefs.current.delete(requestId);
    }

    sendResponse(requestId, false);
  }, []);

  // Send response back via relay
  const sendResponse = (requestId: string, approved: boolean) => {
    const response: PermissionResponse = {
      requestId,
      approved,
      respondedAt: Date.now(),
    };

    getRelayConnection().send({
      type: 'permission_response',
      payload: response,
    });
  };

  // Approve all pending
  const approveAll = useCallback(() => {
    state.pending.forEach((req) => approve(req.id));
  }, [state.pending, approve]);

  // Deny all pending
  const denyAll = useCallback(() => {
    state.pending.forEach((req) => deny(req.id));
  }, [state.pending, deny]);

  // Clear history
  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, history: [] }));
  }, []);

  // Subscribe to permission events from relay
  useEffect(() => {
    const relay = getRelayConnection();
    const unsubscribe = relay.onMessage((message: RelayMessage) => {
      if (message.type === 'permission_request') {
        const request = message.payload as PermissionRequest;
        handlePermissionRequest({
          ...request,
          expiresAt: request.expiresAt || (Date.now() + PERMISSION_TIMEOUT_MS),
          status: 'pending',
        });
      }
    });

    return () => {
      unsubscribe();
      // Clean up all timeouts on unmount
      timeoutRefs.current.forEach((timeout) => window.clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, [handlePermissionRequest]);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return {
    pending: state.pending,
    history: state.history,
    currentRequest: state.pending[0] || null,
    hasPending: state.pending.length > 0,
    pendingCount: state.pending.length,
    approve,
    deny,
    approveAll,
    denyAll,
    clearHistory,
  };
}

// Get time remaining for a request
export function getTimeRemaining(request: PermissionRequest): number {
  return Math.max(0, request.expiresAt - Date.now());
}

// Format time remaining
export function formatTimeRemaining(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
