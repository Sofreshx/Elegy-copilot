import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopWindowControls, TauriResizeDirection } from '../ui/src/vite-env';

type BridgeMock = {
  [K in keyof DesktopWindowControls]: ReturnType<typeof vi.fn>;
};

function installBridge(overrides: Partial<{ [K in keyof DesktopWindowControls]: DesktopWindowControls[K] }> = {}): BridgeMock {
  const bridge: BridgeMock = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    startResizeDragging: vi.fn(async (_direction: TauriResizeDirection) => undefined),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value) {
      (bridge as Record<string, unknown>)[key] = value;
    }
  }
  (window as unknown as {
    instructionEngineDesktop?: { windowControls?: DesktopWindowControls };
  }).instructionEngineDesktop = { windowControls: bridge as unknown as DesktopWindowControls };
  return bridge;
}

function uninstallBridge() {
  delete (window as unknown as { instructionEngineDesktop?: unknown }).instructionEngineDesktop;
}

async function loadWindowControls() {
  const mod = await import('../ui/src/components/WindowControls');
  return mod.default;
}

describe('WindowControls', () => {
  beforeEach(() => {
    uninstallBridge();
  });

  afterEach(() => {
    uninstallBridge();
  });

  it('renders nothing in plain browser mode (no instructionEngineDesktop bridge)', async () => {
    const WindowControls = await loadWindowControls();
    const { container } = render(<WindowControls />);
    expect(container.querySelector('[data-testid="window-controls"]')).toBeNull();
  });

  it('renders nothing when the bridge exists but exposes no windowControls', async () => {
    (window as unknown as { instructionEngineDesktop?: unknown }).instructionEngineDesktop = {};
    const WindowControls = await loadWindowControls();
    const { container } = render(<WindowControls />);
    expect(container.querySelector('[data-testid="window-controls"]')).toBeNull();
  });

  it('renders the three titlebar controls when the bridge exposes windowControls', async () => {
    installBridge();
    const WindowControls = await loadWindowControls();
    render(<WindowControls />);
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
    expect(screen.getByTestId('app-window-minimize')).toBeInTheDocument();
    expect(screen.getByTestId('app-window-maximize')).toBeInTheDocument();
    expect(screen.getByTestId('app-window-close')).toBeInTheDocument();
  });

  it('invokes bridge.minimize when the minimize button is clicked', async () => {
    const bridge = installBridge();
    const WindowControls = await loadWindowControls();
    render(<WindowControls />);
    fireEvent.click(screen.getByTestId('app-window-minimize'));
    await waitFor(() => {
      expect(bridge.minimize).toHaveBeenCalledTimes(1);
    });
  });

  it('invokes bridge.close when the close button is clicked', async () => {
    const bridge = installBridge();
    const WindowControls = await loadWindowControls();
    render(<WindowControls />);
    fireEvent.click(screen.getByTestId('app-window-close'));
    await waitFor(() => {
      expect(bridge.close).toHaveBeenCalledTimes(1);
    });
  });

  it('invokes bridge.toggleMaximize and refreshes isMaximized after toggling', async () => {
    let maximized = false;
    const bridge = installBridge({
      isMaximized: vi.fn(async () => maximized),
      toggleMaximize: vi.fn(async () => {
        maximized = !maximized;
      }),
    });
    const WindowControls = await loadWindowControls();
    render(<WindowControls />);

    const maximizeButton = screen.getByTestId('app-window-maximize');
    expect(maximizeButton).toHaveAttribute('aria-label', 'Maximize');

    fireEvent.click(maximizeButton);

    await waitFor(() => {
      expect(bridge.toggleMaximize).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(bridge.isMaximized).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(maximizeButton).toHaveAttribute('aria-label', 'Restore');
    });
  });

  it('refreshes isMaximized state when the window resize event fires', async () => {
    const isMaximizedMock = vi.fn(async () => false);
    isMaximizedMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(true);
    const bridge = installBridge({ isMaximized: isMaximizedMock });
    const WindowControls = await loadWindowControls();
    render(<WindowControls />);

    await waitFor(() => {
      expect(isMaximizedMock).toHaveBeenCalledTimes(1);
    });

    const maximizeButton = screen.getByTestId('app-window-maximize');
    expect(maximizeButton).toHaveAttribute('aria-label', 'Maximize');

    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(isMaximizedMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(maximizeButton).toHaveAttribute('aria-label', 'Restore');
    });
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
  });
});
