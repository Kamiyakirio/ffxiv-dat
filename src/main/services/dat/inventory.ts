import { decodeUtf8, readSections } from './sections.ts';
import type { DatDecodeResult, DatSection } from './types.ts';

// Layout references: FFXIVClientStructs b72bc1f73, Client/UI/Misc/
// AcquaintanceModule, GoldSaucerModule, ItemOrderModule and ItemFinderModule.
// These readers additionally validate the on-disk tags and lengths; they do not
// assume that the enclosing runtime modules can be copied directly from disk.

function exactLength(bytes: Buffer, expected: number, label: string): void {
  if (bytes.length !== expected) {
    throw new Error(
      `${label}: expected ${expected} bytes, received ${bytes.length}`,
    );
  }
}

function u16s(bytes: Buffer): number[] {
  if (bytes.length % 2) throw new Error('Incomplete uint16 array');
  return Array.from({ length: bytes.length / 2 }, (_, i) =>
    bytes.readUInt16LE(i * 2),
  );
}

function u32s(bytes: Buffer): number[] {
  if (bytes.length % 4) throw new Error('Incomplete uint32 array');
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readUInt32LE(i * 4),
  );
}

function id64(bytes: Buffer): string {
  exactLength(bytes, 8, '64-bit identifier');
  return bytes.readBigUInt64LE().toString(16).toUpperCase().padStart(16, '0');
}

function versionWarnings(version: number, expected: number): string[] {
  return version === expected
    ? []
    : [
        `Version ${version} has not been verified; the known layout version is ${expected}.`,
      ];
}

function sectionBytes(section: DatSection): Buffer {
  return Buffer.from(section.valueHex, 'hex');
}

export function decodeAcquaintance(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 100);
  const sections = readSections(payload);
  const contacts: Record<string, unknown>[] = [];
  let index = 0;
  while (index < sections.length && sections[index].tag === 'N') {
    const group = sections.slice(index, index + 7);
    if (group.map((field) => field.tag).join('') !== 'NWOTCCC') {
      warnings.push(
        `Unknown contact record at payload offset ${sections[index].offset}.`,
      );
      break;
    }
    const worldText = group[2].text;
    const cParts = group.slice(4).map((field) => field.text);
    const contentIdHex = cParts.every((part, partIndex) =>
      new RegExp(`^[0-9A-Fa-f]{${partIndex === 0 ? 4 : 6}}$`).test(part ?? ''),
    )
      ? cParts.join('').toUpperCase()
      : null;
    const flagsText = group[3].text;
    contacts.push({
      offset: group[0].offset,
      name: group[0].text,
      worldName: group[1].text,
      worldId:
        worldText && /^[0-9A-Fa-f]+$/.test(worldText)
          ? parseInt(worldText, 16)
          : null,
      worldIdEncoded: worldText,
      unknownT: flagsText,
      unknownCParts: cParts,
      inferred: {
        // AcquaintanceModule.Acquaintance has Flags (commented ushort at
        // 0xD2) and ContentId (ulong at 0xD8). The serialized T / C binding
        // is inferred from those fields and the observed 4/6/6 hex widths;
        // the game's ReadFile implementation is not available to confirm it.
        contentIdCandidate:
          contentIdHex === null
            ? null
            : {
                hex: contentIdHex,
                decimal: BigInt(`0x${contentIdHex}`).toString(),
                confidence: 'inferred',
              },
        flagsCandidate:
          flagsText && /^[0-9A-Fa-f]{4}$/.test(flagsText)
            ? { value: parseInt(flagsText, 16), confidence: 'inferred' }
            : null,
      },
      fields: group,
    });
    index += 7;
  }
  const additionalFields = sections.slice(index);
  const metadataFields = additionalFields
    .filter((field) => field.tag === 'M')
    .map((field) => ({
      offset: field.offset,
      hex: field.text,
      decimal:
        field.text && /^[0-9A-Fa-f]+$/.test(field.text)
          ? BigInt(`0x${field.text}`).toString()
          : null,
    }));
  // The first two six-digit M values form a plausible Unix timestamp in the
  // observed sample. This is an explicitly inferred candidate, not evidence
  // that the remaining M values are timestamps or are grouped the same way.
  const timeParts = metadataFields.slice(2, 4);
  const timeHex =
    timeParts.length === 2 &&
    timeParts.every((field) => /^[0-9A-Fa-f]{6}$/.test(field.hex ?? ''))
      ? timeParts.map((field) => field.hex).join('')
      : null;
  const timeSeconds = timeHex ? BigInt(`0x${timeHex}`) : null;
  const timestampCandidate =
    timeSeconds !== null && timeSeconds > 0n && timeSeconds < 253402300800n
      ? {
          hex: timeHex,
          unixSeconds: timeSeconds.toString(),
          isoUtc: new Date(Number(timeSeconds) * 1000).toISOString(),
          fieldOffsets: timeParts.map((field) => field.offset),
          confidence: 'inferred',
        }
      : null;
  const metadataCount = metadataFields[0]?.hex;
  const metadataRecordCount =
    metadataCount && /^[0-9a-f]{4}$/i.test(metadataCount)
      ? parseInt(metadataCount, 16)
      : null;
  const metadataShapeMatches =
    metadataRecordCount !== null &&
    metadataFields.length === 4 + metadataRecordCount * 2 &&
    /^[0-9a-f]{4}$/i.test(metadataFields[1]?.hex ?? '') &&
    metadataFields
      .slice(2)
      .every((field) => /^[0-9a-f]{6}$/i.test(field.hex ?? ''));
  const metadataBlock = metadataShapeMatches
    ? {
        recordCount: metadataRecordCount,
        headerFieldOffsets: metadataFields
          .slice(0, 4)
          .map((field) => field.offset),
        integer64: BigInt(
          `0x${metadataFields
            .slice(1, 4)
            .map((field) => field.hex)
            .join('')}`,
        ).toString(),
        entries: Array.from(
          { length: metadataRecordCount },
          (_, recordIndex) => ({
            index: recordIndex,
            fieldOffsets: metadataFields
              .slice(4 + recordIndex * 2, 6 + recordIndex * 2)
              .map((field) => field.offset),
            firstValue: parseInt(
              metadataFields[4 + recordIndex * 2].hex ?? '0',
              16,
            ),
            secondValue: parseInt(
              metadataFields[5 + recordIndex * 2].hex ?? '0',
              16,
            ),
          }),
        ),
      }
    : null;
  if (sections.length) {
    warnings.push(
      'Contact names and worlds are decoded. T flag bits, the C identifier binding, and the purpose of numeric M records still need confirmation; exact values and boundaries are retained.',
    );
  }
  return {
    status: sections.length || warnings.length ? 'partial' : 'decoded',
    data: {
      contacts,
      contactCount: contacts.length,
      additionalFields,
      metadataFields,
      timestampCandidate,
      metadataBlock,
      sections,
    },
    coverage: {
      structureComplete: true,
      knownFields: [
        'contacts[].name',
        'contacts[].worldName',
        'contacts[].worldId',
        'contacts[].fields',
        ...(metadataBlock
          ? [
              'metadataBlock.recordCount',
              'metadataBlock.entries[].firstValue',
              'metadataBlock.entries[].secondValue',
            ]
          : []),
      ],
      candidateFields: sections.length
        ? [
            'contacts[].inferred.contentIdCandidate',
            'contacts[].inferred.flagsCandidate',
            'timestampCandidate',
          ]
        : [],
      unknownFields: sections.length
        ? [
            {
              field: 'contacts[].unknownT',
              reason:
                '字段可精确解码为16位值，但每个位的业务含义尚未由读取函数或单项差分证实。',
              kind: 'meaning',
            },
            {
              field: 'contacts[].unknownCParts',
              reason:
                '4/6/6十六进制分片可精确拼接64位标识；源码同时含ContentId和AccountId，需进一步确认序列化绑定。',
              kind: 'reference',
            },
            {
              field: 'metadataBlock',
              reason: metadataBlock
                ? '已核实数量与两列数值的记录边界；这组数值的业务用途及64位头字段的时间语义尚未确认。'
                : '附加M字段未匹配已知的数量/64位头/两列记录格式，原始字段完整保留。',
              kind: 'meaning',
            },
          ]
        : [],
    },
    warnings,
  };
}

export function decodeGoldSaucer(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 103);
  if (payload.length < 648)
    throw new Error('Truncated Gold Saucer configuration');
  const decks = Array.from({ length: 10 }, (_, index) => {
    const offset = index * 58;
    const nameBytes = payload.subarray(offset, offset + 48);
    const terminator = nameBytes.indexOf(0);
    return {
      index,
      offset,
      name: decodeUtf8(
        terminator < 0 ? nameBytes : nameBytes.subarray(0, terminator),
      ),
      nameStorageHex: nameBytes.toString('hex'),
      cardIds: u16s(payload.subarray(offset + 48, offset + 58)),
    };
  });
  const padding = payload.subarray(626, 628);
  const trailing = payload.subarray(648);
  if (padding.some((value) => value !== 0))
    warnings.push('Nonzero alignment bytes after minion hotbar.');
  if (trailing.length)
    warnings.push('Additional Gold Saucer bytes follow the verified layout.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: {
      decks,
      minionCompanionIds: u16s(payload.subarray(580, 626)),
      alignmentHex: padding.toString('hex'),
      unseenTripleTriadCardIds: u16s(payload.subarray(628, 648)),
      trailingHex: trailing.toString('hex'),
    },
    coverage: {
      structureComplete: true,
      knownFields: [
        'decks[].name',
        'decks[].cardIds',
        'minionCompanionIds',
        'unseenTripleTriadCardIds',
      ],
      candidateFields: [],
      unknownFields: trailing.length
        ? [
            {
              field: 'trailingHex',
              reason: '已知648字节配置之后仍有额外字节，保留原值。',
              kind: 'storage',
            },
          ]
        : [],
    },
    warnings,
  };
}

interface OrderField {
  offset: number;
  tag: string;
  bytes: Buffer;
}

function readOrderFields(payload: Buffer): OrderField[] {
  const fields: OrderField[] = [];
  for (let offset = 0; offset < payload.length;) {
    if (offset + 2 > payload.length)
      throw new Error(`Truncated item order header at ${offset}`);
    const length = payload[offset + 1];
    const end = offset + 2 + length;
    if (length === 0 || end > payload.length)
      throw new Error(`Invalid item order field at ${offset}`);
    fields.push({
      offset,
      tag: String.fromCharCode(payload[offset]),
      bytes: payload.subarray(offset + 2, end),
    });
    offset = end;
  }
  return fields;
}

const orderContainers = [
  'inventory',
  'armouryMainHand',
  'armouryHead',
  'armouryBody',
  'armouryHands',
  'armouryLegs',
  'armouryFeet',
  'armouryOffHand',
  'armouryEars',
  'armouryNeck',
  'armouryWrists',
  'armouryRings',
  'armourySoulCrystal',
];

export function decodeItemOrder(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 104);
  const fields = readOrderFields(payload);
  let cursor = 0;
  function take(tag: string, length: number): OrderField {
    const field = fields[cursor++];
    if (!field || field.tag !== tag || field.bytes.length !== length) {
      throw new Error(
        `Expected item order ${tag}/${length} at field ${cursor - 1}`,
      );
    }
    return field;
  }
  function sorter(name: string, retainerId?: string): Record<string, unknown> {
    const countField = take('n', 4);
    const count = countField.bytes.readUInt32LE();
    if (count > fields.length - cursor)
      throw new Error('Item order count exceeds remaining records');
    const slots = Array.from({ length: count }, (_, displayIndex) => {
      const field = take('i', 4);
      return {
        displayIndex,
        offset: field.offset,
        slot: field.bytes.readUInt16LE(),
        page: field.bytes.readUInt16LE(2),
      };
    });
    return {
      name,
      retainerId,
      offset: countField.offset,
      count,
      slots,
      locations: slots.map((entry) => ({
        displayPosition: entry.displayIndex + 1,
        sourcePage: entry.page + 1,
        sourceSlot: entry.slot + 1,
      })),
    };
  }
  const formatVersion = take('V', 4).bytes.readUInt32LE();
  if (formatVersion !== version)
    warnings.push('Item order inner version differs from its file header.');
  const containers = orderContainers.map((name) => sorter(name));
  const retainerCount = take('N', 4).bytes.readUInt32LE();
  if (retainerCount > fields.length - cursor)
    throw new Error('Retainer count exceeds remaining item order fields');
  const retainers = Array.from({ length: retainerCount }, () => {
    const retainerId = id64(take('R', 8).bytes);
    return sorter('retainer', retainerId);
  });
  containers.push(sorter('saddleBag'), sorter('premiumSaddleBag'));
  const additionalFields = fields.slice(cursor).map((field) => ({
    offset: field.offset,
    tag: field.tag,
    valueHex: field.bytes.toString('hex'),
  }));
  if (additionalFields.length)
    warnings.push('Unrecognized fields follow the item sorters.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: { formatVersion, containers, retainers, additionalFields },
    coverage: {
      structureComplete: true,
      knownFields: [
        'formatVersion',
        'containers[].slots[].displayIndex',
        'containers[].slots[].slot',
        'containers[].slots[].page',
        'retainers[].retainerId',
        'retainers[].slots',
      ],
      candidateFields: [],
      unknownFields: additionalFields.length
        ? [
            {
              field: 'additionalFields',
              reason: '已知排序器之后有附加字段，尚未对应运行时业务字段。',
              kind: 'meaning',
            },
          ]
        : [],
    },
    warnings,
  };
}

function decodeRetainerInventory(bytes: Buffer): Record<string, unknown> {
  exactLength(bytes, 1152, 'Retainer inventory');
  const body = bytes.subarray(8);
  return {
    retainerId: id64(bytes.subarray(0, 8)),
    equippedItemIds: u32s(body.subarray(0, 0x38)),
    itemIds: u32s(body.subarray(0x38, 0x2f4)),
    itemCounts: u16s(body.subarray(0x2f4, 0x452)),
    crystalQuantities: u16s(body.subarray(0x452, 0x476)),
    alignmentHex: body.subarray(0x476).toString('hex'),
  };
}

export function decodeItemFinder(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 203);
  const sections = readSections(payload);
  let cursor = 0;
  function take(tag: string, length?: number): DatSection {
    const section = sections[cursor++];
    if (
      !section ||
      section.tag !== tag ||
      (length !== undefined && section.length !== length)
    ) {
      throw new Error(
        `Expected item finder ${tag}/${length ?? '*'} at section ${cursor - 1}`,
      );
    }
    return section;
  }
  function number(tag: string, length: 2 | 4): number {
    const bytes = sectionBytes(take(tag, length));
    return length === 2 ? bytes.readUInt16LE() : bytes.readUInt32LE();
  }
  const characterContentId = id64(sectionBytes(take('C', 8)));
  const retainerFormatVersion = number('R', 2);
  const retainerCount = number('N', 4);
  if (retainerCount > sections.length - cursor)
    throw new Error('Retainer inventory count exceeds remaining sections');
  const retainers = Array.from({ length: retainerCount }, () => {
    const section = take('I');
    const bytes = sectionBytes(section);
    if (bytes.length !== 1152) {
      warnings.push(
        `Unverified retainer inventory length ${bytes.length} at ${section.offset}.`,
      );
      return { offset: section.offset, rawHex: section.valueHex };
    }
    return { offset: section.offset, ...decodeRetainerInventory(bytes) };
  });
  const saddleBagFormatVersion = number('B', 2);
  const bagsSection = take('I', 840);
  const bags = sectionBytes(bagsSection);
  const bagItemIds = u32s(bags.subarray(0, 560));
  const bagCounts = u16s(bags.subarray(560));
  const glamourDresserFormatVersion = number('M', 2);
  const dresserSection = take('I');
  const dresser = sectionBytes(dresserSection);
  if (dresser.length % 6)
    throw new Error('Invalid glamour dresser array length');
  const dresserCount = dresser.length / 6;
  if (dresserCount !== 800)
    warnings.push(
      `Glamour dresser holds ${dresserCount} entries, not the verified 800.`,
    );
  const cabinetFormatVersion = number('A', 2);
  const cabinetBitCount = number('N', 4);
  const cabinetSection = take('F');
  const cabinet = sectionBytes(cabinetSection);
  if (cabinetBitCount !== cabinet.length * 8)
    throw new Error('Cabinet bit count does not match its data size');
  const cabinetSetBitIndices: number[] = [];
  cabinet.forEach((value, byteIndex) => {
    for (let bit = 0; bit < 8; bit++)
      if (value & (1 << bit)) cabinetSetBitIndices.push(byteIndex * 8 + bit);
  });
  const additionalFields = sections.slice(cursor);
  if (additionalFields.length)
    warnings.push('Unrecognized fields follow the item finder cache.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: {
      characterContentId,
      retainerFormatVersion,
      retainers,
      saddleBagFormatVersion,
      saddleBag: {
        offset: bagsSection.offset,
        itemIds: bagItemIds.slice(0, 70),
        itemCounts: bagCounts.slice(0, 70),
      },
      premiumSaddleBag: {
        offset: bagsSection.offset,
        itemIds: bagItemIds.slice(70),
        itemCounts: bagCounts.slice(70),
      },
      glamourDresserFormatVersion,
      glamourDresser: {
        offset: dresserSection.offset,
        itemIds: u32s(dresser.subarray(0, dresserCount * 4)),
        itemSetUnlockBits: u16s(dresser.subarray(dresserCount * 4)),
      },
      cabinetFormatVersion,
      cabinet: {
        offset: cabinetSection.offset,
        bitCount: cabinetBitCount,
        unlockWords: u32s(cabinet),
        setBitIndices: cabinetSetBitIndices,
        cabinetIds: cabinetSetBitIndices,
      },
      additionalFields,
      note: 'Client-side item-search cache, not authoritative server inventory. Cabinet bit indices are Cabinet row IDs: resolve Cabinet.Item to the Item sheet rather than treating Cabinet IDs as Item IDs.',
    },
    coverage: {
      structureComplete: true,
      knownFields: [
        'characterContentId',
        'retainers[].retainerId',
        'retainers[].equippedItemIds',
        'retainers[].itemIds',
        'retainers[].itemCounts',
        'retainers[].crystalQuantities',
        'saddleBag.itemIds',
        'saddleBag.itemCounts',
        'premiumSaddleBag.itemIds',
        'premiumSaddleBag.itemCounts',
        'glamourDresser.itemIds',
        'cabinet.cabinetIds',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'glamourDresser.itemSetUnlockBits',
          reason:
            '已完整读取每项16位状态值；各位的业务含义未在当前结构源码定义。',
          kind: 'meaning',
        },
        {
          field: 'retainers[].alignmentHex',
          reason:
            '每条雇员记录末尾2字节保留；不影响已读取的物品ID、数量及水晶数量。',
          kind: 'storage',
        },
        {
          field: 'retainers[].crystalQuantities[] -> crystal ItemId',
          reason:
            '18个数量已由结构源码确认；槽位到水晶物品编号的映射缺少独立的正值样本或读函数验证。',
          kind: 'reference',
        },
        ...(additionalFields.length
          ? [
              {
                field: 'additionalFields',
                reason: '存在已知缓存字段之后的附加字段。',
                kind: 'meaning' as const,
              },
            ]
          : []),
      ],
    },
    warnings,
  };
}

export function decodeLogFilter(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 3);
  const groups: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 16 > payload.length)
      throw new Error(`Truncated log filter header at ${offset}`);
    const index = payload.readUInt16LE(offset);
    const groupVersion = payload.readUInt16LE(offset + 2);
    const length = payload.readUInt32LE(offset + 4);
    if (offset + 16 + length > payload.length)
      throw new Error(`Truncated log filter values at ${offset}`);
    const filterStates = Array.from(
      payload.subarray(offset + 16, offset + 16 + length),
    );
    groups.push({
      offset,
      index,
      // MoreMessageFilterPresets.cs:221-231 and :237-260 in the local
      // DailyRoutines.ModulesPublic repository selects one of four chat tabs
      // and copies its filter data. Filter positions are LogFilter RowIds,
      // NOT LogKind ids: all 234 active rows in the supplied second tab match
      // LogFilter.Preset & 2 exactly. The other three tabs differ by only one
      // user-selected category. 0/1 therefore mean hidden/displayed. State 2
      // occurs only at unused/deleted/category-zero rows in initialized tabs.
      chatTab: index < 4 ? `Chat tab ${index + 1}` : null,
      version: groupVersion,
      unknownHeaderHex: payload
        .subarray(offset + 8, offset + 16)
        .toString('hex'),
      filterStates,
      filters: filterStates.map((rawState, filterId) => ({
        filterId,
        rawState,
        enabled: rawState === 1 ? true : rawState === 0 ? false : null,
        stateLabel:
          rawState === 1
            ? '显示'
            : rawState === 0
              ? '隐藏'
              : rawState === 2
                ? '保留项'
                : `未知状态 ${rawState}`,
      })),
    });
    offset += 16 + length;
  }
  warnings.push(
    'LogFilter row IDs identify categories; state 0 hides and state 1 displays. State 2 is retained without interpreting it as an enabled switch.',
  );
  return {
    status: 'partial',
    data: { groups },
    warnings,
    coverage: {
      structureComplete: true,
      knownFields: [
        'groups[].index',
        'groups[].chatTab',
        'groups[].filters[].filterId',
        'groups[].filters[].rawState',
        'groups[].filters[].enabled (states 0/1)',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'groups[].filters state 2',
          reason:
            '所有样本的已初始化页中，2只出现在无效/删除/保留类别位置；不把它强行解释为显示或隐藏。',
          kind: 'storage',
        },
        ...groups
          .filter((group) =>
            Array.from(group.filterStates as number[]).some(
              (state) => state > 2,
            ),
          )
          .map((group) => ({
            field: `groups[${group.index}].filters`,
            reason: '包含0/1/2之外的状态值，原值保留。',
            kind: 'meaning' as const,
          })),
      ],
    },
  };
}
