import { ReactNode } from 'react';
import RuntimeDisconnectedBanner from './RuntimeDisconnectedBanner';
import WindowControls from './WindowControls';
import DesktopUpdaterShellAction from './DesktopUpdaterShellAction';

interface AppLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  testId?: string;
  sidebarCollapsed?: boolean;
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
  sidebarCollapsed = false,
  appVersion,
  canDownload = false,
  canRestartToUpdate = false,
  onDownloadUpdate,
  onRestartToUpdate,
}: AppLayoutProps) {
  return (
    <div className="app-layout" data-testid={testId}>
      <header className="app-titlebar" data-tauri-drag-region>
        <span className="app-titlebar-label">Elegy Copilot</span>
        <span className="app-titlebar-spacer" />
        <DesktopUpdaterShellAction
          canDownload={canDownload}
          canRestartToUpdate={canRestartToUpdate}
          onDownloadUpdate={onDownloadUpdate}
          onRestartToUpdate={onRestartToUpdate}
        />
        <WindowControls />
      </header>
      <RuntimeDisconnectedBanner />
      <div className={`app-layout-body${sidebarCollapsed ? ' app-layout-body-collapsed' : ''}`}>
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
