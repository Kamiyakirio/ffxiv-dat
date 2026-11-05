import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeBanners,
  generateBannerChecksum,
  bannerChecksumPayload,
} from '../src/main/services/dat/uisave-banner.ts';
import {
  expectRecord,
  expectRecords,
  expectDefined,
  expectCoverage,
} from './helpers/assertions.ts';

function fixed(tag: number, bytes: Buffer) {
  const header = Buffer.alloc(2);
  header.writeUInt16LE(tag);
  return Buffer.concat([header, bytes]);
}
function word(value: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function integer(value: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function chunk(bytes: Buffer, id = 0) {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(id);
  b.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([b, bytes]);
}
function variable(tag: number, bytes: Buffer) {
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
      variable(24, word(0x0102)),
    ]),
  );
  const result = expectDefined(decodeBanners(bytes));
  const record = expectRecords(expectRecords(result.chunks)[0].records)[0];
  assert.equal(expectCoverage(result.coverage).structureComplete, true);
  assert.deepEqual(record.customize, {
    race: 4,
    sex: 1,
    height: 100,
    tribe: 7,
  });
  assert.deepEqual(record.ambientLightingColourRgb, {
    red: 32,
    green: 53,
    blue: 255,
  });
  assert.equal(record.ambientLightingColourHex, '#2035ff');
  assert.equal(record.bannerIndex, 7);
  assert.equal(record.bannerId, 0);
  assert.equal(record.flagsRaw, 0x0102);
  assert.deepEqual(record.setFlagIndices, [1, 8]);
  assert.equal(record.unknownTag24, undefined);
  assert.deepEqual(expectRecord(record.references).expression, {
    sheet: 'BannerFacial',
    rowId: 22,
  });
  assert.deepEqual(expectRecord(record.references).bannerTimeline, {
    sheet: 'BannerTimeline',
    rowId: 69,
  });
  assert(
    expectCoverage(result.coverage).knownFields.includes('customize.race'),
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'flagsRaw',
    ),
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) =>
        field.field === 'checksumVerification' && field.kind === 'reference',
    ),
  );
  assert(!expectCoverage(result.coverage).candidateFields.includes('bannerBg'));
});

test('unknown tags preserve already decoded records and the rest of their bounded block', () => {
  const unknown = Buffer.from([0xfe, 0, 1, 2, 3]);
  const result = expectDefined(
    decodeBanners(
      Buffer.concat([
        chunk(Buffer.concat([fixed(0, word(1)), fixed(2, word(9)), unknown])),
        chunk(fixed(0, word(2))),
      ]),
    ),
  );
  assert.equal(result.recordCount, 2);
  assert.equal(
    expectRecords(expectRecords(result.chunks)[0].records)[0].bannerBg,
    9,
  );
  assert.equal(
    expectRecords(result.chunks)[0].unparsedFieldsHex,
    unknown.toString('hex'),
  );
  assert.equal(
    expectRecords(expectRecords(result.chunks)[1].records)[0].recordKeyRaw,
    2,
  );
  assert.equal(result.completeFieldStream, false);
  assert.equal(expectCoverage(result.coverage).structureComplete, false);
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'tag254',
    ),
  );
});

test('unknown customization width and invalid UTF-8 remain explicit rather than silently inventing text or fields', () => {
  const result = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          variable(1, Buffer.from([0xff, 0, 0, 0])),
          Buffer.concat([
            variable(22, Buffer.from([1, 2, 3, 4, 5])),
            Buffer.alloc(1),
          ]),
        ]),
      ),
    ),
  );
  const record = expectRecords(expectRecords(result.chunks)[0].records)[0];
  assert.equal(record.bannerTimelineName, null);
  assert.equal(record.customize, undefined);
  assert.equal(expectRecord(record.customizeCandidate).rawHex, '0102030405');
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'customize',
    ),
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'bannerTimelineName',
    ),
  );
});

test('non-finite half vectors and repeated portrait keys are exposed as specific diagnostics', () => {
  const result = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          fixed(8, Buffer.concat([word(0x7c00), word(0), word(0)])),
          fixed(0, word(1)),
        ]),
      ),
    ),
  );
  assert.deepEqual(
    expectRecords(expectRecords(result.chunks)[0].records)[0].cameraPosition,
    [null, 0, 0],
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'cameraPosition',
    ),
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (field) => field.field === 'recordKeyRaw',
    ),
  );
});

test('incomplete chunks cannot be read beyond the declared container', () => {
  assert.equal(decodeBanners(Buffer.alloc(15)), null);
  const bytes = chunk(fixed(0, word(1)));
  assert.equal(decodeBanners(bytes.subarray(0, -1)), null);
});

test('serialized physical indices are mapped to dense BannerIds only for records accepted by the client', () => {
  const decoded = expectDefined(
    decodeBanners(
      Buffer.concat([
        chunk(Buffer.alloc(0), 1),
        chunk(Buffer.concat([fixed(0, word(7)), fixed(0, word(2))])),
      ]),
    ),
  );
  assert.deepEqual(decoded.bannerIdToIndex, [
    { bannerId: 0, bannerIndex: 7 },
    { bannerId: 1, bannerIndex: 2 },
  ]);
  const invalid = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(7)),
          fixed(0, word(7)),
          fixed(0, word(3)),
        ]),
      ),
    ),
  );
  assert.equal(invalid.recordCount, 1);
  assert.equal(expectCoverage(invalid.coverage).structureComplete, false);
  assert.equal(
    expectRecords(invalid.chunks)[0].unparsedFieldsHex,
    '0000070000000300',
  );
  const recovered = expectDefined(
    decodeBanners(
      Buffer.concat([
        chunk(Buffer.concat([fixed(0, word(7)), fixed(0, word(7))])),
        chunk(fixed(0, word(2))),
      ]),
    ),
  );
  assert.deepEqual(recovered.bannerIdToIndex, [
    { bannerId: 0, bannerIndex: 7 },
    { bannerId: 1, bannerIndex: 2 },
  ]);
  const foreign = expectDefined(decodeBanners(chunk(fixed(0, word(7)), 2)));
  assert.equal(foreign.recordCount, 0);
  assert.equal(expectRecords(foreign.chunks)[0].rawHex, '00000700');
});

test('tag24 is a length-framed flags value and consumes odd-length padding without shifting following fields', () => {
  const decoded = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          variable(24, Buffer.from([0x80])),
          Buffer.from([0xa5]),
          fixed(2, word(9)),
        ]),
      ),
    ),
  );
  const record = expectRecords(expectRecords(decoded.chunks)[0].records)[0];
  assert.equal(record.flagsRaw, 128);
  assert.equal(record.bannerBg, 9);
  const field = expectDefined(
    expectRecords(record.fields).find((f) => f.tag === 24),
  );
  assert.equal(field.declaredLength, 1);
  assert.equal(field.valueHex, '80');
  assert.equal(field.alignmentHex, 'a5');
});

test('name storage exposes the exact declared boundary and NUL/alignment bytes', () => {
  const decoded = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          variable(1, Buffer.from([65, 66, 0, 0])),
          fixed(2, word(9)),
        ]),
      ),
    ),
  );
  const record = expectRecords(expectRecords(decoded.chunks)[0].records)[0];
  assert.equal(record.bannerTimelineName, 'AB');
  assert.equal(record.hasCustomTimelineName, true);
  assert.equal(record.nameByteLength, 2);
  assert.equal(record.nameStorageByteLength, 4);
  assert.equal(record.namePaddingHex, '0000');
  assert.equal(record.bannerBg, 9);
});

test('equipment checksum uses the exact normalized 92-byte CRC32 payload, not portrait record bytes', () => {
  const empty = {
    itemIds: Array(14).fill(0),
    stainIds: Array(28).fill(0),
    glassesIds: [0, 0],
    gearVisibilityFlag: 0,
  };
  assert.equal(generateBannerChecksum(empty), 0xc2b526e7);
  const fixture = {
    itemIds: Array.from({ length: 14 }, (_, i) => 1000001 + i),
    stainIds: Array.from({ length: 14 }, (_, i) => [i, i + 30]).flat(),
    glassesIds: [12, 23],
    gearVisibilityFlag: 14,
  };
  assert.equal(bannerChecksumPayload(fixture).length, 92);
  assert.equal(generateBannerChecksum(fixture), 0x253bfa0d);
  const belt = {
    ...fixture,
    itemIds: [...fixture.itemIds],
    stainIds: [...fixture.stainIds],
  };
  belt.itemIds[5] = 123;
  belt.stainIds[10] = 255;
  assert.equal(generateBannerChecksum(belt), generateBannerChecksum(fixture));
  const normal = {
    ...fixture,
    itemIds: fixture.itemIds.map((id) => id - 1000000),
  };
  assert.equal(generateBannerChecksum(normal), generateBannerChecksum(fixture));
  const hidden = { ...fixture, gearVisibilityFlag: 15 };
  const head = {
    ...hidden,
    itemIds: [...hidden.itemIds],
    stainIds: [...hidden.stainIds],
  };
  head.itemIds[2] = 499999;
  head.stainIds[4] = 255;
  assert.equal(generateBannerChecksum(hidden), generateBannerChecksum(head));
  assert.equal(bannerChecksumPayload(hidden).readUInt32LE(88), 3);
  assert.throws(
    () => generateBannerChecksum({ ...empty, itemIds: [] }),
    /snapshot/,
  );
});

test('lighting tags follow actual native offsets and flag zero selects the default preset', () => {
  const decoded = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          fixed(14, Buffer.from([1, 2, 3, 0])),
          fixed(15, word(4)),
          fixed(16, Buffer.from([5, 6, 7, 0])),
          fixed(17, word(8)),
          variable(24, word(1)),
        ]),
      ),
    ),
  );
  const r = expectRecords(expectRecords(decoded.chunks)[0].records)[0];
  assert.deepEqual(r.ambientLightingColour, [1, 2, 3, 0]);
  assert.deepEqual(r.directionalLightingColour, [5, 6, 7, 0]);
  assert.equal(r.ambientLightingBrightness, 4);
  assert.equal(r.directionalLightingBrightness, 8);
  assert.equal(r.useDefaultPreset, true);
  assert.equal(r.unknownFlags, 0);
  assert(
    !expectCoverage(decoded.coverage).unknownFields.some(
      (f) => f.field === 'flagsRaw',
    ),
  );
});

test('byte-backed portrait settings and signed timestamps match what the client actually loads', () => {
  const decoded = expectDefined(
    decodeBanners(
      chunk(
        Buffer.concat([
          fixed(0, word(1)),
          fixed(7, word(0x1234)),
          fixed(10, word(0x5678)),
          fixed(15, word(0x90ab)),
          fixed(17, word(0xcdef)),
          fixed(21, integer(0xffffffff)),
        ]),
      ),
    ),
  );
  const r = expectRecords(expectRecords(decoded.chunks)[0].records)[0];
  assert.equal(r.expression, 0x34);
  assert.equal(r.cameraZoom, 0x78);
  assert.equal(r.ambientLightingBrightness, 0xab);
  assert.equal(r.directionalLightingBrightness, 0xef);
  assert.equal(r.lastUpdatedUnix, -1);
  assert.equal(
    expectDefined(expectRecords(r.fields).find((f) => f.tag === 7)).valueHex,
    '3412',
  );
});
