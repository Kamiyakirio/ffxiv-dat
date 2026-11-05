import './helpers/renderer-dom';
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import App from '../src/renderer/App';
import type { GameDirectory, GameDirectoryApi } from '../src/shared/types';
import type {
  BackupLibrary,
  CharacterManagerApi,
  FolderBackup,
  PortraitCollection,
} from '../src/shared/management';
import {
  changePortraitData,
  decodePortraitCode,
  digest,
  exportPortraitCode,
  readPortraitData,
} from '../src/main/services/portrait-data';
import { bannerRecord, uiSave } from './helpers/portrait-fixtures';

afterEach(() => {
  cleanup();
  mock.restoreAll();
  Reflect.deleteProperty(window, 'gameDirectory');
  Reflect.deleteProperty(window, 'characterManager');
});
const ui = () => within(document.body);
const directory: GameDirectory = {
  path: '/My Games/FFXIV',
  fileCount: 2,
  characters: [
    {
      path: '/My Games/FFXIV/FFXIV_CHR0000000000000001',
      contentId: '0000000000000001',
      names: ['角色甲'],
      fileCount: 1,
    },
    {
      path: '/My Games/FFXIV/FFXIV_CHR0000000000000002',
      contentId: '0000000000000002',
      names: ['角色乙'],
      fileCount: 1,
    },
  ],
};
function bridge() {
  const [a, b] = directory.characters;
  const bytes = new Map<string, Buffer>([
    [a.path, uiSave(a.contentId, [bannerRecord(7, '甲的肖像')])],
    [b.path, uiSave(b.contentId, [bannerRecord(0, '乙的肖像')])],
  ]);
  const collection = async (
    characterPath: string,
  ): Promise<PortraitCollection> => ({
    characterPath,
    revision: digest(bytes.get(characterPath)!),
    portraits: readPortraitData(bytes.get(characterPath)!).records.map(
      (r) => r.summary,
    ),
    capacity: 110,
    available: true,
    warnings: [],
  });
  let library: BackupLibrary = {
    path: '/My Games/FFXIV DAT Backups',
    custom: false,
    backups: [],
    warnings: [],
  };
  const game: GameDirectoryApi = {
    scan: async () => [directory],
    choose: async () => directory,
    reveal: async () => {},
    cancel: async () => {},
    decode: async () => ({
      files: [],
      total: 0,
      processed: 0,
      cancelled: false,
    }),
    result: async () => {
      throw new Error('unused');
    },
    edit: async () => {
      throw new Error('unused');
    },
    save: async () => {
      throw new Error('unused');
    },
    names: async () => [],
    onProgress: () => () => {},
  };
  const api: CharacterManagerApi = {
    portraits: collection,
    exportPortraits: mock.fn(
      async (characterPath: string, _revision: string, ids: number[]) =>
        exportPortraitCode(bytes.get(characterPath)!, ids),
    ),
    previewImport: async (code) => ({
      version: 1,
      portraits: decodePortraitCode(code).map((r) => r.summary),
    }),
    writePortraits: mock.fn(async (request) => {
      bytes.set(
        request.characterPath,
        changePortraitData(bytes.get(request.characterPath)!, request.change),
      );
      return collection(request.characterPath);
    }),
    backups: async () => library,
    createBackups: mock.fn(async (paths: string[]) => {
      const backups: FolderBackup[] = paths.map((p, i) => ({
        id: `backup-${i}`,
        characterId: directory.characters.find((c) => c.path === p)!.contentId,
        characterName: '角色甲',
        sourcePath: p,
        createdAt: '2026-11-05T08:00:00Z',
        fileCount: 3,
        byteLength: 4096,
        reason: 'manual',
      }));
      library = { ...library, backups: [...backups, ...library.backups] };
      return backups;
    }),
    restoreBackup: mock.fn(async () => {}),
    deleteBackups: mock.fn(async (_root: string, ids: string[]) => {
      library = {
        ...library,
        backups: library.backups.filter((b) => !ids.includes(b.id)),
      };
    }),
    chooseBackupLocation: async () => {
      library = {
        ...library,
        path: '/chosen-backups',
        custom: true,
        backups: [],
      };
      return library;
    },
    resetBackupLocation: async () => {
      library = {
        ...library,
        path: '/My Games/FFXIV DAT Backups',
        custom: false,
        backups: [],
      };
      return library;
    },
    revealBackupLocation: async () => {},
  };
  window.gameDirectory = game;
  window.characterManager = api;
  return { api, game, bytes, a, b };
}
async function start() {
  render(<App />);
  await ui().findByRole('checkbox', { name: '选择甲的肖像（槽位 8）' });
}

test('portrait management is the default and batch copy pastes full settings into a new portrait on another character', async () => {
  const { api, a, b } = bridge();
  await start();
  assert.equal(ui().queryByRole('button', { name: '开始解码' }), null);
  fireEvent.click(
    ui().getByRole('checkbox', { name: '选择甲的肖像（槽位 8）' }),
  );
  fireEvent.click(ui().getByRole('button', { name: '复制肖像' }));
  await ui().findByText(/已复制 1 个肖像/);
  fireEvent.click(ui().getByRole('button', { name: /角色乙@/ }));
  await ui().findByRole('checkbox', { name: '选择乙的肖像（槽位 1）' });
  fireEvent.click(ui().getByRole('button', { name: '粘贴到此角色' }));
  await ui().findByText('已读取 1 个肖像');
  fireEvent.click(ui().getByRole('button', { name: '新建 1 个肖像' }));
  await ui().findByRole('checkbox', { name: '选择甲的肖像（槽位 2）' });
  const request = (
    api.writePortraits as ReturnType<typeof mock.fn<typeof api.writePortraits>>
  ).mock.calls[0].arguments[0];
  assert.equal(request.characterPath, b.path);
  assert.equal(request.change.type, 'import');
  assert.equal((await api.portraits(a.path)).portraits.length, 1);
  assert.equal((await api.portraits(b.path)).portraits.length, 2);
});

test('import previews the share code and explicit overwrite targets, while delete honors cancellation', async () => {
  const { api, b } = bridge();
  await start();
  const code = exportPortraitCode(
    uiSave('0000000000000002', [bannerRecord(0, '分享来的肖像')]),
    [0],
  );
  fireEvent.click(ui().getByRole('button', { name: '导入分享码' }));
  fireEvent.change(ui().getByRole('textbox', { name: '肖像分享码' }), {
    target: { value: code },
  });
  fireEvent.click(ui().getByRole('button', { name: '读取分享码' }));
  await ui().findByText('已读取 1 个肖像');
  fireEvent.click(ui().getByRole('radio', { name: '覆盖已有肖像' }));
  assert(
    ui()
      .getByRole('button', { name: '覆盖 1 个肖像' })
      .hasAttribute('disabled'),
  );
  fireEvent.click(ui().getByRole('checkbox', { name: /槽位 8 · 甲的肖像/ }));
  mock.method(window, 'confirm', () => true);
  fireEvent.click(ui().getByRole('button', { name: '覆盖 1 个肖像' }));
  await ui().findByRole('checkbox', { name: '选择分享来的肖像（槽位 8）' });
  fireEvent.click(
    ui().getByRole('checkbox', { name: '选择分享来的肖像（槽位 8）' }),
  );
  mock.method(window, 'confirm', () => false);
  fireEvent.click(ui().getByRole('button', { name: '删除所选' }));
  assert.equal(
    (await api.portraits(directory.characters[0].path)).portraits.length,
    1,
  );
  assert.equal((await api.portraits(b.path)).portraits.length, 1);
});

test('backup page supports batch backup, restore, delete and choosing a persistent library location', async () => {
  const { api } = bridge();
  await start();
  fireEvent.click(ui().getByRole('button', { name: '资料夹备份' }));
  await ui().findByText('/My Games/FFXIV DAT Backups');
  fireEvent.click(ui().getByRole('checkbox', { name: '全选角色资料夹' }));
  fireEvent.click(ui().getByRole('button', { name: '备份所选（2）' }));
  await ui().findByText('已备份 2 个角色资料夹。');
  assert.equal(ui().getAllByRole('button', { name: '还原' }).length, 2);
  mock.method(window, 'confirm', () => true);
  fireEvent.click(ui().getAllByRole('button', { name: '还原' })[0]);
  await ui().findByText('资料夹已还原。');
  fireEvent.click(ui().getByRole('checkbox', { name: '全选当前备份' }));
  fireEvent.click(ui().getByRole('button', { name: '删除所选备份（2）' }));
  await ui().findByText('已删除 2 份备份。');
  assert.equal((await api.backups(directory.path)).backups.length, 0);
  fireEvent.click(ui().getByRole('button', { name: '更改位置' }));
  await ui().findByText('/chosen-backups');
  fireEvent.click(ui().getByRole('button', { name: '使用默认位置' }));
  await ui().findByText('/My Games/FFXIV DAT Backups');
});

test('late portrait responses cannot replace the newly selected character and the advanced parser remains reachable', async () => {
  const { api, a } = bridge();
  let finish!: (data: PortraitCollection) => void;
  const read = api.portraits;
  api.portraits = (p) =>
    p === a.path
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : read(p);
  render(<App />);
  await ui().findByRole('button', { name: /角色乙@/ });
  fireEvent.click(ui().getByRole('button', { name: /角色乙@/ }));
  await ui().findByRole('checkbox', { name: '选择乙的肖像（槽位 1）' });
  await act(async () => finish(await read(a.path)));
  assert.equal(
    ui().queryByRole('checkbox', { name: '选择甲的肖像（槽位 8）' }),
    null,
  );
  fireEvent.click(ui().getByRole('button', { name: '高级解析' }));
  await ui().findByRole('button', { name: '开始解码' });
  assert.equal(
    ui().getByRole('button', { name: '高级解析' }).getAttribute('aria-current'),
    'page',
  );
});
