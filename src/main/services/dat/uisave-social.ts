import { decodeUtf8 } from './sections.ts';
import type { DecodeCoverage } from '../../../shared/types.ts';

// CN ffxiv_dx11.exe SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Container writer 0x1407fab70; name setter 0x1407fb650; 64-byte contact
// setters 0x1407fc720..0x1407fca70. Vector writers: 0x1407fd1a0 / 0x1407ff090.
// These are static serialization observations, not observed client execution.
interface TaggedField {
  tag: string;
  offset: number;
  length: number;
  valueHex: string;
}
type Unknown = DecodeCoverage['unknownFields'][number];
type Row = Record<string, unknown>;
const layouts: Record<
  number,
  { version: number; length?: number; runtimeOffset: number }
> = {
  0: { version: 0, length: 448, runtimeOffset: 0x48 },
  3: { version: 5, length: 3200, runtimeOffset: 0x518 },
  4: { version: 3, runtimeOffset: 0x1198 },
  5: { version: 0, length: 392, runtimeOffset: 0x11b0 },
  6: { version: 0, length: 9608, runtimeOffset: 0x1338 },
  11: { version: 2, runtimeOffset: 0x38c0 },
};
function cstring(bytes: Buffer) {
  const end = bytes.indexOf(0);
  return {
    value: decodeUtf8(bytes.subarray(0, end < 0 ? bytes.length : end)),
    byteLength: end < 0 ? bytes.length : end,
    nulTerminated: end >= 0,
    rawHex: bytes.toString('hex'),
  };
}
function tagged(body: Buffer) {
  const fields: TaggedField[] = [];
  let offset = 0;
  while (offset < body.length) {
    const remainder = body.subarray(offset);
    if (remainder.length <= 3 && remainder.every((byte) => byte === 0)) break;
    if (offset + 3 > body.length)
      throw new Error('Truncated social tagged-field header');
    const length = body.readUInt16LE(offset + 1),
      end = offset + 3 + length;
    if (end > body.length)
      throw new Error('Social tagged field exceeds its bounded block');
    fields.push({
      tag: String.fromCharCode(body[offset]),
      offset,
      length,
      valueHex: body.subarray(offset + 3, end).toString('hex'),
    });
    offset = end;
  }
  return { fields, paddingHex: body.subarray(offset).toString('hex') };
}
function decodeList(
  id: number,
  body: Buffer,
  sourceOffset: number,
  unknown: Unknown[],
  known: string[],
) {
  const parsed = tagged(body),
    fields = parsed.fields;
  const bytes = (tag: string, size: number) => {
    const matches = fields.filter((field) => field.tag === tag);
    if (matches.length !== 1 || matches[0].length !== size)
      throw new Error(`Expected unique social ${tag}/${size} field`);
    return Buffer.from(matches[0].valueHex, 'hex');
  };
  const count = bytes('N', 4).readUInt32LE();
  if (count > 200)
    throw new Error('Social list count exceeds the native capacity of 200');
  if (bytes('B', 2).readUInt16LE() !== 32)
    throw new Error('Unverified social string-array width');
  const identities = bytes('I', 1600),
    worlds = bytes('W', 400),
    names = bytes('C', 6400),
    comments = bytes('M', 6400);
  const bitmap = id === 4 ? bytes('F', 28) : undefined,
    indices = id === 4 ? bytes('R', 400) : undefined;
  if (id === 4 && bytes('D', 1)[0] !== 28)
    throw new Error('Unverified social bitmap width');
  const entries: Row[] = Array.from({ length: count }, (_, index) => {
    const name = cstring(names.subarray(index * 32, index * 32 + 32)),
      comment = cstring(comments.subarray(index * 32, index * 32 + 32));
    if (
      name.value === null ||
      comment.value === null ||
      !name.nulTerminated ||
      !comment.nulTerminated
    )
      unknown.push({
        field: `blocks[id=${id}].entries[${index}].text`,
        reason: '名称或备注包含非UTF-8或缺少NUL终止，原始32字节槽位完整保留。',
        kind: 'storage',
      });
    const identity = identities.readBigUInt64LE(index * 8).toString(),
      world = worlds.readUInt16LE(index * 2);
    const fieldOffset = (tag: string) =>
      sourceOffset + fields.find((field) => field.tag === tag)!.offset + 3;
    return {
      index,
      name: name.value,
      comment: comment.value,
      nameStorageHex: name.rawHex,
      commentStorageHex: comment.rawHex,
      sourceOffsets: {
        identity: fieldOffset('I') + index * 8,
        world: fieldOffset('W') + index * 2,
        name: fieldOffset('C') + index * 32,
        comment: fieldOffset('M') + index * 32,
        ...(id === 4
          ? {
              recordId: fieldOffset('R') + index * 2,
              flagByte: fieldOffset('F') + (index >>> 3),
              flagBit: index & 7,
            }
          : {}),
      },
      ...(id === 11
        ? { accountId: identity, worldId: world }
        : {
            identityIdRaw: identity,
            worldIdRaw: world,
            recordIdRaw: indices!.readUInt16LE(index * 2),
            flagRaw: (bitmap![index >>> 3] & (1 << (index & 7))) !== 0,
          }),
    };
  });
  const expected = new Set(
    id === 4
      ? ['N', 'D', 'F', 'R', 'I', 'W', 'C', 'B', 'M']
      : ['N', 'I', 'W', 'C', 'B', 'M'],
  );
  const additionalFields = fields.filter((field) => !expected.has(field.tag));
  if (additionalFields.length)
    unknown.push({
      field: `blocks[id=${id}].additionalFields`,
      reason: '已验证数组之外仍有附加标签，字段边界和原始内容已保留。',
      kind: 'meaning',
    });
  known.push(
    `blocks[id=${id}].count`,
    `blocks[id=${id}].entries.name`,
    `blocks[id=${id}].entries.comment`,
    `blocks[id=${id}].fields`,
  );
  if (id === 11)
    known.push(
      'muteList.entries.accountId',
      'muteList.entries.worldId',
      'muteList.entries.name',
      'muteList.entries.comment',
    );
  else
    unknown.push({
      field: 'blocks[id=4].entries.identityIdRaw / recordIdRaw / flagRaw',
      reason:
        '向量分列序列化已核实，身份值、记录键和布尔位按原类型解码；列表业务类别及标志用途尚未对应，不标成好友或黑名单。',
      kind: 'meaning',
    });
  return {
    count,
    capacity: 200,
    textSlotByteLength: 32,
    entries,
    fields,
    paddingHex: parsed.paddingHex,
    additionalFields,
    sourceOffset,
    ...(id === 4 ? { bitmaskHex: bitmap!.toString('hex') } : {}),
    // Arrays always contain 200 slots even when count is zero. Preserve them.
    arrays: {
      identityIdsHex: identities.toString('hex'),
      worldIdsHex: worlds.toString('hex'),
      namesHex: names.toString('hex'),
      commentsHex: comments.toString('hex'),
      ...(indices ? { recordIdsHex: indices.toString('hex') } : {}),
    },
  };
}

/** Accept outer UIDATA v106; offsets are relative to its fully unmasked bytes. */
export function decodeNativeSocial(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 106 || data.length < 4) return null;
  const count = data[0],
    blocks: Row[] = [],
    unknown: Unknown[] = [],
    known = [
      'blockCount',
      'blocks.id',
      'blocks.version',
      'blocks.offset',
      'blocks.dataOffset',
      'blocks.length',
    ];
  const candidates: string[] = [];
  let offset = 4,
    complete = true;
  if (data.subarray(1, 4).some((byte) => byte !== 0))
    unknown.push({
      field: 'headerPaddingHex',
      reason: '客户端只使用首字节块数量，另外3字节按原值保留。',
      kind: 'storage',
    });
  const seen = new Set<number>();
  for (let index = 0; index < count; index++) {
    if (offset + 16 > data.length) {
      complete = false;
      unknown.push({
        field: `blocks[${index}].header`,
        reason: '声明的块数量超过剩余完整块头；已读块和剩余原始字节保留。',
        kind: 'meaning',
      });
      break;
    }
    const id = data.readUInt16LE(offset),
      blockVersion = data.readUInt16LE(offset + 2),
      length = data.readUInt32LE(offset + 8),
      end = offset + 20 + length;
    if (end > data.length) {
      complete = false;
      unknown.push({
        field: `blocks[${index}].length`,
        reason: '块正文及4字节尾部超出UIDATA范围，未读取其他块或容量尾区。',
        kind: 'meaning',
      });
      break;
    }
    const body = data.subarray(offset + 16, offset + 16 + length),
      layout = layouts[id];
    const block: Row = {
      index,
      id,
      version: blockVersion,
      offset,
      dataOffset: offset + 16,
      length,
      headerHex: data.subarray(offset, offset + 16).toString('hex'),
      trailerHex: data.subarray(end - 4, end).toString('hex'),
      rawHex: body.toString('hex'),
      runtimeOffset: layout?.runtimeOffset,
    };
    if (seen.has(id))
      unknown.push({
        field: `blocks[id=${id}]`,
        reason: '块编号重复，未把重复块的内容合并成唯一联系人或列表。',
        kind: 'reference',
      });
    seen.add(id);
    if (
      !layout ||
      layout.version !== blockVersion ||
      (layout.length !== undefined && layout.length !== length)
    ) {
      unknown.push({
        field: `blocks[id=${id},version=${blockVersion}]`,
        reason:
          '块边界已读取，但未匹配目标客户端的已验证版本和长度，原始正文保留。',
        kind: 'meaning',
      });
    } else {
      try {
        if (id === 0) {
          const labels = Array.from({ length: 7 }, (_, slot) => {
            const text = cstring(body.subarray(slot * 64, slot * 64 + 64));
            if (text.value === null)
              unknown.push({
                field: `blocks[id=0].labels[${slot}]`,
                reason: '名称不是UTF-8，原字节保留。',
                kind: 'storage',
              });
            return {
              index: slot,
              offset: offset + 16 + slot * 64,
              name: text.value,
              byteLength: text.byteLength,
              nulTerminated: text.nulTerminated,
              rawHex: text.rawHex,
            };
          });
          block.data = { labels, slotByteLength: 64, nameCopyLimit: 45 };
          known.push('blocks[id=0].labels.name', 'blocks[id=0].labels.offset');
          candidates.push('groupLabelsCandidate business classification');
        } else if (id === 3) {
          const contacts = Array.from({ length: 50 }, (_, slot) => {
            const at = slot * 64,
              record = body.subarray(at, at + 64),
              text = cstring(record.subarray(0, 32)),
              identity = record.readBigUInt64LE(32).toString();
            if (text.value === null)
              unknown.push({
                field: `blocks[id=3].contacts[${slot}].name`,
                reason: '联系人名称不是UTF-8，原始字节完整保留。',
                kind: 'storage',
              });
            return {
              index: slot,
              offset: offset + 16 + at,
              name: text.value,
              nameStorageHex: text.rawHex,
              identityIdRaw: identity,
              contentIdCandidate: identity,
              worldIdRaw: record.readUInt16LE(48),
              unknownAfterIdHex: record.subarray(40, 48).toString('hex'),
              unknownAfterWorldHex: record.subarray(50).toString('hex'),
              unknownAfterContentIdHex: record.subarray(40).toString('hex'),
              rawHex: record.toString('hex'),
            };
          });
          block.data = { contacts, capacity: 50, recordSize: 64 };
          known.push(
            'blocks[id=3].contacts.name',
            'blocks[id=3].contacts.identityIdRaw',
            'blocks[id=3].contacts.worldIdRaw',
          );
          candidates.push('contactRecordsCandidate.contentIdCandidate');
          unknown.push({
            field: 'blocks[id=3].contacts identifiers / tail fields',
            reason:
              '设置函数确认32字节名称、+32处64位身份值和+48处16位值；身份类型、列表类别和其余尾部数值尚未完全对应，原始字段保留。',
            kind: 'meaning',
          });
        } else if (id === 4 || id === 11)
          block.data = decodeList(id, body, offset + 16, unknown, known);
        else {
          const capacity = id === 5 ? 8 : 200,
            rawCount = body.readUInt32LE();
          block.data = {
            declaredCountRaw: rawCount,
            nativeCount: rawCount <= capacity ? rawCount : 0,
            capacity,
            rawHex: body.toString('hex'),
          };
          known.push(
            `blocks[id=${id}].declaredCountRaw`,
            `blocks[id=${id}].nativeCount`,
          );
          unknown.push({
            field: `blocks[id=${id}].data`,
            reason:
              '客户端整体复制此固定存储块，并把越界数量重置为0；块内其他业务字段尚未核实，未按名字推测好友或黑名单。',
            kind: 'meaning',
          });
        }
      } catch (error) {
        block.parseError =
          error instanceof Error ? error.message : String(error);
        unknown.push({
          field: `blocks[id=${id}].data`,
          reason: `内部字段校验失败：${block.parseError}；原始正文保留，其他块继续解析。`,
          kind: 'meaning',
        });
      }
    }
    if (
      data.readUInt32LE(offset + 4) !== 0 ||
      data.readUInt32LE(offset + 12) !== 0 ||
      data.subarray(end - 4, end).some((byte) => byte !== 0)
    )
      unknown.push({
        field: `blocks[id=${id}].header / trailer`,
        reason: '块头保留值或4字节尾部非零，完整原值已保留。',
        kind: 'storage',
      });
    blocks.push(block);
    offset = end;
  }
  const only = (id: number) => {
    const selected = blocks.filter((block) => block.id === id);
    return selected.length === 1 && selected[0].data
      ? (selected[0].data as Row)
      : undefined;
  };
  const groupLabels = only(0)?.labels ?? [],
    contacts = only(3)?.contacts ?? [];
  const remainder = data.subarray(offset);
  if (remainder.some((byte) => byte !== 0))
    unknown.push({
      field: 'remainingHex',
      reason: complete
        ? '声明块数量之后还有非零容量字节，未将它们当成额外块。'
        : '未完成块及后续容量字节完整保留。',
      kind: 'storage',
    });
  return {
    layoutBasis:
      'native UIDATA writer 0x1407fab70; frame lengths from header+8; includes four-byte trailers',
    blockCount: count,
    parsedBlockCount: blocks.length,
    completeContainer: complete && blocks.length === count,
    headerPaddingHex: data.subarray(1, 4).toString('hex'),
    blocks,
    groupLabels,
    contactRecords: contacts,
    groupLabelsCandidate: groupLabels,
    contactRecordsCandidate: contacts,
    socialList: only(4),
    muteList: only(11),
    remainingOffset: offset,
    remainingHex: remainder.toString('hex'),
    capacityPaddingByteLength: complete ? remainder.length : 0,
    capacityPaddingAllZero: complete
      ? remainder.every((byte) => byte === 0)
      : null,
    coverage: {
      structureComplete: complete && blocks.length === count,
      knownFields: known,
      candidateFields: candidates,
      unknownFields: unknown,
    } satisfies DecodeCoverage,
  };
}
