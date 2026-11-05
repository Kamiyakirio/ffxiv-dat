import { decodedDetail } from './helpers/decoded-detail.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import catalog from '../src/main/services/dat/addon-name-data.json' with { type: 'json' };
import {
  nativeAddonName,
  addonDisplayName,
} from '../src/main/services/dat/addon-names.ts';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { createEditPlan } from '../src/main/services/dat/editor.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
import { buildFileNode } from '../src/renderer/components/browser-model.ts';
import {
  expectRecord,
  expectArray,
  expectRecords,
  expectString,
  expectDefined,
} from './helpers/assertions.ts';

function fixture() {
  // Empty slot followed by a known item and a real unknown hash. No HUD layouts.
  const payload = Buffer.alloc(208);
  payload.write('ADDN');
  payload.writeUInt32LE(1, 4);
  payload.writeUInt32LE(32, 8);
  const ds = payload.subarray(32);
  ds.write('Default');
  ds.writeUInt32LE(176, 16);
  ds.writeUInt32LE(48, 20);
  ds.writeUInt32LE(160, 28);
  ds.writeUInt32LE(3, 48);
  ds.writeUInt32LE(16, 52);
  ds.writeUInt32LE(16, 160);
  for (const [index, hash] of [
    [1, 0x23815eb0],
    [2, 0x5709adf2],
  ]) {
    const at = 64 + index * 32;
    ds.writeUInt32LE(hash, at);
    ds.writeFloatLE(50, at + 4);
    ds.writeFloatLE(25, at + 8);
    ds.writeFloatLE(0.8, at + 12);
    ds[at + 27] = 255;
  }
  const bytes = Buffer.alloc(payload.length + 96);
  bytes.writeUInt16LE(105, 2);
  bytes.writeUInt32LE(payload.length + 64, 4);
  bytes.writeUInt32LE(payload.length, 8);
  payload.copy(bytes, 16);
  return bytes;
}

test('native addon name catalog has exact CRC keys and distinct indexed names', () => {
  assert.equal(Object.keys(catalog.names).length, 595);
  for (const [hash, entry] of Object.entries(catalog.names)) {
    assert.equal(
      crc32(Buffer.from(entry.name + '_a'))
        .toString(16)
        .padStart(8, '0'),
      hash,
    );
    assert(Number.isSafeInteger(entry.sourceOffset));
    if ('format' in entry)
      assert.equal(entry.format.replace('%d', String(entry.index)), entry.name);
    assert.match(
      catalog.labels[entry.name as keyof typeof catalog.labels],
      /[\u3400-\u9fff]/,
    );
  }
  assert.equal(nativeAddonName(0x23815eb0), 'RecommendEquip');
  assert.equal(
    addonDisplayName(nativeAddonName(0x23815eb0), 0x23815eb0),
    '推荐装备',
  );
  assert.equal(nativeAddonName(0x37ad582e), 'InventoryEventGrid0');
  assert.equal(nativeAddonName(0x6422230f), 'InventoryEventGrid0E');
  assert.notEqual(
    addonDisplayName('InventoryEventGrid0', 0x37ad582e),
    addonDisplayName('InventoryEventGrid0E', 0x6422230f),
  );
  assert.equal(
    addonDisplayName('JobHudBRD0', crc32(Buffer.from('JobHudBRD0_a'))),
    '吟游诗人量谱 1',
  );
  assert.equal(nativeAddonName(0x5709adf2), null);
});

test('blank addon storage is retained but omitted from readable UI without shifting edit offsets', () => {
  const bytes = fixture(),
    decoded = decodeDat(bytes, 'ADDON.DAT');
  assert.equal(decoded.result.data.parseError, undefined);
  const entries = expectArray(
    expectRecords(decoded.result.data.datasets)[0].entries,
  );
  assert.equal(entries.length, 3);
  assert.equal(expectRecord(entries[0]).isEmptyStorage, true);
  assert.equal(expectRecord(entries[1]).addonName, 'RecommendEquip');
  const detail = decodedDetail({
    summary: { name: 'ADDON.DAT' },
    data: decoded.result.data,
    header: decoded.header,
  });
  detail.readable = readableSections(detail);
  const section = detail.readable[0];
  assert.equal(section.rows.length, 2);
  assert.equal(section.rows[0].name, '推荐装备');
  assert.match(
    expectString(expectDefined(section.rows[1].name)),
    /名称待核对.*5709adf2/,
  );
  assert.deepEqual(section.sourceKeys, ['128', '160']);
  const root = buildFileNode(detail);
  assert.deepEqual(
    expectDefined(expectDefined(root.children)[0].editTarget).prefixes,
    ['addon.128.'],
  );
  assert.deepEqual(
    expectDefined(expectDefined(root.children)[1].editTarget).prefixes,
    ['addon.160.'],
  );
  const plan = createEditPlan(bytes, 'ADDON.DAT');
  assert(!plan.fields.some((field) => field.id.startsWith('addon.96.')));
  assert(
    expectDefined(
      plan.fields.find((field) => field.id === 'addon.128.x'),
    ).group.includes('推荐装备'),
  );
  const expected = Buffer.from(bytes);
  expected.writeFloatLE(77, 16 + 128 + 4);
  assert.deepEqual(plan.apply([{ id: 'addon.128.x', value: 77 }]), expected);
});

test('zero hash with nonzero storage is not silently discarded as an empty slot', () => {
  const bytes = fixture();
  bytes[16 + 96 + 28] = 1;
  const decoded = decodeDat(bytes, 'ADDON.DAT');
  assert.equal(
    expectRecords(expectRecords(decoded.result.data.datasets)[0].entries)[0]
      .isEmptyStorage,
    false,
  );
  assert.equal(
    readableSections(
      decodedDetail({
        summary: { name: 'ADDON.DAT' },
        data: decoded.result.data,
      }),
    )[0].rows.length,
    3,
  );
});
