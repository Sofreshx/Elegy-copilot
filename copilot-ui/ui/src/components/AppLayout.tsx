import { ReactNode } from 'react';

import RuntimeDisconnectedBanner from './RuntimeDisconnectedBanner';

interface AppLayoutProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  testId?: string;
  sidebarCollapsed?: boolean;
  appVersion?: string;
}

export default function AppLayout({
  statusBar,
  sidebar,
  children,
  testId = 'app-layout',
  sidebarCollapsed = false,
  appVersion,
}: AppLayoutProps) {
  return (
    <div className="app-layout" data-testid={testId}>
      {statusBar}
      <RuntimeDisconnectedBanner />
      <div className={`app-layout-body${sidebarCollapsed ? ' app-layout-body-collapsed' : ''}`}>
        {sidebar}
        <main className="app-layout-content">
          {children}
        </main>
      </div>
      {appVersion ? (
        <footer className="app-layout-footer" data-testid="app-version-footer">
          <span className="app-version">v{appVersion}</span>
        </footer>
      ) : null}
    </div>
  );
}
