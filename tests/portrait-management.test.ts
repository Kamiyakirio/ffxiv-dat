import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  bannerChunk,
  bannerRecord,
  fixed,
  uiSave,
  word,
} from './helpers/portrait-fixtures.ts';
import {
  changePortraitData,
  decodePortraitCode,
  exportPortraitCode,
  readPortraitData,
} from '../src/main/services/portrait-data.ts';

const id = '0000000000000001';
test('cross-character sharing preserves every record byte except the destination slot and leaves other UISAVE segments and footer intact', () => {
  const source = uiSave(id, [
    bannerRecord(7, '来源肖像'),
    bannerRecord(3, '另一个肖像'),
  ]);
  const before = Buffer.from(source),
    code = exportPortraitCode(source, [7, 3]);
  const shared = decodePortraitCode(code);
  assert.equal(shared.length, 2);
  assert.equal(shared[0].summary.name, '来源肖像');
  const target = uiSave('0000000000000002', [bannerRecord(0, '原肖像')], false);
  const result = changePortraitData(target, {
    type: 'import',
    code,
    mode: 'create',
  });
  const parsed = readPortraitData(result),
    original = readPortraitData(target);
  assert.deepEqual(
    parsed.records.map((r) => r.id),
    [0, 1, 2],
  );
  for (let n = 0; n < 2; n++)
    assert.deepEqual(
      parsed.records[n + 1].bytes.subarray(4),
      shared[n].bytes.subarray(4),
    );
  assert.deepEqual(parsed.records[0].bytes, original.records[0].bytes);
  assert.equal(parsed.decoded.result.data.contentId, '2');
  const segments = (value: ReturnType<typeof readPortraitData>) =>
    (value.decoded.result.data.segments as Record<string, unknown>[])
      .filter((s) => s.id !== 23)
      .map(
        ({
          offset: _offset,
          contentOffset: _contentOffset,
          decodedContentOffset: _decodedOffset,
          ...rest
        }) => {
          void _offset;
          void _contentOffset;
          void _decodedOffset;
          return rest;
        },
      );
  assert.deepEqual(segments(parsed), segments(original));
  assert.deepEqual(result.subarray(-32), target.subarray(-32));
  assert.equal(result.readUInt32LE(12), target.readUInt32LE(12));
  assert.equal(result.length - result.readUInt32LE(4), 32);
  assert.deepEqual(source, before);
  assert.equal(exportPortraitCode(result, [1, 2]), code);
});

test('batch overwrite, deletion, UTF-8 rename and an absent portrait segment round-trip without changing unrelated records', () => {
  const source = uiSave(id, [bannerRecord(7), bannerRecord(2, '保留')]);
  const code = exportPortraitCode(uiSave(id, [bannerRecord(5, '替换')]), [5]);
  const updated = changePortraitData(source, {
    type: 'import',
    code,
    mode: 'overwrite',
    targetIds: [7],
  });
  assert.deepEqual(
    readPortraitData(updated).records.map((r) => r.id),
    [7, 2],
  );
  assert.equal(readPortraitData(updated).records[0].summary.name, '替换');
  assert.deepEqual(
    readPortraitData(updated).records[1].bytes,
    readPortraitData(source).records[1].bytes,
  );
  const renamed = changePortraitData(updated, {
    type: 'rename',
    id: 7,
    name: '新的中文名称，长度不同',
  });
  assert.equal(
    readPortraitData(renamed).records[0].summary.name,
    '新的中文名称，长度不同',
  );
  assert.deepEqual(
    readPortraitData(renamed).records[1].bytes,
    readPortraitData(source).records[1].bytes,
  );
  const deleted = changePortraitData(renamed, { type: 'delete', ids: [7, 2] });
  assert.equal(readPortraitData(deleted).records.length, 0);
  const empty = uiSave(id, [], true, false);
  const created = readPortraitData(
    changePortraitData(empty, { type: 'import', code, mode: 'create' }),
  );
  assert.equal(created.records.length, 1);
  assert.equal(created.decoded.result.data.declaredCount, 3);
});

function shareRecords(records: string[], version = 1) {
  const bytes = deflateRawSync(
    Buffer.from(JSON.stringify({ version, records })),
  );
  return Buffer.concat([
    bytes,
    createHash('sha256').update(bytes).digest(),
  ]).toString('base64url');
}

test('sharing rejects corrupt codes, extra records, unknown tags, duplicate selection, insufficient capacity and ambiguous overwrite before any write', () => {
  const source = uiSave(id);
  const code = exportPortraitCode(source, [7]);
  assert.throws(
    () =>
      decodePortraitCode(code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a')),
    /校验/,
  );
  assert.throws(
    () =>
      decodePortraitCode(
        shareRecords([bannerRecord(0).toString('base64url')], 2),
      ),
    /版本/,
  );
  assert.throws(() => decodePortraitCode('x'.repeat(262145)), /过长/);
  assert.throws(
    () =>
      decodePortraitCode(
        shareRecords([
          Buffer.concat([bannerRecord(0), bannerRecord(1)]).toString(
            'base64url',
          ),
        ]),
      ),
    /单条/,
  );
  assert.throws(
    () =>
      decodePortraitCode(
        shareRecords([
          Buffer.concat([bannerRecord(0), fixed(254, word(1))]).toString(
            'base64url',
          ),
        ]),
      ),
    /结构/,
  );
  assert.throws(
    () =>
      decodePortraitCode(
        shareRecords([bannerChunk(bannerRecord(0)).toString('base64url')]),
      ),
    /结构|单条/,
  );
  assert.throws(() => exportPortraitCode(source, [7, 7]), /重复/);
  assert.throws(
    () =>
      changePortraitData(source, {
        type: 'rename',
        id: 7,
        name: '中'.repeat(22),
      }),
    /63/,
  );
  assert.throws(
    () =>
      changePortraitData(source, {
        type: 'import',
        code,
        mode: 'overwrite',
        targetIds: [],
      }),
    /选择/,
  );
  const full = uiSave(
    id,
    Array.from({ length: 110 }, (_, i) => bannerRecord(i)),
  );
  assert.throws(
    () => changePortraitData(full, { type: 'import', code, mode: 'create' }),
    /槽位不足/,
  );
});
