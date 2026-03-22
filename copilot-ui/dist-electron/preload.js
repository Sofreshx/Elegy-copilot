"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const DESKTOP_UPDATER_STATE_EVENT = 'desktop-updater:state';
electron_1.contextBridge.exposeInMainWorld('instructionEngineDesktop', {
    platform: process.platform,
    electronVersion: process.versions.electron,
    updater: {
        getState: () => electron_1.ipcRenderer.invoke('desktop-updater:get-state'),
        checkForUpdates: () => electron_1.ipcRenderer.invoke('desktop-updater:check-for-updates'),
        downloadUpdate: () => electron_1.ipcRenderer.invoke('desktop-updater:download-update'),
        restartToUpdate: () => electron_1.ipcRenderer.invoke('desktop-updater:restart-to-update'),
        subscribe: (listener) => {
            const handler = (_event, state) => {
                listener(state);
            };
            electron_1.ipcRenderer.on(DESKTOP_UPDATER_STATE_EVENT, handler);
            return () => {
                electron_1.ipcRenderer.off(DESKTOP_UPDATER_STATE_EVENT, handler);
            };
        },
    },
});
