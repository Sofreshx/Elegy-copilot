/**
 * Toast notification component for workflow status updates and other notifications.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  workflowStatusManager,
  WorkflowStatusUpdate,
  getWorkflowStatusMessage,
  getWorkflowStatusIcon,
  isTerminalStatus,
} from '../../services/workflowWebhook';
import './NotificationToast.css';

interface Toast {
  id: string;
  message: string;
  icon: string;
  type: 'info' | 'success' | 'warning' | 'error';
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number;
}

interface NotificationToastProps {
  maxToasts?: number;
}

export default function NotificationToast({ maxToasts = 3 }: NotificationToastProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    const newToast = { ...toast, id };
    
    setToasts((prev) => {
      const updated = [newToast, ...prev].slice(0, maxToasts);
      return updated;
    });

    // Auto-remove after duration
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, [maxToasts]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to workflow status updates
  useEffect(() => {
    const unsubscribe = workflowStatusManager.subscribeAll((update: WorkflowStatusUpdate) => {
      const type = getToastType(update);
      const duration = isTerminalStatus(update.status) ? 8000 : 4000;

      addToast({
        message: getWorkflowStatusMessage(update),
        icon: getWorkflowStatusIcon(update.status),
        type,
        duration,
        action: update.htmlUrl
          ? {
              label: 'View',
              onClick: () => window.open(update.htmlUrl, '_blank'),
            }
          : undefined,
      });
    });

    return () => unsubscribe();
  }, [addToast]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="notification-toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`notification-toast ${toast.type}`}>
          <span className="toast-icon">{toast.icon}</span>
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={toast.action.onClick}
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function getToastType(update: WorkflowStatusUpdate): Toast['type'] {
  switch (update.status) {
    case 'completed':
      return update.conclusion === 'success' ? 'success' : 'warning';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * Hook to show custom toasts from anywhere in the app
 */
export function useToast() {
  const [toastQueue, setToastQueue] = useState<Omit<Toast, 'id'>[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    setToastQueue((prev) => [...prev, toast]);
  }, []);

  const showSuccess = useCallback((message: string, action?: Toast['action']) => {
    showToast({ message, icon: '✅', type: 'success', action });
  }, [showToast]);

  const showError = useCallback((message: string, action?: Toast['action']) => {
    showToast({ message, icon: '❌', type: 'error', action, duration: 8000 });
  }, [showToast]);

  const showInfo = useCallback((message: string, action?: Toast['action']) => {
    showToast({ message, icon: 'ℹ️', type: 'info', action });
  }, [showToast]);

  const showWarning = useCallback((message: string, action?: Toast['action']) => {
    showToast({ message, icon: '⚠️', type: 'warning', action });
  }, [showToast]);

  return { showToast, showSuccess, showError, showInfo, showWarning, toastQueue, setToastQueue };
}
