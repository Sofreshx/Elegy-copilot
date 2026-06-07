import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

async function loadAppLayout() {
  const mod = await import('../ui/src/components/AppLayout');
  return mod.default;
}

describe('AppLayout (native decorations)', () => {
  it('renders layout shell without custom chrome', async () => {
    const AppLayout = await loadAppLayout();
    render(
      <AppLayout sidebar={<div data-testid="app-layout-sidebar" />} children={<div data-testid="app-layout-content" />} />
    );

    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
    expect(screen.queryByTestId('window-resize-regions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-titlebar')).not.toBeInTheDocument();
  });

  it('renders RuntimeDisconnectedBanner and version footer', async () => {
    const AppLayout = await loadAppLayout();
    render(
      <AppLayout sidebar={<div />} appVersion="2.0.0">
        <div>Content</div>
      </AppLayout>
    );

    expect(screen.getByTestId('app-version-footer')).toBeInTheDocument();
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
  });
});
