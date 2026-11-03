import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gameDirectory', {
  scan: (): Promise<string | null> => ipcRenderer.invoke('game-directory:scan'),
});
