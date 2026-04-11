import { ReactNode } from 'react';

interface AppLayoutProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  testId?: string;
}

export default function AppLayout({
  statusBar,
  sidebar,
  children,
  testId = 'app-layout',
}: AppLayoutProps) {
  return (
    <div className="app-layout" data-testid={testId}>
      {statusBar}
      <div className="app-layout-body">
        {sidebar}
        <main className="app-layout-content">
          {children}
        </main>
      </div>
    </div>
  );
}
