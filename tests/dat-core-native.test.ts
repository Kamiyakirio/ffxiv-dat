import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeHotbar,
  decodeGearset,
} from '../src/main/services/dat/layouts.ts';
import {
  expectRecord,
  expectRecords,
  expectDefined,
} from './helpers/assertions.ts';

function hotbar(groups: number[]) {
  return Buffer.concat(
    groups.map((group) => {
      const row = Buffer.alloc(8);
      row[4] = group;
      return row;
    }),
  );
}

test('HOTBAR v4 distinguishes disk group bytes from runtime groups and resolves PvP jobs', () => {
  const decoded = decodeHotbar(
    hotbar([0, 19, 36, 43, 64, 65, 72, 79, 80, 85]),
    4,
  );
  assert.equal(expectDefined(decoded.coverage).candidateFields.length, 0);
  assert.equal(expectDefined(decoded.coverage).unknownFields.length, 0);
  const slots = decoded.data.slots;
  assert.deepEqual(
    expectRecords(slots).map((s) => [
      s.groupId,
      s.savedHotbarIndex,
      s.classJobId,
      s.isPvp,
    ]),
    [
      [0, 0, 0, false],
      [19, 19, 19, false],
      [36, 36, 36, false],
      [43, 43, 43, false],
      [64, 46, 0, true],
      [65, 47, 19, true],
      [72, 54, 27, true],
      [79, 61, 35, true],
      [80, 62, 37, true],
      [85, 67, 42, true],
    ],
  );
  assert.equal(expectRecords(slots)[0].groupKind, 'shared');
  assert.equal(expectRecords(slots)[4].groupKind, 'pvpShared');
  assert.equal(expectRecords(slots)[5].groupKind, 'pvpClassJob');
  assert.equal(expectRecord(decoded.data.groupNames)[80], '绝枪战士 · PvP');
  assert.equal(expectRecord(decoded.data.groupNames)[85], '绘灵法师 · PvP');
});

test('HOTBAR retains rejected gaps and unmapped target PvP slots instead of inventing jobs', () => {
  const decoded = decodeHotbar(hotbar([46, 63, 86, 87, 88, 255]), 4);
  assert.equal(decoded.status, 'partial');
  assert.equal(expectDefined(decoded.coverage).unknownFields.length, 6);
  assert(expectRecords(decoded.data.slots).every((s) => s.classJobId === null));
  assert.deepEqual(
    expectRecords(decoded.data.slots).map((s) => s.savedHotbarIndex),
    [null, null, 68, 69, null, null],
  );
  assert(expectRecords(decoded.data.slots).every((s) => s.groupId !== 0));
});

test('GEARSET v110 header identifies current saved index and suppression state', () => {
  const body = Buffer.alloc(4 + 101 * 452);
  body[1] = 22;
  body[2] = 1;
  body[4 + 100 * 452] = 255;
  body[4 + 100 * 452 + 0x31] = 32;
  body.writeUInt32LE(1234, 4 + 100 * 452 + 0x38);
  const result = decodeGearset(body, 110);
  assert.equal(result.data.currentGearsetIndexRaw, 22);
  assert.equal(result.data.currentGearsetIndex, 22);
  assert.equal(result.data.currentGearsetLinkSuppressed, true);
  assert.equal(result.data.metadataReservedHex, '0000');
  assert.equal(result.data.savedSlotCount, 100);
  const snapshot = result.data.internalEquipmentSnapshot;
  assert.equal(expectRecord(snapshot).recordIndex, 100);
  assert.equal(expectRecord(snapshot).recordRole, 'internalEquipmentSnapshot');
  assert.equal(expectRecord(snapshot).isSavedGearsetSlot, false);
  assert.equal(expectRecord(snapshot).classJobId, 32);
  assert.equal(expectRecords(expectRecord(snapshot).items)[0].itemId, 1234);
  assert(
    !expectDefined(result.coverage).unknownFields.some(
      (f) => f.field === 'metadataHex' || f.field === 'records[100..]',
    ),
  );
  body[1] = 255;
  body[2] = 0;
  const noSelection = decodeGearset(body, 110).data;
  assert.equal(noSelection.currentGearsetIndexRaw, 255);
  assert.equal(noSelection.currentGearsetIndex, null);
  assert.equal(noSelection.currentGearsetLinkSuppressed, false);
});

test('GEARSET does not turn opaque metadata bytes or additional records into business values', () => {
  const body = Buffer.alloc(4 + 102 * 452);
  body.set([0xab, 100, 7, 0xcd]);
  const decoded = decodeGearset(body, 110);
  assert.equal(decoded.data.metadataReservedHex, 'abcd');
  assert.equal(decoded.data.currentGearsetIndex, null);
  assert.equal(decoded.data.currentGearsetLinkSuppressed, true);
  assert.equal(
    expectRecords(decoded.data.records)[101].recordRole,
    'unrecognizedAdditionalRecord',
  );
  assert(
    expectDefined(decoded.coverage).unknownFields.some(
      (f) => f.field === 'records[101..]',
    ),
  );
});

function addonRows(
  parameters: {
    hash: number;
    flags?: number;
    anchor?: number;
    visibility?: number;
    override?: number;
  }[],
) {
  const header = 32,
    dsHeader = 48,
    config = 16,
    data = parameters.length * 32,
    hud = 16;
  const bytes = Buffer.alloc(header + dsHeader + config + data + hud);
  bytes.write('ADDN');
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(32, 8);
  const ds = bytes.subarray(32);
  ds.write('Default');
  ds.writeUInt32LE(ds.length, 16);
  ds.writeUInt32LE(48, 20);
  ds.writeUInt32LE(48 + 16 + data, 28);
  ds.writeUInt32LE(parameters.length, 48);
  ds.writeUInt32LE(16, 52);
  ds.writeUInt32LE(16, 48 + 16 + data);
  parameters.forEach((entry, index) => {
    const at = 64 + index * 32;
    ds.writeUInt32LE(entry.hash, at);
    ds.writeUInt32LE(entry.flags ?? 0, at + 16);
    ds[at + 24] = entry.anchor ?? 4;
    ds[at + 25] = entry.visibility ?? 3;
    ds[at + 26] = entry.override ?? 0;
  });
  return bytes;
}

test('ADDON separates nine-way anchoring from input-mode HUD visibility and flags-only inheritance', async () => {
  const { decodeAddon } = await import('../src/main/services/dat/layouts.ts');
  const data = addonRows([
    { hash: 0x23815eb0, anchor: 8, visibility: 1 },
    { hash: 0x23815eb0, anchor: 0, visibility: 2, override: 1 },
  ]);
  const result = decodeAddon(data, 105);
  const [a, b] = expectRecords(expectRecords(result.data.datasets)[0].entries);
  assert.equal(a.alignmentType, 8);
  assert.equal(a.alignmentName, '右下');
  assert.equal(a.hudVisibleKeyboardMouse, true);
  assert.equal(a.hudVisibleGamepad, false);
  assert.equal(b.alignmentName, '左上');
  assert.equal(b.hudVisibleKeyboardMouse, false);
  assert.equal(b.hudVisibleGamepad, true);
  assert.equal(b.flagsOnlyOverride, true);
  assert(
    !expectDefined(result.coverage).unknownFields.some((f) =>
      f.field.includes('byteValue'),
    ),
  );
  assert.equal(a.byteValue1, 8);
  assert.equal(a.byteValue2, 1);
});

test('ADDON interprets job gauge simple mode and packed hotbar layout without applying them to unrelated addons', async () => {
  const { decodeAddon } = await import('../src/main/services/dat/layouts.ts');
  const { crc32 } = await import('node:zlib');
  const hash = (name: string) => crc32(Buffer.from(name + '_a'));
  const result = decodeAddon(
    addonRows([
      { hash: hash('JobHudBRD0'), flags: 4 },
      { hash: hash('_ActionBar02'), flags: 0x402 },
      { hash: hash('_ActionBar'), flags: 0 },
      { hash: hash('ActionMenu'), flags: 35 },
    ]),
    105,
  );
  const [gauge, bar, defaults, other] = expectRecords(
    expectRecords(result.data.datasets)[0].entries,
  );
  assert.deepEqual(gauge.elementSettings, {
    kind: 'jobGauge',
    useSimpleGauge: true,
  });
  assert.equal(expectRecord(bar.elementSettings).hotbarIndex, 2);
  assert.equal(expectRecord(bar.elementSettings).layoutIndex, 3);
  assert.equal(expectRecord(bar.elementSettings).layoutName, '3 × 4');
  assert.equal(expectRecord(defaults.elementSettings).usesDefaultLayout, true);
  assert.equal(expectRecord(defaults.elementSettings).layoutIndex, null);
  assert.deepEqual(other.elementSettings, {
    kind: 'addonSpecific',
    parameterRaw: 35,
  });
  assert(
    expectDefined(result.coverage).unknownFields.some((f) =>
      f.field.includes('other addon-specific'),
    ),
  );
});

test('ADDON native writer binds the first 16 HUD-header bytes to the saved layout name', async () => {
  const { decodeAddon } = await import('../src/main/services/dat/layouts.ts');
  const bytes = Buffer.alloc(32 + 48 + 16 + 16 + 64);
  bytes.write('ADDN');
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(32, 8);
  const ds = bytes.subarray(32);
  ds.write('Default');
  ds.writeUInt32LE(ds.length, 16);
  ds.writeUInt32LE(48, 20);
  ds.writeUInt32LE(64, 28);
  ds.writeUInt32LE(16, 52);
  ds.writeUInt32LE(16, 64);
  ds.writeUInt16LE(1, 64 + 10);
  ds.write('Saved layout', 80);
  ds.writeUInt32LE(64, 80 + 52);
  const result = decodeAddon(bytes, 105);
  assert.equal(
    expectRecords(expectRecords(result.data.datasets)[0].layouts)[0].name,
    'Saved layout',
  );
  assert.equal(
    expectRecords(expectRecords(result.data.datasets)[0].layouts)[0]
      .nameCandidate,
    'Saved layout',
  );
  assert.equal(expectDefined(result.coverage).candidateFields.length, 0);
});

test('GEARSET item bit1 records an unavailable original item independently of a missing item', () => {
  const body = Buffer.alloc(4 + 101 * 452);
  body[4 + 0x38 + 25] = 2;
  body[4 + 0x38 + 0x1c + 25] = 0xe3;
  const result = decodeGearset(body, 110);
  const [main, off] = expectRecords(
    expectRecords(result.data.records)[0].items,
  );
  assert.equal(main.registeredItemUnavailable, true);
  assert.equal(main.itemMissing, false);
  assert.equal(main.unknownFlags, 0);
  assert.equal(off.registeredItemUnavailable, true);
  assert.equal(off.itemMissing, true);
  assert.equal(off.unknownFlags, 0xe0);
  assert.equal(off.flags, 0xe3);
});
