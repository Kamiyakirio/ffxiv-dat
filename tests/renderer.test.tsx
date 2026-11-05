import './helpers/renderer-dom';
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  DecodedFileDetail,
  DecodedFileSummary,
  GameDirectory,
  GameDirectoryApi,
  DecodeProgress,
  EditableField,
} from '../src/shared/types';
import App from '../src/renderer/App';
import DecodedContent from '../src/renderer/components/DecodedContent';
import JsonTree from '../src/renderer/components/JsonTree';
import DatEditor from '../src/renderer/components/DatEditor';
import { readableSections } from '../src/main/services/dat/readable';

afterEach(() => {
  cleanup();
  mock.restoreAll();
  Reflect.deleteProperty(window, 'gameDirectory');
});
const directory: GameDirectory = {
  path: '/game',
  fileCount: 3,
  characters: [
    {
      path: '/game/character',
      contentId: '123456',
      names: ['测试角色'],
      fileCount: 2,
    },
  ],
};
function summary(
  name: string,
  overrides: Partial<DecodedFileSummary> = {},
): DecodedFileSummary {
  return {
    id: name,
    name,
    relativePath: `character/${name}`,
    characterId: '123456',
    category: 'character',
    parentId: null,
    byteLength: 256,
    status: 'decoded',
    warningCount: 0,
    error: null,
    ...overrides,
  };
}
function detail(
  name: string,
  data: Record<string, unknown> = {},
  id = name,
  header: Record<string, unknown> = { version: 1 },
): DecodedFileDetail {
  const result: DecodedFileDetail = {
    summary: summary(name, { id }),
    data,
    header,
    checks: [],
    warnings: [],
    sha256: 'abc123',
  };
  result.readable = readableSections(result);
  return result;
}
const textField = (
  id: string,
  label: string,
  value = '1',
  group = '配置项',
  maxBytes = 20,
): EditableField => ({ id, label, value, group, type: 'text', maxBytes });
const numberField = (
  id: string,
  label: string,
  value = 10,
  group = '设置',
): EditableField => ({
  id,
  label,
  value,
  group,
  type: 'number',
  min: 0,
  max: 65535,
  step: 1,
});
function bridge(files = [summary('COMMON.DAT'), summary('KEYBIND.DAT')]) {
  let listener: ((progress: DecodeProgress) => void) | undefined;
  const unsubscribe = mock.fn();
  const defaults: GameDirectoryApi = {
    scan: async () => [directory],
    choose: async () => directory,
    reveal: async () => {},
    cancel: async () => {},
    decode: async () => ({
      files,
      total: files.length,
      processed: files.length,
      cancelled: false,
    }),
    result: async (id) =>
      detail(id, {
        entries: [{ line: 1, name: 'BattleEffectSelf', value: '1' }],
      }),
    edit: async (id) => ({ id, sha256: 'abc123', fields: [], notes: [] }),
    save: async () => {
      throw Error('No save fixture');
    },
    names: async () => [],
    onProgress: (callback) => {
      listener = callback;
      return unsubscribe;
    },
  };
  const api = {
    scan: mock.fn(defaults.scan),
    choose: mock.fn(defaults.choose),
    reveal: mock.fn(defaults.reveal),
    cancel: mock.fn(defaults.cancel),
    decode: mock.fn(defaults.decode),
    result: mock.fn(defaults.result),
    edit: mock.fn(defaults.edit),
    save: mock.fn(defaults.save),
    names: mock.fn(defaults.names),
    onProgress: mock.fn(defaults.onProgress),
  };
  window.gameDirectory = api;
  return {
    api,
    unsubscribe,
    progress: (value: DecodeProgress) => listener?.(value),
  };
}
const ui = () => within(document.body);
const pageHeading = () =>
  within(document.querySelector('.browser-page') ?? document.body).getByRole(
    'heading',
    { level: 2 },
  );
async function start() {
  render(<App />);
  await waitFor(() =>
    assert.equal(
      ui().getByRole('button', { name: '开始解码' }).hasAttribute('disabled'),
      false,
    ),
  );
  fireEvent.click(ui().getByRole('button', { name: '开始解码' }));
  await ui().findByRole('heading', { name: '配置文件' });
}
async function openFile(name = 'COMMON.DAT') {
  fireEvent.click(
    ui().getByRole('button', { name: new RegExp(name.replaceAll('.', '\\.')) }),
  );
  await ui().findByRole('heading', { name });
}
async function openRow(name: string | RegExp) {
  fireEvent.click(ui().getByRole('button', { name }));
}
async function edit() {
  fireEvent.click(ui().getByRole('button', { name: '编辑' }));
  return ui().findByRole('region', { name: 'DAT 编辑器' });
}
const settingData = {
  entries: [
    { line: 1, name: 'BattleEffectSelf', value: '1' },
    { line: 49, name: 'Target', value: '48' },
  ],
};

test('decode opens a file catalog, collapses setup, and file contents use breadcrumbs', async () => {
  const { api, unsubscribe } = bridge();
  await start();
  assert.equal(ui().queryByRole('heading', { name: 'COMMON.DAT' }), null);
  assert.equal(
    (document.querySelector('.directory-disclosure') as HTMLDetailsElement)
      .open,
    false,
  );
  await openFile();
  assert.equal(api.result.mock.callCount(), 1);
  await openRow(/自身战斗特效/);
  assert.equal(pageHeading().textContent, '自身战斗特效');
  assert.match(
    ui().getByRole('navigation', { name: '当前位置' }).textContent ?? '',
    /配置文件COMMON.DAT自身战斗特效/,
  );
  fireEvent.click(ui().getByRole('button', { name: '技术数据' }));
  const clipboard = mock.fn(async (value: string) => {
    assert.equal(typeof value, 'string');
  });
  mock.method(navigator.clipboard, 'writeText', clipboard);
  fireEvent.click(ui().getByRole('button', { name: '复制 JSON' }));
  await waitFor(() => assert.equal(clipboard.mock.callCount(), 1));
  assert.deepEqual(JSON.parse(clipboard.mock.calls[0].arguments[0]), {
    line: 1,
    name: 'BattleEffectSelf',
    value: '1',
  });
  fireEvent.click(ui().getByRole('button', { name: '配置文件' }));
  await ui().findByRole('heading', { name: '配置文件' });
  cleanup();
  assert.equal(unsubscribe.mock.callCount(), 1);
});

test('file search includes purpose, scope and backups without flattening backup members', async () => {
  bridge([
    summary('UISAVE.DAT'),
    summary('MACROSYS.DAT', { characterId: null, category: 'shared' }),
    summary('RESTORE.DAT', {
      id: 'archive',
      category: 'backup',
      characterId: null,
    }),
    summary('MACRO.DAT', {
      id: 'inside',
      parentId: 'archive',
      category: 'backup',
      characterId: null,
    }),
  ]);
  await start();
  assert(document.querySelector('.file-catalog .file-records.compact-records'));
  fireEvent.change(ui().getByLabelText('搜索文件'), {
    target: { value: '肖像' },
  });
  assert.equal(ui().getAllByRole('button', { name: /UISAVE.DAT/ }).length, 1);
  fireEvent.change(ui().getByLabelText('搜索文件'), { target: { value: '' } });
  fireEvent.change(ui().getByLabelText('角色与来源'), {
    target: { value: 'backup' },
  });
  assert.equal(ui().getAllByRole('button', { name: /RESTORE.DAT/ }).length, 1);
  assert.equal(ui().queryByRole('button', { name: /MACRO.DAT/ }), null);
});

test('archive members open their own file pages with a link back to the archive', async () => {
  const { api } = bridge([
    summary('RESTORE.DAT', { id: 'archive', category: 'backup' }),
    summary('COMMON.DAT', {
      id: 'member',
      parentId: 'archive',
      category: 'backup',
      relativePath: 'archive / COMMON.DAT',
    }),
  ]);
  api.result.mock.mockImplementation(async (id) =>
    id === 'archive'
      ? {
          ...detail(
            'RESTORE.DAT',
            {
              members: [{ name: 'COMMON.DAT', length: 10, status: 'decoded' }],
            },
            id,
            { format: 'character-backup' },
          ),
          summary: summary('RESTORE.DAT', {
            id: 'archive',
            category: 'backup',
          }),
        }
      : {
          ...detail('COMMON.DAT', settingData, id),
          summary: summary('COMMON.DAT', {
            id: 'member',
            parentId: 'archive',
            category: 'backup',
            relativePath: 'archive / COMMON.DAT',
          }),
        },
  );
  await start();
  await openFile('RESTORE.DAT');
  await openRow(/COMMON.DAT/);
  await ui().findByRole('heading', { name: 'COMMON.DAT' });
  const crumb = ui().getByRole('navigation', { name: '当前位置' });
  assert.match(crumb.textContent ?? '', /RESTORE.DATCOMMON.DAT/);
  fireEvent.click(within(crumb).getByRole('button', { name: 'RESTORE.DAT' }));
  await ui().findByRole('heading', { name: 'RESTORE.DAT' });
});

test('late result responses cannot replace a newly opened file and loading pages have a back action', async () => {
  const { api } = bridge();
  let finish!: (value: DecodedFileDetail) => void;
  api.result.mock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await start();
  fireEvent.click(ui().getByRole('button', { name: /COMMON.DAT/ }));
  await ui().findByRole('status', { name: '正在读取配置' });
  fireEvent.click(ui().getByRole('button', { name: '返回配置文件' }));
  await openFile('KEYBIND.DAT');
  await act(async () => finish(detail('COMMON.DAT', settingData)));
  assert.equal(pageHeading().textContent, 'KEYBIND.DAT');
});

test('result failures provide retry and clipboard errors remain local and recoverable', async () => {
  const { api } = bridge();
  api.result.mock.mockImplementationOnce(async () => {
    throw Error('读取失败');
  });
  await start();
  fireEvent.click(ui().getByRole('button', { name: /COMMON.DAT/ }));
  await ui().findByRole('heading', { name: '配置读取失败' });
  fireEvent.click(ui().getByRole('button', { name: '重新读取' }));
  await ui().findByRole('heading', { name: 'COMMON.DAT' });
  fireEvent.click(ui().getByRole('button', { name: '技术数据' }));
  mock.method(navigator.clipboard, 'writeText', async () => {
    throw Error('denied');
  });
  fireEvent.click(ui().getByRole('button', { name: '复制 JSON' }));
  await ui().findByRole('alert');
  assert.match(ui().getByRole('alert').textContent ?? '', /复制失败/);
});

test('decode progress, cancellation and partial results stay usable', async () => {
  const { api, progress } = bridge();
  let finish!: (value: Awaited<ReturnType<GameDirectoryApi['decode']>>) => void;
  api.decode.mock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  await waitFor(() =>
    assert.equal(
      ui().getByRole('button', { name: '开始解码' }).hasAttribute('disabled'),
      false,
    ),
  );
  fireEvent.click(ui().getByRole('button', { name: '开始解码' }));
  act(() => progress({ current: 1, total: 3, filename: 'COMMON.DAT' }));
  assert.equal(
    (document.querySelector('progress') as HTMLProgressElement).value,
    1,
  );
  fireEvent.click(ui().getByRole('button', { name: '停止解码' }));
  assert.equal(api.cancel.mock.callCount(), 1);
  await act(async () =>
    finish({
      files: [summary('COMMON.DAT')],
      processed: 1,
      total: 3,
      cancelled: true,
    }),
  );
  await ui().findByText(/已停止，保留已完成结果/);
  await openFile();
});

test('scan failures allow manual selection and browser-only mode disables native actions', async () => {
  const { api } = bridge();
  api.scan.mock.mockImplementationOnce(async () => {
    throw Error('无访问权限');
  });
  render(<App />);
  await ui().findByRole('alert');
  fireEvent.click(ui().getAllByRole('button', { name: '选择文件夹' })[0]);
  await ui().findByText('测试角色');
  assert.equal(api.choose.mock.callCount(), 1);
  cleanup();
  Reflect.deleteProperty(window, 'gameDirectory');
  render(<App />);
  assert.match(ui().getByRole('alert').textContent ?? '', /Electron/);
  assert.equal(
    ui().getByRole('button', { name: '扫描游戏目录' }).hasAttribute('disabled'),
    true,
  );
});

test('settings searches use source line identities and survive editing, cancel and returning to the list', async () => {
  const { api } = bridge();
  api.result.mock.mockImplementation(async () =>
    detail('COMMON.DAT', settingData),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      textField('config.0', 'Other'),
      textField('config.48', 'Target', '48'),
    ],
  }));
  mock.method(window, 'confirm', () => true);
  await start();
  await openFile();
  fireEvent.change(ui().getByLabelText('搜索当前列表'), {
    target: { value: 'Target' },
  });
  await openRow(/Target/);
  await edit();
  const input = ui().getByLabelText(/Target/);
  assert.equal((input as HTMLInputElement).value, '48');
  assert.equal(ui().queryByLabelText(/Other/), null);
  fireEvent.change(input, { target: { value: '49' } });
  fireEvent.click(ui().getByRole('button', { name: '取消编辑' }));
  assert.equal(pageHeading().textContent, 'Target');
  fireEvent.click(ui().getByRole('button', { name: '返回COMMON.DAT' }));
  assert.equal(
    (ui().getByLabelText('搜索当前列表') as HTMLInputElement).value,
    'Target',
  );
});

test('saving validates the selected record, refreshes hashes and keeps its page with backup feedback', async () => {
  const { api } = bridge();
  let value = '1';
  api.result.mock.mockImplementation(async (id) =>
    detail(
      'COMMON.DAT',
      { entries: [{ line: 1, name: 'BattleEffectSelf', value }] },
      id,
    ),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [textField('config.0', '自身战斗特效', value)],
  }));
  api.save.mock.mockImplementation(async () => {
    value = '2';
    return {
      report: {
        files: [summary('COMMON.DAT', { id: 'saved' })],
        processed: 1,
        total: 1,
        cancelled: false,
      },
      selectedId: 'saved',
      backupPath: '/game/original.backup',
    };
  });
  await start();
  await openFile();
  await openRow(/自身战斗特效/);
  await edit();
  fireEvent.change(ui().getByLabelText(/自身战斗特效/), {
    target: { value: '2' },
  });
  fireEvent.click(ui().getByRole('button', { name: '保存并备份' }));
  await ui().findByText('保存成功，已备份原文件。');
  assert.equal(pageHeading().textContent, '自身战斗特效');
  assert.equal(ui().queryByRole('region', { name: 'DAT 编辑器' }), null);
  assert.deepEqual(api.save.mock.calls[0].arguments, [
    {
      id: 'COMMON.DAT',
      sha256: 'abc123',
      changes: [{ id: 'config.0', value: '2' }],
    },
  ]);
  assert.equal(api.result.mock.calls.at(-1)?.arguments[0], 'saved');
});

test('invalid UTF-8 byte limits block saving and a failed save preserves the draft', async () => {
  const { api } = bridge();
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [textField('config.0', '自身战斗特效', '1', '配置项', 4)],
  }));
  api.save.mock.mockImplementation(async () => {
    throw Error('文件已被游戏修改');
  });
  await start();
  await openFile();
  await openRow(/自身战斗特效/);
  await edit();
  const input = ui().getByLabelText(/自身战斗特效/);
  fireEvent.change(input, { target: { value: '中文' } });
  assert.equal(
    ui().getByRole('button', { name: '保存并备份' }).hasAttribute('disabled'),
    true,
  );
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.click(ui().getByRole('button', { name: '保存并备份' }));
  await ui().findByText('文件已被游戏修改');
  assert.equal((input as HTMLInputElement).value, '2');
});

test('breadcrumb navigation protects unsaved changes and browser Back uses the same guard', async () => {
  const { api } = bridge();
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [textField('config.0', '自身战斗特效')],
  }));
  const confirm = mock.method(window, 'confirm', () => false),
    go = mock.method(window.history, 'go', () => {});
  await start();
  await openFile();
  await openRow(/自身战斗特效/);
  await edit();
  fireEvent.change(ui().getByLabelText(/自身战斗特效/), {
    target: { value: '2' },
  });
  fireEvent.click(ui().getByRole('button', { name: '返回COMMON.DAT' }));
  assert.equal(confirm.mock.callCount(), 1);
  assert.equal(pageHeading().textContent, '编辑 · 自身战斗特效');
  const current = window.history.state.datRoute;
  act(() =>
    window.dispatchEvent(
      new window.PopStateEvent('popstate', {
        state: {
          datRoute: {
            index: current.index - 1,
            route: { file: 'character/COMMON.DAT', path: [] },
          },
        },
      }),
    ),
  );
  assert.equal(confirm.mock.callCount(), 2);
  assert.equal(go.mock.callCount(), 1);
  confirm.mock.mockImplementation(() => true);
  fireEvent.click(ui().getByRole('button', { name: '返回COMMON.DAT' }));
  await ui().findByRole('heading', { name: 'COMMON.DAT' });
  assert.equal(ui().queryByRole('region', { name: 'DAT 编辑器' }), null);
});

test('browser Back returns to the previous page with its search filter', async () => {
  const { api } = bridge();
  api.result.mock.mockImplementation(async () =>
    detail('COMMON.DAT', settingData),
  );
  await start();
  await openFile();
  fireEvent.change(ui().getByLabelText('搜索当前列表'), {
    target: { value: 'Target' },
  });
  await openRow(/Target/);
  act(() => window.history.back());
  await ui().findByRole('heading', { name: 'COMMON.DAT' });
  assert.equal(
    (ui().getByLabelText('搜索当前列表') as HTMLInputElement).value,
    'Target',
  );
});

test('UISAVE exposes categories as pages and each portrait has all its own detail sections', async () => {
  const { api } = bridge([summary('UISAVE.DAT')]);
  api.result.mock.mockImplementation(async () =>
    detail('UISAVE.DAT', {
      segments: [
        { id: 0, name: 'LETTER', data: { records: [] } },
        {
          id: 23,
          name: 'BANNER',
          data: {
            chunks: [
              {
                records: [
                  {
                    recordIndex: 0,
                    timelineName: '冲刺',
                    cameraPosition: [1, 2, 3],
                  },
                ],
              },
              {
                records: [
                  {
                    recordIndex: 7,
                    timelineName: '绅士风度',
                    cameraPosition: [4, 5, 6],
                    directionalLightingColourHex: '#2035ff',
                  },
                ],
              },
            ],
          },
        },
      ],
    }),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      numberField('ui.1.banner.0.0.8.0', '镜头位置 X', 1),
      numberField('ui.1.banner.1.7.8.0', '镜头位置 X', 4),
      numberField('ui.1.banner.1.7.2', '背景', 3),
    ],
  }));
  await start();
  await openFile('UISAVE.DAT');
  assert.equal(ui().queryByLabelText('配置类别'), null);
  await openRow(/^肖像/);
  assert.equal(pageHeading().textContent, '肖像');
  assert(document.querySelector('.compact-records'));
  await openRow(/^肖像 8/);
  assert.equal(pageHeading().textContent, '肖像 8');
  assert.equal(
    ui()
      .getAllByRole('region')
      .filter((region) => region.getAttribute('aria-label') === '镜头与视线')
      .length,
    1,
  );
  assert.match(
    ui().getByRole('region', { name: '镜头与视线' }).textContent ?? '',
    /X 4 · Y 5 · Z 6/,
  );
  assert.equal(ui().queryByLabelText('查看内容'), null);
  assert.equal(ui().queryByText('1 / 2 / 3'), null);
  await edit();
  assert.equal(
    (ui().getByLabelText(/镜头位置 X/) as HTMLInputElement).value,
    '4',
  );
  assert.equal(ui().getAllByLabelText(/镜头位置 X/).length, 1);
  fireEvent.click(ui().getByRole('button', { name: '取消编辑' }));
  assert.equal(pageHeading().textContent, '肖像 8');
  fireEvent.click(ui().getByRole('button', { name: '返回肖像' }));
  assert.equal(pageHeading().textContent, '肖像');
  assert(document.querySelector('.compact-records'));
});

test('board pages lead to individual object pages and keep unknown arguments in technical data', async () => {
  const view = render(
    <DecodedContent
      detail={detail('UISAVE.DAT', {
        segments: [
          {
            id: 28,
            name: 'TOFU',
            data: {
              chunks: [
                {
                  id: 2,
                  data: {
                    records: [
                      {
                        title: '测试战术',
                        objects: [
                          {
                            objectType: 9,
                            objectName: '圆形范围',
                            position: { x: 10, y: 20 },
                            angle: 30,
                            scale: 100,
                            rgba: [255, 0, 0, 0],
                            argsA: 321,
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      })}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: /战术板/ }));
  fireEvent.click(view.getByRole('button', { name: /测试战术/ }));
  fireEvent.click(view.getByRole('button', { name: /圆形范围/ }));
  assert.equal(
    view.getByRole('heading', { level: 2 }).textContent,
    '1 · 圆形范围',
  );
  assert.match(
    view.getByRole('region', { name: '对象属性' }).textContent ?? '',
    /X 10 · Y 20/,
  );
  assert.equal(view.queryByText('321'), null);
  fireEvent.click(view.getByRole('button', { name: '技术数据' }));
  assert.match(view.container.textContent ?? '', /argsA/);
});

test('gearset and equipment pages edit their own fields and name lookup selects a real ID', async () => {
  const { api } = bridge([summary('GEARSET.DAT')]);
  api.result.mock.mockImplementation(async () =>
    detail('GEARSET.DAT', {
      records: [
        {
          recordIndex: 3,
          exists: true,
          name: '套装 A',
          classJobName: '骑士',
          items: [
            {
              slot: 'MainHand',
              slotLabel: '主手',
              itemId: 1,
              itemName: '武器',
              stainNames: ['无染色'],
              materiaDetails: [],
            },
            {
              slot: 'OffHand',
              slotLabel: '副手',
              itemId: 2,
              itemName: '盾',
              stainNames: ['素雪白'],
              materiaDetails: [{ name: '暴击 +447' }],
            },
          ],
        },
      ],
    }),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      textField('gear.3.name', '名称', '套装 A'),
      {
        ...numberField('gear.3.items.1.item', '副手物品', 2),
        reference: 'Item',
      },
      numberField('gear.3.items.0.item', '主手物品', 1),
    ],
  }));
  api.names.mock.mockImplementation(async () => [
    { value: 123, label: '测试盾牌' },
  ]);
  await start();
  await openFile('GEARSET.DAT');
  assert(document.querySelector('.compact-records'));
  await openRow(/^套装 A/);
  assert(document.querySelector('.compact-records'));
  await openRow(/^副手/);
  assert.match(
    ui().getByRole('region', { name: '装备信息' }).textContent ?? '',
    /暴击 \+447/,
  );
  await edit();
  assert.equal(ui().queryByLabelText(/主手物品/), null);
  fireEvent.click(ui().getByRole('button', { name: '按名称查找' }));
  fireEvent.change(ui().getByLabelText('副手物品名称查找'), {
    target: { value: '盾' },
  });
  fireEvent.click(await ui().findByRole('button', { name: '测试盾牌 · 123' }));
  assert.equal(
    (ui().getByLabelText(/副手物品/) as HTMLInputElement).value,
    '123',
  );
});

test('macro list pagination, body search, empty slots and standalone body copying work', async () => {
  const macros = Array.from({ length: 22 }, (_, index) => ({
    index,
    name: index === 21 ? '' : `宏 ${index + 1}`,
    lines: [index === 20 ? '/echo 特定命令' : '/echo hi'],
    iconId: 1,
  }));
  macros[21].lines = [];
  const view = render(
    <DecodedContent detail={detail('MACRO.DAT', { macros })} />,
  );
  assert(view.container.querySelector('.compact-records'));
  assert.equal(view.container.querySelectorAll('.record-link').length, 21);
  fireEvent.change(view.getByLabelText('每页条数'), {
    target: { value: '20' },
  });
  assert.equal(view.container.querySelectorAll('.record-link').length, 20);
  fireEvent.click(view.getByRole('button', { name: '下一页' }));
  assert.equal(view.container.querySelectorAll('.record-link').length, 1);
  fireEvent.click(view.getByLabelText('显示空槽'));
  fireEvent.click(view.getByRole('button', { name: '下一页' }));
  assert.equal(view.container.querySelectorAll('.record-link').length, 2);
  fireEvent.change(view.getByLabelText('搜索当前列表'), {
    target: { value: '特定命令' },
  });
  fireEvent.click(view.getByRole('button', { name: /宏 21/ }));
  assert.match(
    view.container.querySelector('pre')?.textContent ?? '',
    /特定命令/,
  );
  const copy = mock.fn(async (value: string) => {
    assert.equal(typeof value, 'string');
  });
  mock.method(navigator.clipboard, 'writeText', copy);
  fireEvent.click(view.getByRole('button', { name: '复制宏正文' }));
  await waitFor(() => assert.equal(copy.mock.callCount(), 1));
  assert.equal(copy.mock.calls[0].arguments[0], '/echo 特定命令');
});

test('hotbar groups, bars and slots form separate pages with human command names', () => {
  const view = render(
    <DecodedContent
      detail={detail('HOTBAR.DAT', {
        groupIds: [0],
        groupNames: {},
        slots: [
          {
            groupId: 0,
            barIndex: 5,
            slotIndex: 5,
            commandType: 10,
            commandTypeLabel: '通用技能',
            commandName: '极限技',
            commandId: 3,
          },
        ],
      })}
    />,
  );
  assert(view.container.querySelector('.compact-records'));
  fireEvent.click(view.getByRole('button', { name: /共享热键栏/ }));
  assert(view.container.querySelector('.compact-records'));
  fireEvent.click(view.getByRole('button', { name: /热键栏 6/ }));
  fireEvent.click(view.getByRole('button', { name: /槽位 6/ }));
  assert.match(
    view.getByRole('region', { name: '快捷栏内容' }).textContent ?? '',
    /极限技/,
  );
  assert.match(
    view.getByRole('region', { name: '快捷栏内容' }).textContent ?? '',
    /6 \/ 6/,
  );
});

test('retainer caches drill through container pages without losing sparse physical slots', async () => {
  const { api } = bridge([summary('ITEMFDR.DAT')]);
  api.result.mock.mockImplementation(async () =>
    detail('ITEMFDR.DAT', {
      retainers: [
        {
          retainerId: '123',
          itemIds: [0, 0, 1],
          itemCounts: [0, 0, 5],
          equippedItemIds: [],
          crystalQuantities: [],
        },
      ],
      saddleBag: { itemIds: [], itemCounts: [] },
      premiumSaddleBag: { itemIds: [], itemCounts: [] },
      glamourDresser: { itemIds: [] },
      cabinet: { setBitIndices: [] },
    }),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      numberField('finder.ret0.item0', '错误槽位物品', 0),
      numberField('finder.ret0.item2', '物品', 1),
      numberField('finder.ret0.count2', '数量', 5),
    ],
  }));
  await start();
  await openFile('ITEMFDR.DAT');
  await openRow(/^雇员 1/);
  await openRow(/^背包/);
  const row = document.querySelector('.record-link')!;
  fireEvent.click(row);
  await edit();
  assert.equal(ui().queryByLabelText(/错误槽位物品/), null);
  assert.equal((ui().getByLabelText(/数量/) as HTMLInputElement).value, '5');
});

test('key bindings are edited as named keys and modifiers rather than hexadecimal text', async () => {
  const { api } = bridge([summary('KEYBIND.DAT')]);
  api.result.mock.mockImplementation(async () =>
    detail('KEYBIND.DAT', {
      bindings: [
        {
          index: 0,
          command: 'JUMP',
          keys: [{ keyName: 'A', modifierNames: ['Ctrl'] }, { unbound: true }],
        },
      ],
    }),
  );
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [textField('keybind.0', '跳跃绑定', '41.02,00.00', '按键绑定')],
  }));
  await start();
  await openFile('KEYBIND.DAT');
  await openRow(/^移动与镜头/);
  await openRow(/^跳跃/);
  await edit();
  assert.equal(
    (ui().getByLabelText('第一按键') as HTMLSelectElement).value,
    '65',
  );
  const group = ui().getByRole('group', { name: '第一按键' });
  assert.equal(
    (within(group).getByLabelText('Ctrl') as HTMLInputElement).checked,
    true,
  );
  fireEvent.change(ui().getByLabelText('第一按键'), {
    target: { value: '66' },
  });
  assert.match(document.body.textContent ?? '', /42.02,00.00/);
});

test('empty categories remain reachable and technical diagnostics are not the primary view', async () => {
  const { api } = bridge([summary('UISAVE.DAT')]);
  api.result.mock.mockImplementation(async () =>
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 7,
          name: 'PVPSET',
          coverage: {
            structureComplete: false,
            knownFields: [],
            candidateFields: [],
            unknownFields: [{ field: 'bytes', reason: '未知字段' }],
          },
          data: { decodedByteLength: 66 },
        },
        { id: 38, name: 'MKDSJOB', data: { empty: true } },
      ],
    }),
  );
  await start();
  await openFile('UISAVE.DAT');
  assert.equal(ui().getAllByRole('button', { name: /辅助职业设置/ }).length, 1);
  await openRow(/^PvP 设置/);
  assert.equal(ui().queryByText('未知字段'), null);
  assert.equal(ui().queryByRole('button', { name: '编辑' }), null);
  fireEvent.click(ui().getByRole('button', { name: '技术数据' }));
  await ui().findByText(/bytes/);
});

test('JSON trees stay lazy, page long arrays and expand long text', () => {
  const view = render(
    <JsonTree
      value={{
        rows: Array.from({ length: 120 }, (_, i) => i),
        text: 'x'.repeat(500),
      }}
    />,
  );
  assert.equal(view.queryByText('119'), null);
  fireEvent.click(view.getByRole('button', { name: /rows 120 项/ }));
  assert.match(view.container.textContent ?? '', /继续显示/);
  fireEvent.click(view.getByRole('button', { name: /继续显示/ }));
  assert.match(view.container.textContent ?? '', /79/);
  fireEvent.click(view.getByRole('button', { name: /展开文本/ }));
  assert.match(view.container.textContent ?? '', new RegExp('x'.repeat(500)));
});

test('large simple lists use compact rows and keep page size, search and sparse edit targets', () => {
  const onEdit = mock.fn();
  const view = render(
    <DecodedContent
      detail={detail('ITEMFDR.DAT', {
        glamourDresser: {
          itemIds: Array.from({ length: 795 }, (_, i) => (i === 0 ? 0 : 1)),
        },
      })}
      onEdit={onEdit}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: /^投影台/ }));
  const records = () =>
    view.container.querySelectorAll('.compact-records .record-link');
  assert.equal(records().length, 60);
  assert.equal(view.container.querySelector('.detail-sections'), null);
  assert.match(
    view.container.querySelector('.pagination')?.textContent ?? '',
    /1 \/ 14/,
  );
  fireEvent.click(view.getByRole('button', { name: '下一页' }));
  assert.match(records()[0].textContent ?? '', /槽位：62/);
  fireEvent.change(view.getByLabelText('每页条数'), {
    target: { value: '120' },
  });
  assert.equal(records().length, 120);
  assert.match(
    view.container.querySelector('.pagination')?.textContent ?? '',
    /1 \/ 7/,
  );
  fireEvent.click(records()[0]);
  fireEvent.click(view.getByRole('button', { name: '编辑' }));
  assert.deepEqual(onEdit.mock.calls[0].arguments[0].ids, ['finder.dresser1']);
  fireEvent.click(view.getByRole('button', { name: '返回投影台' }));
  assert.equal(
    (view.getByLabelText('每页条数') as HTMLSelectElement).value,
    '120',
  );
  fireEvent.change(view.getByLabelText('搜索当前列表'), {
    target: { value: '槽位：795' },
  });
  assert.equal(records().length, 1);
  assert.equal(view.queryByRole('button', { name: '下一页' }), null);
  fireEvent.click(records()[0]);
  fireEvent.click(view.getByRole('button', { name: '编辑' }));
  assert.deepEqual(onEdit.mock.calls[1].arguments[0].ids, [
    'finder.dresser794',
  ]);
});

test('settings and complex portrait lists both use compact navigation while preserving details', () => {
  const view = render(
    <DecodedContent detail={detail('COMMON.DAT', settingData)} />,
  );
  assert(view.container.querySelector('.compact-records'));
  view.rerender(
    <DecodedContent
      detail={detail('UISAVE.DAT', {
        segments: [
          {
            id: 23,
            name: 'BANNER',
            data: {
              chunks: [
                {
                  records: [
                    {
                      recordIndex: 0,
                      timelineName: '测试动作',
                      cameraPosition: [1, 2, 3],
                    },
                  ],
                },
              ],
            },
          },
        ],
      })}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: /^肖像/ }));
  assert(view.container.querySelector('.compact-records'));
  fireEvent.click(view.getByRole('button', { name: /^肖像 1/ }));
  assert.equal(view.getByRole('heading', { level: 2 }).textContent, '肖像 1');
});

test('portrait lists show all 53 summaries by default and retain five-section detail navigation', () => {
  const view = render(
    <DecodedContent
      detail={detail('UISAVE.DAT', {
        segments: [
          {
            id: 23,
            name: 'BANNER',
            data: {
              chunks: [
                {
                  records: Array.from({ length: 53 }, (_, recordIndex) => ({
                    recordIndex,
                    timelineName: `动作 ${recordIndex + 1}`,
                    backgroundName: '四边形',
                    cameraPosition: [1, 2, 3],
                  })),
                },
              ],
            },
          },
        ],
      })}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: /^肖像/ }));
  assert.equal(
    view.container.querySelectorAll('.compact-records .record-link').length,
    53,
  );
  assert.equal(view.queryByRole('button', { name: '下一页' }), null);
  fireEvent.click(view.getByRole('button', { name: /^肖像 53/ }));
  assert.equal(view.getByRole('heading', { level: 2 }).textContent, '肖像 53');
  assert.equal(view.container.querySelectorAll('.detail-section').length, 5);
  fireEvent.click(view.getByRole('button', { name: '返回肖像' }));
  assert.equal(
    view.container.querySelectorAll('.compact-records .record-link').length,
    53,
  );
});

test('editor fields use shared columns while long text and key bindings retain full width', () => {
  const view = render(
    <DatEditor
      model={{
        id: 'test',
        sha256: 'abc',
        notes: [],
        fields: [
          numberField('zoom', '镜头距离', 3, '镜头'),
          numberField('light', '灯光亮度', 50, '灯光'),
          textField('comment', '长备注', '示例', '说明', 512),
          textField('keybind.0', '按键', '41.02,00.00', '按键', 20),
        ],
      }}
      contextLabel="肖像 1"
      onSaved={() => {}}
      onCancel={() => {}}
      onDirty={() => {}}
      onSaving={() => {}}
    />,
  );
  assert.equal(view.container.querySelectorAll('.editor-field').length, 4);
  assert.equal(view.container.querySelectorAll('.editor-field-wide').length, 2);
  assert(view.container.querySelectorAll('.editor-group-heading').length > 1);
  fireEvent.change(view.getByLabelText('镜头距离'), { target: { value: '4' } });
  assert.match(view.container.textContent ?? '', /修改前：3/);
  assert.equal(
    (view.getByLabelText('长备注') as HTMLInputElement).value,
    '示例',
  );
});
