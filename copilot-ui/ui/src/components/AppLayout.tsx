import { ReactNode } from 'react';
import RuntimeDisconnectedBanner from './RuntimeDisconnectedBanner';
import WindowControls from './WindowControls';
import DesktopUpdaterShellAction from './DesktopUpdaterShellAction';

interface AppLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  testId?: string;
  appVersion?: string;
  canDownload?: boolean;
  canRestartToUpdate?: boolean;
  onDownloadUpdate?: () => void;
  onRestartToUpdate?: () => void;
}

export default function AppLayout({
  sidebar,
  children,
  testId = 'app-layout',
  appVersion,
  canDownload = false,
  canRestartToUpdate = false,
  onDownloadUpdate,
  onRestartToUpdate,
}: AppLayoutProps) {
  return (
    <div className="app-layout" data-testid={testId}>
      <header className="app-titlebar">
        <span className="app-titlebar-label" data-tauri-drag-region>Elegy Copilot</span>
        <span className="app-titlebar-spacer" data-tauri-drag-region />
        <div className="app-titlebar-actions">
          <DesktopUpdaterShellAction
            canDownload={canDownload}
            canRestartToUpdate={canRestartToUpdate}
            onDownloadUpdate={onDownloadUpdate}
            onRestartToUpdate={onRestartToUpdate}
          />
          <WindowControls />
        </div>
      </header>
      <RuntimeDisconnectedBanner />
      <div className="app-layout-body">
        {sidebar}
        <main className="app-layout-content">
          {children}
        </main>
      </div>
      <footer className="app-layout-footer" data-testid="app-version-footer">
        <span className="app-version">v{appVersion || '0.0.0'}</span>
      </footer>
    </div>
  );
}
