import HealthDot from './HealthDot';

interface StatusBarProps {
  desktopUpdaterTone: string;
  desktopUpdaterSummary: string;
  canDownload: boolean;
  canRestartToUpdate: boolean;
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
  desktopUpdaterTone,
  desktopUpdaterSummary,
  canDownload,
  canRestartToUpdate,
  onDownloadUpdate,
  onRestartToUpdate,
  testId = 'status-bar',
}: StatusBarProps) {
  return (
    <header className="status-bar" data-testid={testId}>
      <div className="status-bar-indicators">
        <span className="status-bar-item" data-testid="status-bar-updater">
          <HealthDot tone={mapToHealthTone(desktopUpdaterTone)} />
          <span className="status-bar-label">Update</span>
          <span className="status-bar-value">{desktopUpdaterSummary}</span>
        </span>
      </div>

      <div className="status-bar-actions" data-testid="desktop-updater-actions">
        {canDownload ? (
          <button
            className="status-bar-btn status-bar-btn-primary"
            data-testid="desktop-updater-download"
            onClick={onDownloadUpdate}
            type="button"
          >
            Update
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
