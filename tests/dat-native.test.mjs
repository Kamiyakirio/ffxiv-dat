import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeUiSegment } from '../src/main/services/dat/uisave-native.ts';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
import { decodeUiRecords } from '../src/main/services/dat/uisave-records.ts';
import { buildFileNode } from '../src/renderer/components/browser-model.ts';

function file(segments) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16);
  header.writeUInt32LE(segments.length, 4);
  const payload = Buffer.concat([
    header,
    ...segments.map(({ id, version, data }) => {
      const part = Buffer.alloc(16);
      part.writeUInt16LE(id);
      part.writeUInt16LE(version, 2);
      part.writeUInt32LE(data.length, 4);
      part.writeUInt32LE(data.length, 8);
      return Buffer.concat([part, data, Buffer.alloc(4)]);
    }),
  ]);
  const result = Buffer.alloc(32 + payload.length);
  result.writeUInt16LE(9);
  result.writeUInt16LE(1, 2);
  result.writeUInt32LE(payload.length, 4);
  result.writeUInt32LE(payload.length, 8);
  payload.forEach((byte, index) => {
    result[16 + index] = byte ^ 0x31;
  });
  return result;
}

test('market favorites use all 100 slots and the client zero terminator', () => {
  const data = Buffer.alloc(400);
  for (let i = 0; i < 100; i++) data.writeUInt32LE(4650 + i, i * 4);
  const full = decodeNativeUiSegment(34, 0, data);
  assert.equal(full.itemCount, 100);
  assert.equal(full.wishlist[99].offset, 396);
  assert.equal(full.wishlist[99].itemId, 4749);
  assert.equal(full.coverage.unknownFields.length, 0);
  data.writeUInt32LE(0, 8);
  const terminated = decodeNativeUiSegment(34, 0, data);
  assert.equal(terminated.itemCount, 2);
  assert.equal(terminated.wishlist.length, 2);
  assert.equal(terminated.wishlistItemIds[99], 4749);
  assert(
    terminated.coverage.unknownFields.some((field) => field.kind === 'meaning'),
  );
});

test('item menu tiers preserve their full backing arrays and the final bitmap bit', () => {
  const data = Buffer.alloc(288);
  data.set([3, 5, 0, 9]);
  data[255] = 69;
  data[287] = 0x80;
  const decoded = decodeNativeUiSegment(6, 90, data);
  assert.equal(decoded.tiers[0].count, 2);
  assert.deepEqual(
    decoded.tiers[0].entries.map((row) => row.menuEntryId),
    [3, 5],
  );
  assert.equal(decoded.tiers[0].values[3], 9);
  assert.equal(decoded.tiers[1].values[127], 69);
  assert.deepEqual(decoded.customizedEntryIndices, [255]);
});

test('PvP keeps 46 choice bytes separate from untouched trailing bytes', () => {
  const data = Buffer.alloc(66);
  data.writeUInt16LE(400, 2);
  data.writeUInt32LE(15, 4);
  data[16] = 3;
  data[61] = 255;
  data[65] = 0xa5;
  const decoded = decodeNativeUiSegment(7, 400, data);
  assert.equal(decoded.formatVersion, 400);
  assert.equal(decoded.recordType, 15);
  assert.equal(decoded.stateEntries.length, 46);
  assert.equal(decoded.stateEntries[0].selectedIndex, 2);
  assert.equal(decoded.stateEntries[0].jobIndex, 1);
  assert.equal(decoded.stateEntries[0].classJobId, 19);
  assert.equal(decoded.stateEntries[0].classJobName, '骑士');
  assert.equal(decoded.stateEntries[1].selectedIndex, null);
  assert.equal(decoded.stateEntries[45].offset, 61);
  assert.equal(decoded.stateEntries[45].selectedIndex, 254);
  assert.equal(decoded.stateEntries[45].classJobId, null);
  assert.equal(decoded.unknownTailHex, '000000a5');
  assert.equal(decoded.byteValues[49].value, 0xa5);
});

test('glasses separate both equipment slots and translate style zero without using colored variant IDs', () => {
  const data = Buffer.alloc(42);
  data[0] = 1;
  data.writeUInt16LE(1, 2);
  data.writeUInt16LE(2, 4);
  data.writeUInt16LE(0xffff, 40);
  const decoded = decodeNativeUiSegment(42, 100, data);
  assert.equal(decoded.groups[0].entries[0].styleId, 0);
  assert.equal(decoded.groups[0].entries[0].name, '椭圆眼镜');
  assert.equal(decoded.groups[0].entries[1].styleId, 1);
  assert.equal(decoded.groups[0].entries[1].name, '金边墨镜');
  assert.equal(decoded.groups[0].entries[2].styleId, null);
  assert.equal(decoded.groups[1].entries[9].offset, 40);
  assert.equal(decoded.groups[1].entries[9].styleId, 65534);
  assert.match(decoded.groups[1].entries[9].name, /未收录/);
  assert(decoded.coverage.candidateFields.length > 0);
});

test('native layouts reject unknown versions and off-by-one lengths', () => {
  for (const [id, version, length] of [
    [6, 90, 288],
    [7, 400, 66],
    [34, 0, 400],
    [42, 100, 42],
  ]) {
    assert.equal(
      decodeNativeUiSegment(id, version + 1, Buffer.alloc(length)),
      null,
    );
    assert.equal(
      decodeNativeUiSegment(id, version, Buffer.alloc(length - 1)),
      null,
    );
    assert.equal(
      decodeNativeUiSegment(id, version, Buffer.alloc(length + 1)),
      null,
    );
  }
});

test('complete DAT decoding routes native market and CWLS values into readable tables', () => {
  const market = Buffer.alloc(400);
  market.writeUInt32LE(4650);
  const cwls = Buffer.alloc(1456);
  cwls.writeBigUInt64LE(0xfffffffffffffff1n, 8 + 31 * 8);
  cwls.writeBigUInt64LE(0xfffffffffffffff1n, 264 + 3 * 8);
  const bytes = file([
    { id: 34, version: 0, data: market },
    { id: 13, version: 4, data: cwls },
  ]);
  const before = Buffer.from(bytes);
  const decoded = decodeDat(bytes, 'UISAVE.DAT');
  assert.deepEqual(bytes, before);
  assert.equal(decoded.result.data.segments[0].status, 'decoded');
  assert.equal(decoded.result.data.segments[1].status, 'partial');
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    data: decoded.result.data,
    header: decoded.header,
  });
  assert.equal(
    sections.find((section) => section.id === 'market-wishlist').rows[0].itemId,
    '水煮蛋',
  );
  const linkshell = sections.find((section) => section.id === 'cwls-group-3')
    .rows[0];
  assert.equal(linkshell.linkshellId, '18446744073709551601');
  assert.equal(linkshell.selected, '是');
  const browser = buildFileNode({
    summary: { name: 'UISAVE.DAT' },
    data: decoded.result.data,
    header: decoded.header,
    readable: sections,
  });
  assert.equal(browser.children[0].children[0].title, '水煮蛋');
});

test('lost-action and stamp readable views expose recovered names, quantities and final text slots', () => {
  const field = (tag, bytes) => {
    const header = Buffer.alloc(3);
    header.write(tag);
    header.writeUInt16LE(bytes.length, 1);
    return Buffer.concat([header, bytes]);
  };
  const presetName = Buffer.alloc(61);
  presetName.write('非空技能预设');
  const lost = decodeUiRecords(
    20,
    1,
    Buffer.concat([
      field('A', Buffer.alloc(13)),
      field('S', Buffer.from([1])),
      field('n', presetName),
      field('l', Buffer.from([2])),
      field('i', Buffer.from([3, 1])),
      field('s', Buffer.from([5, 9])),
    ]),
  );
  const stamps = Buffer.alloc(65556);
  stamps.fill(0xff, 54928, 59128);
  stamps.write('最后配置', 5 + 4 * 64);
  stamps.write('最后文字', 59148 + 49 * 128);
  const decodedStamps = decodeDat(
    file([{ id: 21, version: 103, data: stamps }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        { id: 20, name: 'MYCITEM', data: lost },
        ...decodedStamps.result.data.segments,
      ],
    },
  });
  const preset = sections.find((section) => section.id === 'lost-action-set-0');
  assert.match(preset.title, /非空技能预设/);
  assert.equal(preset.rows[0].mycItemId, '失传坚壁（3）');
  assert.equal(preset.rows[0].quantity, 5);
  assert.equal(preset.rows[1].mycItemId, '失传强麻痹（1）');
  assert.equal(
    sections.find((section) => section.id === 'stamp-text-4').rows[0].text,
    '最后文字',
  );
  assert.equal(
    sections.find((section) => section.id === 'stamp-groups').rows[4].name,
    '最后配置',
  );
});
