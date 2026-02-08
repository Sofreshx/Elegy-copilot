import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary that catches React rendering errors
 * and shows a recovery UI instead of a blank screen.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <div style={styles.actions}>
              <button onClick={this.handleReset} style={styles.primaryButton}>
                Try Again
              </button>
              <button onClick={this.handleGoHome} style={styles.secondaryButton}>
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '24px',
    background: 'var(--bg, #1a1a2e)',
    color: 'var(--text, #fff)',
  },
  card: {
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  message: {
    fontSize: '14px',
    color: 'var(--text-secondary, #9ca3af)',
    marginBottom: '24px',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  primaryButton: {
    padding: '12px 24px',
    background: 'var(--primary, #6366f1)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '12px 24px',
    background: 'transparent',
    color: 'var(--text-secondary, #9ca3af)',
    border: '1px solid var(--border, #374151)',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
  },
};
