import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeRetainerComments } from '../src/main/services/dat/uisave-retainers.ts';
import {
  expectArray,
  expectRecords,
  expectString,
  expectDefined,
  expectCoverage,
} from './helpers/assertions.ts';

test('RTNR binds the final physical retainer ID and 91-byte comment to its paired arrays', () => {
  const data = Buffer.alloc(1376);
  const offset = 8 + 9 * 136;
  data.writeBigUInt64LE(0xfedcba9876543210n, offset);
  data.write('雇员备注', offset + 8, 'utf8');
  data[offset + 99] = 0x67;
  for (let slot = 0; slot < 10; slot++) {
    data.writeUInt16LE(1000 + slot, offset + 100 + slot * 2);
    data[offset + 120 + slot] = slot;
  }
  data.fill(0x89, offset + 130, offset + 136);
  data.fill(0xab, 1368);
  const decoded = expectDefined(decodeNativeRetainerComments(102, data));
  const last = expectRecords(decoded.retainers)[9];
  assert.equal(decoded.retainers, decoded.retainersCandidate);
  assert.equal(last.index, 9);
  assert.equal(last.offset, offset);
  assert.equal(last.id, '18364758544493064720');
  assert.equal(last.comment, '雇员备注');
  assert.equal(last.alignmentByteRaw, 0x67);
  assert.equal(expectArray(last.savedTaskEntries).length, 10);
  assert.deepEqual(expectArray(last.savedTaskEntries)[9], {
    slot: 9,
    taskIdRaw: 1009,
    flagRaw: 9,
    isPinned: null,
  });
  assert.equal(expectRecords(last.savedTaskEntries)[0].isPinned, false);
  assert.equal(expectRecords(last.savedTaskEntries)[1].isPinned, true);
  assert.equal(expectRecords(last.savedTaskEntries)[2].isPinned, null);
  assert.equal(last.reservedTailHex, '898989898989');
  assert.equal(decoded.trailerHex, 'abababababababab');
  assert.equal(
    last.rawHex,
    data.subarray(offset, offset + 136).toString('hex'),
  );
  assert.equal(expectString(last.unusedRecordBytesHex).length, 37 * 2);
  assert(
    expectCoverage(decoded.coverage).knownFields.includes('retainers.comment'),
  );
  assert(
    expectCoverage(decoded.coverage).knownFields.includes(
      'retainers.savedTaskEntries.isPinned',
    ),
  );
  assert(
    expectCoverage(decoded.coverage).unknownFields.some(
      (entry) => entry.field === 'retainers.savedTaskEntries.flagRaw',
    ),
  );
});

test('RTNR bounds comment decoding to 91 bytes, preserving all following data', () => {
  const data = Buffer.alloc(1376);
  data.fill(0x61, 16, 107);
  data[107] = 0x62;
  data.writeUInt16LE(0xffff, 108);
  const retainer = expectRecords(
    expectDefined(decodeNativeRetainerComments(102, data)).retainers,
  )[0];
  assert.equal(retainer.comment, 'a'.repeat(91));
  assert.equal(expectString(retainer.commentRawHex).length, 91 * 2);
  assert.equal(retainer.alignmentByteRaw, 0x62);
  assert.equal(expectRecords(retainer.savedTaskEntries)[0].taskIdRaw, 0xffff);
  assert.equal(expectRecords(retainer.savedTaskEntries)[0].isPinned, false);
  assert.equal(decodeNativeRetainerComments(101, data), null);
  assert.equal(decodeNativeRetainerComments(102, Buffer.alloc(1375)), null);
  assert.equal(decodeNativeRetainerComments(102, Buffer.alloc(1377)), null);
});
