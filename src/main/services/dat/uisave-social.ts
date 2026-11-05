import { decodeUtf8 } from './sections.ts';
import type { DecodeCoverage } from '../../../shared/types.ts';

// CN ffxiv_dx11.exe SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Container writer 0x1407fab70; name setter 0x1407fb650; 64-byte contact
// setters 0x1407fc720..0x1407fca70. Vector writers: 0x1407fd1a0 / 0x1407ff090.
// Blacklist: InfoProxyBlacklist 0x1409685f0 consumes module+0x1198;
// 0x140968a5a selects AccountIdMap(+0x19f8)/ContentIdMap(+0x1a08).
// 0x140968ccc passes server flag bit1 to record+0x10; writer 0x1407fd333
// packs that bool into F. R is the server record key; I is a legacy identity
// used when R=0 (0x1407fe415..452), not necessarily a populated account ID.
// Group labels: 0x1407fb5f0 default Addon1668(index+1), 0x1407fb650
// updates icon labels Addon1661..1667; AgentFriendlist event 0x14051c2d5.
// Name caches: 0x1407fe540 inserts 8 name32/contentId64/world16 records;
// party caller 0x140d1deee reads CrossRealmMember.ContentId+0x10 and World+0x2c.
// 0x1407fe7b0 inserts the same 48-byte layout at module+0x1340 (cap200);
// InfoProxyFriendList 0x140969340 supplies CharacterData.ContentId/Name.
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
            legacyIdentityId: identity,
            worldIdRaw: world,
            worldId: world,
            recordIdRaw: indices!.readUInt16LE(index * 2),
            serverRecordId: indices!.readUInt16LE(index * 2),
            flagRaw: (bitmap![index >>> 3] & (1 << (index & 7))) !== 0,
            isAccountBlock: (bitmap![index >>> 3] & (1 << (index & 7))) !== 0,
            identityKind:
              (bitmap![index >>> 3] & (1 << (index & 7))) !== 0
                ? 'account'
                : 'content',
            accountId:
              identity !== '0' &&
              indices!.readUInt16LE(index * 2) === 0 &&
              (bitmap![index >>> 3] & (1 << (index & 7))) !== 0
                ? identity
                : null,
            contentId:
              identity !== '0' &&
              indices!.readUInt16LE(index * 2) === 0 &&
              (bitmap![index >>> 3] & (1 << (index & 7))) === 0
                ? identity
                : null,
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
    known.push(
      'blacklist.entries.serverRecordId',
      'blacklist.entries.isAccountBlock',
      'blacklist.entries.identityKind',
      'blacklist.entries.legacyIdentityId',
      'blacklist.entries.accountId / contentId',
      'blacklist.entries.worldId',
    );
  return {
    kind: id === 4 ? 'blacklist' : 'mute-list',
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

function decodeNameCache(
  body: Buffer,
  sourceOffset: number,
  capacity: number,
  unknown: Unknown[],
  known: string[],
  id: number,
) {
  const declaredCountRaw = body.readUInt32LE(),
    nativeCount = declaredCountRaw <= capacity ? declaredCountRaw : 0;
  if (declaredCountRaw > capacity)
    unknown.push({
      field: `blocks[id=${id}].declaredCountRaw`,
      reason: `数量${declaredCountRaw}超出原生容量${capacity}，客户端将活动数量重置为0；全部存储槽位仍保留。`,
      kind: 'meaning',
    });
  const slots = Array.from({ length: capacity }, (_, index) => {
    const offset = 8 + index * 48,
      record = body.subarray(offset, offset + 48),
      name = cstring(record.subarray(0, 32));
    if (index < nativeCount && (name.value === null || !name.nulTerminated))
      unknown.push({
        field: `blocks[id=${id}].entries[${index}].name`,
        reason: '名称不是完整的NUL终止UTF-8字符串，保留原始32字节。',
        kind: 'storage',
      });
    return {
      index,
      offset: sourceOffset + offset,
      isStoredEntry: index < nativeCount,
      name: name.value,
      contentId: record.readBigUInt64LE(32).toString(),
      worldId: record.readUInt16LE(40),
      nameStorageHex: name.rawHex,
      reservedTailHex: record.subarray(42).toString('hex'),
      rawHex: record.toString('hex'),
    };
  });
  known.push(
    `blocks[id=${id}].nativeCount`,
    `blocks[id=${id}].entries.name`,
    `blocks[id=${id}].entries.contentId`,
    `blocks[id=${id}].entries.worldId`,
  );
  return {
    kind: id === 5 ? 'party-character-cache' : 'character-name-cache',
    declaredCountRaw,
    nativeCount,
    capacity,
    recordSize: 48,
    headerReservedHex: body.subarray(4, 8).toString('hex'),
    entries: slots.slice(0, nativeCount),
    slots,
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
              groupIndex: slot + 1,
              iconAddonId: 1661 + slot,
              offset: offset + 16 + slot * 64,
              name: text.value,
              byteLength: text.byteLength,
              nulTerminated: text.nulTerminated,
              rawHex: text.rawHex,
            };
          });
          block.data = {
            kind: 'friend-group-names',
            labels,
            slotByteLength: 64,
            nameCopyLimit: 45,
          };
          known.push('blocks[id=0].labels.name', 'blocks[id=0].labels.offset');
          known.push('friendGroups.groupIndex', 'friendGroups.iconAddonId');
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
              contentId: identity,
              identityIdRaw: identity,
              contentIdCandidate: identity,
              worldId: record.readUInt16LE(48),
              worldIdRaw: record.readUInt16LE(48),
              classJobId: record.readUInt16LE(50),
              additionalIdRaw: record.readBigUInt64LE(40).toString(),
              contextValueRaw: record.readUInt32LE(52),
              clientValueRaw: record.readUInt16LE(56),
              reservedTailHex: record.subarray(58).toString('hex'),
              unknownAfterIdHex: record.subarray(40, 48).toString('hex'),
              unknownAfterWorldHex: record.subarray(50).toString('hex'),
              unknownAfterContentIdHex: record.subarray(40).toString('hex'),
              rawHex: record.toString('hex'),
            };
          });
          block.data = {
            kind: 'recent-contacts',
            contacts,
            capacity: 50,
            recordSize: 64,
          };
          known.push(
            'blocks[id=3].contacts.name',
            'blocks[id=3].contacts.identityIdRaw',
            'blocks[id=3].contacts.worldIdRaw',
            'contactRecords.contentId',
            'contactRecords.worldId',
            'contactRecords.classJobId',
          );
          unknown.push({
            field:
              'blocks[id=3].contacts.additionalIdRaw / contextValueRaw / clientValueRaw',
            reason:
              'AgentContactList(AgentId0x10c)与跨服队伍/队伍成员调用链确认名称、角色ContentId、关联服务器及职业；+40处64位值、+52处32位上下文及+56处16位客户端值的业务含义仍待核对。',
            kind: 'meaning',
          });
        } else if (id === 4 || id === 11)
          block.data = decodeList(id, body, offset + 16, unknown, known);
        else if (id === 5 || id === 6)
          block.data = decodeNameCache(
            body,
            offset + 16,
            id === 5 ? 8 : 200,
            unknown,
            known,
            id,
          );
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
    friendGroups: groupLabels,
    contactRecords: contacts,
    recentContacts: contacts,
    groupLabelsCandidate: groupLabels,
    contactRecordsCandidate: contacts,
    socialList: only(4),
    blacklist: only(4),
    partyMemberCache: only(5),
    characterNameCache: only(6),
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
