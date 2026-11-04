import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDat } from '../src/main/services/dat/decoder.ts';

function field(tag, text) {
  const value = Buffer.from(`${text}\0`);
  const header = Buffer.alloc(3);
  header[0] = tag.charCodeAt(0);
  header.writeUInt16LE(value.length, 1);
  return Buffer.concat([header, value]);
}

function binary(type, version, data, mask = 0x73) {
  const bytes = Buffer.alloc(32 + data.length + 1);
  bytes.writeUInt16LE(type);
  bytes.writeUInt16LE(version, 2);
  bytes.writeUInt32LE(data.length + 1, 4);
  bytes.writeUInt32LE(data.length + 1, 8);
  bytes[16] = 0xff;
  for (let i = 0; i < data.length; i++) bytes[i + 17] = data[i] ^ mask;
  return bytes;
}

function macroFile() {
  const macro = Buffer.concat([
    field('T', '合成测试'),
    field('I', '0010AB'),
    field('K', '001'),
    ...Array.from({ length: 15 }, (_, i) =>
      field('L', i ? '' : '/echo synthetic'),
    ),
  ]);
  return binary(1, 2, Buffer.concat(Array(100).fill(macro)));
}

test('macro records keep UTF-8 text, all 15 lines and numeric icon without changing source bytes', () => {
  const bytes = macroFile();
  const before = Buffer.from(bytes);
  const decoded = decodeDat(bytes, 'MACRO.DAT');
  assert.equal(decoded.result.status, 'decoded');
  assert.equal(decoded.result.data.count, 100);
  assert.equal(decoded.result.data.macros[0].name, '合成测试');
  assert.equal(decoded.result.data.macros[0].lines.length, 15);
  assert.equal(decoded.result.data.macros[0].iconId, 0x10ab);
  assert.deepEqual(bytes, before);
});

test('key bindings distinguish hexadecimal keys, keyboard and gamepad modifiers', () => {
  const payload = Buffer.concat([
    field('T', 'TEST'),
    field('C', '41.03,AF.01,'),
  ]);
  const decoded = decodeDat(binary(3, 101, payload), 'KEYBIND.DAT');
  assert.equal(decoded.result.status, 'decoded');
  assert.equal(decoded.result.data.bindings[0].keys[0].keyName, 'A');
  assert.deepEqual(decoded.result.data.bindings[0].keys[0].modifierNames, [
    'Shift',
    'Ctrl',
  ]);
  assert.deepEqual(decoded.result.data.bindings[0].keys[1].modifierNames, [
    'L1',
  ]);
});

test('malformed lengths and type mismatches remain explicit parse errors with bytes retained', () => {
  const bytes = macroFile();
  bytes.writeUInt32LE(bytes.length, 8);
  const result = decodeDat(bytes, 'MACRO.DAT');
  assert.match(result.result.data.parseError, /beyond file/);
  assert.deepEqual(result.payload, bytes);
  assert.match(
    decodeDat(macroFile(), 'GEARSET.DAT').result.data.parseError,
    /does not match/,
  );
});

test('an empty ACQ uses its observed zero marker and has no contacts', () => {
  const bytes = binary(6, 100, Buffer.alloc(0));
  bytes[16] = 0;
  const decoded = decodeDat(bytes, 'ACQ.DAT');
  assert.equal(decoded.result.status, 'decoded');
  assert.equal(decoded.result.data.contactCount, 0);
});

test('text configs consume terminal NUL without losing the original text', () => {
  const bytes = Buffer.from('<Settings>\r\nName\t123\r\n\0');
  const decoded = decodeDat(bytes, 'COMMON.DAT');
  assert.equal(decoded.result.status, 'decoded');
  assert.equal(decoded.result.data.entries[0].numericValue, 123);
  assert.equal(decoded.result.data.trailingNulCount, 1);
  assert.equal(decoded.result.data.text, bytes.toString());
});

test('character preset checksum detects a changed appearance byte', () => {
  const bytes = Buffer.alloc(212);
  bytes.writeUInt32LE(0x2013ff14);
  bytes.writeUInt32LE(8, 4);
  bytes[16] = 3;
  bytes[17] = 1;
  bytes.writeUInt32LE(3 ^ (1 << 1), 8);
  assert.equal(
    decodeDat(bytes, 'FFXIV_CHARA_01.dat').result.data.checksumMatches,
    true,
  );
  bytes[16] ^= 1;
  assert.equal(
    decodeDat(bytes, 'FFXIV_CHARA_01.dat').result.data.checksumMatches,
    false,
  );
});

test('backup tables preserve exact member offsets and reject incomplete boundaries', () => {
  const member = Buffer.from('Test\t42\r\n');
  const header = Buffer.alloc(104);
  header.write('FFXIV_BKCHR_RESTORE_DATA');
  header.writeUInt32LE(member.length, 44);
  header.writeUInt32LE(member.length, 48);
  const bytes = Buffer.concat([header, member]);
  const decoded = decodeDat(bytes, 'backup.dat');
  assert.equal(decoded.members.length, 1);
  assert.equal(decoded.members[0].offset, 104);
  assert.equal(
    decoded.members[0].decoded.result.data.entries[0].numericValue,
    42,
  );
  assert.match(
    decodeDat(bytes.subarray(0, -1), 'backup.dat').result.data.parseError,
    /exactly/,
  );
});
