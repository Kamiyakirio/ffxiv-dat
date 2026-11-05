import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeRemainingUiSegment } from '../src/main/services/dat/uisave-remaining.ts';
import {
  expectRecord,
  expectArray,
  expectRecords,
  expectDefined,
} from './helpers/assertions.ts';

test('GRPSTAMP partitions fixed records and the following array without losing the final record', () => {
  const data = Buffer.alloc(65556);
  const lastRecordOffset = 328 + 1049 * 52;
  data.writeUInt32LE(0x12345678, lastRecordOffset + 48);
  data.writeFloatLE(1.5, lastRecordOffset + 16);
  data.writeUInt32LE(0xffffffff, 54928 + 1049 * 4);
  const decoded = expectDefined(decodeRemainingUiSegment(21, 103, data));
  assert.equal(decoded.recordCount, 1050);
  assert.equal(expectRecords(decoded.records)[1049].offset, lastRecordOffset);
  assert.equal(
    expectArray(expectRecords(decoded.records)[1049].unknownU32)[12],
    0x12345678,
  );
  assert.equal(expectRecords(decoded.records)[1049].floatCandidateAt16, 1.5);
  assert.equal(
    expectArray(expectRecord(decoded.trailingU32Array).values)[1049],
    0xffffffff,
  );
  assert.equal(expectRecord(decoded.suffix).offset, 59128);
  assert.equal(expectRecord(decoded.suffix).byteLength, 6428);
  assert.equal(decoded.completePartition, true);
});

test('unsupported versions and incomplete or extended snapshot layouts remain unparsed', () => {
  assert.equal(decodeRemainingUiSegment(21, 104, Buffer.alloc(65556)), null);
  assert.equal(decodeRemainingUiSegment(21, 103, Buffer.alloc(65555)), null);
  assert.equal(decodeRemainingUiSegment(21, 103, Buffer.alloc(65557)), null);
  assert.equal(decodeRemainingUiSegment(7, 401, Buffer.alloc(66)), null);
  assert.equal(decodeRemainingUiSegment(7, 400, Buffer.alloc(65)), null);
});

test('PVPSET exposes all fifty byte positions and preserves its unverified prefix', () => {
  const data = Buffer.alloc(66);
  data.writeUInt16LE(400, 2);
  data.writeUInt32LE(15, 4);
  data[16] = 3;
  data[65] = 0xa5;
  const decoded = expectDefined(decodeRemainingUiSegment(7, 400, data));
  assert.equal(expectArray(expectRecord(decoded.prefix).unknownU16)[1], 400);
  assert.equal(expectArray(expectRecord(decoded.prefix).unknownU32)[1], 15);
  assert.equal(expectArray(decoded.byteValues).length, 50);
  assert.deepEqual(expectArray(decoded.byteValues)[49], {
    index: 49,
    offset: 65,
    value: 0xa5,
  });
  assert.equal(decoded.completePartition, true);
});
