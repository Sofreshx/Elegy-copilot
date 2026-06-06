import { notificationStore, type Toast, type ToastType } from '../stores/notificationStore';
import { useStoreValue } from '../lib/store';

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

interface ToastItemProps {
  toast: Toast;
}

function ToastItem({ toast }: ToastItemProps) {
  return (
    <div
      className={`toast toast--${toast.type}`}
      data-testid={`toast-${toast.id}`}
      role="alert"
    >
      <span className="toast__icon">{TOAST_ICONS[toast.type]}</span>
      <div className="toast__body">
        <span className="toast__title">{toast.title}</span>
        {toast.message && <span className="toast__message">{toast.message}</span>}
      </div>
      {toast.actionLabel && toast.onAction && (
        <button
          className="toast__action"
          type="button"
          onClick={() => {
            toast.onAction?.();
            notificationStore.removeToast(toast.id);
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        className="toast__close"
        type="button"
        onClick={() => notificationStore.removeToast(toast.id)}
        aria-label="Dismiss"
      >
        ×
      </button>
      {toast.duration > 0 && (
        <div
          className="toast__progress"
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      )}
    </div>
  );
}

export default function ToastContainer() {
  const { toasts } = useStoreValue(notificationStore);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" data-testid="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
