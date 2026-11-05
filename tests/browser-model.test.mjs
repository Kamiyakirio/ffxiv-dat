import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildFileNode,
  resolveNode,
  recordCount,
} from '../src/renderer/components/browser-model.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
const detail = (name, data, header = {}) => {
  const d = { summary: { name }, data, header };
  d.readable = readableSections(d);
  return d;
};

test('every UISAVE segment is a category, while each portrait collects all five views in one record', () => {
  const data = {
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
                  timelineName: '动作 A',
                  cameraPosition: [1, 2, 3],
                },
              ],
            },
            {
              records: [
                {
                  recordIndex: 7,
                  timelineName: '动作 B',
                  cameraPosition: [4, 5, 6],
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const root = buildFileNode(detail('UISAVE.DAT', data));
  assert.equal(root.children.length, 2);
  const portraits = root.children[1];
  assert.equal(portraits.children.length, 2);
  assert.equal(recordCount(portraits), 2);
  const selected = resolveNode(root, [
    portraits.key,
    portraits.children[1].key,
  ]);
  assert.equal(selected.node.title, '肖像 8');
  assert.equal(selected.node.sections.length, 5);
  assert(selected.node.sections.every((s) => s.rows.length === 1));
  assert.deepEqual(selected.node.editTarget.prefixes, ['ui.1.banner.1.7.']);
  assert.deepEqual(
    selected.trail.map((n) => n.title),
    ['UISAVE.DAT', '肖像', '肖像 8'],
  );
});

test('board and object editing scopes remain separate and every object stays accessible', () => {
  const root = buildFileNode(
    detail('UISAVE.DAT', {
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
                      title: 'Test',
                      objects: [
                        { objectName: '圆形', argsA: 321 },
                        { objectName: '文字', text: 'Hello' },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    }),
  );
  const board = root.children[0].children[0];
  assert.equal(board.children.length, 2);
  assert.equal(recordCount(root.children[0]), 1);
  assert.deepEqual(board.editTarget.ids, [
    'ui.0.board.0.0.title',
    'ui.0.board.0.0.background',
  ]);
  assert.deepEqual(board.children[1].editTarget.prefixes, [
    'ui.0.board.0.0.object1.',
  ]);
  assert.equal(board.children[0].raw.argsA, 321);
  assert(root.searchText.includes('Hello'));
});

test('gearset metadata never includes equipment fields and auxiliary records are not editable gearsets', () => {
  const root = buildFileNode(
    detail('GEARSET.DAT', {
      records: [
        {
          recordIndex: 3,
          name: '骑士',
          exists: true,
          isSavedGearsetSlot: true,
          items: [
            {
              slot: 'MainHand',
              slotLabel: '主手',
              itemId: 1,
              itemName: '测试武器',
              materiaDetails: [{ name: '直击 +447' }],
            },
          ],
        },
        { recordIndex: 4, exists: false, items: [] },
        { recordIndex: 100, isSavedGearsetSlot: false, items: [] },
      ],
    }),
  );
  assert.equal(root.children.length, 2);
  assert.equal(root.children[1].empty, true);
  const gear = root.children[0];
  assert(gear.editTarget.ids.every((id) => !id.includes('items')));
  assert.deepEqual(gear.children[0].editTarget.prefixes, ['gear.3.items.0.']);
  assert(gear.children[0].searchText.includes('直击 +447'));
});

test('nested attachment tables follow their mail record rather than becoming unrelated categories', () => {
  const d = detail('UISAVE.DAT', {
    segments: [
      {
        id: 0,
        name: 'LETTER',
        data: {
          records: [
            {
              index: 0,
              recipientName: 'A',
              gil: 10,
              unixTimestamp: 1700000000,
              items: [{ itemId: 1, quantity: 2 }],
            },
            {
              index: 5,
              recipientName: 'B',
              gil: 0,
              items: [{ itemId: 2, quantity: 4 }],
            },
          ],
        },
      },
    ],
  });
  const mail = buildFileNode(d).children[0];
  assert.equal(mail.children.length, 2);
  assert.equal(mail.children[0].title, 'A@未知服务器');
  assert.equal(mail.children[1].title, 'B@未知服务器');
  assert(mail.description.includes('不包含邮件正文'));
  assert(
    mail.children.every((child) =>
      child.sections.some((s) => s.title === '附件'),
    ),
  );
  assert.deepEqual(mail.children[1].editTarget.prefixes, ['ui.0.letter.5.']);
});

test('sparse retainer slots preserve their writer identities and containers become real hierarchy', () => {
  const root = buildFileNode(
    detail('ITEMFDR.DAT', {
      retainers: [
        {
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
  assert.equal(root.children[0].title, '雇员 1');
  assert.equal(root.children[0].children[0].title, '背包');
  const item = root.children[0].children[0].children[0];
  assert.deepEqual(item.editTarget.ids, [
    'finder.ret0.item2',
    'finder.ret0.count2',
  ]);
});

test('general settings stay editable even when a category also contains record lists', () => {
  const root = buildFileNode(
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 31,
          name: 'TFILTER',
          data: {
            setting: 0,
            settingName: '显示过滤词编号',
            termFiltersEnabled: true,
            termFilters: [{ index: 7, term: 'test', channels: ['说话'] }],
          },
        },
      ],
    }),
  );
  const category = root.children[0];
  assert.equal(category.children[0].title, '通用设置');
  assert.deepEqual(category.children[0].editTarget.ids, [
    'ui.0.filterMode',
    'ui.0.enabled',
  ]);
  assert.equal(category.children[1].editTarget.prefixes[0], 'ui.0.term.7.');
});

test('decoded two-bit emote states get stable read-only identities instead of an editable unseen-slot alias', () => {
  const root = buildFileNode(
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 8,
          name: 'EMTH',
          data: {
            history: [1],
            favorites: [2],
            emoteStates: [
              {
                emoteId: 1,
                state: 2,
                stateName: '已解锁未查看',
                isUnseen: true,
                isSeen: false,
              },
              {
                emoteId: 7,
                state: 3,
                stateName: '已查看',
                isUnseen: false,
                isSeen: true,
              },
            ],
          },
        },
      ],
    }),
  );
  const states = root.children[0].children.find(
    (node) => node.key === 'section:8-states',
  );
  assert(states);
  assert.deepEqual(
    states.children.map((node) => node.key),
    ['emote:1', 'emote:7'],
  );
  assert(
    states.children.every(
      (node) => !node.editTarget.ids.length && !node.editTarget.prefixes.length,
    ),
  );
});

test('group-pose light records keep distinct edit targets after XYZ decoding', async () => {
  const { decodeNativeGroupPose } =
    await import('../src/main/services/dat/uisave-pose.ts');
  const data = decodeNativeGroupPose(100, Buffer.alloc(240));
  const root = buildFileNode(
    detail('UISAVE.DAT', { segments: [{ id: 15, name: 'GRPPOS', data }] }),
  );
  const category = root.children[0];
  const lights = category.children.filter((row) =>
    row.editTarget.prefixes?.[0]?.includes('.light.'),
  );
  assert.equal(new Set(lights.map((row) => row.key)).size, 3);
  assert.deepEqual(
    lights.map((row) => row.editTarget.prefixes),
    [['ui.0.light.0.'], ['ui.0.light.1.'], ['ui.0.light.2.']],
  );
});

test('quick-panel icons are read-only while sparse slots retain their physical edit identities', () => {
  const root = buildFileNode(
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 41,
          name: 'QPNL',
          data: {
            panels: Array.from({ length: 4 }, (_, index) => ({
              index,
              usesDefaultIcon: true,
              defaultIconId: 695 + index,
              iconCommandType: 0,
              iconCommandId: 0,
              slots:
                index === 2
                  ? [
                      { slot: 7, commandType: 6, commandId: 3 },
                      { slot: 24, commandType: 1, commandId: 9 },
                    ]
                  : [],
            })),
          },
        },
      ],
    }),
  );
  const category = root.children[0];
  const icons = category.children.find(
    (node) => node.key === 'section:quick-panel-icons',
  );
  assert.equal(new Set(icons.children.map((node) => node.key)).size, 4);
  assert(
    icons.children.every(
      (node) => !node.editTarget.ids.length && !node.editTarget.prefixes.length,
    ),
  );
  const slots = category.children.find(
    (node) => node.key === 'section:quick-panel-2-slots',
  );
  assert.deepEqual(
    slots.children.map((node) => node.editTarget.prefixes),
    [['ui.0.panel.2.7.'], ['ui.0.panel.2.24.']],
  );
});

test('empty collections and reserved chat-filter values remain readable without advertising nonexistent editor fields', async () => {
  const { decodeLogFilter } =
    await import('../src/main/services/dat/inventory.ts');
  const payload = Buffer.alloc(20);
  payload.writeUInt16LE(3, 2);
  payload.writeUInt32LE(4, 4);
  payload.set([0, 1, 2, 9], 16);
  const data = decodeLogFilter(payload, 3).data;
  const root = buildFileNode(detail('LOGFLTR.DAT', data));
  assert.deepEqual(root.children[0].editTarget.ids, ['log.0.0']);
  assert.deepEqual(root.children[1].editTarget.ids, ['log.0.1']);
  for (const record of root.children.slice(2)) {
    assert.equal(record.editTarget.ids.length, 0);
    assert.equal(record.editTarget.prefixes.length, 0);
    assert(record.sections[0].rows.length > 0);
  }
  const empty = buildFileNode(
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 29,
          name: 'FISHING',
          data: { unseenFishIds: [], fishEntries: [] },
        },
      ],
    }),
  );
  assert(!empty.children[0].editTarget?.ids?.length);
  assert(!empty.children[0].editTarget?.prefixes?.length);
});

test('internal gear snapshot has its own read-only page instead of becoming a user gearset', async () => {
  const { decodeGearset } = await import('../src/main/services/dat/layouts.ts');
  const bytes = Buffer.alloc(4 + 101 * 452);
  bytes[1] = 2;
  bytes[2] = 1;
  bytes.write('内部快照', 4 + 100 * 452 + 1);
  bytes.writeUInt32LE(1, 4 + 100 * 452 + 0x38);
  const data = decodeGearset(bytes, 110).data;
  const root = buildFileNode(detail('GEARSET.DAT', data));
  assert.equal(root.children.length, 101);
  const snapshot = root.children.find(
    (child) => child.key === 'equipment-snapshot',
  );
  assert.equal(snapshot.title, '内部装备快照');
  assert.equal(snapshot.editTarget, undefined);
  assert(snapshot.children.every((child) => child.editTarget === undefined));
  assert(
    root.sections[0].rows.some(
      (row) => row.field === '当前装备与套装关联已中断' && row.value === '是',
    ),
  );
});
