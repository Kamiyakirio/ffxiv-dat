import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeCwls } from '../src/main/services/dat/uisave-cwls.ts';
import { coverageStatus } from '../src/main/services/dat/coverage.ts';

test('CWLS keeps four independent eight-slot groups and exact uint64 selections', () => {
  const data = Buffer.alloc(1456);
  data[0] = 1;
  for (let group = 0; group < 4; group++) {
    for (let slot = 0; slot < 8; slot++) {
      const id = 0xf123456789abc000n + BigInt(group * 8 + slot);
      data.writeBigUInt64LE(id, 8 + group * 64 + slot * 8);
    }
    data.writeBigUInt64LE(
      0xf123456789abc000n + BigInt(group * 8 + 7),
      264 + group * 8,
    );
  }
  const decoded = decodeNativeCwls(4, data);
  assert.equal(decoded.groups.length, 4);
  for (let group = 0; group < 4; group++) {
    assert.equal(decoded.groups[group].index, group);
    assert.equal(decoded.groups[group].slots.length, 8);
    assert.equal(
      decoded.groups[group].selectedLinkshellId,
      (0xf123456789abc000n + BigInt(group * 8 + 7)).toString(),
    );
  }
  assert.deepEqual(decoded.groups[3].slots[7], {
    slot: 7,
    offset: 256,
    linkshellId: '17375808098319187999',
  });
  assert.equal(decoded.headerHex, '0100000000000000');
  assert(decoded.coverage.knownFields.includes('groups.slots.linkshellId'));
  assert(decoded.coverage.knownFields.includes('groups.selectedLinkshellId'));
});

test('CWLS preserves unmapped data, complete flags and reserved bytes without declaring full decoding', () => {
  const data = Buffer.alloc(1456);
  data.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
  data[296] = 0xaa;
  data[1447] = 0xbb;
  data[1448] = 0xad;
  data.set([1, 2, 3, 4, 5, 6, 7], 1449);
  const decoded = decodeNativeCwls(4, data);
  assert.equal(decoded.headerHex, '0102030405060708');
  assert.equal(
    decoded.unknownRemainderHex,
    data.subarray(296, 1448).toString('hex'),
  );
  assert.equal(decoded.unknownRemainderHex.length, 1152 * 2);
  assert.equal(decoded.tailFlagsRaw, 0xad);
  assert.equal(decoded.tailFlagsLowNibble, 0xd);
  assert.equal(decoded.tailReservedHex, '01020304050607');
  assert.equal(coverageStatus(decoded.coverage), 'partial');
  assert.equal(decoded.coverage.structureComplete, true);
  assert.deepEqual(
    decoded.coverage.unknownFields
      .filter((entry) => entry.kind === 'meaning')
      .map((entry) => entry.field),
    ['unknownRemainderHex', 'tailFlagsRaw / tailFlagsLowNibble'],
  );
});

test('CWLS rejects unverified versions and incomplete or extended layouts', () => {
  assert.equal(decodeNativeCwls(3, Buffer.alloc(1456)), null);
  assert.equal(decodeNativeCwls(5, Buffer.alloc(1456)), null);
  assert.equal(decodeNativeCwls(4, Buffer.alloc(1455)), null);
  assert.equal(decodeNativeCwls(4, Buffer.alloc(1457)), null);
  assert.equal(decodeNativeCwls(4, Buffer.alloc(0)), null);
});
