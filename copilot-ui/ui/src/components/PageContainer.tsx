import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  testId?: string;
  /** Fill mode: adds flex:1, min-height:0, column layout for nested flex views */
  fill?: boolean;
}

export default function PageContainer({ children, testId = 'page-container', fill = false }: PageContainerProps) {
  return (
    <div className={`page-container${fill ? ' page-container-fill' : ''}`} data-testid={testId}>
      {children}
    </div>
  );
}
