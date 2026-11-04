import { ipcMain } from 'electron';
import { findGameDirectory } from '../services/game-directory-scanner';

export function registerGameDirectoryIpc(signal: AbortSignal): void {
  let activeScan: Promise<string | null> | undefined;

  ipcMain.handle('game-directory:scan', () => {
    activeScan ??= findGameDirectory(undefined, signal).finally(() => {
      activeScan = undefined;
    });

    return activeScan;
  });
}
