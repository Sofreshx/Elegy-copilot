import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface UseInstallPromptResult {
  /** Whether the app can be installed (prompt available and not already installed) */
  isInstallable: boolean;
  /** Trigger the browser install prompt. Returns true if user accepted. */
  installApp: () => Promise<boolean>;
}

/**
 * Captures the `beforeinstallprompt` event and exposes a function
 * to trigger the PWA install prompt.
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: BeforeInstallPromptEvent) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Clear prompt if app gets installed
    const installedHandler = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const installApp = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    // Prompt can only be used once
    setDeferredPrompt(null);

    return outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    isInstallable: deferredPrompt !== null,
    installApp,
  };
}
