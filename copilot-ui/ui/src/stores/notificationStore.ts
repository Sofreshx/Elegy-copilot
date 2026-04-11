import { createStore } from '../lib/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
  actionLabel?: string;
  onAction?: () => void;
  createdAt: number;
}

export interface NotificationState {
  toasts: Toast[];
}

const MAX_VISIBLE = 5;
const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  success: 5000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

let nextId = 1;

function createNotificationStore() {
  const store = createStore<NotificationState>({ toasts: [] });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function addToast(
    type: ToastType,
    title: string,
    opts?: { message?: string; duration?: number | null; actionLabel?: string; onAction?: () => void },
  ): string {
    const id = `toast-${nextId++}`;
    const duration = opts?.duration === null ? 0 : (opts?.duration ?? DEFAULT_DURATION_MS[type]);
    const toast: Toast = {
      id,
      type,
      title,
      message: opts?.message,
      duration,
      actionLabel: opts?.actionLabel,
      onAction: opts?.onAction,
      createdAt: Date.now(),
    };

    store.setState((state) => {
      const next = [toast, ...state.toasts];
      if (next.length > MAX_VISIBLE) next.length = MAX_VISIBLE;
      return { toasts: next };
    });

    if (duration > 0) {
      timers.set(id, setTimeout(() => removeToast(id), duration));
    }

    return id;
  }

  function removeToast(id: string): void {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    store.setState((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  }

  function clearAll(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    store.setState(() => ({ toasts: [] }));
  }

  // Convenience shorthands
  const success = (title: string, opts?: Parameters<typeof addToast>[2]) => addToast('success', title, opts);
  const error = (title: string, opts?: Parameters<typeof addToast>[2]) => addToast('error', title, opts);
  const warning = (title: string, opts?: Parameters<typeof addToast>[2]) => addToast('warning', title, opts);
  const info = (title: string, opts?: Parameters<typeof addToast>[2]) => addToast('info', title, opts);

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    addToast,
    removeToast,
    clearAll,
    success,
    error,
    warning,
    info,
  };
}

export const notificationStore = createNotificationStore();
