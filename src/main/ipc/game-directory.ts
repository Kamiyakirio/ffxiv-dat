import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { findGameDirectories } from '../services/game-directory-scanner';
import { DatWorkspace } from '../services/dat-workspace';
import { searchGameNames } from '../services/dat/game-data';
import { CharacterManager } from '../services/character-manager';
import type { PortraitWriteRequest } from '../../shared/management';
import type { GameDirectory, DatEditRequest } from '../../shared/types';

export function registerGameDirectoryIpc(signal: AbortSignal): void {
  const workspace = new DatWorkspace();
  const manager = new CharacterManager(
    workspace,
    path.join(app.getPath('userData'), 'backup-locations.json'),
  );
  let activeScan: Promise<GameDirectory[]> | undefined;
  let decoding: AbortController | null = null;
  let scanning: AbortController | null = null;
  let saving = false;
  const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new Error('无效的目录或数据。');
    return value;
  };
  const strings = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== 'string')
    )
      throw new Error('无效的选择列表。');
    return value;
  };
  const mutate = async <T>(operation: () => Promise<T>) => {
    if (decoding || saving) throw new Error('请等待当前任务完成。');
    saving = true;
    try {
      return await manager.exclusive(operation);
    } finally {
      saving = false;
    }
  };
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
    if (decoding || saving)
      throw new Error('正在解码或保存，请等待当前任务完成。');
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
  ipcMain.handle(
    'game-directory:names',
    (_event, sheet: string, query: string) => searchGameNames(sheet, query),
  );
  ipcMain.handle('game-directory:edit', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('请选择一个文件。');
    if (decoding || saving) throw new Error('请等待当前任务完成。');
    return workspace.edit(id);
  });
  ipcMain.handle(
    'game-directory:save',
    async (_event, request: DatEditRequest) => {
      if (
        !request ||
        typeof request.id !== 'string' ||
        typeof request.sha256 !== 'string'
      )
        throw new Error('无效的保存请求。');
      if (decoding || saving) throw new Error('请等待当前任务完成。');
      saving = true;
      try {
        return await workspace.save(request);
      } finally {
        saving = false;
      }
    },
  );

  ipcMain.handle('character-manager:portraits', (_event, directory: unknown) =>
    manager.portraits(text(directory)),
  );
  ipcMain.handle(
    'character-manager:export',
    (_event, directory: unknown, revision: unknown, ids: number[]) =>
      manager.exportPortraits(text(directory), text(revision), ids),
  );
  ipcMain.handle('character-manager:preview', (_event, code: unknown) =>
    manager.previewImport(text(code)),
  );
  ipcMain.handle(
    'character-manager:write',
    (_event, request: PortraitWriteRequest) =>
      mutate(() => manager.writePortraits(request)),
  );
  ipcMain.handle('character-manager:backups', (_event, directory: unknown) =>
    manager.backups(text(directory)),
  );
  ipcMain.handle(
    'character-manager:backup-create',
    (_event, directories: unknown) =>
      mutate(() => manager.createBackups(strings(directories))),
  );
  ipcMain.handle(
    'character-manager:backup-restore',
    (_event, directory: unknown, id: unknown) =>
      mutate(() => manager.restore(text(directory), text(id))),
  );
  ipcMain.handle(
    'character-manager:backup-delete',
    (_event, directory: unknown, ids: unknown) =>
      mutate(() => manager.deleteBackups(text(directory), strings(ids))),
  );
  ipcMain.handle(
    'character-manager:backup-reset',
    (_event, directory: unknown) =>
      mutate(() => manager.setLocation(text(directory), null)),
  );
  ipcMain.handle(
    'character-manager:backup-choose',
    async (event, directory: unknown) => {
      const gamePath = text(directory);
      await workspace.gameDirectory(gamePath);
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: '选择备份存放目录',
        buttonLabel: '使用此备份目录',
        properties: ['openDirectory', 'createDirectory'] as (
          'openDirectory' | 'createDirectory'
        )[],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      return mutate(() => manager.setLocation(gamePath, result.filePaths[0]));
    },
  );
  ipcMain.handle(
    'character-manager:backup-reveal',
    async (_event, directory: unknown) => {
      const error = await shell.openPath(
        await manager.backupLocation(text(directory)),
      );
      if (error) throw new Error(`无法打开备份目录：${error}`);
    },
  );
}
