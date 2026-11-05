import { decodedDetail } from './helpers/decoded-detail.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeHotbarCommand,
  itemName,
  linkHotbarReferences,
} from '../src/main/services/dat/game-data.ts';
import { decodeHotbar } from '../src/main/services/dat/layouts.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
import {
  expectRecord,
  expectRecords,
  expectDefined,
} from './helpers/assertions.ts';

function detail(
  name: string,
  data: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  return decodedDetail({ summary: { name }, data, header });
}

test('hotbar names use the correct sheet namespace and keep raw coordinates and identifiers', () => {
  const bytes = Buffer.from([3, 0, 0, 0, 0, 5, 5, 10]);
  const row = expectRecords(decodeHotbar(bytes, 4).data.slots)[0];
  assert.equal(row.commandTypeLabel, '通用技能');
  assert.equal(row.commandName, '极限技');
  assert.equal(row.nameSource, 'GeneralAction#3');
  assert.equal(row.commandId, 3);
  assert.equal(row.barIndex, 5);
  assert.equal(row.slotIndex, 5);
  assert.equal(describeHotbarCommand('Action', 3).commandName, '冲刺');
  assert.equal(describeHotbarCommand('GeneralAction', 4).commandName, '冲刺');
  assert.equal(describeHotbarCommand('Mount', 151).commandName, '雷迦利亚G型');
  assert.equal(
    describeHotbarCommand('GeneralAction', 0xffffffff).commandName,
    null,
  );
  assert.equal(describeHotbarCommand('InventoryItem', 4650).commandName, null);
});

test('item names normalize HQ/collectible identifiers and preserve an explicit unknown fallback', () => {
  assert.equal(itemName(4650), '水煮蛋');
  assert.equal(itemName(1004650), '水煮蛋 · HQ');
  assert.equal(itemName(504650), '水煮蛋 · 收藏品');
  assert.match(itemName(0xffffffff), /未收录物品/);
});

test('local macro and gearset links use saved slot identities instead of unrelated game IDs', () => {
  const slots = [
    { commandTypeName: 'Macro', commandId: 60 },
    { commandTypeName: 'GearSet', commandId: 14 },
    { commandTypeName: 'Macro', commandId: 0x100 },
  ];
  linkHotbarReferences(
    slots,
    [{ index: 60, name: '测试宏' }],
    [{ id: 14, recordIndex: 14, exists: true, name: '学者套装' }],
  );
  assert.equal(expectRecord(slots[0]).commandName, '测试宏');
  assert.equal(expectRecord(slots[1]).commandName, '学者套装');
  assert.equal(expectRecord(slots[2]).commandName, undefined);
});

test('item finder joins names and quantities without shifting empty inventory positions', () => {
  const sections = readableSections(
    detail('ITEMFDR.DAT', {
      retainers: [],
      saddleBag: { itemIds: [0, 1004650, 4650], itemCounts: [0, 23, 7] },
      premiumSaddleBag: { itemIds: [], itemCounts: [] },
      glamourDresser: { itemIds: [] },
      cabinet: { setBitIndices: [] },
    }),
  );
  const bag = expectDefined(sections.find((s) => s.id === 'saddleBag'));
  assert.equal(bag.title, '陆行鸟鞍囊');
  assert.deepEqual(bag.rows, [
    {
      position: '1 / 2',
      item: '水煮蛋 · HQ',
      quantity: 23,
      itemIdRaw: 1004650,
    },
    { position: '1 / 3', item: '水煮蛋', quantity: 7, itemIdRaw: 4650 },
  ]);
  assert.equal(
    JSON.stringify(sections).includes('saddleBagFormatVersion'),
    false,
  );
});

test('each generic file category has business tables and unresolved meanings are not invented', () => {
  const cases = [
    detail('GS.DAT', {
      decks: [{ index: 0, name: '卡组', cardIds: [1] }],
      minionCompanionIds: [],
      unseenTripleTriadCardIds: [],
    }),
    detail('ACQ.DAT', {
      contacts: [
        {
          name: '角色',
          worldName: '服务器',
          inferred: { contentIdCandidate: { hex: '123' } },
        },
      ],
    }),
    detail('ITEMODR.DAT', {
      containers: [
        { name: 'inventory', slots: [{ displayIndex: 0, page: 0, slot: 1 }] },
      ],
      retainers: [],
    }),
    detail('LOGFLTR.DAT', { groups: [{ filterStates: [0, 1, 2] }] }),
    detail('ADDON.DAT', {
      datasets: [
        {
          entries: [
            {
              addonName: 'ItemDetail',
              x: 1,
              y: 2,
              scale: 1,
              width: 30,
              height: 40,
              alpha: 255,
            },
          ],
          layouts: [],
        },
      ],
    }),
    detail(
      'FFXIV_CHARA_01.dat',
      { customize: { race: 3, sex: 1 }, checksumMatches: true },
      { format: 'character-preset' },
    ),
    detail(
      'FFXIV_CFGCPY1234.dat',
      { name: '角色', worldId: 1081, contentIdHex: '123' },
      { format: 'config-copy' },
    ),
  ];
  for (const file of cases)
    assert.ok(
      readableSections(file).some((s) => s.rows.length),
      file.summary.name,
    );
  const filters = readableSections(cases[3]);
  assert.equal(filters[0].rows[0].state, '隐藏');
  assert.equal(filters[0].rows[1].state, '显示');
  assert.equal(filters[0].rows[1].category, '说话');
  assert.equal(filters[0].rows[2].state, '保留项');
  assert.equal(filters[0].rows[0].state.includes('开启'), false);
});

test('UISAVE readable tables are selected by segment and raw metadata remains outside business rows', () => {
  const sections = readableSections(
    detail('UISAVE.DAT', {
      segments: [
        {
          id: 23,
          name: 'BANNER',
          status: 'partial',
          data: {
            interpretation: 'technical',
            records: [{ bannerBg: 7, cameraZoom: 120 }],
            rawHex: 'aabb',
          },
        },
        {
          id: 7,
          name: 'PVPSET',
          status: 'partial',
          data: { unknownU32: [1, 2] },
        },
      ],
    }),
  );
  assert(
    sections.some(
      (s) => s.sourceId === '23' && s.rows.some((r) => r.cameraZoom === 120),
    ),
  );
  assert(
    sections
      .filter((s) => s.sourceId === '7')
      .every(
        (s) =>
          expectDefined(s.note).includes('尚未确认') ||
          expectDefined(s.note).includes('未确认'),
      ),
  );
  assert.equal(JSON.stringify(sections).includes('aabb'), false);
  assert.equal(JSON.stringify(sections).includes('technical'), false);
});

test('selected inventory and collection rows retain source slots across omitted empty entries', async () => {
  const { sectionEditTarget, targetMatches } =
    await import('../src/renderer/components/edit-target.ts');
  const cache = detail('ITEMFDR.DAT', {
    retainers: [],
    saddleBag: { itemIds: [0, 0, 1], itemCounts: [0, 0, 5] },
    premiumSaddleBag: { itemIds: [0, 2], itemCounts: [0, 1] },
    glamourDresser: { itemIds: [] },
    cabinet: { setBitIndices: [] },
  });
  const sections = readableSections(cache),
    saddle = sections.find((s) => s.id === 'saddleBag'),
    premium = sections.find((s) => s.id === 'premiumSaddleBag');
  const target = sectionEditTarget(cache, expectDefined(saddle), 0);
  assert.deepEqual(target.ids, ['finder.bag.item2', 'finder.bag.count2']);
  assert.equal(targetMatches('finder.bag.item0', target), false);
  assert.deepEqual(sectionEditTarget(cache, expectDefined(premium), 0).ids, [
    'finder.bag.item71',
    'finder.bag.count71',
  ]);
  const ui = detail('UISAVE.DAT', {
    segments: [
      {
        id: 14,
        name: 'ARCHVLST',
        data: {
          achievementWatchlist: [0, 1, 0, 2],
          achievements: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
          ],
        },
      },
    ],
  });
  const section = readableSections(ui).find((s) => s.id === '14-achievements');
  assert.deepEqual(sectionEditTarget(ui, expectDefined(section), 1).ids, [
    'ui.0.watch.3',
  ]);
});

test('scalar row source keys select the corresponding writer field instead of another setting', async () => {
  const { sectionEditTarget } =
    await import('../src/renderer/components/edit-target.ts');
  const ui = detail('UISAVE.DAT', {
    segments: [
      {
        id: 37,
        name: 'PERFORM',
        data: { beatsPerMinute: 120, displayControlGuide: true },
      },
    ],
  });
  const section = readableSections(ui)[0];
  assert.deepEqual(section.sourceKeys, [
    'beatsPerMinute',
    'displayControlGuide',
  ]);
  assert.deepEqual(sectionEditTarget(ui, section, 1).ids, ['ui.0.settings1.3']);
});
