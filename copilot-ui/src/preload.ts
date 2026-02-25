import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('instructionEngineDesktop', {
  platform: process.platform,
  electronVersion: process.versions.electron,
});
