import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeAddon,
  decodeGearset,
  decodeHotbar,
} from '../src/main/services/dat/layouts.ts';

test('HOTBAR reads stored coordinates and command types from disk records', () => {
  // Disk format stores a 4-byte ID before group/bar/slot/type, unlike SavedHotbarSlot.
  const result = decodeHotbar(
    Buffer.from([0x34, 0x12, 0, 0, 0x40, 17, 15, 7]),
    4,
  );
  assert.equal(result.status, 'decoded');
  assert.deepEqual(result.data.slots[0], {
    offset: 0,
    groupId: 64,
    groupKindCandidate: 'pvpStoredGroup',
    classJobIdCandidate: null,
    barIndex: 17,
    slotIndex: 15,
    commandType: 7,
    commandTypeName: 'Macro',
    commandId: 0x1234,
    commandTypeLabel: '宏',
    commandName: null,
    nameSource: null,
  });
});

test('HOTBAR rejects truncation, duplicate keys and out-of-range coordinates', () => {
  assert.throws(() => decodeHotbar(Buffer.alloc(7), 4), /8-byte/);
  assert.throws(() => decodeHotbar(Buffer.alloc(16), 4), /Duplicate/);
  const invalid = Buffer.alloc(8);
  invalid[5] = 18;
  assert.throws(() => decodeHotbar(invalid, 4), /coordinate/);
});

test('unverified format versions do not inherit the current layout', () => {
  assert.equal(decodeHotbar(Buffer.alloc(0), 999).status, 'unsupported');
  assert.equal(decodeGearset(Buffer.alloc(0), 109).status, 'unsupported');
  assert.equal(decodeAddon(Buffer.alloc(0), 104).status, 'unsupported');
});

test('GEARSET keeps metadata and decodes the 452-byte record without shifting the name', () => {
  const bytes = Buffer.alloc(4 + 452);
  bytes.writeUInt32LE(0x11223344, 0);
  const record = bytes.subarray(4);
  record[0] = 12;
  record.write('学者', 1);
  record[0x31] = 28;
  record.writeInt16LE(730, 0x34);
  record[0x37] = 0x19;
  record.writeUInt32LE(1049381, 0x38);
  record[0x38 + 8] = 9;
  record[0x38 + 9] = 10;
  record.writeUInt16LE(111, 0x38 + 10);
  record[0x38 + 20] = 12;
  record[0x38 + 25] = 0x1d;
  record[0x38 + 26] = 0xa5;
  record[0x33] = 0xfe;
  record.writeUInt16LE(7, 0x1c0);
  const result = decodeGearset(bytes, 110);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.metadataHex, '44332211');
  const decoded = result.data.records[0];
  assert.equal(decoded.name, '学者');
  assert.equal(decoded.classJobId, 28);
  assert.equal(decoded.itemLevel, 730);
  assert.equal(decoded.exists, true);
  assert.equal(decoded.headgearVisible, true);
  assert.equal(decoded.weaponsVisible, true);
  assert.equal(decoded.visorEnabled, false);
  assert.equal(decoded.unknownByte33, 0xfe);
  assert.equal(decoded.items[0].baseItemId, 49381);
  assert.deepEqual(decoded.items[0].stainIds, [9, 10]);
  assert.deepEqual(decoded.items[0].materia[0], { id: 111, grade: 12 });
  assert.equal(decoded.items[0].itemMissing, true);
  assert.equal(decoded.items[0].colorDiffers, true);
  assert.equal(decoded.items[0].materiaDiffers, true);
  assert.equal(decoded.items[0].appearanceDiffers, true);
  assert.equal(decoded.items[0].unknownTailHex, 'a500');
  assert.deepEqual(decoded.glassesIds, [7, 0]);
  assert.throws(() => decodeGearset(bytes.subarray(0, -1), 110), /452-byte/);
});

function addonFixture() {
  // One dataset, one ordinary entry, one layout with one HUD entry.
  const bytes = Buffer.alloc(32 + 48 + 16 + 32 + 16 + 64 + 32);
  bytes.write('ADDN');
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(32, 8);
  const ds = bytes.subarray(32);
  ds.write('Default');
  ds.writeUInt32LE(ds.length, 16);
  ds.writeUInt32LE(48, 20);
  ds.writeUInt32LE(96, 28);
  ds.writeUInt32LE(1, 48);
  ds.writeUInt32LE(16, 52);
  ds.writeUInt32LE(0x9e53098a, 64); // CRC32('Teleport_a') from the structure name.
  ds.writeFloatLE(50.25, 68);
  ds.writeFloatLE(75, 72);
  ds.writeFloatLE(1.2, 76);
  ds.writeUInt16LE(320, 84);
  ds.writeUInt16LE(180, 86);
  ds.writeUInt32LE(16, 96);
  ds.writeUInt32LE(1, 100);
  ds.writeUInt16LE(1, 106);
  ds.writeUInt32LE(64, 112 + 52);
  ds.writeUInt32LE(0x9e53098a, 176);
  return bytes;
}

test('ADDON follows dataset offsets and the separate 32-byte HUD record layout', () => {
  const result = decodeAddon(addonFixture(), 105);
  const dataset = result.data.datasets[0];
  assert.equal(dataset.name, 'Default');
  assert.equal(dataset.regularEntryCount, 1);
  assert.equal(dataset.entries[0].addonName, 'Teleport');
  assert.equal(dataset.entries[0].x, 50.25);
  assert.equal(dataset.entries[0].width, 320);
  assert.equal(dataset.layoutCount, 1);
  assert.equal(dataset.layouts[0].entries[0].offset, 32 + 176);
  assert.equal(dataset.layouts[0].entries[0].addonName, 'Teleport');
});

test('ADDON rejects forged section sizes and overlapping offsets before allocation', () => {
  const truncated = addonFixture().subarray(0, -1);
  assert.throws(() => decodeAddon(truncated, 105), /range/);
  const oversized = addonFixture();
  oversized.writeUInt32LE(0xffffffff, 32 + 48);
  assert.throws(() => decodeAddon(oversized, 105), /range/);
  const overlapping = addonFixture();
  overlapping.writeUInt32LE(0, 32 + 112 + 52);
  assert.throws(() => decodeAddon(overlapping, 105), /overlap/);
});
