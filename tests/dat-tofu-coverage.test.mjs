import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTofu } from '../src/main/services/dat/uisave-tofu.ts';

function words(...values) {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) =>
    bytes.writeUInt16LE(value & 0xffff, index * 2),
  );
  return bytes;
}
function chunk(id, body) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(id);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function align(bytes) {
  return bytes.length % 2 ? Buffer.concat([bytes, Buffer.alloc(1)]) : bytes;
}
function record(key, title, withArgs = false) {
  const titleBytes = Buffer.from(title + '\0');
  const fields = [
    words(0, key),
    align(Buffer.concat([words(1, titleBytes.length), titleBytes])),
  ];
  if (withArgs)
    fields.push(words(2, 100), words(4, 1, 1, 9), words(10, 1, 1, 4));
  const body = Buffer.concat(fields);
  return align(Buffer.concat([words(0, body.length), body]));
}
function array(tag, dataType, values) {
  const width = [1, 2, 4, 4][dataType];
  const bytes = Buffer.alloc(values.length * width);
  values.forEach((value, index) =>
    bytes.writeUIntLE(value, index * width, width),
  );
  return align(Buffer.concat([words(tag, dataType, values.length), bytes]));
}
function fixture(folderIndex = 3) {
  return Buffer.concat([
    chunk(0, Buffer.from([0, 0, 0, 0, 1, 0, 0, 0])),
    chunk(
      3,
      Buffer.concat([
        record(3, 'Real folder'),
        record(1, ''),
        array(1, 0, [0, 1]),
      ]),
    ),
    chunk(
      4,
      Buffer.concat([
        record(17, 'First board', true),
        record(0, 'Second board'),
        array(1, 0, [folderIndex, 1]),
        array(2, 2, [1700000000, 1700000050]),
        array(3, 1, [3, 1]),
      ]),
    ),
  ]);
}

test('TOFU assigns per-record folder/time/background arrays by serialized order and resolves folder keys rather than positions', () => {
  const decoded = decodeTofu(fixture());
  assert(decoded.completeChunkStream);
  assert(decoded.coverage.structureComplete);
  const folders = decoded.chunks.find((c) => c.id === 3).data.records;
  assert.equal(folders[0].storageIndex, 3);
  assert.equal(folders[0].isBoardPlaceholder, false);
  assert.equal(folders[1].isBoardPlaceholder, true);
  const boards = decoded.chunks.find((c) => c.id === 4).data.records;
  assert.equal(boards[0].storageIndex, 17);
  assert.equal(boards[0].folderIndex, 3);
  assert.equal(boards[0].folderName, 'Real folder');
  assert.equal(boards[0].isInNamedFolder, true);
  assert.equal(boards[0].serverTime, 1700000000);
  assert.equal(boards[0].background, 3);
  assert.equal(boards[1].isInNamedFolder, false);
  assert.equal(boards[1].folderName, null);
  assert(decoded.checks.every((c) => c.passed));
});

test('TOFU coverage distinguishes confirmed object data from only the actual unresolved fields', () => {
  const decoded = decodeTofu(fixture());
  assert(decoded.coverage.knownFields.includes('records.objects.position'));
  assert(decoded.coverage.knownFields.includes('chunks[4].records.background'));
  assert(
    decoded.coverage.candidateFields.includes('chunks[4].records.serverTime'),
  );
  const unknown = decoded.coverage.unknownFields;
  assert(unknown.some((f) => f.field === 'chunks.settings'));
  assert(unknown.some((f) => f.field === 'records.objects.argsA/argsB/argsC'));
  assert.equal(
    unknown.some((f) => f.field.includes('position')),
    false,
  );
  assert.equal(unknown.filter((f) => f.field.includes('argsA')).length, 1);
});

test('a dangling board-folder reference is reported explicitly rather than matched to the first folder', () => {
  const decoded = decodeTofu(fixture(19));
  const first = decoded.chunks.find((c) => c.id === 4).data.records[0];
  assert.equal(first.folderReferenceResolved, false);
  assert.equal(first.folderName, undefined);
  assert(
    decoded.checks.some(
      (c) => c.name === 'board-folder-reference' && !c.passed,
    ),
  );
  assert(
    decoded.coverage.unknownFields.some((f) => f.field.includes('folderIndex')),
  );
});

test('an unrecognized record in one well-framed block preserves that block raw and still decodes later blocks', () => {
  const valid = chunk(4, record(2, 'Later board'));
  const bytes = Buffer.concat([
    chunk(0, Buffer.alloc(8)),
    chunk(2, words(0xffff)),
    valid,
  ]);
  const decoded = decodeTofu(bytes);
  assert(decoded.completeChunkStream);
  assert.equal(decoded.coverage.structureComplete, false);
  const broken = decoded.chunks.find((c) => c.id === 2).data;
  assert.equal(broken.rawHex, 'ffff');
  assert.match(broken.decodeError, /Unverified/);
  assert.equal(
    decoded.chunks.find((c) => c.id === 4).data.records[0].title,
    'Later board',
  );
});

test('unknown block identifiers and a truncated trailing frame do not erase earlier complete records', () => {
  const prior = chunk(4, record(2, 'Preserved'));
  const decoded = decodeTofu(
    Buffer.concat([prior, chunk(99, Buffer.from([1, 2, 3]))]),
  );
  assert.equal(decoded.chunks[1].data.rawHex, '010203');
  assert.equal(decoded.coverage.structureComplete, false);
  const truncated = decodeTofu(Buffer.concat([prior, Buffer.from([1, 2, 3])]));
  assert.equal(truncated.chunks[0].data.records[0].title, 'Preserved');
  assert.equal(truncated.remainingHex, '010203');
  assert.equal(truncated.completeChunkStream, false);
  assert.equal(truncated.coverage.structureComplete, false);
});

test('typed object-array mismatches remain a local block diagnostic instead of silently reading the wrong width', () => {
  const title = Buffer.from('x\0');
  const content = Buffer.concat([
    words(0, 1),
    words(1, title.length),
    title,
    words(2, 100),
    array(5, 2, [200]),
  ]);
  const decoded = decodeTofu(
    chunk(4, Buffer.concat([words(0, content.length), content])),
  );
  assert.match(
    decoded.chunks[0].data.decodeError,
    /Unexpected Tofu object array type/,
  );
  assert.equal(decoded.coverage.structureComplete, false);
});
