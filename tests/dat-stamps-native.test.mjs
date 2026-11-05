import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeGroupStamps } from '../src/main/services/dat/uisave-stamps.ts';

test('GPSTAMP decodes all five groups and their final name, record, ordering and text slots', () => {
  const data = Buffer.alloc(65556);
  data.fill(0xff, 54928, 59128);
  data[4] = 1;
  data.write('第五组', 5 + 4 * 64, 'utf8');
  const recordOffset = 328 + 1049 * 52;
  data.writeUInt32LE(4, recordOffset);
  data[recordOffset + 4] = 0x81;
  data.writeUInt16LE(0xabcd, recordOffset + 12);
  data[recordOffset + 14] = 0x56;
  data.writeFloatLE(1.5, recordOffset + 16);
  data.writeUInt32LE(0x12345678, recordOffset + 48);
  data.writeUInt32LE(209, 54928 + 1049 * 4);
  data.writeUInt32LE(123, 59128 + 4 * 4);
  data.write('最后一条贴纸文字', 59148 + 49 * 128, 'utf8');
  data[65548 + 4] = 0x82;
  data[65555] = 0x7f;

  const decoded = decodeNativeGroupStamps(103, data);
  assert.equal(decoded.groupCount, 5);
  assert.equal(decoded.recordsPerGroup, 210);
  assert.equal(decoded.recordCount, 1050);
  const group = decoded.groups[4];
  assert.equal(group.name, '第五组');
  assert.equal(group.nameOffset, 261);
  assert.equal(group.savedStateRaw, 1);
  assert.equal(group.hasSavedDataCandidate, true);
  assert.equal(group.recordOffset, 328 + 840 * 52);
  assert.deepEqual(group.orderedRecordIndices, [209]);
  assert.equal(group.order[209], 209);
  assert.equal(group.savedSettingRaw, 123);
  assert.equal(group.texts[9].text, '最后一条贴纸文字');
  assert.equal(group.texts[9].offset, 65420);
  assert.equal(group.displayFlagRaw, 0x82);
  assert.equal(decoded.records[1049].groupIndex, 4);
  assert.equal(decoded.records[1049].slot, 209);
  assert.equal(decoded.records[1049].unknownU32[12], 0x12345678);
  assert.equal(decoded.records[1049].floatCandidateAt16, 1.5);
  assert.deepEqual(decoded.records[1049].storageFields.slice(0, 5), [
    { offset: 0, width: 4, value: 4 },
    { offset: 4, width: 1, value: 0x81 },
    { offset: 8, width: 4, value: 0 },
    { offset: 12, width: 2, value: 0xabcd },
    { offset: 14, width: 1, value: 0x56 },
  ]);
  assert.equal(decoded.reservedTailHex, '00007f');
  assert.equal(decoded.suffix.offset, 59128);
  assert.equal(decoded.suffix.byteLength, 6428);
  assert.equal(decoded.completePartition, true);
  assert(decoded.coverage.unknownFields.some((f) => f.kind === 'meaning'));
});

test('GPSTAMP preserves unknown indices and bytes instead of treating them as validated record references', () => {
  const data = Buffer.alloc(65556, 0xff);
  data.writeUInt32LE(0xfffffffe, 54928);
  data.writeUInt32LE(0x7fc00000, 328 + 16);
  const decoded = decodeNativeGroupStamps(103, data);
  assert.deepEqual(decoded.groups[0].orderedRecordIndices, [0xfffffffe]);
  assert.equal(decoded.records[0].floatCandidateAt16, null);
  assert.equal(decoded.records[0].unknownU32[4], 0x7fc00000);
  assert.equal(decoded.records[0].rawHex.length, 104);
  assert.equal(decoded.reservedPrefixHex, 'ffffff');
});

test('GPSTAMP refuses older conversion layouts, unknown versions and incorrect lengths', () => {
  for (const version of [100, 101, 102, 104]) {
    assert.equal(decodeNativeGroupStamps(version, Buffer.alloc(65556)), null);
  }
  assert.equal(decodeNativeGroupStamps(103, Buffer.alloc(65555)), null);
  assert.equal(decodeNativeGroupStamps(103, Buffer.alloc(65557)), null);
});

test('GPSTAMP native consumers identify transform, opacity, priority and text formatting fields', () => {
  const data = Buffer.alloc(65556);
  const offset = 328 + 17 * 52;
  data.writeUInt16LE(87, offset + 12);
  data[offset + 14] = 192;
  data.writeFloatLE(1.25, offset + 16);
  data.writeFloatLE(-0.125, offset + 20);
  data.writeFloatLE(0.75, offset + 24);
  data.writeFloatLE(-45.5, offset + 28);
  data.writeUInt32LE(123456, offset + 36);
  data.writeUInt32LE(36, offset + 40);
  data.writeUInt32LE(12, offset + 44);
  data.writeUInt32LE(2, offset + 48);
  data[0] = 1;
  data[65548] = 1;
  const result = decodeNativeGroupStamps(103, data);
  const record = result.records[17];
  assert.equal(record.drawPriority, 87);
  assert.equal(record.alpha, 192);
  assert.equal(record.scale, 1.25);
  assert.deepEqual(record.positionNormalized, { x: -0.125, y: 0.75 });
  assert.equal(record.rotationDegrees, -45.5);
  assert.equal(record.iconId, 123456);
  assert.equal(record.fontSize, 36);
  assert.equal(record.textColorPresetId, 12);
  assert.equal(record.textAlignmentRaw, 2);
  assert.equal(record.textAlignment, 'right');
  assert.equal(result.groups[0].hasSavedData, true);
  assert.equal(result.groups[0].timeFormatAddonId, 14062);
  assert.equal(result.groups[0].clockFormatCandidate, '12-hour');
  assert.equal(result.groups[1].timeFormatAddonId, 14061);
  assert.equal(result.groups[1].clockFormatCandidate, '24-hour');
  assert.ok(result.coverage.knownFields.includes('records.positionNormalized'));
  assert.ok(
    !result.coverage.candidateFields.includes('records.floatCandidateAt16'),
  );
  assert.ok(
    result.coverage.unknownFields.some((field) =>
      field.field.includes('image subtypes'),
    ),
  );
});

test('GPSTAMP keeps exceptional transforms, icon sentinel and unsupported alignment explicit', () => {
  const data = Buffer.alloc(65556);
  data.writeUInt32LE(0x7fc00000, 328 + 16);
  data.writeUInt32LE(0x7f800000, 328 + 20);
  data.writeUInt32LE(0xff800000, 328 + 28);
  data.writeUInt32LE(0xffffffff, 328 + 36);
  data.writeUInt32LE(7, 328 + 48);
  data[328 + 32] = 0x82;
  const result = decodeNativeGroupStamps(103, data);
  const record = result.records[0];
  assert.equal(record.scale, null);
  assert.equal(record.positionNormalized.x, null);
  assert.equal(record.rotationDegrees, null);
  assert.equal(record.iconId, null);
  assert.equal(record.textAlignment, null);
  assert.equal(record.flipHorizontallyRaw, 0x82);
  assert.equal(record.flipHorizontally, null);
  assert.equal(record.unknownU32[4], 0x7fc00000);
  assert.equal(
    record.storageFields.find((field) => field.offset === 36).value,
    0xffffffff,
  );
  assert.ok(
    result.coverage.unknownFields.some(
      (field) => field.field === 'records.textAlignmentRaw',
    ),
  );
  assert.ok(
    result.coverage.unknownFields.some(
      (field) => field.field === 'records transform floats',
    ),
  );
});

test('GPSTAMP first two fields follow the final Win64 argument bindings and image flags retain their raw values', () => {
  const data = Buffer.alloc(65556);
  data.writeUInt32LE(4, 328);
  data[328 + 4] = 0x81;
  data.writeUInt32LE(345, 328 + 8);
  data[328 + 32] = 1;
  data[328 + 33] = 0;
  data.writeUInt32LE(2, 328 + 52);
  data.writeUInt32LE(0xffffffff, 328 + 52 + 8);
  data[328 + 52 + 32] = 0;
  data[328 + 52 + 33] = 1;
  const result = decodeNativeGroupStamps(103, data);
  const [text, image] = result.records;
  assert.equal(text.stampType, 4);
  assert.equal(text.stampTypeName, '文字');
  assert.equal(text.enabledRaw, 0x81);
  assert.equal(text.enabled, true);
  assert.equal(text.catalogEntryId, 345);
  assert.equal(text.flipHorizontally, true);
  assert.equal(text.flipVertically, false);
  assert.equal(text.flipHorizontallyRaw, 1);
  assert.equal(image.stampType, 2);
  assert.equal(image.stampTypeName, '图片');
  assert.equal(image.enabled, false);
  assert.equal(image.catalogEntryIdRaw, 0xffffffff);
  assert.equal(image.catalogEntryId, null);
  assert.equal(image.flipHorizontally, false);
  assert.equal(image.flipVertically, true);
  assert.ok(result.coverage.knownFields.includes('records.enabled'));
  assert.ok(result.coverage.knownFields.includes('records.flipHorizontally'));
  assert.ok(
    !result.coverage.unknownFields.some((field) =>
      field.field.includes('records bytes'),
    ),
  );
});
