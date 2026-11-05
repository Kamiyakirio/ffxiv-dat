import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeSocial } from '../src/main/services/dat/uisave-social.ts';

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function tagged(tag, bytes) {
  return Buffer.concat([Buffer.from(tag), u16(bytes.length), bytes]);
}
function block(id, version, body, extra = {}) {
  const h = Buffer.alloc(16);
  h.writeUInt16LE(id);
  h.writeUInt16LE(version, 2);
  h.writeUInt32LE(extra.field4 ?? 0, 4);
  h.writeUInt32LE(body.length, 8);
  h.writeUInt32LE(extra.field12 ?? 0, 12);
  return Buffer.concat([h, body, extra.trailer ?? Buffer.alloc(4)]);
}
function container(blocks, padding = Buffer.alloc(0)) {
  return Buffer.concat([
    Buffer.from([blocks.length, 0, 0, 0]),
    ...blocks,
    padding,
  ]);
}
function labels() {
  const b = Buffer.alloc(448);
  b.write('分组 A');
  b.write('第二组', 64);
  return b;
}
function contacts() {
  const b = Buffer.alloc(3200);
  b.write('昵称');
  b.writeBigUInt64LE(0x00438d8134b183cen, 32);
  b.writeBigUInt64LE(0xfedcba9876543210n, 40);
  b.writeUInt16LE(1177, 48);
  b.writeUInt16LE(0x1234, 50);
  b.writeUInt32LE(0x89abcdef, 52);
  return b;
}
function profile(id = 11, count = 2) {
  const identities = Buffer.alloc(1600),
    worlds = Buffer.alloc(400),
    names = Buffer.alloc(6400),
    comments = Buffer.alloc(6400),
    indices = Buffer.alloc(400),
    flags = Buffer.alloc(28);
  identities.writeBigUInt64LE(0xffffffffffffffffn);
  identities.writeBigUInt64LE(0x00438d8134b183cen, 8);
  identities.writeBigUInt64LE(123n, 199 * 8);
  worlds.writeUInt16LE(1177);
  worlds.writeUInt16LE(65535, 2);
  names.write('名字一');
  names.write('Second', 32);
  comments.write('备注一');
  comments[32] = 255;
  indices.writeUInt16LE(7);
  indices.writeUInt16LE(2, 2);
  flags[0] = 1;
  const fields = [
    tagged('N', u32(count)),
    ...(id === 4
      ? [
          tagged('D', Buffer.from([28])),
          tagged('F', flags),
          tagged('R', indices),
        ]
      : []),
    tagged('I', identities),
    tagged('W', worlds),
    tagged('C', names),
    tagged('B', u16(32)),
    tagged('M', comments),
  ];
  const bytes = Buffer.concat(fields);
  return Buffer.concat([bytes, Buffer.alloc(-bytes.length & 3)]);
}

test('UIDATA reads six framed blocks by declared count and does not interpret unused capacity as another block', () => {
  const b5 = Buffer.alloc(392),
    b6 = Buffer.alloc(9608);
  b5.writeUInt32LE(8);
  b6.writeUInt32LE(80);
  const source = container(
    [
      block(0, 0, labels()),
      block(3, 5, contacts()),
      block(4, 3, profile(4)),
      block(5, 0, b5),
      block(6, 0, b6),
      block(11, 2, profile()),
    ],
    Buffer.alloc(2220),
  );
  const result = decodeNativeSocial(106, source);
  assert.equal(result.blockCount, 6);
  assert.equal(result.parsedBlockCount, 6);
  assert.equal(result.completeContainer, true);
  assert.deepEqual(
    result.blocks.map((b) => b.id),
    [0, 3, 4, 5, 6, 11],
  );
  assert.equal(result.capacityPaddingByteLength, 2220);
  assert.equal(result.capacityPaddingAllZero, true);
  assert.equal(result.groupLabelsCandidate[0].name, '分组 A');
  assert.equal(result.groupLabelsCandidate[0].offset, 20);
  assert.equal(result.groupLabelsCandidate[1].offset, 84);
  assert.equal(result.contactRecordsCandidate[0].offset, 488);
  assert.equal(
    result.contactRecordsCandidate[0].identityIdRaw,
    0x00438d8134b183cen.toString(),
  );
  assert.equal(result.contactRecordsCandidate[0].worldIdRaw, 1177);
  assert.equal(
    result.contactRecordsCandidate[0].unknownAfterIdHex,
    '1032547698badcfe',
  );
  assert.equal(result.blocks[3].data.nativeCount, 8);
  assert.equal(result.blocks[4].data.nativeCount, 80);
  assert.equal(result.socialList.entries[0].recordIdRaw, 7);
  assert.equal(result.socialList.entries[0].flagRaw, true);
  assert.equal(result.socialList.entries[0].accountId, null);
  assert.equal(
    result.socialList.entries[0].legacyIdentityId,
    '18446744073709551615',
  );
  assert.equal(result.blacklist.kind, 'blacklist');
  assert.equal(result.blacklist.entries[0].serverRecordId, 7);
  assert.equal(result.blacklist.entries[0].isAccountBlock, true);
  assert.equal(result.blacklist.entries[1].contentId, null);
  assert.equal(result.friendGroups[0].groupIndex, 1);
  assert.equal(result.friendGroups[0].iconAddonId, 1661);
  assert.equal(
    result.recentContacts[0].contentId,
    0x00438d8134b183cen.toString(),
  );
  assert.equal(result.recentContacts[0].classJobId, 0x1234);
  assert.deepEqual(result.coverage.candidateFields, []);
});

test('name and contact offsets follow block positions rather than legacy flat offsets or a fixed total length', () => {
  const source = container([
    block(99, 8, Buffer.from([1, 2, 3, 4, 5])),
    block(3, 5, contacts()),
    block(0, 0, labels()),
  ]);
  const result = decodeNativeSocial(106, source);
  assert.equal(result.completeContainer, true);
  assert.equal(result.contactRecordsCandidate[0].offset, 4 + 25 + 16);
  assert.equal(result.groupLabelsCandidate[0].offset, 4 + 25 + 3220 + 16);
  assert.equal(result.groupLabelsCandidate[0].name, '分组 A');
  assert(result.coverage.unknownFields.some((f) => f.field.includes('id=99')));
  assert.equal(result.blocks[0].rawHex, '0102030405');
  assert.notEqual(source.length, 46080);
});

test('mute-list fields retain full uint64 IDs, world values, names, comments and inactive array slots', () => {
  const result = decodeNativeSocial(106, container([block(11, 2, profile())]));
  const mute = result.muteList;
  assert.equal(mute.count, 2);
  assert.equal(mute.entries.length, 2);
  assert.equal(mute.entries[0].accountId, '18446744073709551615');
  assert.equal(mute.entries[0].worldId, 1177);
  assert.equal(mute.entries[0].name, '名字一');
  assert.equal(mute.entries[0].comment, '备注一');
  assert.equal(mute.entries[1].comment, null);
  assert.equal(mute.entries[1].commentStorageHex.slice(0, 2), 'ff');
  assert.equal(mute.entries[1].worldId, 65535);
  assert.equal(
    Buffer.from(mute.arrays.identityIdsHex, 'hex').readBigUInt64LE(199 * 8),
    123n,
  );
  assert.equal(mute.fields.find((f) => f.tag === 'I').length, 1600);
  assert(
    result.coverage.unknownFields.some((f) =>
      f.field.includes('entries[1].text'),
    ),
  );
});

test('bad inner tagged arrays stay local to their block and later valid blocks still decode', () => {
  const broken = profile(11, 201),
    source = container([block(11, 2, broken), block(0, 0, labels())]);
  const result = decodeNativeSocial(106, source);
  assert.equal(result.completeContainer, true);
  assert.equal(result.muteList, undefined);
  assert.match(result.blocks[0].parseError, /capacity/);
  assert.equal(result.blocks[0].rawHex, broken.toString('hex'));
  assert.equal(result.groupLabels[1].name, '第二组');
  const truncated = Buffer.concat([
    tagged('N', u32(1)),
    Buffer.from([73, 255, 255, 1]),
  ]);
  const other = decodeNativeSocial(
    106,
    container([block(11, 2, truncated), block(0, 0, labels())]),
  );
  assert.match(other.blocks[0].parseError, /exceeds/);
  assert.equal(other.groupLabels[0].name, '分组 A');
});

test('truncated frame boundaries never consume beyond the input and preserve the previously decoded blocks', () => {
  const source = container([block(0, 0, labels()), block(3, 5, contacts())]);
  const result = decodeNativeSocial(106, source.subarray(0, -1));
  assert.equal(result.completeContainer, false);
  assert.equal(result.coverage.structureComplete, false);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.groupLabels.length, 7);
  assert.equal(result.remainingOffset, 472);
  assert.equal(result.remainingHex, source.subarray(472, -1).toString('hex'));
});

test('unknown versions and lengths stay raw, duplicated block aliases remain ambiguous and header padding does not change count', () => {
  const result = decodeNativeSocial(
    106,
    container([block(0, 99, labels()), block(3, 5, Buffer.alloc(1))]),
  );
  assert.equal(result.completeContainer, true);
  assert.equal(result.groupLabels.length, 0);
  assert.equal(result.contactRecords.length, 0);
  assert.equal(result.blocks[0].rawHex, labels().toString('hex'));
  const duplicate = decodeNativeSocial(
    106,
    container([block(0, 0, labels()), block(0, 0, labels())]),
  );
  assert.equal(duplicate.groupLabels.length, 0);
  assert(duplicate.coverage.unknownFields.some((f) => f.kind === 'reference'));
  const padded = container([block(0, 0, labels())]);
  padded[1] = 255;
  assert.equal(decodeNativeSocial(106, padded).parsedBlockCount, 1);
  assert.equal(decodeNativeSocial(106, padded).headerPaddingHex, 'ff0000');
});

test('header/trailer and nonzero trailing storage remain exact, without fabricated extra blocks', () => {
  const trailer = Buffer.from([1, 2, 3, 4]),
    result = decodeNativeSocial(
      106,
      container(
        [block(0, 0, labels(), { field4: 123, field12: 456, trailer })],
        Buffer.from([9, 8, 7]),
      ),
    );
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].trailerHex, '01020304');
  assert.equal(
    Buffer.from(result.blocks[0].headerHex, 'hex').readUInt32LE(4),
    123,
  );
  assert.equal(result.remainingHex, '090807');
  assert.equal(result.capacityPaddingAllZero, false);
  assert(result.coverage.unknownFields.some((f) => f.field === 'remainingHex'));
  assert.equal(decodeNativeSocial(105, Buffer.alloc(4)), null);
  assert.equal(decodeNativeSocial(106, Buffer.alloc(3)), null);
});

test('blacklist distinguishes server record keys, legacy content identities and account flags without inventing zero account IDs', () => {
  const bytes = profile(4, 2);
  // N:4 D:1 F:28 R:400 precede I. Locate the actual field rather than
  // assume a byte offset in a separate serialized list.
  let offset = 0;
  while (offset < bytes.length) {
    const tag = String.fromCharCode(bytes[offset]),
      size = bytes.readUInt16LE(offset + 1);
    if (tag === 'R') bytes.writeUInt16LE(0, offset + 3 + 2);
    if (tag === 'I') bytes.writeBigUInt64LE(0n, offset + 3);
    offset += 3 + size;
    if (bytes.length - offset <= 3) break;
  }
  const list = decodeNativeSocial(
    106,
    container([block(4, 3, bytes)]),
  ).blacklist;
  assert.equal(list.entries[0].serverRecordId, 7);
  assert.equal(list.entries[0].isAccountBlock, true);
  assert.equal(list.entries[0].accountId, null);
  assert.equal(list.entries[0].contentId, null);
  assert.equal(list.entries[1].serverRecordId, 0);
  assert.equal(list.entries[1].identityKind, 'content');
  assert.equal(list.entries[1].contentId, 0x00438d8134b183cen.toString());
});

test('the 8- and 200-entry name caches decode full 48-byte records while preserving inactive storage and padding', () => {
  const first = Buffer.alloc(392),
    second = Buffer.alloc(9608);
  first.writeUInt32LE(2);
  first.write('队伍成员', 8);
  first.writeBigUInt64LE(0xffffffffffffffffn, 40);
  first.writeUInt16LE(1177, 48);
  first.fill(0xaa, 50, 56);
  first.write('Second', 56);
  first.writeBigUInt64LE(123n, 88);
  first.writeUInt16LE(1167, 96);
  second.writeUInt32LE(1);
  second.write('缓存名字', 8);
  second.writeBigUInt64LE(0x00438d8134b183cen, 40);
  second.writeUInt16LE(1177, 48);
  second.writeBigUInt64LE(987n, 8 + 199 * 48 + 32);
  const source = container([block(5, 0, first), block(6, 0, second)]);
  const result = decodeNativeSocial(106, source);
  assert.equal(result.partyMemberCache.entries.length, 2);
  assert.deepEqual(result.partyMemberCache.entries[0], {
    index: 0,
    offset: 28,
    isStoredEntry: true,
    name: '队伍成员',
    contentId: '18446744073709551615',
    worldId: 1177,
    nameStorageHex: first.subarray(8, 40).toString('hex'),
    reservedTailHex: 'aaaaaaaaaaaa',
    rawHex: first.subarray(8, 56).toString('hex'),
  });
  assert.equal(
    result.characterNameCache.entries[0].contentId,
    0x00438d8134b183cen.toString(),
  );
  assert.equal(result.characterNameCache.slots.length, 200);
  assert.equal(result.characterNameCache.slots[199].contentId, '987');
  assert.equal(result.characterNameCache.slots[199].isStoredEntry, false);
  assert(!result.coverage.unknownFields.some((f) => /id=[56]/.test(f.field)));
});

test('native over-capacity cache counts reset active entries without discarding saved slots', () => {
  const bytes = Buffer.alloc(392);
  bytes.writeUInt32LE(9);
  bytes.writeBigUInt64LE(123n, 40);
  const result = decodeNativeSocial(106, container([block(5, 0, bytes)]));
  assert.equal(result.partyMemberCache.declaredCountRaw, 9);
  assert.equal(result.partyMemberCache.nativeCount, 0);
  assert.equal(result.partyMemberCache.entries.length, 0);
  assert.equal(result.partyMemberCache.slots[0].contentId, '123');
  assert(
    result.coverage.unknownFields.some(
      (f) => f.field === 'blocks[id=5].declaredCountRaw',
    ),
  );
});
