import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUiRecords } from '../src/main/services/dat/uisave-records.ts';
import { decodeAdditionalUiSegment } from '../src/main/services/dat/uisave-other.ts';

function field(tag, value) {
  const bytes = Buffer.from(value);
  const header = Buffer.alloc(tag.length + 2);
  header.write(tag, 'ascii');
  header.writeUInt16LE(bytes.length, tag.length);
  return Buffer.concat([header, bytes]);
}
function integer(value, width) {
  const bytes = Buffer.alloc(width);
  bytes.writeUIntLE(value, 0, width);
  return bytes;
}

test('XBM pet settings align sizes by list position and bitmaps by pet ID, without losing nonsequential identities', () => {
  // Bit 19 refers to pet 20, not record index 0; bit 2 refers to pet 3.
  const data = Buffer.concat([
    field('C', [2]),
    field('I', [20, 3]),
    field('S', [2, 0]),
    field('N', [4, 0, 8]),
    field('M', [0, 0, 8]),
  ]);
  const decoded = decodeUiRecords(43, 0, data);
  assert.deepEqual(
    decoded.petSettings.map((p) => [
      p.petId,
      p.sizeName,
      p.isNewPetSeen,
      p.mirageName,
    ]),
    [
      [20, '大型', true, '替代外形'],
      [3, '小型', true, '普通外形'],
    ],
  );
  assert.deepEqual(decoded.seenPetIds, [3, 20]);
  assert.deepEqual(decoded.alternativeMiragePetIds, [20]);
  assert(decoded.coverage.candidateFields.includes('petSettings.mirage'));
  assert.equal(decodeUiRecords(43, 1, data), null);
  assert.equal(decodeUiRecords(43, 0, field('C', [3])), null);
});

test('quick panels decode all slots and source-defined flag bit candidates while listing the remaining P fields', () => {
  const records = [
    field('M0', [4]),
    field('M1', [25]),
    field('F0', integer(1, 4)),
    field('F1', integer(7, 2)),
    field('V0', [10]),
    field('V1', [255]),
  ];
  for (let i = 0; i < 4; i++) {
    const types = Buffer.alloc(25),
      ids = Buffer.alloc(100);
    types[24] = 10;
    ids.writeUInt32LE(3, 96);
    records.push(
      field('P0', [0]),
      field('P1', Buffer.alloc(4)),
      field('S0', types),
      field('S1', ids),
    );
  }
  const decoded = decodeUiRecords(41, 1, Buffer.concat(records));
  assert.equal(decoded.panels.length, 4);
  assert.equal(decoded.panels[3].slots.length, 25);
  assert.deepEqual(decoded.panels[3].slots[24], {
    slot: 24,
    type: 10,
    commandType: 10,
    commandId: 3,
  });
  assert.equal(decoded.panelOpenIndex, -1);
  assert(decoded.closePanelUponExecutingActions);
  assert(decoded.openPanelAtMouseCursorPosition);
  assert(decoded.disableDraggingWithinCommandPanel);
  assert(decoded.firstTimeHelpSeen);
  assert.equal(decoded.coverage.unknownFields.length, 4);
  assert.throws(
    () => decodeUiRecords(41, 1, Buffer.concat(records).subarray(0, -1)),
    /Truncated/,
  );
});

test('seen lore and support jobs validate declared vector lengths and expose all entries', () => {
  for (const [id, version] of [
    [39, 0],
    [40, 2],
  ]) {
    const data = Buffer.concat([field('N', [3]), field('I', [7, 2, 19])]);
    const decoded = decodeUiRecords(id, version, data);
    assert.deepEqual(decoded.entries, [
      { index: 0, id: 7 },
      { index: 1, id: 2 },
      { index: 2, id: 19 },
    ]);
    assert.equal(decoded.coverage.unknownFields.length, 0);
    assert.equal(
      decodeUiRecords(
        id,
        version,
        Buffer.concat([field('N', [2]), field('I', [7])]),
      ),
      null,
    );
  }
});

test('empty lost-action presets retain the flags and names while refusing to invent the nonempty item serialization', () => {
  const name = Buffer.alloc(61);
  name.write('合成预设');
  const data = Buffer.concat([
    field('A', Buffer.from([1, ...Array(12).fill(0)])),
    field('S', [1]),
    field('n', name),
    field('l', [0]),
  ]);
  const decoded = decodeUiRecords(20, 1, data);
  assert.equal(decoded.setCount, 1);
  assert.equal(decoded.sets[0].name, '合成预设');
  assert.equal(decoded.sets[0].numItems, 0);
  assert.deepEqual(decoded.sets[0].items, []);
  assert.deepEqual(decoded.setBitIndices, [0]);
  assert(decoded.coverage.unknownFields.some((f) => f.field === 'seenFlags'));
  const nonempty = Buffer.from(data);
  nonempty[nonempty.length - 1] = 1;
  assert(
    decodeUiRecords(20, 1, nonempty).coverage.unknownFields.some(
      (f) => f.field === 'sets[0].items',
    ),
  );
});

test('CRAFT exposes its real flags field and reports an unrecognized favorite stream instead of an empty success', () => {
  const decoded = decodeUiRecords(
    16,
    1,
    Buffer.concat([field('F', integer(8, 4)), field('Z', [1])]),
  );
  assert.equal(decoded.flags, 8);
  assert(decoded.coverage.knownFields.includes('flags'));
  assert(
    decoded.coverage.unknownFields.some((f) => f.field.startsWith('fields.Z')),
  );
  assert(decoded.coverage.unknownFields.some((f) => f.field === 'flags'));
});

test('retainer task IDs keep full uint64 precision and have separate evidence from task-time semantics', () => {
  const data = Buffer.alloc(168);
  data.writeUInt32LE(1);
  const id = 0xf123456789abcdefn;
  data.writeBigUInt64LE(id, 8);
  data.writeUInt32LE(1700000000, 16);
  const decoded = decodeAdditionalUiSegment(1, 101, data);
  assert.equal(decoded.retainerCount, 1);
  assert.equal(decoded.tasks[0].retainerId, id.toString());
  assert.equal(decoded.tasks[0].retainerIdCandidate, id.toString());
  assert(decoded.coverage.knownFields.includes('tasks.retainerId'));
  assert(
    decoded.coverage.candidateFields.includes('tasks.completionUnixCandidate'),
  );
});

function emjChunk(key, bytes) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(key);
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}

test('EMJ exposes the complete source-layout settings candidate while retaining every raw byte', () => {
  const body = Buffer.from([
    2, 1, 0, 1, 0xab, 0xcd, 1, 1, 0, 2, 3, 1, 4, 5, 0x12, 0x34,
  ]);
  const result = decodeAdditionalUiSegment(11, 0, emjChunk(2, body));
  const chunk = result.chunks[0];
  const settings = chunk.data.settingsCandidate;
  assert.deepEqual(settings, {
    tileSet: 2,
    hideHints: true,
    hideDangerousTileMarker: false,
    hideChatLog: true,
    unknownSettingsByte4: 0xab,
    unknownSettingsByte5: 0xcd,
    hideTileNames: true,
    showHighResolutionLayout: true,
    showTraditionalDoraIndicator: false,
    ownPlayerNameSetting: 2,
    othersPlayerNameSetting: 3,
    disableCharacterVoices: true,
    emjVoiceNpc: 4,
    emjCostumeId: 5,
    unknownTailHex: '1234',
  });
  assert.equal(chunk.dataHex, body.toString('hex'));
  assert.deepEqual(chunk.bytes, [...body]);
  assert(
    result.coverage.candidateFields.includes(
      'chunks[key=2].data.settingsCandidate.hideTileNames',
    ),
  );
  assert(
    result.coverage.unknownFields.some((field) =>
      field.field.endsWith('unknownSettingsByte4/5'),
    ),
  );
  assert.equal(
    result.coverage.knownFields.some((field) =>
      field.includes('hideTileNames'),
    ),
    false,
  );
});

test('EMJ statistics candidates use the documented history stride and do not guess the other block identities', () => {
  const stats = Buffer.alloc(80);
  stats.writeInt32LE(-7);
  stats.writeInt32LE(1700000000, 4);
  stats.writeUInt32LE(0x11223344, 8);
  stats.writeInt32LE(1234, 16);
  stats.writeInt32LE(-99, 76);
  const result = decodeAdditionalUiSegment(
    11,
    0,
    Buffer.concat([
      emjChunk(0, stats),
      emjChunk(1, Buffer.alloc(32)),
      emjChunk(3, Buffer.from([1, 2, 3])),
      emjChunk(4, Buffer.from([4, 3, 2, 1])),
    ]),
  );
  const values = result.chunks[0].data.statisticsCandidate;
  assert.equal(values.unknownValue, -7);
  assert.equal(values.timestampCandidate, 1700000000);
  assert.equal(values.historyValues.length, 16);
  assert.equal(values.historyValues[0], 1234);
  assert.equal(values.historyValues[15], -99);
  assert.equal(values.unknownGapHex, '4433221100000000');
  for (const key of [1, 3, 4]) {
    const chunk = result.chunks.find((chunk) => chunk.key === key);
    assert.equal(chunk.data, undefined);
    assert(
      result.coverage.unknownFields.some(
        (field) => field.field === `chunks[key=${key}].data`,
      ),
    );
  }
  assert.equal(result.chunks[2].dataHex, '010203');
});
