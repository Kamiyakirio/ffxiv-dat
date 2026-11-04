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
  DecodeProgress,
  DecodedFileDetail,
  DecodedFileSummary,
  GameDirectory,
  GameDirectoryApi,
} from '../src/shared/types';
import App from '../src/renderer/App';
import DecodedContent from '../src/renderer/components/DecodedContent';
import JsonTree from '../src/renderer/components/JsonTree';
import { readableSections } from '../src/main/services/dat/readable';
import { decodeHotbar } from '../src/main/services/dat/layouts';

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
): DecodedFileDetail {
  const result: DecodedFileDetail = {
    summary: summary(name),
    data,
    header: { version: 1 },
    checks: [],
    warnings: [],
    sha256: 'abc123',
  };
  result.readable = readableSections(result);
  return result;
}

function bridge(files = [summary('COMMON.DAT'), summary('KEYBIND.DAT')]) {
  let progressListener: ((progress: DecodeProgress) => void) | undefined;
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
      detail(id, { entries: [{ name: 'BattleEffectSelf', value: 1 }] }),
    edit: async (id) => ({ id, sha256: 'abc123', fields: [], notes: [] }),
    names: async () => [],
    save: async () => {
      throw new Error('No save fixture');
    },
    onProgress: (callback) => {
      progressListener = callback;
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
    names: mock.fn(defaults.names),
    save: mock.fn(defaults.save),
    onProgress: mock.fn(defaults.onProgress),
  };
  window.gameDirectory = api;
  return {
    api,
    unsubscribe,
    progress: (value: DecodeProgress) => progressListener?.(value),
  };
}

test('scanner discovers directories, decodes, filters, copies JSON, and unsubscribes', async () => {
  const { api, unsubscribe } = bridge([
    summary('COMMON.DAT'),
    summary('KEYBIND.DAT'),
    summary('MACROSYS.DAT', { characterId: null, category: 'shared' }),
    summary('BACKUP.DAT', {
      characterId: null,
      category: 'backup',
      parentId: 'archive',
    }),
  ]);
  const writeText = mock.fn<(value: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  const view = render(<App />);
  const decode = await view.findByRole('button', { name: '开始解码' });
  fireEvent.click(view.getByRole('button', { name: '打开文件夹' }));
  assert.equal(api.reveal.mock.calls[0].arguments[0], '/game');
  fireEvent.click(decode);
  await view.findByText('BattleEffectSelf');
  assert.equal(api.decode.mock.calls[0].arguments[0], '/game');
  assert.equal(view.queryByRole('button', { name: /MACROSYS.DAT/ }), null);
  fireEvent.click(view.getByRole('button', { name: '复制 JSON' }));
  await view.findByRole('button', { name: '已复制' });
  assert.deepEqual(JSON.parse(writeText.mock.calls[0].arguments[0]), {
    entries: [{ name: 'BattleEffectSelf', value: 1 }],
  });
  fireEvent.change(view.getByRole('combobox', { name: '查看范围' }), {
    target: { value: 'shared' },
  });
  await view.findByRole('heading', { name: 'MACROSYS.DAT' });
  fireEvent.change(view.getByRole('combobox', { name: '查看范围' }), {
    target: { value: 'backup' },
  });
  await view.findByRole('heading', { name: 'BACKUP.DAT' });
  fireEvent.change(view.getByRole('combobox', { name: '查看范围' }), {
    target: { value: 'all' },
  });
  fireEvent.change(view.getByRole('textbox', { name: '搜索文件' }), {
    target: { value: 'keybind' },
  });
  await view.findByRole('heading', { name: 'KEYBIND.DAT' });
  fireEvent.change(view.getByRole('textbox', { name: '搜索文件' }), {
    target: { value: '' },
  });
  view.getByRole('heading', { name: 'KEYBIND.DAT' });
  fireEvent.change(view.getByRole('combobox', { name: '查看范围' }), {
    target: { value: '123456' },
  });
  view.getByRole('heading', { name: 'KEYBIND.DAT' });
  fireEvent.change(view.getByRole('textbox', { name: '搜索文件' }), {
    target: { value: 'missing' },
  });
  view.getByText('没有匹配的文件');
  assert.equal(view.queryByRole('button', { name: '复制 JSON' }), null);
  view.unmount();
  assert.equal(unsubscribe.mock.callCount(), 1);
});

test('switching files ignores late responses and resets the content view', async () => {
  const { api } = bridge();
  const pending = Promise.withResolvers<DecodedFileDetail>();
  api.result.mock.mockImplementation((id) =>
    id === 'COMMON.DAT'
      ? pending.promise
      : Promise.resolve(
          detail(id, {
            bindings: [{ command: 'Jump', keys: [{ keyName: 'SPACE' }] }],
          }),
        ),
  );
  const view = render(<App />);
  fireEvent.click(await view.findByRole('button', { name: '开始解码' }));
  await waitFor(() => assert.equal(api.result.mock.callCount(), 1));
  fireEvent.click(view.getByRole('button', { name: /KEYBIND.DAT/ }));
  await view.findByText('Jump');
  await act(async () =>
    pending.resolve(
      detail('COMMON.DAT', { entries: [{ name: 'Stale', value: 9 }] }),
    ),
  );
  assert.equal(view.queryByText('Stale'), null);
  view.getByRole('heading', { name: 'KEYBIND.DAT' });
  fireEvent.click(view.getByRole('button', { name: '结构数据' }));
  fireEvent.click(view.getByRole('button', { name: /COMMON.DAT/ }));
  await view.findByText('Stale');
  assert.equal(
    view.getByRole('button', { name: '可读内容' }).getAttribute('aria-pressed'),
    'true',
  );
});

test('decode progress and cancellation keep the completed results', async () => {
  const { api, progress } = bridge();
  const pending =
    Promise.withResolvers<Awaited<ReturnType<GameDirectoryApi['decode']>>>();
  api.decode.mock.mockImplementation(() => pending.promise);
  const view = render(<App />);
  fireEvent.click(await view.findByRole('button', { name: '开始解码' }));
  act(() => progress({ current: 1, total: 3, filename: 'COMMON.DAT' }));
  assert.equal((view.getByRole('progressbar') as HTMLProgressElement).value, 1);
  fireEvent.click(view.getByRole('button', { name: '停止解码' }));
  assert.equal(api.cancel.mock.callCount(), 1);
  assert.equal(
    (view.getByRole('button', { name: '正在停止' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  await act(async () =>
    pending.resolve({
      files: [summary('COMMON.DAT')],
      total: 3,
      processed: 1,
      cancelled: true,
    }),
  );
  await view.findByRole('heading', { name: '已停止，保留已完成结果' });
  await view.findByText('BattleEffectSelf');
});

test('scan failures allow manual selection and directory changes clear results', async () => {
  const { api } = bridge();
  api.scan.mock.mockImplementation(async () => {
    throw new Error('Abort scan');
  });
  api.choose.mock.mockImplementation(async () => ({
    ...directory,
    path: '/manual',
  }));
  const view = render(<App />);
  await view.findByText('扫描已停止，可以手动选择文件夹。');
  fireEvent.click(view.getByRole('button', { name: '手动选择文件夹' }));
  fireEvent.click(await view.findByRole('button', { name: '开始解码' }));
  await view.findByText('BattleEffectSelf');
  api.choose.mock.mockImplementation(async () => ({
    ...directory,
    path: '/another',
  }));
  fireEvent.click(view.getByRole('button', { name: '选择文件夹' }));
  await view.findByText('/another', { selector: 'p' });
  assert.equal(view.queryByRole('heading', { name: '解码结果' }), null);
  fireEvent.change(view.getByRole('combobox', { name: '找到 2 个配置目录' }), {
    target: { value: '/manual' },
  });
  view.getByText('/manual', { selector: 'p' });
});

test('detail and clipboard errors are displayed without losing the file list', async () => {
  const { api } = bridge();
  api.result.mock.mockImplementation(async () => {
    throw new Error(
      "Error invoking remote method 'game-directory:result': Error: missing result",
    );
  });
  const view = render(<App />);
  fireEvent.click(await view.findByRole('button', { name: '开始解码' }));
  await view.findByText('missing result');
  api.result.mock.mockImplementation(async (id) => detail(id));
  fireEvent.click(view.getByRole('button', { name: /KEYBIND.DAT/ }));
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
    configurable: true,
  });
  fireEvent.click(await view.findByRole('button', { name: '复制 JSON' }));
  await view.findByText('复制失败，请检查剪贴板权限后重试。');
  view.getByRole('button', { name: /COMMON.DAT/ });
});

test('browser-only rendering explains the missing Electron bridge', () => {
  const view = render(<App />);
  view.getByRole('alert');
  view.getByText('请在 Electron 桌面应用中打开此页面。');
  assert.equal(view.queryByRole('button', { name: '停止扫描' }), null);
});

test('macro pagination, search and empty-slot controls work', () => {
  const macros = Array.from({ length: 12 }, (_, index) => ({
    index,
    name: `Macro ${index}`,
    iconId: index,
    lines: [`/echo ${index}`],
  }));
  macros.push({ index: 12, name: '', iconId: 0, lines: [] });
  const view = render(
    <DecodedContent detail={detail('MACRO.DAT', { macros })} />,
  );
  assert.equal(view.container.querySelectorAll('.macro-record').length, 10);
  fireEvent.click(view.getByRole('button', { name: '下一页' }));
  assert.equal(view.container.querySelectorAll('.macro-record').length, 2);
  fireEvent.change(view.getByRole('textbox', { name: '搜索解码内容' }), {
    target: { value: 'Macro 0' },
  });
  view.getByRole('heading', { name: 'Macro 0' });
  assert.equal(view.queryByRole('button', { name: '上一页' }), null);
  fireEvent.change(view.getByRole('textbox', { name: '搜索解码内容' }), {
    target: { value: '' },
  });
  fireEvent.click(view.getByRole('checkbox', { name: '显示空槽' }));
  fireEvent.click(view.getByRole('button', { name: '下一页' }));
  view.getByRole('heading', { name: '未命名宏' });
});

test('key bindings and settings render readable tables', () => {
  const view = render(
    <DecodedContent
      detail={detail('KEYBIND.DAT', {
        bindings: [
          {
            command: 'Jump',
            keys: [
              { keyName: 'NUMPAD0', modifierNames: ['CTRL'] },
              { unbound: true },
            ],
          },
        ],
      })}
    />,
  );
  view.getByText('CTRL + 小键盘 0');
  view.getByText('未设置');
  view.rerender(
    <DecodedContent
      key="settings"
      detail={detail('CONTROL0.DAT', {
        entries: [{ name: 'MoveMode', section: 'Controls', value: 1 }],
      })}
    />,
  );
  view.getByText('MoveMode');
  view.getByText('Controls');
  view.getByRole('cell', { name: '1' });
});

test('hotbar groups and empty slots filter independently', () => {
  const view = render(
    <DecodedContent
      detail={detail('HOTBAR.DAT', {
        groupIds: [0, 65],
        slots: [
          {
            groupId: 0,
            barIndex: 0,
            slotIndex: 0,
            commandType: 1,
            commandTypeName: 'Action',
            commandId: 100,
          },
          {
            groupId: 0,
            barIndex: 0,
            slotIndex: 1,
            commandType: 0,
            commandTypeName: 'Empty',
            commandId: 0,
          },
          {
            groupId: 65,
            barIndex: 1,
            slotIndex: 0,
            commandType: 1,
            commandTypeName: 'PvP',
            commandId: 200,
          },
        ],
      })}
    />,
  );
  view.getByText('Action');
  assert.equal(view.queryByText('Empty'), null);
  fireEvent.click(view.getByRole('checkbox', { name: '显示空槽' }));
  view.getByText('Empty');
  fireEvent.change(view.getByRole('combobox', { name: '存储组' }), {
    target: { value: '65' },
  });
  view.getByText('PvP');
  assert.equal(view.queryByText('Action'), null);
});

test('gearsets show equipment, glamour, quality and dyes', () => {
  const view = render(
    <DecodedContent
      detail={detail('GEARSET.DAT', {
        records: [
          {
            recordIndex: 0,
            exists: true,
            name: 'Paladin',
            classJobId: 19,
            itemLevel: 700,
            items: [
              {
                slot: 'Weapon',
                baseItemId: 42,
                highQuality: true,
                glamourId: 25,
                stainIds: [1, 2],
              },
            ],
          },
        ],
      })}
    />,
  );
  view.getByText('Paladin');
  view.getByText('42 · HQ');
  view.getByText('1 / 2');
});

test('UISAVE categories show readable records while preserving technical data in the raw view', () => {
  const view = render(
    <DecodedContent
      detail={detail('UISAVE.DAT', {
        segments: [
          {
            id: 3,
            name: 'BANNER',
            status: 'decoded',
            data: { records: [{ name: 'Portrait' }], rawHex: 'aabb' },
          },
          {
            id: 4,
            name: 'TOFU',
            status: 'partial',
            data: { records: [{ name: 'Board' }] },
          },
        ],
      })}
    />,
  );
  assert.equal(
    (view.getByRole('combobox', { name: '配置类别' }) as HTMLSelectElement)
      .value,
    '3',
  );
  assert.equal(view.queryByText('aabb'), null);
  view.getByRole('cell', { name: 'Portrait' });
  fireEvent.change(view.getByRole('combobox', { name: '配置类别' }), {
    target: { value: '4' },
  });
  view.getByRole('cell', { name: 'Board' });
  assert.equal(view.queryByRole('cell', { name: 'Portrait' }), null);
  fireEvent.click(view.getByRole('button', { name: '结构数据' }));
  view.getByRole('button', { name: 'segments 2 项' });
});

test('JSON tree lazily expands containers, pages entries and expands long text', () => {
  const value = Object.fromEntries(
    Array.from({ length: 41 }, (_, index) => [`field${index}`, index]),
  );
  const view = render(<JsonTree value={value} />);
  assert.equal(view.queryByText('field40'), null);
  fireEvent.click(view.getByRole('button', { name: /继续显示 40 项/ }));
  view.getByText('field40');
  view.rerender(
    <JsonTree key="long" value={{ records: [{ text: 'x'.repeat(500) }] }} />,
  );
  assert.equal(view.queryByText('x'.repeat(300)), null);
  fireEvent.click(view.getByRole('button', { name: '记录 1 项' }));
  fireEvent.click(view.getByRole('button', { name: '[0] 1 字段' }));
  fireEvent.click(view.getByRole('button', { name: '展开文本（500 字符）' }));
  view.getByText('x'.repeat(500));
});

test('hotbar readable view shows Limit Break rather than only GeneralAction and 3', () => {
  const data = decodeHotbar(Buffer.from([3, 0, 0, 0, 0, 5, 5, 10]), 4).data;
  const view = render(<DecodedContent detail={detail('HOTBAR.DAT', data)} />);
  view.getByRole('cell', { name: '通用技能' });
  view.getByText('极限技');
  view.getByText('GeneralAction · ID 3');
  fireEvent.change(view.getByRole('textbox', { name: '搜索解码内容' }), {
    target: { value: '极限技' },
  });
  view.getByText('极限技');
});

test('item finder readable view pairs the item name with its quantity and hides format fields', () => {
  const view = render(
    <DecodedContent
      detail={detail('ITEMFDR.DAT', {
        retainers: [],
        retainerFormatVersion: 200,
        saddleBagFormatVersion: 200,
        saddleBag: { itemIds: [0, 4650], itemCounts: [0, 23] },
        premiumSaddleBag: { itemIds: [], itemCounts: [] },
        glamourDresser: { itemIds: [] },
        cabinet: { setBitIndices: [] },
      })}
    />,
  );
  const row = view.getByRole('row', { name: /水煮蛋/ });
  within(row).getByRole('cell', { name: '23' });
  within(row).getByRole('cell', { name: '1 / 2' });
  assert.equal(view.queryByText('retainerFormatVersion'), null);
  assert.equal(view.queryByRole('button', { name: /物品 ID/ }), null);
  fireEvent.click(view.getByRole('button', { name: '结构数据' }));
  view.getByText('retainerFormatVersion');
});

test('coverage distinguishes resolved fields from specific unknown fields instead of warning about every field', () => {
  const value = detail('UISAVE.DAT', {
    segments: [
      {
        id: 23,
        name: 'BANNER',
        status: 'partial',
        coverage: {
          structureComplete: true,
          knownFields: ['镜头位置', '背景名称'],
          candidateFields: [],
          unknownFields: [
            {
              field: 'tag 24',
              reason: '此标签用途尚未定义。',
              kind: 'meaning',
            },
          ],
        },
        data: {
          chunks: [
            {
              records: [
                {
                  recordIndex: 0,
                  backgroundName: '四边形',
                  timelineName: '绅士风度',
                },
              ],
            },
          ],
        },
      },
    ],
  });
  const view = render(<DecodedContent detail={value} />);
  view.getByText('结构读取完整');
  view.getByText(/已解释 2 类字段/);
  view.getByText(/1 项含义或关联待核对/);
  view.getByText('逐项解析范围与剩余缺口');
  view.getByRole('cell', { name: '四边形' });
  view.getByRole('cell', { name: '绅士风度' });
  assert.equal(view.queryByText('含未确认字段'), null);
});

test('editing a file previews changes, saves with its hash and refreshes the selected result', async () => {
  const { api } = bridge([summary('COMMON.DAT')]);
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: ['保存前请退出游戏'],
    fields: [
      {
        id: 'config.0',
        group: '配置项',
        label: '测试设置',
        type: 'text',
        value: '1',
        maxBytes: 20,
      },
    ],
  }));
  api.save.mock.mockImplementation(async () => ({
    report: {
      files: [summary('COMMON.DAT', { id: 'saved' })],
      processed: 1,
      total: 1,
      cancelled: false,
    },
    selectedId: 'saved',
    backupPath: '/game/COMMON.DAT.backup-test',
  }));
  render(<App />);
  await waitFor(() =>
    assert.equal(
      within(document.body)
        .getByRole('button', { name: '开始解码' })
        .hasAttribute('disabled'),
      false,
    ),
  );
  fireEvent.click(
    within(document.body).getByRole('button', { name: '开始解码' }),
  );
  fireEvent.click(
    await within(document.body).findByRole('button', { name: '编辑' }),
  );
  const input = await within(document.body).findByLabelText(/测试设置/);
  fireEvent.change(input, { target: { value: '200' } });
  assert.match(document.body.textContent ?? '', /1 项未保存修改/);
  assert.match(document.body.textContent ?? '', /1 → 200/);
  fireEvent.click(
    within(document.body).getByRole('button', { name: '保存并备份' }),
  );
  await within(document.body).findByText(/保存成功。原文件备份/);
  assert.deepEqual(api.save.mock.calls[0].arguments, [
    {
      id: 'COMMON.DAT',
      sha256: 'abc123',
      changes: [{ id: 'config.0', value: '200' }],
    },
  ]);
  assert.equal(api.result.mock.calls.at(-1)?.arguments[0], 'saved');
  assert.equal(
    within(document.body).queryByRole('region', { name: 'DAT 编辑器' }),
    null,
  );
});

test('editor rejects invalid byte lengths, retains drafts on save failure and guards unsaved navigation', async () => {
  const { api } = bridge();
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      {
        id: 'config.0',
        group: '配置项',
        label: '测试设置',
        type: 'text',
        value: '1',
        maxBytes: 4,
      },
    ],
  }));
  api.save.mock.mockImplementation(async () => {
    throw new Error('文件已被游戏修改');
  });
  const confirm = mock.method(window, 'confirm', () => false);
  render(<App />);
  await waitFor(() =>
    assert.equal(
      within(document.body)
        .getByRole('button', { name: '开始解码' })
        .hasAttribute('disabled'),
      false,
    ),
  );
  fireEvent.click(
    within(document.body).getByRole('button', { name: '开始解码' }),
  );
  fireEvent.click(
    await within(document.body).findByRole('button', { name: '编辑' }),
  );
  const input = await within(document.body).findByLabelText(/测试设置/);
  fireEvent.change(input, { target: { value: '中文' } });
  assert.equal(
    within(document.body)
      .getByRole('button', { name: '保存并备份' })
      .hasAttribute('disabled'),
    true,
  );
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.click(
    within(document.body).getByRole('button', { name: '保存并备份' }),
  );
  await within(document.body).findByText('文件已被游戏修改');
  assert.equal((input as HTMLInputElement).value, '2');
  fireEvent.click(
    within(document.body).getByRole('button', { name: /KEYBIND.DAT/ }),
  );
  assert.equal(confirm.mock.callCount(), 1);
  assert.equal((input as HTMLInputElement).value, '2');
  confirm.mock.mockImplementation(() => true);
  fireEvent.click(
    within(document.body).getByRole('button', { name: /KEYBIND.DAT/ }),
  );
  await waitFor(() =>
    assert.equal(within(document.body).queryByLabelText(/测试设置/), null),
  );
  assert.equal(api.result.mock.calls.at(-1)?.arguments[0], 'KEYBIND.DAT');
});

test('editor reference lookup selects named data instead of requiring a raw numeric ID', async () => {
  const { api } = bridge([summary('GEARSET.DAT')]);
  api.edit.mock.mockImplementation(async (id) => ({
    id,
    sha256: 'abc123',
    notes: [],
    fields: [
      {
        id: 'item',
        group: '装备',
        label: '主手物品',
        type: 'number',
        value: 0,
        min: 0,
        max: 4294967295,
        step: 1,
        reference: 'Item',
      },
    ],
  }));
  api.names.mock.mockImplementation(async () => [
    { value: 123, label: '测试武器' },
  ]);
  render(<App />);
  await waitFor(() =>
    assert.equal(
      within(document.body)
        .getByRole('button', { name: '开始解码' })
        .hasAttribute('disabled'),
      false,
    ),
  );
  fireEvent.click(
    within(document.body).getByRole('button', { name: '开始解码' }),
  );
  fireEvent.click(
    await within(document.body).findByRole('button', { name: '编辑' }),
  );
  fireEvent.click(
    await within(document.body).findByRole('button', { name: '按名称查找' }),
  );
  fireEvent.change(within(document.body).getByLabelText('主手物品名称查找'), {
    target: { value: '武器' },
  });
  fireEvent.click(
    await within(document.body).findByRole('button', {
      name: '测试武器 · 123',
    }),
  );
  assert.equal(
    (within(document.body).getByLabelText(/主手物品装备/) as HTMLInputElement)
      .value,
    '123',
  );
  assert.deepEqual(api.names.mock.calls[0].arguments, ['Item', '武器']);
});
