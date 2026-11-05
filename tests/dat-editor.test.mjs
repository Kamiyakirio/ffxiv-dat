import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  realpath,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEditPlan } from '../src/main/services/dat/editor.ts';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { DatWorkspace } from '../src/main/services/dat-workspace.ts';

function dat(type, version, payload, spare = 64) {
  const masked = [1, 3, 5, 6, 7, 8, 10].includes(type),
    mask = masked ? 0x73 : [2, 9].includes(type) ? 0x31 : 0;
  const length = payload.length + Number(masked),
    capacity = length + spare;
  const b = Buffer.alloc(capacity + 32);
  b.writeUInt16LE(type);
  b.writeUInt16LE(version, 2);
  b.writeUInt32LE(capacity, 4);
  b.writeUInt32LE(length, 8);
  if (masked) b[16] = 255;
  Buffer.from(payload.map((byte) => byte ^ mask)).copy(b, 16 + Number(masked));
  return b;
}
function field(tag, text) {
  const value = Buffer.from(text + '\0'),
    h = Buffer.alloc(3);
  h[0] = tag.charCodeAt(0);
  h.writeUInt16LE(value.length, 1);
  return Buffer.concat([h, value]);
}
function macro() {
  return dat(
    1,
    2,
    Buffer.concat(
      Array.from({ length: 100 }, (_, i) =>
        Buffer.concat([
          field('T', i === 0 ? '测试宏' : ''),
          field('I', '000001'),
          field('K', '000001'),
          ...Array.from({ length: 15 }, () => field('L', '')),
        ]),
      ),
    ),
    4096,
  );
}
function uisave(segments) {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(16);
  h.writeUInt32LE(segments.length, 4);
  h.writeBigUInt64LE(123n, 8);
  return dat(
    9,
    1,
    Buffer.concat([
      h,
      ...segments.map(([id, version, data, masked = false]) => {
        const body = masked
          ? Buffer.concat([
              Buffer.from([255]),
              Buffer.from(data.map((b) => b ^ 0x73)),
            ])
          : data;
        const header = Buffer.alloc(16);
        header.writeUInt16LE(id);
        header.writeUInt16LE(version, 2);
        header.writeUInt32LE(body.length, 4);
        header.writeUInt32LE(body.length, 8);
        return Buffer.concat([header, body, Buffer.from([0xaa, 0, 0, 0])]);
      }),
    ]),
  );
}
function edit(bytes, name, changes) {
  return createEditPlan(bytes, name).apply(
    Object.entries(changes).map(([id, value]) => ({ id, value })),
  );
}
function word(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

test('text edits preserve CRLF, sections, unknown lines and terminal NULs without rewriting unrelated bytes', () => {
  const source = Buffer.from(
    '<Config>\r\nFoo\t1\r\nUnknown line\r\nBar\t中文\r\n\0\0',
  );
  const plan = createEditPlan(source, 'COMMON.DAT');
  assert.equal(plan.fields.length, 2);
  assert.deepEqual(plan.apply([]), source);
  const result = edit(source, 'COMMON.DAT', {
    'config.1': '999',
    'config.3': '新值',
  });
  assert.equal(
    result.toString(),
    '<Config>\r\nFoo\t999\r\nUnknown line\r\nBar\t新值\r\n\0\0',
  );
  assert.throws(
    () => edit(source, 'COMMON.DAT', { 'config.1': '1\nInjected\t2' }),
    /无效字符/,
  );
  assert.throws(
    () => edit(source, 'COMMON.DAT', { 'arbitrary.path': '1' }),
    /只读/,
  );
});

test('macro strings can grow and shrink while section lengths, capacity, padding and XOR stay valid', () => {
  const source = macro(),
    plan = createEditPlan(source, 'MACRO.DAT');
  assert.equal(plan.fields.length, 1800);
  const output = edit(source, 'MACRO.DAT', {
    'macro.0.name': '较长的新名称',
    'macro.0.line0': '/echo 你好',
    'macro.99.line14': '/wait 1',
    'macro.0.icon1': '000003',
  });
  const parsed = decodeDat(output, 'MACRO.DAT');
  assert.equal(parsed.result.data.macros[0].name, '较长的新名称');
  assert.equal(parsed.result.data.macros[0].lines[0], '/echo 你好');
  assert.equal(parsed.result.data.macros[99].lines[14], '/wait 1');
  assert.equal(parsed.result.data.macros[1].name, '');
  assert.equal(parsed.header.capacity, source.readUInt32LE(4));
  assert.equal(output.length, source.length);
  assert.deepEqual(output.subarray(-16), source.subarray(-16));
  assert.throws(
    () => edit(source, 'MACRO.DAT', { 'macro.0.icon1': 'invalid' }),
    /十六进制/,
  );
  assert.throws(
    () => edit(source, 'MACRO.DAT', { 'macro.0.line0': 'x'.repeat(60000) }),
    /容量/,
  );
});

test('hotbar edits only change command ID and type bytes, with stable coordinates and namespace-aware name choices', () => {
  const p = Buffer.from([3, 0, 0, 0, 1, 2, 3, 10]),
    source = dat(2, 4, p);
  const output = edit(source, 'HOTBAR.DAT', { 'slots.1.2.3.command': 4 });
  assert.equal(output[16], 4 ^ 0x31);
  assert.deepEqual(output.subarray(17), source.subarray(17));
  const plan = createEditPlan(output, 'HOTBAR.DAT');
  assert.equal(plan.fields[1].referenceType.sheets['10'], 'GeneralAction');
  assert.equal(
    plan.fields[0].choices.find((c) => c.value === 10).label,
    '通用技能',
  );
  assert.throws(
    () => edit(source, 'HOTBAR.DAT', { 'slots.1.2.3.command': -1 }),
    /范围/,
  );
  assert.equal(createEditPlan(dat(2, 999, p), 'HOTBAR.DAT').fields.length, 0);
});

test('gear edits preserve all unknown bytes and combine independent flags in one byte', () => {
  const p = Buffer.alloc(456);
  p[4] = 0;
  p[4 + 0x37] = 0xc3;
  p[4 + 0x33] = 0xfe;
  p[4 + 0x38 + 26] = 0xa5;
  const source = dat(5, 110, p),
    output = edit(source, 'GEARSET.DAT', {
      'gear.0.name': '骑士',
      'gear.0.flag8': true,
      'gear.0.flag16': true,
      'gear.0.items.0.item': 123,
      'gear.0.items.0.stain0': 7,
      'gear.0.items.0.materia0': 1,
      'gear.0.items.0.grade0': 2,
    });
  const r = decodeDat(output, 'GEARSET.DAT').result.data.records[0];
  assert.equal(r.name, '骑士');
  assert.equal(r.flags, 0xdb);
  assert.equal(r.unknownByte33, 0xfe);
  assert.equal(r.items[0].unknownTailHex, 'a500');
  assert.equal(r.items[0].itemId, 123);
  assert.deepEqual(r.items[0].materia[0], { id: 1, grade: 2 });
  assert.throws(
    () => edit(source, 'GEARSET.DAT', { 'gear.0.name': '中'.repeat(16) }),
    /字节/,
  );
});

test('UISAVE edits retain outer masks, inner masks, metadata, unknown segments and trailer bytes', () => {
  const performance = Buffer.from([120, 0xe0, 0, 0xfc]);
  const source = uisave([
    [32, 0, Buffer.from([10]), true],
    [37, 1, performance],
    [999, 9, Buffer.from([7, 8, 9])],
  ]);
  const output = edit(source, 'UISAVE.DAT', {
    'ui.0.countdown': 15,
    'ui.1.bpm': 180,
    'ui.1.settings1.0': true,
    'ui.1.settings1.1': true,
  });
  const before = decodeDat(source, 'UISAVE.DAT').result.data,
    after = decodeDat(output, 'UISAVE.DAT').result.data;
  assert.equal(after.contentId, '123');
  assert.equal(after.segments[0].data.countdownLength, 15);
  assert.equal(after.segments[1].data.beatsPerMinute, 180);
  assert.equal(after.segments[1].data.unknownBpmBits, 7);
  assert.equal(after.segments[1].data.settings1, 3);
  assert.equal(after.segments[1].data.unknownSettings2Bits, 0xfc);
  assert.deepEqual(after.segments[2], before.segments[2]);
  assert.equal(after.segments[0].trailerHex, 'aa000000');
  assert.equal(after.completeContainer, true);
  assert.equal(output.length, source.length);
});

test('portrait edits round-trip half floats and RGB while leaving record keys, checksum, tag24 and fourth color byte untouched', () => {
  const body = Buffer.concat([
    word(0),
    word(7),
    word(2),
    word(3),
    word(8),
    word(0x3c00),
    word(0),
    word(0),
    word(14),
    Buffer.from([1, 2, 3, 0xa5]),
    word(23),
    Buffer.from([1, 2, 3, 4]),
    word(24),
    Buffer.from([2, 0, 0, 0]),
  ]);
  const h = Buffer.alloc(16);
  h.writeUInt32LE(body.length, 4);
  const source = uisave([[23, 0, Buffer.concat([h, body]), true]]);
  const output = edit(source, 'UISAVE.DAT', {
    'ui.0.banner.0.0.2': 4,
    'ui.0.banner.0.0.8.0': 1.125,
    'ui.0.banner.0.0.14.0': 255,
  });
  const r = decodeDat(output, 'UISAVE.DAT').result.data.segments[0].data
    .chunks[0].records[0];
  assert.equal(r.recordKeyRaw, 7);
  assert.equal(r.checksum, 0x04030201);
  assert.equal(r.flagsRaw, 0);
  assert.equal(r.cameraPosition[0], 1.125);
  assert.deepEqual(r.ambientLightingColour, [255, 2, 3, 0xa5]);
  assert.throws(
    () => edit(source, 'UISAVE.DAT', { 'ui.0.banner.0.0.24': 3 }),
    /只读/,
  );
});

test('character presets recalculate their real checksum after appearance changes and preserve header storage', () => {
  const source = Buffer.alloc(212);
  source.writeUInt32LE(0x2013ff14);
  source[12] = 0xaa;
  const output = edit(source, 'FFXIV_CHARA_01.dat', {
    'appearance.3': 55,
    voice: 5,
    comment: '预设说明',
  });
  const result = decodeDat(output, 'FFXIV_CHARA_01.dat').result.data;
  assert.equal(result.checksumMatches, true);
  assert.equal(result.customize.height, 55);
  assert.equal(result.voice, 5);
  assert.equal(result.comment, '预设说明');
  assert.equal(output[12], 0xaa);
});

async function workspace(t, files) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'dat-edit-')),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const character = path.join(root, 'FFXIV_CHR000000000000007B');
  await mkdir(character);
  for (const [name, bytes] of Object.entries(files))
    await writeFile(path.join(character, name), bytes);
  const ws = new DatWorkspace();
  await ws.locate(root);
  const report = await ws.decode(root, new AbortController().signal, () => {});
  return { root, character, ws, report };
}

test('workspace save creates an exact backup, atomically replaces the source and refreshes result IDs', async (t) => {
  const source = Buffer.from('Foo\t1\r\n\0');
  const { root, character, ws, report } = await workspace(t, {
    'COMMON.DAT': source,
  });
  const id = report.files[0].id,
    model = await ws.edit(id);
  const saved = await ws.save({
    id,
    sha256: model.sha256,
    changes: [{ id: 'config.0', value: '200' }],
  });
  assert.deepEqual(await readFile(saved.backupPath), source);
  assert.equal(
    (await readFile(path.join(character, 'COMMON.DAT'))).toString(),
    'Foo\t200\r\n\0',
  );
  assert.equal(saved.report.files.length, 1);
  assert.notEqual(saved.selectedId, id);
  assert.throws(() => ws.getResult(id), /失效/);
  assert.equal(ws.getResult(saved.selectedId).data.entries[0].value, '200');
  assert(saved.backupPath.startsWith(root));
});

test('stale source, stale edit hash, invalid fields and symlink substitution never overwrite originals', async (t) => {
  const source = Buffer.from('Foo\t1\r\n');
  const { root, character, ws, report } = await workspace(t, {
    'COMMON.DAT': source,
  });
  const id = report.files[0].id,
    model = await ws.edit(id);
  await assert.rejects(
    ws.save({ id, sha256: 'wrong', changes: [{ id: 'config.0', value: '2' }] }),
    /失效/,
  );
  await assert.rejects(
    ws.save({
      id,
      sha256: model.sha256,
      changes: [{ id: 'private', value: '2' }],
    }),
    /只读/,
  );
  const file = path.join(character, 'COMMON.DAT');
  await writeFile(file, 'Foo\t3\r\n');
  await assert.rejects(
    ws.save({
      id,
      sha256: model.sha256,
      changes: [{ id: 'config.0', value: '2' }],
    }),
    /其他程序修改/,
  );
  assert.equal((await readdir(character)).length, 1);
  const outside = path.join(root, 'outside');
  await writeFile(outside, source);
  await rm(file);
  await symlink(outside, file);
  await assert.rejects(
    ws.save({
      id,
      sha256: model.sha256,
      changes: [{ id: 'config.0', value: '2' }],
    }),
    /位置已改变/,
  );
  assert.deepEqual(await readFile(outside), source);
});

test('editing a backup member updates its length table and keeps its other member byte-for-byte', async (t) => {
  const a = Buffer.from('Foo\t1\r\n'),
    b = Buffer.from('Bar\t2\r\n'),
    header = Buffer.alloc(104);
  header.write('FFXIV_BKCHR_RESTORE_DATA');
  header.writeUInt32LE(a.length + b.length, 44);
  header.writeUInt32LE(a.length, 48);
  header.writeUInt32LE(b.length, 52);
  const source = Buffer.concat([header, a, b]);
  const { character, ws, report } = await workspace(t, {
    'RESTORE.DAT': source,
  });
  const f = report.files.find((f) => f.parentId && f.name === 'COMMON.DAT'),
    model = await ws.edit(f.id);
  const saved = await ws.save({
    id: f.id,
    sha256: model.sha256,
    changes: [{ id: 'config.0', value: '9999' }],
  });
  const parsed = decodeDat(
    await readFile(path.join(character, 'RESTORE.DAT')),
    'RESTORE.DAT',
  );
  assert.equal(parsed.members[0].length, a.length + 3);
  assert.equal(parsed.members[0].decoded.result.data.entries[0].value, '9999');
  assert.deepEqual(parsed.members[1].decoded.payload, b);
  assert.deepEqual(await readFile(saved.backupPath), source);
});

test('a new leading 0xff bitset is escaped and the following UISAVE segment retains its bytes', () => {
  const source = uisave([
    [35, 0, Buffer.alloc(16)],
    [32, 0, Buffer.from([10])],
  ]);
  const changes = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`ui.0.description.${i}`, true]),
  );
  const output = edit(source, 'UISAVE.DAT', changes);
  const parsed = decodeDat(output, 'UISAVE.DAT').result.data;
  assert.equal(parsed.segments[0].data.seenDescriptionBitfields[0], 255);
  assert.equal(parsed.segments[0].length, 17);
  assert.equal(parsed.segments[0].capacity, 17);
  assert.equal(parsed.segments[0].rawHex.slice(0, 4), 'ff8c');
  assert.equal(parsed.segments[1].data.countdownLength, 10);
  assert.equal(parsed.segments[1].trailerHex, 'aa000000');
  assert.equal(parsed.completeContainer, true);
});

test('strategy board edits respect odd field alignment and preserve unknown object arguments', () => {
  const words = (...v) => Buffer.concat(v.map(word));
  const aligned = (bytes) =>
    bytes.length % 2 ? Buffer.concat([bytes, Buffer.from([0xa5])]) : bytes;
  const title = Buffer.from('Test\0');
  const fields = Buffer.concat([
    words(0, 0),
    aligned(Buffer.concat([words(1, title.length), title])),
    words(2, 9),
    words(4, 1, 1, 0xf009),
    words(5, 3, 1, 100, 200),
    words(6, 1, 1, 12),
    aligned(Buffer.concat([words(7, 0, 1), Buffer.from([100])])),
    words(10, 1, 1, 321),
  ]);
  const record = aligned(Buffer.concat([words(0, fields.length), fields]));
  const header = Buffer.alloc(16);
  header.writeUInt32LE(4);
  header.writeUInt32LE(record.length, 4);
  const source = uisave([[28, 0, Buffer.concat([header, record]), true]]);
  const output = edit(source, 'UISAVE.DAT', {
    'ui.0.board.0.0.title': '更长的战术板标题',
    'ui.0.board.0.0.object0.tag4.1': false,
    'ui.0.board.0.0.object0.tag5.x': 444,
    'ui.0.board.0.0.object0.tag6.angle': -15,
  });
  const r = decodeDat(output, 'UISAVE.DAT').result.data.segments[0].data
    .chunks[0].data.records[0];
  assert.equal(r.title, '更长的战术板标题');
  assert.ok(r.length > fields.length);
  assert.equal(r.objects[0].flags, 0xf008);
  assert.equal(r.objects[0].position.x, 444);
  assert.equal(r.objects[0].angle, -15);
  assert.equal(r.objects[0].argsA, 321);
  assert.equal(r.fields.find((f) => f.tag === 1).alignmentByte, 0xa5);
  assert.equal(output.length, source.length);
});

function portraitFixture(fields) {
  const header = Buffer.alloc(16),
    body = Buffer.concat([word(0), word(7), ...fields]);
  header.writeUInt32LE(body.length, 4);
  return uisave([
    [23, 0, Buffer.concat([header, body]), true],
    [32, 0, Buffer.from([10])],
  ]);
}
function portraitRecord(bytes) {
  return decodeDat(bytes, 'UISAVE.DAT').result.data.segments[0].data.chunks[0]
    .records[0];
}
function nativeBannerName(value, tail) {
  const text = Buffer.from(value),
    body = Buffer.alloc((text.length + 4) & ~3);
  text.copy(body);
  if (tail) Buffer.from(tail).copy(body, text.length + 1);
  return Buffer.concat([word(1), word(body.length), body]);
}

test('portrait names use exact four-byte UTF-8 padding and clear old tail bytes across growth and shrink', () => {
  const original = portraitFixture([
    nativeBannerName('A', [0xde, 0xad]),
    word(2),
    word(9),
    word(24),
    word(2),
    word(0x8080),
  ]);
  const nameKey = 'ui.0.banner.0.0.1';
  assert.equal(
    createEditPlan(original, 'UISAVE.DAT').fields.find(
      (field) => field.id === nameKey,
    ).maxBytes,
    63,
  );
  for (const value of ['中文名X', 'ABCD', '中文名字长些', 'B', '']) {
    const edited = edit(original, 'UISAVE.DAT', { [nameKey]: value }),
      r = portraitRecord(edited),
      length = Buffer.byteLength(value);
    assert.equal(r.bannerTimelineName, value);
    assert.equal(r.nameByteLength, length);
    assert.equal(r.nameStorageByteLength, (length + 4) & ~3);
    assert.equal(r.namePaddingHex, '00'.repeat(((length + 4) & ~3) - length));
    assert.equal(r.bannerBg, 9);
    assert.equal(r.flagsRaw, 0x8080);
    const parsed = decodeDat(edited, 'UISAVE.DAT').result.data;
    assert.equal(parsed.completeContainer, true);
    assert.equal(parsed.segments[1].data.countdownLength, 10);
    assert.equal(parsed.segments[0].trailerHex, 'aa000000');
  }
  const limit = '中'.repeat(21);
  assert.equal(
    portraitRecord(edit(original, 'UISAVE.DAT', { [nameKey]: limit }))
      .nameStorageByteLength,
    64,
  );
  assert.throws(
    () => edit(original, 'UISAVE.DAT', { [nameKey]: '中'.repeat(22) }),
    /63 字节/,
  );
  assert.throws(
    () => edit(original, 'UISAVE.DAT', { [nameKey]: 'x'.repeat(64) }),
    /63 字节/,
  );
});

test('portrait byte-valued settings preserve unused high bytes and use the correct lighting labels', () => {
  const original = portraitFixture([
    word(7),
    word(0x1234),
    word(10),
    word(0x5678),
    word(15),
    word(0x90ab),
    word(17),
    word(0xcdef),
    word(14),
    Buffer.from([1, 2, 3, 0xa5]),
    word(16),
    Buffer.from([4, 5, 6, 0x5a]),
  ]);
  const plan = createEditPlan(original, 'UISAVE.DAT');
  assert.equal(
    plan.fields.find((field) => field.id === 'ui.0.banner.0.0.15').label,
    '环境光亮度',
  );
  assert.equal(
    plan.fields.find((field) => field.id === 'ui.0.banner.0.0.17').label,
    '定向光亮度',
  );
  assert.equal(
    plan.fields.find((field) => field.id === 'ui.0.banner.0.0.14.0').label,
    '环境光 红',
  );
  assert.equal(
    plan.fields.find((field) => field.id === 'ui.0.banner.0.0.16.0').label,
    '定向光 红',
  );
  assert.equal(
    plan.fields.find((field) => field.id === 'ui.0.banner.0.0.7').max,
    255,
  );
  const edited = edit(original, 'UISAVE.DAT', {
    'ui.0.banner.0.0.7': 1,
    'ui.0.banner.0.0.10': 2,
    'ui.0.banner.0.0.15': 3,
    'ui.0.banner.0.0.17': 4,
    'ui.0.banner.0.0.14.0': 5,
    'ui.0.banner.0.0.16.0': 6,
  });
  const r = portraitRecord(edited);
  assert.equal(r.expression, 1);
  assert.equal(r.cameraZoom, 2);
  assert.equal(r.ambientLightingBrightness, 3);
  assert.equal(r.directionalLightingBrightness, 4);
  assert.equal(r.fields.find((field) => field.tag === 7).valueHex, '0112');
  assert.equal(r.fields.find((field) => field.tag === 10).valueHex, '0256');
  assert.equal(r.fields.find((field) => field.tag === 15).valueHex, '0390');
  assert.equal(r.fields.find((field) => field.tag === 17).valueHex, '04cd');
  assert.deepEqual(r.ambientLightingColour, [5, 2, 3, 0xa5]);
  assert.deepEqual(r.directionalLightingColour, [6, 5, 6, 0x5a]);
  assert.throws(
    () => edit(original, 'UISAVE.DAT', { 'ui.0.banner.0.0.10': 256 }),
    /范围/,
  );
});

test('portrait float progress permits values beyond one, signed times remain signed and default-preset edits preserve unknown bits', () => {
  const progress = Buffer.alloc(4);
  progress.writeFloatLE(171.349);
  const original = portraitFixture([
    word(6),
    progress,
    word(21),
    Buffer.from([255, 255, 255, 255]),
    word(24),
    word(2),
    word(0xa502),
  ]);
  const progressKey = 'ui.0.banner.0.0.6',
    flagKey = 'ui.0.banner.0.0.24.useDefaultPreset',
    timeKey = 'ui.0.banner.0.0.21';
  const plan = createEditPlan(original, 'UISAVE.DAT');
  assert.ok(plan.fields.find((f) => f.id === progressKey).max > 171.349);
  assert.equal(plan.fields.find((f) => f.id === timeKey).value, -1);
  assert.equal(plan.fields.find((f) => f.id === flagKey).value, false);
  const result = portraitRecord(
    edit(original, 'UISAVE.DAT', {
      [progressKey]: 234.5,
      [timeKey]: -123,
      [flagKey]: true,
    }),
  );
  assert.equal(result.animationProgress, 234.5);
  assert.equal(result.lastUpdatedUnix, -123);
  assert.equal(result.flagsRaw, 0xa503);
  assert.equal(result.unknownFlags, 0xa502);
  assert.equal(result.useDefaultPreset, true);
  assert.equal(result.fields.find((f) => f.tag === 24).declaredLength, 2);
  const negative = portraitRecord(
    edit(original, 'UISAVE.DAT', { [progressKey]: -2.5 }),
  );
  assert.equal(negative.animationProgress, -2.5);
  assert.throws(
    () => edit(original, 'UISAVE.DAT', { [timeKey]: 0x80000000 }),
    /范围/,
  );
});

test('GRPPOS editing exposes confirmed camera values and XYZ only, preserving internal parameters and all vector alignment bytes', () => {
  for (const innerMasked of [false, true]) {
    const pose = Buffer.alloc(240, 0xa5);
    for (const [offset, value] of [
      [4, 8],
      [8, 0.75],
      [12, 123.25],
      [16, 1],
      [20, -0.5],
      [24, 24.25],
      [28, 28.25],
      [32, -2.5],
      [48, 1],
      [52, 2],
      [56, 3],
    ])
      pose.writeFloatLE(value, offset);
    pose.writeUInt32LE(0xdeadbeef, 60);
    for (let light = 0; light < 3; light++)
      pose.writeUInt32LE(0xabcdef00 + light, 124 + light * 48);
    const source = uisave([[15, 100, pose, innerMasked]]),
      plan = createEditPlan(source, 'UISAVE.DAT'),
      ids = plan.fields.map((field) => field.id);
    assert.deepEqual(
      ids.filter((id) => /^ui\.0\.cameraPosition\d+$/.test(id)),
      ['ui.0.cameraPosition0', 'ui.0.cameraPosition1', 'ui.0.cameraPosition2'],
    );
    assert.equal(
      ids.filter((id) => /^ui\.0\.light\.\d\.position\d$/.test(id)).length,
      9,
    );
    for (const id of [
      'cameraDistance',
      'cameraFieldOfView',
      'cameraDirectionHorizontal',
      'cameraDirectionVertical',
    ])
      assert(ids.includes(`ui.0.${id}`));
    assert(
      !ids.some((id) =>
        /cameraAngle|cameraRotation|cameraParameter|cameraPosition3|light\.\d\.position3/.test(
          id,
        ),
      ),
    );
    assert(!plan.fields.some((field) => /位置 W/.test(field.label)));
    assert.deepEqual(plan.apply([]), source);
    for (const id of [
      'ui.0.cameraAngle',
      'ui.0.cameraRotation',
      'ui.0.cameraPosition3',
      'ui.0.light.2.position3',
    ])
      assert.throws(() => plan.apply([{ id, value: 7 }]), /只读/);
    const changes = {
        'ui.0.cameraDistance': 12.5,
        'ui.0.cameraFieldOfView': 0.875,
        'ui.0.cameraDirectionHorizontal': 2.25,
        'ui.0.cameraDirectionVertical': -1.25,
        'ui.0.cameraPosition0': 10,
        'ui.0.cameraPosition1': 20,
        'ui.0.cameraPosition2': 30,
        'ui.0.light.0.position0': 100,
        'ui.0.light.1.position1': 200,
        'ui.0.light.2.position2': 300,
      },
      output = edit(source, 'UISAVE.DAT', changes),
      result = decodeDat(output, 'UISAVE.DAT').result.data.segments[0],
      expectedPose = Buffer.from(pose);
    for (const [offset, value] of [
      [4, 12.5],
      [8, 0.875],
      [16, 2.25],
      [20, -1.25],
      [48, 10],
      [52, 20],
      [56, 30],
      [112, 100],
      [164, 200],
      [216, 300],
    ])
      expectedPose.writeFloatLE(value, offset);
    assert.equal(result.decodedHex, expectedPose.toString('hex'));
    assert.deepEqual(result.data.cameraPositionOffset, { x: 10, y: 20, z: 30 });
    assert.equal(result.data.cameraParameterAt12Raw, 123.25);
    assert.equal(result.data.cameraRotationRadiansRaw, -2.5);
    assert.equal(result.data.cameraParameterAt24Raw, 24.25);
    assert.equal(result.data.cameraParameterAt28Raw, 28.25);
    const expectedFile = Buffer.from(source),
      fileOffset = 16 + result.decodedContentOffset;
    expectedPose.forEach((byte, index) => {
      expectedFile[fileOffset + index] = byte ^ 0x31 ^ (innerMasked ? 0x73 : 0);
    });
    assert.deepEqual(output, expectedFile);
    assert.equal(result.trailerHex, 'aa000000');
  }
});
