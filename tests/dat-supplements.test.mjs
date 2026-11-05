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
    field('N', [4, 0, 8, 0, 0, 0, 0]),
    field('M', [0, 0, 8, 0, 0, 0, 0]),
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
  assert(decoded.coverage.knownFields.includes('petSettings.mirage'));
  assert.equal(decoded.coverage.candidateFields.length, 0);
  assert.equal(decodeUiRecords(43, 1, data), null);
  assert.equal(decodeUiRecords(43, 0, field('C', [3])), null);
});

test('quick panels confirm native setting tags and decode panel icon command sources', () => {
  const records = [
    field('M0', [4]),
    field('M1', [25]),
    field('F0', integer(7, 4)),
    field('F1', integer(1, 2)),
    field('V0', [10]),
    field('V1', [255]),
  ];
  for (let i = 0; i < 4; i++) {
    const types = Buffer.alloc(25),
      ids = Buffer.alloc(100);
    types[24] = 10;
    ids.writeUInt32LE(3, 96);
    records.push(
      field('P0', [i]),
      field('P1', integer(i === 3 ? 0xffffffff : i * 100, 4)),
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
  assert.equal(decoded.coverage.unknownFields.length, 0);
  assert.equal(decoded.coverage.candidateFields.length, 0);
  assert.equal(decoded.settings, 7);
  assert.equal(decoded.flags, 1);
  assert.equal(decoded.openLastUsedPanel, true);
  assert.equal(decoded.panels[0].usesDefaultIcon, true);
  assert.equal(decoded.panels[0].defaultIconId, 695);
  assert.equal(decoded.panels[3].iconCommandType, 3);
  assert.equal(decoded.panels[3].iconCommandId, 0xffffffff);
  assert.equal(decoded.panels[3].unknownP0, 3);
  assert.equal(decoded.panels[3].unknownP1, 0xffffffff);
  assert.equal(decoded.panels[3].usesDefaultIcon, false);
  assert.throws(
    () => decodeUiRecords(41, 1, Buffer.concat(records).subarray(0, -1)),
    /Truncated/,
  );
});

test('quick panels do not confuse F0 settings bits with F1 flags and keep unknown bits', () => {
  const records = [
    field('M0', [4]),
    field('M1', [25]),
    field('F0', integer(0x80000002, 4)),
    field('F1', integer(8, 2)),
    field('V0', [255]),
    field('V1', [2]),
  ];
  for (let index = 0; index < 4; index++)
    records.push(
      field('P0', [0]),
      field('P1', integer(123, 4)),
      field('S0', Buffer.alloc(25)),
      field('S1', Buffer.alloc(100)),
    );
  const result = decodeUiRecords(41, 1, Buffer.concat(records));
  assert.equal(result.settings, 0x80000002);
  assert.equal(result.flags, 8);
  assert.equal(result.closePanelUponExecutingActions, false);
  assert.equal(result.openPanelAtMouseCursorPosition, true);
  assert.equal(result.disableDraggingWithinCommandPanel, false);
  assert.equal(result.firstTimeHelpSeen, false);
  assert.equal(result.tint, 255);
  assert.equal(result.panelOpenIndex, 2);
  assert.equal(result.openLastUsedPanel, false);
  assert.deepEqual(
    result.coverage.unknownFields.map((entry) => entry.field),
    ['settings', 'flags'],
  );
  assert.match(result.coverage.unknownFields[0].reason, /0x80000000/);
  assert.equal(result.panels[0].iconCommandId, 123);
  assert.equal(result.panels[0].usesDefaultIcon, true);
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

test('empty lost-action presets retain flags and names and reject missing nonempty vectors', () => {
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
  assert.equal(decodeUiRecords(20, 1, nonempty), null);
});

test('nonempty lost-action presets pair MYCItem identities and quantities by position and retain extra tags', () => {
  const name = Buffer.alloc(61);
  name.write('失传技能预设');
  const data = Buffer.concat([
    field('A', Buffer.alloc(13)),
    field('S', [2]),
    field('n', name),
    field('l', [3]),
    field('i', [7, 2, 99]),
    field('s', [1, 17, 255]),
    field('Z', [0xaa]),
    field('n', Buffer.alloc(61)),
    field('l', [0]),
  ]);
  const decoded = decodeUiRecords(20, 1, data);
  assert.deepEqual(decoded.sets[0].items, [
    { index: 0, mycItemId: 7, quantity: 1 },
    { index: 1, mycItemId: 2, quantity: 17 },
    { index: 2, mycItemId: 99, quantity: 255 },
  ]);
  assert.equal(decoded.sets[0].name, '失传技能预设');
  assert.equal(decoded.sets[0].numItems, 3);
  assert.deepEqual(decoded.sets[1].items, []);
  assert.deepEqual(
    decoded.sets[0].itemFields.map((entry) => [entry.tag, entry.valueHex]),
    [
      ['i', '070263'],
      ['s', '0111ff'],
      ['Z', 'aa'],
    ],
  );
  assert.equal(decoded.fields.length, 9);
  assert(decoded.coverage.knownFields.includes('sets.items.mycItemId'));
  assert(decoded.coverage.knownFields.includes('sets.items.quantity'));
  assert(
    decoded.coverage.unknownFields.some((entry) =>
      entry.field.startsWith('fields.Z@'),
    ),
  );
  assert(
    decoded.coverage.unknownFields.some((entry) => entry.field === 'seenFlags'),
  );
  assert.equal(decodeUiRecords(20, 2, data), null);
  assert.throws(
    () => decodeUiRecords(20, 1, data.subarray(0, -1)),
    /Truncated/,
  );
});

test('lost-action preset vectors validate counts, byte widths, tag order and the 100-item limit', () => {
  const preset = (count, ids, quantities, quantityTag = 's', setCount = 1) =>
    Buffer.concat([
      field('A', Buffer.alloc(13)),
      field('S', [setCount]),
      field('n', Buffer.alloc(61)),
      field('l', [count]),
      field('i', ids),
      field(quantityTag, quantities),
    ]);
  const ids = Buffer.from(Array.from({ length: 100 }, (_, index) => index));
  const quantities = Buffer.alloc(100, 2);
  const data = preset(100, ids, quantities);
  assert.deepEqual(decodeUiRecords(20, 1, data).sets[0].items[99], {
    index: 99,
    mycItemId: 99,
    quantity: 2,
  });
  for (const invalid of [
    preset(101, Buffer.alloc(101), Buffer.alloc(101)),
    preset(100, ids.subarray(0, 99), quantities),
    preset(100, ids, quantities.subarray(0, 99)),
    preset(100, ids, Buffer.alloc(101)),
    preset(100, ids, quantities, 'x'),
    preset(100, ids, quantities, 's', 11),
  ]) {
    assert.equal(decodeUiRecords(20, 1, invalid), null);
  }
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

test('retainer task IDs keep full uint64 precision and completion timestamps have client consumer evidence', () => {
  const data = Buffer.alloc(168);
  data.writeUInt32LE(1);
  const id = 0xf123456789abcdefn;
  data.writeBigUInt64LE(id, 8);
  data.writeUInt32LE(1700000000, 16);
  const decoded = decodeAdditionalUiSegment(1, 101, data);
  assert.equal(decoded.retainerCount, 1);
  assert.equal(decoded.tasks[0].retainerId, id.toString());
  assert.equal(decoded.tasks[0].retainerIdCandidate, id.toString());
  assert.equal(decoded.savedEntryCount, 1);
  assert.equal(decoded.tasks[0].completionUnix, 1700000000);
  assert.equal(decoded.tasks[0].completionUnixCandidate, 1700000000);
  assert.equal(decoded.tasks[0].isStoredEntry, true);
  assert.equal(decoded.tasks[1].isStoredEntry, false);
  assert(decoded.coverage.knownFields.includes('tasks.retainerId'));
  assert(decoded.coverage.knownFields.includes('tasks.completionUnix'));
  assert.deepEqual(decoded.coverage.candidateFields, []);
  assert(
    decoded.coverage.unknownFields.every((field) => field.kind === 'storage'),
  );
});

test('retainer saved-entry count is one byte and padding is retained rather than read into the count', () => {
  const data = Buffer.alloc(168);
  data[0] = 1;
  data.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11], 1);
  data.set([0xa1, 0xb2, 0xc3, 0xd4], 20);
  const decoded = decodeAdditionalUiSegment(1, 101, data);
  assert.equal(decoded.retainerCount, 1);
  assert.equal(decoded.reservedHeaderHex, 'aabbccddeeff11');
  assert.equal(decoded.tasks[0].reservedTailHex, 'a1b2c3d4');
  assert.equal(decoded.tasks[0].unknown, 0xd4c3b2a1);
  data[0] = 11;
  assert.equal(decodeAdditionalUiSegment(1, 101, data), null);
});

function emjChunk(key, bytes) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(key);
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}

test('EMJ confirms native settings field bindings while retaining every raw byte', () => {
  const body = Buffer.from([
    2, 1, 0, 1, 0xab, 0xcd, 1, 1, 0, 2, 3, 1, 4, 5, 0x12, 0x34,
  ]);
  const result = decodeAdditionalUiSegment(11, 0, emjChunk(2, body));
  const chunk = result.chunks[0];
  const settings = chunk.data.settings;
  assert.equal(chunk.data.settingsCandidate, settings);
  assert.deepEqual(settings, {
    tileSet: 0,
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
    emjCostumeId: 0,
    unknownTailHex: '1234',
  });
  assert.equal(chunk.data.savedSettings.tileSet, 2);
  assert.equal(chunk.data.savedSettings.emjCostumeId, 5);
  assert.equal(chunk.dataHex, body.toString('hex'));
  assert.deepEqual(chunk.bytes, [...body]);
  assert(
    result.coverage.knownFields.includes(
      'chunks[key=2].data.settings.hideTileNames',
    ),
  );
  assert(
    result.coverage.unknownFields.some((field) =>
      field.field.endsWith('unknownSettingsByte4/5'),
    ),
  );
  assert.equal(
    result.coverage.candidateFields.some((field) =>
      field.includes('settings.'),
    ),
    false,
  );
});

test('EMJ preserves history aliases and decodes NPC win counters without guessing malformed blocks', () => {
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
      emjChunk(3, Buffer.from([1, 2, 3, 4])),
      emjChunk(4, Buffer.from([4, 3, 2])),
    ]),
  );
  const values = result.chunks[0].data.statisticsCandidate;
  assert.equal(values.unknownValue, -7);
  assert.equal(values.timestampCandidate, 1700000000);
  assert.equal(values.historyValues.length, 16);
  assert.equal(values.historyValues[0], 1234);
  assert.equal(values.historyValues[15], -99);
  assert.equal(values.unknownGapHex, '4433221100000000');
  assert.deepEqual(
    result.chunks
      .find((chunk) => chunk.key === 1)
      .data.npcWins.map((row) => row.winCount),
    [0, 0, 0],
  );
  for (const key of [3, 4]) {
    const chunk = result.chunks.find((chunk) => chunk.key === key);
    assert.equal(chunk.data, undefined);
    assert(
      result.coverage.unknownFields.some(
        (field) => field.field === `chunks[key=${key}].data`,
      ),
    );
  }
  assert.equal(result.chunks[2].dataHex, '01020304');
});

test('EMJ applies native load guards and preserves noncanonical settings bytes', () => {
  const body = Buffer.from([
    255, 2, 255, 2, 7, 8, 2, 255, 2, 5, 255, 255, 15, 2, 0, 0,
  ]);
  const result = decodeAdditionalUiSegment(11, 0, emjChunk(2, body));
  const { settings, savedSettings } = result.chunks[0].data;
  assert.equal(settings.tileSet, 0);
  assert.equal(settings.hideTileNames, false);
  assert.equal(settings.showTraditionalDoraIndicator, true);
  assert.equal(settings.disableCharacterVoices, false);
  assert.equal(settings.ownPlayerNameSetting, 0);
  assert.equal(settings.othersPlayerNameSetting, 0);
  assert.equal(settings.emjVoiceNpc, 0);
  assert.equal(settings.emjCostumeId, 0);
  for (const field of [
    'hideHints',
    'hideDangerousTileMarker',
    'hideChatLog',
    'showHighResolutionLayout',
  ]) {
    assert.equal(settings[field], null);
    assert(
      result.coverage.unknownFields.some((entry) =>
        entry.field.endsWith('.' + field),
      ),
    );
  }
  assert.equal(savedSettings.tileSet, 255);
  assert.equal(savedSettings.disableCharacterVoices, 255);
  const highest = decodeAdditionalUiSegment(
    11,
    0,
    emjChunk(2, Buffer.from([1, 1, 1, 1, 0, 0, 1, 1, 1, 4, 4, 1, 14, 1, 0, 0])),
  ).chunks[0].data.settings;
  assert.equal(highest.tileSet, 1);
  assert.equal(highest.ownPlayerNameSetting, 4);
  assert.equal(highest.othersPlayerNameSetting, 4);
  assert.equal(highest.emjVoiceNpc, 14);
  assert.equal(highest.emjCostumeId, 1);
});

test('EMJ seen voice/costume blocks use ID minus one and retain out-of-domain bits', () => {
  const result = decodeAdditionalUiSegment(
    11,
    0,
    Buffer.concat([
      emjChunk(3, Buffer.from([0x81, 0xe1, 0xff])),
      emjChunk(4, Buffer.from([0x81, 0x81, 0xf0, 0xff])),
    ]),
  );
  const voice = result.chunks[0].data;
  const costume = result.chunks[1].data;
  assert.deepEqual(voice.seenVoiceNpcIds, [1, 8, 9, 14]);
  assert.equal(voice.seenBitflagsHex, '81e1ff');
  assert.equal(voice.reservedBitsHex, '00c0ff');
  assert.deepEqual(costume.seenCostumeIds, [1, 8, 9, 16, 21]);
  assert.equal(costume.seenBitflagsHex, '8181f0ff');
  assert.equal(costume.reservedBitsHex, '0000e0ff');
  assert.equal(result.coverage.candidateFields.length, 0);
  assert(
    result.coverage.unknownFields.every((entry) => entry.kind === 'storage'),
  );
});

test('FLAGS names documented UI indices after native serialization confirms the source array mapping', () => {
  const bytes = Buffer.alloc(384);
  bytes.writeUInt32LE(96, 4);
  bytes.writeUInt32LE(2, 112);
  bytes.writeUInt32LE(256, 116);
  const values = {
    1: 123,
    10: 9,
    11: 1,
    13: 3,
    14: 0x44332211,
    15: 0x55,
    16: 0,
    21: 1,
  };
  for (const [index, value] of Object.entries(values))
    bytes.writeUInt32LE(value, 128 + Number(index) * 4);
  const result = decodeAdditionalUiSegment(2, 100, bytes);
  assert.deepEqual(result.namedFlags, {
    summonedCompanionId: 123,
    lastSeenMentorVersion: 9,
    hideMentorRenewDialogue: true,
    defaultCurrencyRotationIndex: 3,
    currencySettingIds0To3: [0x11, 0x22, 0x33, 0x44],
    currencySettingIdForRotation5: 0x55,
    actionsAndTraitsCompactView: false,
    hidePortraitUpdatePreview: true,
  });
  assert.equal(result.namedFlagsCandidate.hideMentorRenewDialogueRaw, 1);
  assert.equal(result.namedFlagsCandidate.currencySettingIdsPacked, 0x44332211);
  assert.equal(result.coverage.candidateFields.length, 0);
  assert(
    result.coverage.knownFields.includes('namedFlags.summonedCompanionId'),
  );
  assert(
    result.coverage.unknownFields.some(
      (entry) => entry.field === 'unmappedUiFlags',
    ),
  );
  bytes.writeUInt32LE(255, 128 + 16 * 4);
  const invalid = decodeAdditionalUiSegment(2, 100, bytes);
  assert.equal(invalid.namedFlags.actionsAndTraitsCompactView, null);
  assert.equal(invalid.uiFlags[16], 255);
});

test('XBM reserved bitmap bits do not invent pets outside native IDs or the saved list', () => {
  const data = Buffer.concat([
    field('C', [1]),
    field('I', [50]),
    field('S', [1]),
    field('N', [0, 0, 0, 0, 0, 0, 255]),
    field('M', [0, 0, 0, 0, 0, 0, 254]),
  ]);
  const decoded = decodeUiRecords(43, 0, data);
  assert.deepEqual(decoded.seenPetIds, [50]);
  assert.deepEqual(decoded.alternativeMiragePetIds, [50]);
  assert.equal(decoded.petSettings[0].sizeName, '中型');
  assert.equal(decoded.reservedSeenBitsHex, '000000000000fc');
  assert.equal(decoded.seenStorageHex, '000000000000ff');
});
