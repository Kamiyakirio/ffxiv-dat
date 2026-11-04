import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeAcquaintance,
  decodeLogFilter,
  decodeItemOrder,
} from '../src/main/services/dat/inventory.ts';
import {
  decodeCharacterPreset,
  decodeConfigCopy,
} from '../src/main/services/dat/extras.ts';
import { decodeGearset } from '../src/main/services/dat/layouts.ts';

function field(tag, bytes) {
  const header = Buffer.alloc(3);
  header[0] = tag.charCodeAt(0);
  header.writeUInt16LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
const text = (tag, value) => field(tag, Buffer.from(`${value}\0`));

test('chat filter states map 0/1 to hidden/displayed without treating reserved state 2 as enabled', () => {
  const payload = Buffer.alloc(20);
  payload.writeUInt16LE(1);
  payload.writeUInt16LE(3, 2);
  payload.writeUInt32LE(4, 4);
  payload.set([0, 1, 2, 9], 16);
  const result = decodeLogFilter(payload, 3);
  assert.deepEqual(result.data.groups[0].filters, [
    { filterId: 0, rawState: 0, enabled: false, stateLabel: '隐藏' },
    { filterId: 1, rawState: 1, enabled: true, stateLabel: '显示' },
    { filterId: 2, rawState: 2, enabled: null, stateLabel: '保留项' },
    { filterId: 3, rawState: 9, enabled: null, stateLabel: '未知状态 9' },
  ]);
  assert(
    result.coverage.knownFields.some((field) => field.includes('enabled')),
  );
  assert(
    result.coverage.unknownFields.some((field) =>
      field.reason.includes('0/1/2之外'),
    ),
  );
});

test('ACQ metadata decodes declared paired records exactly while keeping their business purpose unresolved', () => {
  const values = [
    '0002',
    '0000',
    '000065',
    '53F100',
    '000001',
    '000002',
    '000003',
    '000004',
  ];
  const result = decodeAcquaintance(
    Buffer.concat(values.map((value) => text('M', value))),
    100,
  );
  assert.equal(result.data.metadataBlock.recordCount, 2);
  assert.equal(result.data.metadataBlock.integer64, '1700000000');
  assert.deepEqual(
    result.data.metadataBlock.entries.map((entry) => [
      entry.firstValue,
      entry.secondValue,
    ]),
    [
      [1, 2],
      [3, 4],
    ],
  );
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'metadataBlock',
    ),
  );
  assert.equal(
    decodeAcquaintance(
      Buffer.concat(values.slice(0, -1).map((value) => text('M', value))),
      100,
    ).data.metadataBlock,
    null,
  );
});

test('configuration copy preserves exact 64-bit identity and time integers beyond JavaScript safe range', () => {
  const fields = Buffer.concat([
    text('N', '角色'),
    field('W', Buffer.from([0x39, 0x04])),
    text('I', 'FFFF'),
    text('I', 'FFFFFF'),
    text('I', 'FFFFFE'),
    text('T', 'FFFF'),
    text('T', 'FFFFFF'),
    text('T', 'FFFFFF'),
  ]);
  const bytes = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(fields.map((value) => value ^ 0x73)),
  ]);
  const result = decodeConfigCopy(bytes);
  assert.equal(result.data.contentId, '18446744073709551614');
  assert.equal(result.data.timestampInteger, '18446744073709551615');
  assert.equal(result.data.timestampCandidate, null);
  assert.equal(result.coverage.structureComplete, true);
});

test('character presets expose source-defined bit fields and read multibyte comments beyond forty bytes', () => {
  const bytes = Buffer.alloc(212);
  bytes.writeUInt32LE(0x2013ff14);
  bytes.writeUInt32LE(8, 4);
  bytes[23] = 0x80;
  bytes[28] = 0x85;
  bytes[32] = 0x83;
  bytes[35] = 0x84;
  bytes[40] = 0x85;
  const comment = '多字节角色备注'.repeat(5);
  bytes.write(comment, 48, 'utf8');
  let checksum = 0;
  for (let i = 0; i < 32; i++) checksum ^= bytes[16 + i] << (i % 24);
  bytes.writeUInt32LE(checksum >>> 0, 8);
  const result = decodeCharacterPreset(bytes);
  assert.equal(result.data.comment, comment);
  assert.equal(result.data.checksumMatches, true);
  assert.equal(result.data.customize.highlights, true);
  assert.deepEqual(result.data.customize.facialFeaturesEnabled, [
    true,
    false,
    true,
    false,
    false,
    false,
    false,
  ]);
  assert.equal(result.data.customize.legacyTattoo, true);
  assert.equal(result.data.customize.eyeShape, 3);
  assert.equal(result.data.customize.smallIris, true);
  assert.equal(result.data.customize.mouth, 4);
  assert.equal(result.data.customize.lipstick, true);
  assert.equal(result.data.customize.facePaint, 5);
  assert.equal(result.data.customize.facePaintReversed, true);
  assert(result.data.commentTerminatorOffset > 88);
});

test('gearset banner references use the documented plus-one encoding and separate auxiliary records', () => {
  const bytes = Buffer.alloc(4 + 101 * 452);
  bytes[4 + 0x36] = 2;
  const result = decodeGearset(bytes, 110);
  assert.equal(result.data.savedSlotCount, 100);
  assert.equal(result.data.auxiliaryRecordCount, 1);
  assert.equal(result.data.records[0].bannerIndexPlusOne, 2);
  assert.equal(result.data.records[0].bannerIndex, 1);
  assert.equal(result.data.records[0].hasLinkedBanner, true);
  assert.equal(result.data.records[1].bannerIndex, null);
  assert.equal(result.data.records[99].isSavedGearsetSlot, true);
  assert.equal(result.data.records[100].isSavedGearsetSlot, false);
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'records[100..]',
    ),
  );
});

test('item order exposes one-based display locations while preserving raw slot and page numbers', () => {
  const word = (value) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    return b;
  };
  const f = (tag, bytes) =>
    Buffer.concat([Buffer.from([tag.charCodeAt(0), bytes.length]), bytes]);
  const payload = Buffer.concat([
    f('V', word(104)),
    f('n', word(1)),
    f('i', Buffer.from([12, 0, 3, 0])),
    ...Array.from({ length: 12 }, () => f('n', word(0))),
    f('N', word(0)),
    f('n', word(0)),
    f('n', word(0)),
  ]);
  const result = decodeItemOrder(payload, 104);
  assert.deepEqual(result.data.containers[0].locations, [
    { displayPosition: 1, sourcePage: 4, sourceSlot: 13 },
  ]);
  assert.equal(result.data.containers[0].slots[0].slot, 12);
  assert.equal(result.data.containers[0].slots[0].page, 3);
  assert.deepEqual(result.coverage.unknownFields, []);
});
