declare module 'electron';

declare module 'electron-updater' {
  export const autoUpdater: {
    autoDownload: boolean;
    allowPrerelease: boolean;
    checkForUpdates?: () => Promise<unknown>;
    checkForUpdatesAndNotify: () => Promise<unknown>;
    downloadUpdate?: () => Promise<unknown>;
    quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };
}
