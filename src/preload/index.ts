import { contextBridge, ipcRenderer } from 'electron';
import type { GameDirectoryApi } from '../shared/types';

const gameDirectory: GameDirectoryApi = {
  scan: (): Promise<string | null> => ipcRenderer.invoke('game-directory:scan'),
};

contextBridge.exposeInMainWorld('gameDirectory', gameDirectory);
