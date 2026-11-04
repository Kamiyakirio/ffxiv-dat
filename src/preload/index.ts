import { contextBridge, ipcRenderer } from 'electron';
import type { GameDirectoryApi, DecodeProgress } from '../shared/types';

const gameDirectory: GameDirectoryApi = {
  scan: () => ipcRenderer.invoke('game-directory:scan'),
  choose: () => ipcRenderer.invoke('game-directory:choose'),
  reveal: (directory) => ipcRenderer.invoke('game-directory:reveal', directory),
  decode: (directory) => ipcRenderer.invoke('game-directory:decode', directory),
  cancel: () => ipcRenderer.invoke('game-directory:cancel'),
  result: (id) => ipcRenderer.invoke('game-directory:result', id),
  onProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: DecodeProgress,
    ) => callback(progress);
    ipcRenderer.on('game-directory:progress', listener);
    return () => {
      ipcRenderer.removeListener('game-directory:progress', listener);
    };
  },
};

contextBridge.exposeInMainWorld('gameDirectory', gameDirectory);
