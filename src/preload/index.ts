import { contextBridge, ipcRenderer } from 'electron';
import type { GameDirectoryApi, DecodeProgress } from '../shared/types';
import type { CharacterManagerApi } from '../shared/management';

const gameDirectory: GameDirectoryApi = {
  scan: () => ipcRenderer.invoke('game-directory:scan'),
  choose: () => ipcRenderer.invoke('game-directory:choose'),
  reveal: (directory) => ipcRenderer.invoke('game-directory:reveal', directory),
  decode: (directory) => ipcRenderer.invoke('game-directory:decode', directory),
  cancel: () => ipcRenderer.invoke('game-directory:cancel'),
  result: (id) => ipcRenderer.invoke('game-directory:result', id),
  edit: (id) => ipcRenderer.invoke('game-directory:edit', id),
  names: (sheet, query) =>
    ipcRenderer.invoke('game-directory:names', sheet, query),
  save: (request) => ipcRenderer.invoke('game-directory:save', request),
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

const characterManager: CharacterManagerApi = {
  portraits: (path) => ipcRenderer.invoke('character-manager:portraits', path),
  exportPortraits: (path, revision, ids) =>
    ipcRenderer.invoke('character-manager:export', path, revision, ids),
  previewImport: (code) =>
    ipcRenderer.invoke('character-manager:preview', code),
  writePortraits: (request) =>
    ipcRenderer.invoke('character-manager:write', request),
  backups: (path) => ipcRenderer.invoke('character-manager:backups', path),
  createBackups: (paths) =>
    ipcRenderer.invoke('character-manager:backup-create', paths),
  restoreBackup: (path, id) =>
    ipcRenderer.invoke('character-manager:backup-restore', path, id),
  deleteBackups: (path, ids) =>
    ipcRenderer.invoke('character-manager:backup-delete', path, ids),
  chooseBackupLocation: (path) =>
    ipcRenderer.invoke('character-manager:backup-choose', path),
  resetBackupLocation: (path) =>
    ipcRenderer.invoke('character-manager:backup-reset', path),
  revealBackupLocation: (path) =>
    ipcRenderer.invoke('character-manager:backup-reveal', path),
};
contextBridge.exposeInMainWorld('characterManager', characterManager);
