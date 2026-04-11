import HealthDot from './HealthDot';

interface StatusBarProps {
  sdkHealthClassName: string;
  sdkHealthSummary: string;
  managedCliTone: string;
  managedCliSummary: string;
  desktopUpdaterTone: string;
  desktopUpdaterSummary: string;
  canCheckForUpdates: boolean;
  canDownload: boolean;
  canRestartToUpdate: boolean;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRestartToUpdate: () => void;
  testId?: string;
}

function mapToHealthTone(className: string): 'ok' | 'warn' | 'error' | 'loading' | 'neutral' {
  if (className === 'ok' || className === 'success') return 'ok';
  if (className === 'warn' || className === 'accent') return 'warn';
  if (className === 'error' || className === 'danger') return 'error';
  if (className === 'loading') return 'loading';
  return 'neutral';
}

export default function StatusBar({
  sdkHealthClassName,
  sdkHealthSummary,
  managedCliTone,
  managedCliSummary,
  desktopUpdaterTone,
  desktopUpdaterSummary,
  canCheckForUpdates,
  canDownload,
  canRestartToUpdate,
  onCheckForUpdates,
  onDownloadUpdate,
  onRestartToUpdate,
  testId = 'status-bar',
}: StatusBarProps) {
  return (
    <header className="status-bar" data-testid={testId}>
      <div className="status-bar-indicators">
        <span className="status-bar-item" data-testid="status-bar-sdk">
          <HealthDot tone={mapToHealthTone(sdkHealthClassName)} />
          <span className="status-bar-label">SDK</span>
          <span className="status-bar-value">{sdkHealthSummary}</span>
        </span>

        <span className="status-bar-divider" aria-hidden="true" />

        <span className="status-bar-item" data-testid="status-bar-cli">
          <HealthDot tone={mapToHealthTone(managedCliTone)} />
          <span className="status-bar-label">CLI</span>
          <span className="status-bar-value">{managedCliSummary}</span>
        </span>

        <span className="status-bar-divider" aria-hidden="true" />

        <span className="status-bar-item" data-testid="status-bar-updater">
          <HealthDot tone={mapToHealthTone(desktopUpdaterTone)} />
          <span className="status-bar-label">Update</span>
          <span className="status-bar-value">{desktopUpdaterSummary}</span>
        </span>
      </div>

      <div className="status-bar-actions" data-testid="desktop-updater-actions">
        <button
          className="status-bar-btn"
          data-testid="desktop-updater-check"
          disabled={!canCheckForUpdates}
          onClick={onCheckForUpdates}
          type="button"
        >
          Check updates
        </button>
        {canDownload ? (
          <button
            className="status-bar-btn status-bar-btn-primary"
            data-testid="desktop-updater-download"
            onClick={onDownloadUpdate}
            type="button"
          >
            Download
          </button>
        ) : null}
        {canRestartToUpdate ? (
          <button
            className="status-bar-btn status-bar-btn-primary"
            data-testid="desktop-updater-restart"
            onClick={onRestartToUpdate}
            type="button"
          >
            Install
          </button>
        ) : null}
      </div>
    </header>
  );
}
