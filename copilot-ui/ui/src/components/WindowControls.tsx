import { useState, useEffect } from 'react';
import type { DesktopWindowControls } from '../vite-env';

function getWindowControls(): DesktopWindowControls | null {
  return window.instructionEngineDesktop?.windowControls ?? null;
}

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const controls = getWindowControls();

  useEffect(() => {
    let cancelled = false;

    async function syncMaximizedState() {
      if (!controls) return;
      try {
        const next = await controls.isMaximized();
        if (!cancelled) {
          setIsMaximized(Boolean(next));
        }
      } catch {
        // best-effort; ignore maximize-state sync failures
      }
    }

    void syncMaximizedState();
    window.addEventListener('resize', syncMaximizedState);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', syncMaximizedState);
    };
  }, [controls]);

  if (!controls) return null;

  async function handleToggleMaximize() {
    if (!controls) return;
    try {
      await controls.toggleMaximize();
    } finally {
      try {
        const next = await controls.isMaximized();
        setIsMaximized(Boolean(next));
      } catch {
        // best-effort; leave previous state if refresh fails
      }
    }
  }

  return (
    <div className="window-controls" data-testid="window-controls">
      <button
        className="window-control-btn"
        onClick={() => { void controls.minimize(); }}
        aria-label="Minimize"
        title="Minimize"
        data-testid="app-window-minimize"
        type="button"
      >
        <span aria-hidden="true">─</span>
      </button>
      <button
        className="window-control-btn"
        onClick={handleToggleMaximize}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        data-testid="app-window-maximize"
        type="button"
      >
        <span aria-hidden="true">{isMaximized ? '❐' : '□'}</span>
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={() => { void controls.close(); }}
        aria-label="Close"
        title="Close"
        data-testid="app-window-close"
        type="button"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
