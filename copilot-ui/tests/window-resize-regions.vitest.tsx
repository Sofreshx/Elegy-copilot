import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopWindowControls, TauriResizeDirection } from '../ui/src/vite-env';

type BridgeMock = {
  [K in keyof DesktopWindowControls]: ReturnType<typeof vi.fn>;
};

const EXPECTED_REGIONS: ReadonlyArray<{ id: string; direction: TauriResizeDirection }> = [
  { id: 'north-west', direction: 'NorthWest' },
  { id: 'north', direction: 'North' },
  { id: 'north-east', direction: 'NorthEast' },
  { id: 'west', direction: 'West' },
  { id: 'east', direction: 'East' },
  { id: 'south-west', direction: 'SouthWest' },
  { id: 'south', direction: 'South' },
  { id: 'south-east', direction: 'SouthEast' },
];

function installBridge(): BridgeMock {
  const bridge: BridgeMock = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    startResizeDragging: vi.fn(async (_direction: TauriResizeDirection) => undefined),
  };
  (window as unknown as {
    instructionEngineDesktop?: { windowControls?: DesktopWindowControls };
  }).instructionEngineDesktop = { windowControls: bridge as unknown as DesktopWindowControls };
  return bridge;
}

function uninstallBridge() {
  delete (window as unknown as { instructionEngineDesktop?: unknown }).instructionEngineDesktop;
}

async function loadWindowResizeRegions() {
  const mod = await import('../ui/src/components/WindowResizeRegions');
  return mod.default;
}

describe('WindowResizeRegions', () => {
  beforeEach(() => {
    uninstallBridge();
  });

  afterEach(() => {
    uninstallBridge();
  });

  it('renders nothing in plain browser mode (no instructionEngineDesktop bridge)', async () => {
    const WindowResizeRegions = await loadWindowResizeRegions();
    const { container } = render(<WindowResizeRegions />);
    expect(container.querySelector('[data-testid="window-resize-regions"]')).toBeNull();
  });

  it('renders nothing when the bridge exists but exposes no windowControls', async () => {
    (window as unknown as { instructionEngineDesktop?: unknown }).instructionEngineDesktop = {};
    const WindowResizeRegions = await loadWindowResizeRegions();
    const { container } = render(<WindowResizeRegions />);
    expect(container.querySelector('[data-testid="window-resize-regions"]')).toBeNull();
  });

  it('renders all eight resize hit zones with the expected Tauri directions in desktop mode', async () => {
    installBridge();
    const WindowResizeRegions = await loadWindowResizeRegions();
    render(<WindowResizeRegions />);

    expect(screen.getByTestId('window-resize-regions')).toBeInTheDocument();

    for (const region of EXPECTED_REGIONS) {
      const node = screen.getByTestId(`window-resize-region-${region.id}`);
      expect(node).toBeInTheDocument();
      expect(node.getAttribute('data-resize-direction')).toBe(region.direction);
    }
  });

  it('invokes startResizeDragging with the matching Tauri direction for every region', async () => {
    const bridge = installBridge();
    const WindowResizeRegions = await loadWindowResizeRegions();
    render(<WindowResizeRegions />);

    for (const region of EXPECTED_REGIONS) {
      const node = screen.getByTestId(`window-resize-region-${region.id}`);
      fireEvent.pointerDown(node, { button: 0 });
      expect(bridge.startResizeDragging).toHaveBeenCalledWith(region.direction);
    }
    expect(bridge.startResizeDragging).toHaveBeenCalledTimes(EXPECTED_REGIONS.length);
  });
});
