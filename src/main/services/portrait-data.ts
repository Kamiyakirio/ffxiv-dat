import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { decodeDat } from './dat/decoder.ts';
import { decodeBanners } from './dat/uisave-banner.ts';
import { gameName } from './dat/game-data.ts';
import type {
  PortraitChange,
  PortraitSummary,
} from '../../shared/management.ts';

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value : []);
export const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const capacity = 110;

function chunk(body: Buffer) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function portraitSummary(record: Row): PortraitSummary {
  const reference = (field: string, sheet: string) =>
    typeof record[field] === 'number'
      ? (gameName(sheet, Number(record[field])) ?? `编号 ${record[field]}`)
      : '未设置';
  const vectors = (field: string) =>
    Array.isArray(record[field])
      ? (record[field] as unknown[])
          .map((v) => (typeof v === 'number' ? Number(v.toFixed(4)) : '—'))
          .join(', ')
      : '—';
  return {
    id: Number(record.bannerIndex),
    name: String(
      record.bannerTimelineName || `肖像 ${Number(record.bannerIndex) + 1}`,
    ),
    background: reference('bannerBg', 'BannerBg'),
    frame: reference('bannerFrame', 'BannerFrame'),
    decoration: reference('bannerDecoration', 'BannerDecoration'),
    timeline: reference('bannerTimeline', 'BannerTimeline'),
    expression: reference('expression', 'BannerFacial'),
    updatedAt:
      typeof record.lastUpdatedUnix === 'number'
        ? record.lastUpdatedUnix
        : null,
    usesDefault: record.useDefaultPreset === true,
    linkedGearsets: [],
    fields: {
      镜头位置: vectors('cameraPosition'),
      镜头目标: vectors('cameraTarget'),
      镜头缩放: Number(record.cameraZoom ?? 0),
      画面旋转: Number(record.imageRotation ?? 0),
      动作进度: Number(record.animationProgress ?? 0),
      头部方向: vectors('headDirection'),
      视线方向: vectors('eyeDirection'),
      环境光: String(record.ambientLightingColourHex ?? '—'),
      环境光亮度: Number(record.ambientLightingBrightness ?? 0),
      定向光: String(record.directionalLightingColourHex ?? '—'),
      定向光亮度: Number(record.directionalLightingBrightness ?? 0),
    },
  };
}

interface PortraitRecord {
  id: number;
  bytes: Buffer;
  summary: PortraitSummary;
  chunkIndex: number;
}

function parseBannerBytes(bytes: Buffer) {
  const decoded = decodeBanners(bytes);
  if (!decoded || decoded.completeFieldStream !== true)
    throw new Error('肖像记录结构不完整或含未支持的字段，请在高级解析中检查。');
  const chunks = rows(decoded.chunks);
  const records: PortraitRecord[] = [];
  for (const [chunkIndex, current] of chunks.entries()) {
    const entries = rows(current.records);
    for (const [index, record] of entries.entries()) {
      const start = Number(current.offset) + 16 + Number(record.offset);
      const end =
        Number(current.offset) +
        16 +
        (index + 1 < entries.length
          ? Number(entries[index + 1].offset)
          : Number(current.length));
      records.push({
        id: Number(record.bannerIndex),
        bytes: Buffer.from(bytes.subarray(start, end)),
        summary: portraitSummary(record),
        chunkIndex,
      });
    }
  }
  return { chunks, records };
}

export function readPortraitData(original: Buffer) {
  const decoded = decodeDat(original, 'UISAVE.DAT');
  if (
    decoded.header.version !== 1 ||
    decoded.result.data.completeContainer !== true
  )
    throw new Error('UISAVE.DAT 的版本或结构不受支持，请在高级解析中检查。');
  const segments = rows(decoded.result.data.segments);
  const matches = segments.filter((s) => s.id === 23);
  if (
    matches.length > 1 ||
    matches.some(
      (s) => s.version !== 0 || Number(s.length) > Number(s.capacity),
    )
  )
    throw new Error('肖像子段的版本、数量或长度异常，已停止操作。');
  const segment = matches[0];
  const bannerBytes = segment
    ? Buffer.from(String(segment.decodedHex), 'hex')
    : Buffer.alloc(0);
  return { decoded, segment, bannerBytes, ...parseBannerBytes(bannerBytes) };
}

function selectedRecords(records: PortraitRecord[], ids: number[]) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > capacity ||
    new Set(ids).size !== ids.length
  )
    throw new Error('请选择有效且不重复的肖像。');
  return ids.map((id) => {
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error('肖像已不存在，请刷新列表。');
    return record;
  });
}

export function exportPortraitCode(original: Buffer, ids: number[]) {
  const { records } = readPortraitData(original);
  const shared = selectedRecords(records, ids).map((record) => {
    const bytes = Buffer.from(record.bytes);
    bytes.writeUInt16LE(0, 2); // Physical slot belongs to the destination character.
    return bytes.toString('base64url');
  });
  const payload = Buffer.from(JSON.stringify({ version: 1, records: shared }));
  const compressed = deflateRawSync(payload);
  return Buffer.concat([
    compressed,
    createHash('sha256').update(compressed).digest(),
  ]).toString('base64url');
}

export function decodePortraitCode(code: string): PortraitRecord[] {
  if (typeof code !== 'string' || code.length > 262144)
    throw new Error('分享码过长或不是文本。');
  const encoded = code.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error('分享码格式无效，请粘贴完整的分享码。');
  try {
    const envelope = Buffer.from(encoded, 'base64url');
    const compressed = envelope.subarray(0, -32);
    if (
      envelope.length <= 32 ||
      envelope.toString('base64url') !== encoded ||
      digest(compressed) !== envelope.subarray(-32).toString('hex')
    )
      throw new Error('分享码校验失败，内容可能被截断或修改。');
    const data = JSON.parse(
      inflateRawSync(compressed, { maxOutputLength: 1048576 }).toString('utf8'),
    );
    if (
      data.version !== 1 ||
      !Array.isArray(data.records) ||
      !data.records.length ||
      data.records.length > capacity
    )
      throw new Error('分享码中的肖像数量或版本无效。');
    return data.records.map((value: unknown) => {
      if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(value) ||
        value.length > 8192
      )
        throw new Error('分享码中的肖像数据无效。');
      const bytes = Buffer.from(value, 'base64url');
      if (
        bytes.toString('base64url') !== value ||
        bytes.length < 4 ||
        bytes.readUInt16LE() !== 0 ||
        bytes.readUInt16LE(2) !== 0
      )
        throw new Error('分享码中的肖像槽位无效。');
      const result = parseBannerBytes(chunk(bytes));
      if (result.records.length !== 1 || !result.records[0].bytes.equals(bytes))
        throw new Error('分享码必须包含完整的单条肖像记录。');
      return result.records[0];
    });
  } catch (error) {
    throw new Error(
      `无法导入：${error instanceof Error ? error.message : '分享码数据无效。'}`,
      { cause: error },
    );
  }
}

function renamed(bytes: Buffer, name: string) {
  if (
    typeof name !== 'string' ||
    /[\0\r\n]/.test(name) ||
    Buffer.byteLength(name) > 63 ||
    name !== new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name))
  )
    throw new Error('自定义名称不能含换行，且最多为 63 个 UTF-8 字节。');
  const decoded = decodeBanners(chunk(bytes))!;
  const record = rows(rows(decoded.chunks)[0].records)[0];
  const fields = rows(record.fields);
  const matches = fields.filter((f) => f.tag === 1);
  if (matches.length > 1)
    throw new Error('肖像包含重复名称字段，请先检查原始数据。');
  const text = Buffer.from(name);
  const storage = Buffer.alloc((text.length + 4) & ~3);
  text.copy(storage);
  const header = Buffer.alloc(4);
  header.writeUInt16LE(1);
  header.writeUInt16LE(storage.length, 2);
  const at = matches.length ? Number(matches[0].offset) : 4;
  const length = matches.length ? 4 + Number(matches[0].declaredLength) : 0;
  return Buffer.concat([
    bytes.subarray(0, at),
    header,
    storage,
    bytes.subarray(at + length),
  ]);
}

export function changePortraitData(
  original: Buffer,
  change: PortraitChange,
): Buffer {
  const { decoded, segment, bannerBytes, chunks, records } =
    readPortraitData(original);
  const replacements = new Map<number, Buffer | null>();
  const additions: Buffer[] = [];
  if (change?.type === 'delete') {
    for (const record of selectedRecords(records, change.ids))
      replacements.set(record.id, null);
  } else if (change?.type === 'rename') {
    const record = selectedRecords(records, [change.id])[0];
    replacements.set(record.id, renamed(record.bytes, change.name));
  } else if (change?.type === 'import') {
    const imported = decodePortraitCode(change.code);
    let ids: number[];
    if (change.mode === 'overwrite') {
      const targets = selectedRecords(records, change.targetIds ?? []);
      if (targets.length !== imported.length)
        throw new Error('覆盖目标数量必须与分享码中的肖像数量一致。');
      ids = targets.map((r) => r.id);
    } else if (change.mode === 'create') {
      const taken = new Set(records.map((r) => r.id));
      ids = Array.from({ length: capacity }, (_, id) => id)
        .filter((id) => !taken.has(id))
        .slice(0, imported.length);
      if (ids.length !== imported.length)
        throw new Error(`肖像槽位不足，最多保存 ${capacity} 个肖像。`);
    } else throw new Error('请选择新建或覆盖。');
    imported.forEach((record, i) => {
      const bytes = Buffer.from(record.bytes);
      bytes.writeUInt16LE(ids[i], 2);
      if (change.mode === 'overwrite') replacements.set(ids[i], bytes);
      else additions.push(bytes);
    });
  } else throw new Error('无效的肖像操作。');

  let added = false;
  const updatedChunks = chunks.map((current, ci) => {
    const at = Number(current.offset);
    if (current.id !== 0)
      return bannerBytes.subarray(at, at + 16 + Number(current.length));
    const entries = records
      .filter((r) => r.chunkIndex === ci)
      .flatMap((r) => {
        const replacement = replacements.get(r.id);
        return replacement === null ? [] : [replacement ?? r.bytes];
      });
    if (!added) {
      entries.push(...additions);
      added = true;
    }
    const body = Buffer.concat(entries);
    const header = Buffer.from(bannerBytes.subarray(at, at + 16));
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
  });
  if (!added && additions.length)
    updatedChunks.push(chunk(Buffer.concat(additions)));
  const updatedBanners = Buffer.concat(updatedChunks);
  const masked =
    segment?.encoding === '0xff marker followed by XOR 0x73' ||
    updatedBanners[0] === 0xff;
  const stored = masked
    ? Buffer.concat([
        Buffer.from([255]),
        Buffer.from(updatedBanners.map((b) => b ^ 0x73)),
      ])
    : updatedBanners;
  const header = segment
    ? Buffer.from(
        decoded.payload.subarray(
          Number(segment.offset),
          Number(segment.offset) + 16,
        ),
      )
    : Buffer.alloc(16);
  header.writeUInt16LE(23);
  header.writeUInt32LE(Math.max(header.readUInt32LE(4), stored.length), 4);
  header.writeUInt32LE(stored.length, 8);
  const at = segment ? Number(segment.offset) : decoded.payload.length;
  const end = segment ? at + 20 + Number(segment.length) : at;
  const trailer = segment
    ? decoded.payload.subarray(end - 4, end)
    : Buffer.alloc(4);
  const payload = Buffer.concat([
    decoded.payload.subarray(0, at),
    header,
    stored,
    trailer,
    decoded.payload.subarray(end),
  ]);
  if (!segment)
    payload.writeUInt32LE(Number(decoded.result.data.declaredCount) + 1, 4);

  const oldLength = Number(decoded.header.validLength);
  const growth = Math.max(0, payload.length - oldLength);
  // Keep all old padding/footer bytes, even when they contain reserved data.
  const output = growth
    ? Buffer.concat([
        original.subarray(0, 16 + oldLength),
        Buffer.alloc(growth),
        original.subarray(16 + oldLength),
      ])
    : Buffer.from(original);
  output.fill(0, 16, 16 + Math.max(oldLength, payload.length));
  Buffer.from(payload.map((b) => b ^ 0x31)).copy(output, 16);
  output.writeUInt32LE(Number(decoded.header.capacity) + growth, 4);
  output.writeUInt32LE(payload.length, 8);
  const verified = readPortraitData(output);
  if (
    verified.records.length !==
    records.length +
      additions.length -
      [...replacements.values()].filter((r) => r === null).length
  )
    throw new Error('肖像写回校验失败。');
  return output;
}
