import { ReactNode } from 'react';

import RuntimeDisconnectedBanner from './RuntimeDisconnectedBanner';

interface AppLayoutProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  testId?: string;
  sidebarCollapsed?: boolean;
}

export default function AppLayout({
  statusBar,
  sidebar,
  children,
  testId = 'app-layout',
  sidebarCollapsed = false,
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
    </div>
  );
}
