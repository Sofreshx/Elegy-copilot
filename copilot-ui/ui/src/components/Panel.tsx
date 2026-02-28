import { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  subtitle?: string;
  testId?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export default function Panel({
  title = '',
  subtitle = '',
  testId = 'ui-panel',
  actions,
  footer,
  children,
}: PanelProps) {
  return (
    <section className="panel" data-testid={testId}>
      {title || subtitle || actions ? (
        <header className="panel-header">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}

      <div className="panel-content">{children}</div>

      {footer ? <footer className="panel-footer">{footer}</footer> : null}
    </section>
  );
}
