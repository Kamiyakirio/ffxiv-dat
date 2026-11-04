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
