interface StatusBarProps {
  desktopUpdaterTone: string;
  desktopUpdaterSummary: string;
  canDownload: boolean;
  canRestartToUpdate: boolean;
  onDownloadUpdate: () => void;
  onRestartToUpdate: () => void;
  testId?: string;
  currentVersion?: string;
}

export default function StatusBar({
  canDownload,
  canRestartToUpdate,
  onDownloadUpdate,
  onRestartToUpdate,
  testId = 'status-bar',
}: StatusBarProps) {
  const hasActionableUpdate = canDownload || canRestartToUpdate;
  return (
    <header className="status-bar" data-testid={testId}>
      <div className="status-bar-indicators">
        {hasActionableUpdate ? (
          <span className="status-bar-item" data-testid="status-bar-updater">
            {canDownload ? (
              <button className="status-bar-btn status-bar-btn-primary" data-testid="desktop-updater-download" onClick={onDownloadUpdate} type="button">Update</button>
            ) : null}
            {canRestartToUpdate ? (
              <button className="status-bar-btn status-bar-btn-primary" data-testid="desktop-updater-restart" onClick={onRestartToUpdate} type="button">Install</button>
            ) : null}
          </span>
        ) : null}
      </div>
    </header>
  );
}
