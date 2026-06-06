interface DesktopUpdaterShellActionProps {
  canDownload: boolean;
  canRestartToUpdate: boolean;
  onDownloadUpdate?: () => void;
  onRestartToUpdate?: () => void;
}

export default function DesktopUpdaterShellAction({
  canDownload,
  canRestartToUpdate,
  onDownloadUpdate,
  onRestartToUpdate,
}: DesktopUpdaterShellActionProps) {
  const hasActionableUpdate = canDownload || canRestartToUpdate;
  if (!hasActionableUpdate) return null;

  return (
    <span className="app-titlebar-updater" data-testid="desktop-updater-shell-action">
      {canDownload && (
        <button
          className="app-titlebar-updater-btn"
          onClick={onDownloadUpdate}
          data-testid="desktop-updater-download"
          type="button"
          title="Download update"
          aria-label="Download update"
        >
          ↓ Update
        </button>
      )}
      {canRestartToUpdate && (
        <button
          className="app-titlebar-updater-btn"
          onClick={onRestartToUpdate}
          data-testid="desktop-updater-restart"
          type="button"
          title="Install update"
          aria-label="Install update"
        >
          ↻ Install
        </button>
      )}
    </span>
  );
}
