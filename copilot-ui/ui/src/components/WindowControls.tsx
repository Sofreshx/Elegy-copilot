import { useState, useEffect } from 'react';

interface DesktopWindowControls {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}

function getWindowControls(): DesktopWindowControls | null {
  const win = window as Window & {
    instructionEngineDesktop?: {
      windowControls?: DesktopWindowControls
    }
  };
  return win.instructionEngineDesktop?.windowControls ?? null;
}

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const controls = getWindowControls();

  // Listen for window resize to detect maximize state
  useEffect(() => {
    function checkMaximized() {
      // In Tauri frameless mode, check if window fills the screen
      const isFullscreen = window.outerWidth >= screen.availWidth - 1
        && window.outerHeight >= screen.availHeight - 1;
      setIsMaximized(isFullscreen);
    }
    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, []);

  if (!controls) return null;

  return (
    <div className="window-controls" data-testid="window-controls">
      <button
        className="window-control-btn"
        onClick={controls.minimize}
        aria-label="Minimize"
        title="Minimize"
        data-testid="app-window-minimize"
        type="button"
      >
        <span aria-hidden="true">─</span>
      </button>
      <button
        className="window-control-btn"
        onClick={() => { controls.toggleMaximize(); setIsMaximized(!isMaximized); }}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        data-testid="app-window-maximize"
        type="button"
      >
        <span aria-hidden="true">{isMaximized ? '❐' : '□'}</span>
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={controls.close}
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
