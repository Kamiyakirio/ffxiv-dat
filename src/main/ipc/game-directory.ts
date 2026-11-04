import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { findGameDirectories } from '../services/game-directory-scanner';
import { DatWorkspace } from '../services/dat-workspace';
import type { GameDirectory } from '../../shared/types';

export function registerGameDirectoryIpc(signal: AbortSignal): void {
  const workspace = new DatWorkspace();
  let activeScan: Promise<GameDirectory[]> | undefined;
  let decoding: AbortController | null = null;
  let scanning: AbortController | null = null;
  signal.addEventListener(
    'abort',
    () => {
      decoding?.abort();
      scanning?.abort();
    },
    { once: true },
  );

  ipcMain.handle('game-directory:scan', () => {
    activeScan ??= (async () => {
      scanning = new AbortController();
      if (signal.aborted) scanning.abort();
      const directories: GameDirectory[] = [];
      for (const location of await findGameDirectories(
        undefined,
        scanning.signal,
        [
          path.join(
            app.getPath('documents'),
            'My Games',
            'FINAL FANTASY XIV - A Realm Reborn',
          ),
        ],
      )) {
        scanning.signal.throwIfAborted();
        try {
          directories.push(await workspace.locate(location));
        } catch {
          /* Skip empty or inaccessible installations. */
        }
      }
      return directories;
    })().finally(() => {
      activeScan = undefined;
      scanning = null;
    });

    return activeScan;
  });

  ipcMain.handle('game-directory:choose', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择游戏配置目录',
      buttonLabel: '选择此文件夹',
      properties: ['openDirectory'] as ['openDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0]
      ? null
      : workspace.locate(result.filePaths[0]);
  });
  ipcMain.handle(
    'game-directory:reveal',
    async (_event, directory: unknown) => {
      if (typeof directory !== 'string' || !workspace.canReveal(directory))
        throw new Error('请先扫描或选择目录。');
      const error = await shell.openPath(directory);
      if (error) throw new Error(`无法打开文件夹：${error}`);
    },
  );
  ipcMain.handle('game-directory:decode', async (event, directory: unknown) => {
    if (typeof directory !== 'string') throw new Error('请选择游戏配置目录。');
    if (decoding) throw new Error('正在解码，请等待当前任务完成。');
    decoding = new AbortController();
    if (signal.aborted) decoding.abort();
    try {
      return await workspace.decode(directory, decoding.signal, (progress) => {
        if (!event.sender.isDestroyed())
          event.sender.send('game-directory:progress', progress);
      });
    } finally {
      decoding = null;
    }
  });
  ipcMain.handle('game-directory:cancel', () => {
    decoding?.abort();
    scanning?.abort();
  });
  ipcMain.handle('game-directory:result', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('请选择一个文件。');
    return workspace.getResult(id);
  });
}
