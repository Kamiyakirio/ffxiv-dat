import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBanners } from '../src/main/services/dat/uisave-banner.ts';

function fixed(tag, bytes) {
  const header = Buffer.alloc(2);
  header.writeUInt16LE(tag);
  return Buffer.concat([header, bytes]);
}
function word(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function integer(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function chunk(bytes, id = 0) {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(id);
  b.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([b, bytes]);
}
function variable(tag, bytes) {
  return Buffer.concat([word(tag), word(bytes.length), bytes]);
}

test('portrait fields expose reference sheets, RGB components and the exact four-byte customization summary', () => {
  const bytes = chunk(
    Buffer.concat([
      fixed(0, word(7)),
      fixed(2, word(2)),
      fixed(3, word(3)),
      fixed(4, word(4)),
      fixed(5, word(69)),
      fixed(7, word(22)),
      fixed(14, Buffer.from([32, 53, 255, 0])),
      fixed(16, Buffer.from([255, 255, 255, 0])),
      variable(22, Buffer.from([4, 1, 100, 7])),
      fixed(23, integer(1234)),
      fixed(24, integer(2)),
    ]),
  );
  const result = decodeBanners(bytes);
  const record = result.chunks[0].records[0];
  assert.equal(result.coverage.structureComplete, true);
  assert.deepEqual(record.customize, {
    race: 4,
    sex: 1,
    height: 100,
    tribe: 7,
  });
  assert.deepEqual(record.directionalLightingColourRgb, {
    red: 32,
    green: 53,
    blue: 255,
  });
  assert.equal(record.directionalLightingColourHex, '#2035ff');
  assert.deepEqual(record.references.expression, {
    sheet: 'BannerFacial',
    rowId: 22,
  });
  assert.deepEqual(record.references.bannerTimeline, {
    sheet: 'BannerTimeline',
    rowId: 69,
  });
  assert(result.coverage.knownFields.includes('customize.race'));
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'unknownTag24',
    ),
  );
  assert(
    result.coverage.unknownFields.some(
      (field) =>
        field.field === 'checksumVerification' && field.kind === 'reference',
    ),
  );
  assert(!result.coverage.candidateFields.includes('bannerBg'));
});

test('unknown tags preserve already decoded records and the rest of their bounded block', () => {
  const unknown = Buffer.from([0xfe, 0, 1, 2, 3]);
  const result = decodeBanners(
    Buffer.concat([
      chunk(Buffer.concat([fixed(0, word(1)), fixed(2, word(9)), unknown])),
      chunk(fixed(0, word(2)), 1),
    ]),
  );
  assert.equal(result.recordCount, 2);
  assert.equal(result.chunks[0].records[0].bannerBg, 9);
  assert.equal(result.chunks[0].unparsedFieldsHex, unknown.toString('hex'));
  assert.equal(result.chunks[1].records[0].recordKeyRaw, 2);
  assert.equal(result.completeFieldStream, false);
  assert.equal(result.coverage.structureComplete, false);
  assert(
    result.coverage.unknownFields.some((field) => field.field === 'tag254'),
  );
});

test('unknown customization width and invalid UTF-8 remain explicit rather than silently inventing text or fields', () => {
  const result = decodeBanners(
    chunk(
      Buffer.concat([
        fixed(0, word(1)),
        variable(1, Buffer.from([0xff, 0])),
        variable(22, Buffer.from([1, 2, 3, 4, 5])),
      ]),
    ),
  );
  const record = result.chunks[0].records[0];
  assert.equal(record.bannerTimelineName, null);
  assert.equal(record.customize, undefined);
  assert.equal(record.customizeCandidate.rawHex, '0102030405');
  assert(
    result.coverage.unknownFields.some((field) => field.field === 'customize'),
  );
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'bannerTimelineName',
    ),
  );
});

test('non-finite half vectors and repeated portrait keys are exposed as specific diagnostics', () => {
  const result = decodeBanners(
    chunk(
      Buffer.concat([
        fixed(0, word(1)),
        fixed(8, Buffer.concat([word(0x7c00), word(0), word(0)])),
        fixed(0, word(1)),
      ]),
    ),
  );
  assert.deepEqual(result.chunks[0].records[0].cameraPosition, [null, 0, 0]);
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'cameraPosition',
    ),
  );
  assert(
    result.coverage.unknownFields.some(
      (field) => field.field === 'recordKeyRaw',
    ),
  );
});

test('incomplete chunks cannot be read beyond the declared container', () => {
  assert.equal(decodeBanners(Buffer.alloc(15)), null);
  const bytes = chunk(fixed(0, word(1)));
  assert.equal(decodeBanners(bytes.subarray(0, -1)), null);
});
