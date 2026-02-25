declare module 'electron';

declare module 'electron-updater' {
  export const autoUpdater: {
    autoDownload: boolean;
    allowPrerelease: boolean;
    checkForUpdatesAndNotify: () => Promise<unknown>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };
}
