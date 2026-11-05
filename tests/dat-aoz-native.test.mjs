import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeAoz } from '../src/main/services/dat/uisave-aoz.ts';

const references = {
  1: { actionId: 11383, name: '水炮' },
  124: { actionId: 34582, name: '芥末爆弹' },
};
function fixture() {
  const b = Buffer.alloc(1825);
  for (let set = 0; set < 5; set++) {
    b[set * 24] = set + 1;
    b[set * 24 + 23] = 124;
    b.write(`第${set + 1}组`, 0x78 + set * 60);
    b[0x1a4 + set * 248] = 1;
    b[0x1a4 + set * 248 + 247] = 124;
  }
  b[0x717] = 124;
  b[0x720] = 1;
  return b;
}
test('AOZNOTE v3 uses native parallel columns and preserves all 24 action slots and ten recent slots', () => {
  const result = decodeNativeAoz(3, fixture(), references);
  assert.equal(result.activeSets.length, 5);
  for (let set = 0; set < 5; set++) {
    const r = result.activeSets[set];
    assert.equal(r.name, `第${set + 1}组`);
    assert.equal(r.activeBlueMageActionIds[0], set + 1);
    assert.equal(r.activeActions[23].actionId, 34582);
    assert.equal(r.standardHotbars[0].slots[0].storedId, 1);
    assert.equal(r.crossHotbars[7].slots[15].storedId, 124);
    assert.equal(r.crossHotbars[7].slots[15].offset, 0x1a4 + set * 248 + 247);
    assert.equal(r.macroFlagsHex.length, 62);
  }
  assert.equal(result.activeSets[0].activeActions[0].name, '水炮');
  assert.equal(result.recentActions.length, 10);
  assert.equal(result.recentActions[0].actionId, 34582);
  assert.equal(result.recentActions[9].actionId, 11383);
  assert.equal(result.recentActions[8].empty, true);
  assert.deepEqual(result.coverage.unknownFields, []);
});
test('AOZ macro bitmap is 248 low-first bits: 120 standard then 128 cross, independent for each set', () => {
  const b = fixture();
  const flagged = [0, 7, 8, 119, 120, 127, 128, 247];
  for (const linear of flagged) {
    b[0x67c + 2 * 31 + (linear >>> 3)] |= 1 << (linear & 7);
    b[0x1a4 + 2 * 248 + linear] = linear % 2 ? 199 : 0;
  }
  const r = decodeNativeAoz(3, b, references);
  const slots = r.activeSets[2].standardHotbars
    .concat(r.activeSets[2].crossHotbars)
    .flatMap((bar) => bar.slots);
  assert.deepEqual(
    slots.flatMap((s, i) => (s.isMacro ? [i] : [])),
    flagged,
  );
  assert.equal(slots[0].kind, 'Macro');
  assert.equal(slots[0].macroBankName, '个人');
  assert.equal(slots[0].macroIndex, 0);
  assert.equal(slots[7].macroBankName, '公用');
  assert.equal(slots[7].macroIndex, 99);
  assert.equal(slots[7].macroCommandId, 0x163);
  assert.equal(slots[120].macroFlagBit, 0);
  assert.equal(slots[247].macroFlagBit, 7);
  assert(
    r.activeSets[1].standardHotbars.every((bar) =>
      bar.slots.every((s) => !s.isMacro),
    ),
  );
  assert(
    r.activeSets[3].crossHotbars.every((bar) =>
      bar.slots.every((s) => !s.isMacro),
    ),
  );
});
test('AOZ consumers distinguish zero and 255 sentinels from macro zero and retain unsupported values', () => {
  const b = fixture();
  b[0x1a4] = 0;
  b[0x1a5] = 255;
  b[0x1a6] = 200;
  b[0x1a7] = 200;
  b[0x67c] |= 1 << 3;
  const r = decodeNativeAoz(3, b, references);
  const slots = r.activeSets[0].standardHotbars[0].slots;
  assert.equal(slots[0].kind, 'ClearBlueMageOrMacro');
  assert.equal(slots[1].kind, 'PreserveExisting');
  assert.equal(slots[2].kind, 'Action');
  assert.equal(slots[2].actionId, null);
  assert.equal(slots[2].storedId, 200);
  assert.equal(slots[3].kind, 'InvalidMacro');
  assert.equal(slots[3].storedValue, 200);
  assert.equal(slots[3].macroCommandId, null);
  assert.equal(r.coverage.unknownFields.length, 1);
});
test('AOZ name column stores 60 bytes, with runtime-added terminator; invalid UTF-8 is preserved', () => {
  const b = fixture();
  Buffer.alloc(60, 0x61).copy(b, 0x78);
  b.fill(0, 0x78 + 60, 0x78 + 120);
  b[0x78 + 60] = 0xff;
  const r = decodeNativeAoz(3, b, references);
  assert.equal(r.activeSets[0].name, 'a'.repeat(60));
  assert.equal(r.activeSets[0].nameByteLength, 60);
  assert.equal(r.activeSets[0].nameStorageNulTerminated, false);
  assert.equal(r.activeSets[1].name, null);
  assert.equal(r.activeSets[1].nameStorageHex.slice(0, 4), 'ff00');
  assert.equal(r.coverage.unknownFields.length, 1);
});
test('AOZ decoder accepts only the verified v3 size', () => {
  assert.equal(decodeNativeAoz(2, fixture(), references), null);
  assert.equal(decodeNativeAoz(3, Buffer.alloc(1824), references), null);
  assert.equal(decodeNativeAoz(3, Buffer.alloc(1826), references), null);
});
