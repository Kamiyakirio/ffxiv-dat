import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUiSave } from '../src/main/services/dat/uisave.ts';
import { decodeTofu } from '../src/main/services/dat/uisave-tofu.ts';
import { decodeBanners } from '../src/main/services/dat/uisave-banner.ts';

function fixture(segments) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16);
  header.writeUInt32LE(segments.length, 4);
  header.writeBigUInt64LE(0xffffffffffffffffn, 8);
  return Buffer.concat([
    header,
    ...segments.map(({ id, version = 0, body }) => {
      const segmentHeader = Buffer.alloc(16);
      segmentHeader.writeUInt16LE(id);
      segmentHeader.writeUInt16LE(version, 2);
      segmentHeader.writeUInt32LE(body.length, 4);
      segmentHeader.writeUInt32LE(body.length, 8);
      return Buffer.concat([segmentHeader, body, Buffer.alloc(4)]);
    }),
  ]);
}

test('UISAVE validates variable segment boundaries and preserves full uint64 Content ID', () => {
  const result = decodeUiSave(
    fixture([
      { id: 32, body: Buffer.from([17]) },
      { id: 44, version: 1, body: Buffer.alloc(0) },
    ]),
    1,
  );
  assert.equal(result.data.completeContainer, true);
  assert.equal(result.data.contentId, '18446744073709551615');
  assert.equal(result.data.segments[0].data.countdownLength, 17);
  assert.equal(result.data.segments[1].offset, 37);
  assert.equal(result.data.segments[1].data.empty, true);
});

test('UISAVE removes the inner marker and applies only the additional XOR mask', () => {
  const plain = Buffer.alloc(84);
  plain.writeUInt16LE(123, 2);
  plain.writeUInt16LE(456, 22);
  const encoded = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(plain.map((byte) => byte ^ 0x73)),
  ]);
  const result = decodeUiSave(
    fixture([{ id: 10, version: 102, body: encoded }]),
    1,
  );
  const segment = result.data.segments[0];
  assert.equal(segment.rawHex, encoded.toString('hex'));
  assert.equal(segment.decodedHex, plain.toString('hex'));
  assert.equal(segment.data.unseen[0], 123);
  assert.equal(segment.data.favorites[0], 456);
  assert.equal(segment.status, 'decoded');
  assert.ok(
    segment.coverage.unknownFields.every((field) => field.kind === 'storage'),
  );
});

test('UISAVE does not discard an unknown segment or overrun a truncated section', () => {
  const input = fixture([{ id: 255, body: Buffer.from('01020304', 'hex') }]);
  const valid = decodeUiSave(input, 1);
  assert.equal(valid.data.segments[0].name, 'UNKNOWN_255');
  assert.equal(valid.data.segments[0].decodedHex, '01020304');
  const truncated = decodeUiSave(input.subarray(0, input.length - 1), 1);
  assert.equal(truncated.data.completeContainer, false);
  assert.equal(truncated.data.segments.length, 0);
  assert.ok(
    truncated.warnings.some((warning) => warning.includes('Truncated')),
  );
  assert.equal(
    truncated.data.remainingHex,
    input.subarray(16, -1).toString('hex'),
  );
});

test('UISAVE warns about declared count mismatch and repeated segment identifiers', () => {
  const input = fixture([
    { id: 32, body: Buffer.from([10]) },
    { id: 32, body: Buffer.from([20]) },
  ]);
  input.writeUInt32LE(3, 4);
  const result = decodeUiSave(input, 1);
  assert.equal(result.data.completeContainer, false);
  assert.ok(result.warnings.some((warning) => warning.includes('Expected 3')));
  assert.ok(
    result.data.segments[1].warnings.some((warning) =>
      warning.includes('Duplicate'),
    ),
  );
});

test('UISAVE keeps unknown inner versions raw instead of applying sampled layouts', () => {
  const plain = Buffer.alloc(84);
  const result = decodeUiSave(
    fixture([{ id: 10, version: 999, body: plain }]),
    1,
  );
  assert.equal(result.data.segments[0].data.favorites, undefined);
  assert.equal(result.data.segments[0].decodedHex, plain.toString('hex'));
});

function chunk(id, body) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(id);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function words(...values) {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) =>
    bytes.writeUInt16LE(value & 0xffff, index * 2),
  );
  return bytes;
}

test('TOFU decodes typed objects after odd byte arrays and validates record lengths', () => {
  const content = Buffer.concat([
    words(0, 5, 1, 4),
    Buffer.from('demo'),
    words(2, 100, 3, 4),
    Buffer.from('text'),
    words(4, 1, 1, 9, 5, 3, 1, 100, 200, 6, 1, 1, -30),
    words(7, 0, 1),
    Buffer.from([100, 0]),
    words(8, 2, 1),
    Buffer.from([255, 10, 20, 30]),
    words(10, 1, 1, 4),
  ]);
  const bytes = chunk(2, Buffer.concat([words(0, content.length), content]));
  const result = decodeTofu(bytes);
  assert.equal(result.completeChunkStream, true);
  const record = result.chunks[0].data.records[0];
  assert.equal(record.title, 'demo');
  assert.equal(record.objects[0].objectType, 100);
  assert.equal(record.objects[0].text, 'text');
  assert.deepEqual(record.objects[0].position, { x: 100, y: 200 });
  assert.equal(record.objects[0].angle, -30);
  assert.equal(record.objects[0].scale, 100);
  assert.deepEqual(record.objects[0].rgba, [255, 10, 20, 30]);
  assert.equal(record.objects[0].locked, true);
  assert.equal(decodeTofu(bytes.subarray(0, -1)), null);
});

test('BANNER decodes vectors and length-prefixed flags while retaining unknown bits', () => {
  const content = Buffer.concat([
    words(0, 9, 2, 7, 8, 0x3c00, 0xbc00, 0),
    words(22, 4),
    Buffer.from([4, 1, 100, 7]),
    words(24, 2, 3),
  ]);
  const bytes = chunk(0, content);
  const result = decodeBanners(bytes);
  assert.equal(result.completeFieldStream, true);
  const banner = result.chunks[0].records[0];
  assert.equal(banner.recordKeyRaw, 9);
  assert.equal(banner.bannerBg, 7);
  assert.deepEqual(banner.cameraPosition, [1, -1, 0]);
  assert.equal(banner.customizeCandidate.tribe, 7);
  assert.equal(banner.flagsRaw, 3);
  assert.equal(banner.useDefaultPreset, true);
  assert.equal(banner.unknownFlags, 2);
  assert.equal(banner.bannerIndex, 9);
  assert.equal(banner.bannerId, 0);
  assert.equal(decodeBanners(bytes.subarray(0, -1)), null);
});

test('UISAVE FLAGS locates the second block instead of treating transient runtime IDs as disk data', () => {
  const body = Buffer.alloc(384);
  body.writeUInt32LE(0x00640000, 0);
  body.writeUInt32LE(96, 4);
  body.writeUInt16LE(750, 16);
  body[80] = 2;
  body.writeUInt32LE(2, 112);
  body.writeUInt32LE(256, 116);
  body.writeUInt32LE(123, 132);
  const result = decodeUiSave(fixture([{ id: 2, version: 100, body }]), 1);
  const flags = result.data.segments[0].data;
  assert.equal(flags.patchMarkVersions[0], 750);
  assert.equal(flags.patchMarkStates[0], 2);
  assert.equal(flags.namedFlagsCandidate.summonedCompanionId, 123);
});

test('UISAVE retainer comments preserve 64-bit identities and record padding', () => {
  const plain = Buffer.alloc(1376);
  plain.writeBigUInt64LE(0xfffffffffffffff0n, 8);
  plain.write('note', 16);
  plain[107] = 0xa5;
  const body = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(plain.map((byte) => byte ^ 0x73)),
  ]);
  const result = decodeUiSave(fixture([{ id: 22, version: 102, body }]), 1);
  const retainer = result.data.segments[0].data.retainersCandidate[0];
  assert.equal(retainer.id, '18446744073709551600');
  assert.equal(retainer.comment, 'note');
  assert.ok(retainer.unusedRecordBytesHex.startsWith('a5'));
});
