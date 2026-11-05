import { decodedDetail } from './helpers/decoded-detail.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeAcquaintance,
  decodeItemFinder,
} from '../src/main/services/dat/inventory.ts';
import { linkHotbarReferences } from '../src/main/services/dat/game-data.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
import { buildFileNode } from '../src/renderer/components/browser-model.ts';
import {
  expectRecord,
  expectArray,
  expectRecords,
  expectDefined,
} from './helpers/assertions.ts';

function field(tag: string, bytes: Buffer) {
  const header = Buffer.alloc(3);
  header.write(tag);
  header.writeUInt16LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
const text = (tag: string, value: string) =>
  field(tag, Buffer.from(value + '\0'));
function uint(tag: string, value: number, width: number) {
  const b = Buffer.alloc(width);
  b.writeUIntLE(value, 0, width);
  return field(tag, b);
}
function usageBlock(deadline: bigint) {
  const hex = deadline.toString(16).padStart(16, '0');
  return Buffer.concat([
    ...['004E', hex.slice(0, 4), hex.slice(4, 10), hex.slice(10)].map((v) =>
      text('M', v),
    ),
    ...Array.from({ length: 78 }, (_, i) => [
      text('M', (i + 1).toString(16).padStart(6, '0')),
      text('M', (i === 3 ? 2 : 0).toString(16).padStart(6, '0')),
    ]).flat(),
  ]);
}
function contact(name: string, route: string) {
  return Buffer.concat([
    text('N', name),
    text('W', '示例世界'),
    text('O', '0495'),
    text('T', route),
    text('C', '0040'),
    text('C', '000BE0'),
    text('C', '123456'),
  ]);
}

test('ACQ separates last received tell from ordinary history and reads native command statistics', () => {
  const result = decodeAcquaintance(
    Buffer.concat([
      contact('普通联系人', '1000'),
      contact(' 最后收信者', '4003'),
      usageBlock(1700000000n),
    ]),
    100,
  );
  assert.equal(result.data.contactCount, 1);
  assert.equal(expectArray(result.data.serializedContacts).length, 2);
  assert.equal(
    expectRecords(result.data.contacts)[0].contentId,
    '18014449513411670',
  );
  assert.equal(
    expectRecord(expectRecords(result.data.contacts)[0].route).cycleRoute,
    'extended',
  );
  assert.equal(expectRecord(result.data.lastReceivedTell).name, '最后收信者');
  assert.equal(
    expectRecord(expectRecord(result.data.lastReceivedTell).route)
      .hasReplyContextRoute,
    true,
  );
  assert.equal(
    expectRecord(result.data.mainCommandUsage).aggregationDeadlineUnix,
    '1700000000',
  );
  assert.equal(
    expectArray(expectRecord(result.data.mainCommandUsage).entries).length,
    78,
  );
  assert.equal(
    expectRecords(expectRecord(result.data.mainCommandUsage).entries)[3]
      .useCount,
    4,
  );
  assert.equal(
    expectRecords(expectRecord(result.data.mainCommandUsage).entries)[3]
      .failedUseCount,
    2,
  );
  assert(
    !expectDefined(result.coverage).unknownFields.some(
      (v) => v.field === 'metadataBlock',
    ),
  );
  const empty = decodeAcquaintance(
    Buffer.concat([text('N', ' '), usageBlock(0n)]),
    100,
  );
  assert.equal(empty.data.contactCount, 0);
  assert.equal(expectRecord(empty.data.lastReceivedTell).hasRoutingData, false);
  assert.equal(
    expectArray(expectRecord(empty.data.mainCommandUsage).entries).length,
    78,
  );
});

test('shared macro banks and linked quick-panel names survive the readable projection', () => {
  const slots = [
    { slot: 0, commandType: 7, commandTypeName: 'Macro', commandId: 0x100 },
    { slot: 1, commandType: 15, commandTypeName: 'GearSet', commandId: 23 },
  ];
  linkHotbarReferences(
    slots,
    [],
    [{ id: 23, recordIndex: 23, exists: true, name: '本地套装' }],
    [{ index: 0, name: '公用宏名称' }],
  );
  assert.equal(expectRecord(slots[0]).commandName, '公用宏名称');
  assert.equal(expectRecord(slots[0]).nameSource, 'MACROSYS.DAT#0');
  const sections = readableSections(
    decodedDetail({
      summary: { name: 'UISAVE.DAT' },
      data: {
        segments: [
          {
            id: 41,
            name: 'QPNL',
            data: {
              panels: [
                { index: 0, usesDefaultIcon: true, defaultIconId: 695, slots },
              ],
            },
          },
        ],
      },
    }),
  );
  const rows = expectDefined(
    sections.find((s) => s.id === 'quick-panel-0-slots'),
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.name),
    ['公用宏名称', '本地套装'],
  );
});

test('item-finder cached set bits mean missing components and retain sparse slot identity', () => {
  const retainer = Buffer.alloc(1152);
  retainer.writeBigUInt64LE(123n);
  retainer.writeUInt16LE(17, 8 + 0x452);
  const dresser = Buffer.alloc(4800);
  dresser.writeUInt32LE(45094, 5 * 4);
  dresser.writeUInt16LE(1 << 3, 3200 + 5 * 2);
  const payload = Buffer.concat([
    field('C', Buffer.alloc(8)),
    uint('R', 200, 2),
    uint('N', 1, 4),
    field('I', retainer),
    uint('B', 200, 2),
    field('I', Buffer.alloc(840)),
    uint('M', 203, 2),
    field('I', dresser),
    uint('A', 200, 2),
    uint('N', 32, 4),
    field('F', Buffer.alloc(4)),
  ]);
  const result = decodeItemFinder(payload, 203);
  assert.equal(
    expectRecords(expectRecords(result.data.retainers)[0].crystals)[0].itemId,
    2,
  );
  assert.equal(
    expectRecords(expectRecords(result.data.retainers)[0].crystals)[0].quantity,
    17,
  );
  const set = expectRecords(
    expectRecord(result.data.glamourDresser).outfitSets,
  )[0];
  assert.equal(set.slot, 5);
  assert.equal(set.missingPartCount, 1);
  assert.deepEqual(
    expectRecords(set.components).map((p) => [p.componentIndex, p.isStored]),
    [
      [2, true],
      [3, false],
      [6, true],
    ],
  );
  const detail = decodedDetail({
    summary: { name: 'ITEMFDR.DAT' },
    data: result.data,
  });
  detail.readable = readableSections(detail);
  const crystals = expectDefined(
    detail.readable.find((s) => s.id === 'crystals-0'),
  );
  assert.equal(crystals.rows[0].name, '火之碎晶');
  const dresserNode = expectDefined(
    expectDefined(buildFileNode(detail).children).find(
      (n) => n.title === '投影台',
    ),
  );
  assert.deepEqual(
    expectDefined(expectDefined(dresserNode.children)[0].editTarget).ids,
    ['finder.dresser5'],
  );
  assert(
    expectDefined(expectDefined(dresserNode.children)[0].sections).some(
      (s) => s.id === 'glamourDresser-0-components' && s.rows.length === 3,
    ),
  );
});
