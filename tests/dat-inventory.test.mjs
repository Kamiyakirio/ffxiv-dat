import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeAcquaintance,
  decodeGoldSaucer,
  decodeItemFinder,
  decodeItemOrder,
  decodeLogFilter,
} from '../src/main/services/dat/inventory.ts';

function word(value, size = 4) {
  const bytes = Buffer.alloc(size);
  if (size === 2) bytes.writeUInt16LE(value);
  else if (size === 8) bytes.writeBigUInt64LE(BigInt(value));
  else bytes.writeUInt32LE(value);
  return bytes;
}

function field(tag, bytes, lengthBytes = 2) {
  const header = Buffer.alloc(1 + lengthBytes);
  header[0] = tag.charCodeAt(0);
  if (lengthBytes === 1) header[1] = bytes.length;
  else header.writeUInt16LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

test('acquaintance records retain unverified identifier parts without inventing semantics', () => {
  const values = [
    'Tester',
    'World',
    '0495',
    '1000',
    '0040',
    '000BE0',
    '123456',
  ];
  const payload = Buffer.concat(
    values.map((value, index) =>
      field('NWOTCCC'[index], Buffer.from(`${value}\0`)),
    ),
  );
  const result = decodeAcquaintance(payload, 100);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.contacts[0].worldId, 0x495);
  assert.deepEqual(result.data.contacts[0].unknownCParts, values.slice(4));
  assert.deepEqual(result.data.contacts[0].inferred.contentIdCandidate, {
    hex: '0040000BE0123456',
    decimal: BigInt('0x0040000BE0123456').toString(),
    confidence: 'inferred',
  });
  assert.deepEqual(result.data.contacts[0].inferred.flagsCandidate, {
    value: 0x1000,
    confidence: 'inferred',
  });
  assert.equal(decodeAcquaintance(Buffer.alloc(0), 100).data.contactCount, 0);
  assert.throws(
    () => decodeAcquaintance(Buffer.from([78, 20, 0, 1]), 100),
    /Invalid section/,
  );
});

test('acquaintance metadata exposes exact numbers and labels its timestamp interpretation', () => {
  const payload = Buffer.concat(
    ['004E', '0000', '00006A', 'E5C85B'].map((value) =>
      field('M', Buffer.from(`${value}\0`)),
    ),
  );
  const result = decodeAcquaintance(payload, 100);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.metadataFields[0].decimal, '78');
  assert.equal(
    result.data.timestampCandidate.isoUtc,
    '2026-10-31T10:52:11.000Z',
  );
  assert.equal(result.data.timestampCandidate.confidence, 'inferred');
  assert.equal(
    decodeAcquaintance(Buffer.alloc(0), 100).data.timestampCandidate,
    null,
  );
});

test('Gold Saucer separates 58-byte decks, minion slots, padding and unseen cards', () => {
  const payload = Buffer.alloc(648);
  payload.write('Deck', 0);
  payload.writeUInt16LE(321, 48);
  payload.writeUInt16LE(45, 580);
  payload.writeUInt16LE(800, 628);
  const result = decodeGoldSaucer(payload, 103);
  assert.equal(result.status, 'decoded');
  assert.equal(result.data.decks[0].name, 'Deck');
  assert.equal(result.data.decks[0].cardIds[0], 321);
  assert.equal(result.data.minionCompanionIds[0], 45);
  assert.equal(result.data.unseenTripleTriadCardIds[0], 800);
  assert.throws(
    () => decodeGoldSaucer(payload.subarray(0, 647), 103),
    /Truncated/,
  );
});

test('item order uses one-byte lengths and preserves retainer IDs without precision loss', () => {
  const f = (tag, bytes) => field(tag, bytes, 1);
  const payload = Buffer.concat([
    f('V', word(104)),
    ...Array.from({ length: 13 }, () => f('n', word(0))),
    f('N', word(1)),
    f('R', word(0x7b8d813489799an, 8)),
    f('n', word(1)),
    f('i', Buffer.from([12, 0, 3, 0])),
    f('n', word(0)),
    f('n', word(0)),
  ]);
  const result = decodeItemOrder(payload, 104);
  assert.equal(result.status, 'decoded');
  assert.equal(result.data.retainers[0].retainerId, '007B8D813489799A');
  assert.deepEqual(result.data.retainers[0].slots[0], {
    displayIndex: 0,
    offset: 106,
    slot: 12,
    page: 3,
  });
  assert.throws(
    () => decodeItemOrder(payload.subarray(0, -1), 104),
    /Invalid item order/,
  );
});

test('item finder maps retainer, saddlebag, dresser and armoire arrays with checked lengths', () => {
  const retainer = Buffer.alloc(1152);
  retainer.writeBigUInt64LE(0x7b8d813489799an);
  retainer.writeUInt32LE(9001, 8 + 0x38);
  retainer.writeUInt16LE(12, 8 + 0x2f4);
  const bags = Buffer.alloc(840);
  bags.writeUInt32LE(2, 70 * 4);
  bags.writeUInt16LE(9, 560 + 70 * 2);
  const dresser = Buffer.alloc(4800);
  dresser.writeUInt32LE(1000001);
  dresser.writeUInt16LE(4, 3200);
  const cabinet = Buffer.alloc(500);
  cabinet[1] = 5;
  const payload = Buffer.concat([
    field('C', word(0x438d8134fa7e0bn, 8)),
    field('R', word(200, 2)),
    field('N', word(1)),
    field('I', retainer),
    field('B', word(200, 2)),
    field('I', bags),
    field('M', word(203, 2)),
    field('I', dresser),
    field('A', word(200, 2)),
    field('N', word(4000)),
    field('F', cabinet),
  ]);
  const result = decodeItemFinder(payload, 203);
  assert.equal(result.status, 'decoded');
  assert.equal(result.data.retainers[0].itemIds[0], 9001);
  assert.equal(result.data.retainers[0].itemCounts[0], 12);
  assert.equal(result.data.premiumSaddleBag.itemIds[0], 2);
  assert.equal(result.data.premiumSaddleBag.itemCounts[0], 9);
  assert.equal(result.data.glamourDresser.itemSetUnlockBits[0], 4);
  assert.deepEqual(result.data.cabinet.setBitIndices, [8, 10]);
  assert.throws(
    () => decodeItemFinder(payload.subarray(0, -1), 203),
    /Invalid section/,
  );
});

test('log filters expose all byte states but retain partial semantic status', () => {
  const payload = Buffer.alloc(19);
  payload.writeUInt16LE(2);
  payload.writeUInt16LE(3, 2);
  payload.writeUInt32LE(3, 4);
  payload.set([0, 1, 2], 16);
  const result = decodeLogFilter(payload, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.groups[0].index, 2);
  assert.equal(result.data.groups[0].chatTab, 'Chat tab 3');
  assert.deepEqual(result.data.groups[0].filterStates, [0, 1, 2]);
  assert.throws(() => decodeLogFilter(payload.subarray(0, -1), 3), /Truncated/);
});
