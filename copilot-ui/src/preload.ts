import { contextBridge, ipcRenderer } from 'electron';

import type { UpdaterState } from './updater';

const DESKTOP_UPDATER_STATE_EVENT = 'desktop-updater:state';

contextBridge.exposeInMainWorld('instructionEngineDesktop', {
  platform: process.platform,
  electronVersion: process.versions.electron,
  updater: {
    getState: () => ipcRenderer.invoke('desktop-updater:get-state') as Promise<UpdaterState>,
    checkForUpdates: () => ipcRenderer.invoke('desktop-updater:check-for-updates') as Promise<UpdaterState>,
    downloadUpdate: () => ipcRenderer.invoke('desktop-updater:download-update') as Promise<UpdaterState>,
    restartToUpdate: () => ipcRenderer.invoke('desktop-updater:restart-to-update') as Promise<boolean>,
    subscribe: (listener: (state: UpdaterState) => void) => {
      const handler = (_event: unknown, state: UpdaterState) => {
        listener(state);
      };

      ipcRenderer.on(DESKTOP_UPDATER_STATE_EVENT, handler);
      return () => {
        ipcRenderer.off(DESKTOP_UPDATER_STATE_EVENT, handler);
      };
    },
  },
});
