import type { DatDecodeResult } from './types.ts';
import { nativeAddonName } from './addon-names.ts';
import targetData from './native-save-data.json' with { type: 'json' };
import {
  describeHotbarCommand,
  hotbarTypes,
  gameName,
  nameCatalog,
} from './game-data.ts';

// Field meanings: FFXIVClientStructs b72bc1f73, UI/Misc/
// RaptureHotbarModule.HotbarSlotType, RaptureGearsetModule and AddonConfig.
// Disk offsets below were independently checked against both supplied characters.

const equipmentSlots = [
  'MainHand',
  'OffHand',
  'Head',
  'Body',
  'Hands',
  'Belt',
  'Legs',
  'Feet',
  'Ears',
  'Neck',
  'Wrists',
  'RingRight',
  'RingLeft',
  'SoulStone',
];

function span(
  data: Buffer,
  offset: number,
  length: number,
  label: string,
): Buffer {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > data.length
  ) {
    throw new Error(
      `${label} range ${offset}+${length} exceeds ${data.length} bytes`,
    );
  }
  return data.subarray(offset, offset + length);
}

function text(bytes: Buffer): string | null {
  const end = bytes.indexOf(0);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      end < 0 ? bytes : bytes.subarray(0, end),
    );
  } catch {
    return null;
  }
}

function unsupported(
  kind: string,
  payload: Buffer,
  version: number,
): DatDecodeResult {
  return {
    status: 'unsupported',
    data: { kind, version, byteLength: payload.length },
    warnings: [
      `No verified ${kind} record layout for version ${version}; decoded bytes are retained separately.`,
    ],
  };
}

// Target SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// 0x1407d9020 writes runtime groups 46..69 as disk groups 64..87 (+18).
// 0x1407d8a70 reads this exact range back (-18), rejecting the gap 46..63.
// 0x1407d9920 / 0x1407d99d0 map PvP groups through ClassJob.JobIndex
// (+0x5c): add 46 before BLU, 45 after BLU, 44 after BST; BLU/BST keep
// their PvE groups. The pinned targetData.jobs provides the target JobIndex.
function hotbarGroup(groupId: number) {
  if (groupId < 46)
    return {
      savedHotbarIndex: groupId,
      groupKind: groupId === 0 ? 'shared' : 'classJob',
      classJobId: groupId,
      isPvp: false,
    };
  if (groupId >= 64 && groupId < 88) {
    const savedHotbarIndex = groupId - 18;
    const job = Object.entries(targetData.jobs).find(([index, job]) => {
      const classJobId = job.classJobId;
      return (
        classJobId !== 36 &&
        classJobId !== 43 &&
        Number(index) + (classJobId < 36 ? 46 : classJobId < 43 ? 45 : 44) ===
          savedHotbarIndex
      );
    });
    return {
      savedHotbarIndex,
      groupKind: groupId === 64 ? 'pvpShared' : 'pvpClassJob',
      classJobId: groupId === 64 ? 0 : (job?.[1].classJobId ?? null),
      isPvp: true,
    };
  }
  return {
    savedHotbarIndex: null,
    groupKind: 'unmapped',
    classJobId: null,
    isPvp: null,
  };
}

export function decodeHotbar(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  if (version !== 4) return unsupported('HOTBAR', payload, version);
  if (payload.length % 8 !== 0)
    throw new Error('HOTBAR v4 requires complete 8-byte disk records');
  const seen = new Set<string>();
  const groups = new Set<number>();
  const unknownTypes = new Set<number>();
  const unknownGroups = new Set<number>();
  const slots = [];
  for (let offset = 0; offset < payload.length; offset += 8) {
    const commandId = payload.readUInt32LE(offset);
    const groupId = payload[offset + 4];
    const barIndex = payload[offset + 5];
    const slotIndex = payload[offset + 6];
    const commandType = payload[offset + 7];
    if (barIndex >= 18 || slotIndex >= 16)
      throw new Error(`Invalid HOTBAR coordinate at payload offset ${offset}`);
    const key = `${groupId}:${barIndex}:${slotIndex}`;
    if (seen.has(key)) throw new Error(`Duplicate HOTBAR coordinate ${key}`);
    seen.add(key);
    groups.add(groupId);
    if (!(commandType in hotbarTypes)) unknownTypes.add(commandType);
    const mapping = hotbarGroup(groupId);
    if (mapping.classJobId === null) unknownGroups.add(groupId);
    slots.push({
      offset,
      groupId,
      ...mapping,
      // Compatibility names; formal fields above now have native confirmation.
      groupKindCandidate:
        groupId === 0 ? 'shared' : groupId < 46 ? 'classJob' : 'pvpStoredGroup',
      classJobIdCandidate: mapping.classJobId === 0 ? null : mapping.classJobId,
      barIndex,
      slotIndex,
      commandType,
      commandTypeName: hotbarTypes[commandType] ?? 'Unknown',
      commandId,
      ...describeHotbarCommand(
        hotbarTypes[commandType] ?? 'Unknown',
        commandId,
      ),
    });
  }
  const groupNames: Record<number, string | null> = Object.fromEntries(
    [...groups].map((id) => {
      const group = hotbarGroup(id);
      const name = group.classJobId
        ? gameName('ClassJob', group.classJobId)
        : null;
      return [
        id,
        id === 0
          ? '共享热键栏'
          : id === 64
            ? '共享 PvP 热键栏'
            : group.isPvp && name
              ? `${name} · PvP`
              : name,
      ];
    }),
  );
  return {
    status: unknownTypes.size || unknownGroups.size ? 'partial' : 'decoded',
    data: {
      recordSize: 8,
      slotCount: slots.length,
      nonemptySlotCount: slots.filter((slot) => slot.commandType !== 0).length,
      groupIds: [...groups].sort((a, b) => a - b),
      groupNames,
      groupJobHints: {},
      nameCatalog,
      indexConvention:
        'barIndex and slotIndex are zero-based; groupId is the stored byte, not a runtime array index',
      groupMappingEvidence:
        'Target writer 0x1407d9020 and reader 0x1407d8a70 confirm disk/PvP +18 encoding. GetPvPSavedHotbarIndexForClassJobId 0x1407d9920 and inverse 0x1407d99d0 plus target ClassJob.JobIndex establish job identity.',
      slots,
    },
    warnings: [...unknownTypes].map(
      (type) => `Unknown hotbar command type ${type}`,
    ),
    coverage: {
      structureComplete: true,
      knownFields: [
        'slots[].groupId',
        'slots[].savedHotbarIndex',
        'slots[].groupKind',
        'slots[].classJobId',
        'slots[].isPvp',
        'slots[].barIndex',
        'slots[].slotIndex',
        'slots[].commandType',
        'slots[].commandId',
        'slots[].commandTypeName (defined enum values)',
      ],
      candidateFields: [],
      unknownFields: [
        ...[...unknownTypes].map((type) => ({
          field: `slots[].commandType ${type}`,
          reason: '存储类型字节可读取，但当前源码枚举未定义该类型。',
          kind: 'meaning' as const,
        })),
        ...[...unknownGroups].map((groupId) => ({
          field: `slots[groupId=${groupId}]`,
          reason:
            groupId >= 64 && groupId < 88
              ? '此PvP存储索引在目标范围内，但目标ClassJob表没有对应可用职业，保留原始组号。'
              : '该组号不在目标读取器接受的0..45或64..87范围，保留原值，不冒充职业。',
          kind: 'meaning' as const,
        })),
      ],
    },
  };
}

export function decodeGearset(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  if (version !== 110) return unsupported('GEARSET', payload, version);
  span(payload, 0, 4, 'GEARSET metadata');
  const stride = 0x1c4;
  if ((payload.length - 4) % stride !== 0)
    throw new Error(
      'GEARSET v110 payload is not 4 bytes plus complete 452-byte records',
    );
  const warnings = [
    'Target v110 stores 100 registered gearsets and one internal equipment-switch snapshot; its two leading metadata values are decoded using the native writer and readers.',
    'Unknown flag bits, alignment bytes, and item padding are retained as raw values.',
  ];
  const records = [];
  for (
    let offset = 4, recordIndex = 0;
    offset < payload.length;
    offset += stride, recordIndex++
  ) {
    const record = span(payload, offset, stride, 'GEARSET record');
    const id = record[0];
    const nameBytes = record.subarray(1, 0x31);
    const name = text(nameBytes);
    if (name === null)
      warnings.push(
        `GEARSET record ${recordIndex} has a non-UTF-8 name; raw bytes are retained`,
      );
    const flags = record[0x37];
    const items = equipmentSlots.map((slot, index) => {
      const at = 0x38 + index * 0x1c;
      const itemId = record.readUInt32LE(at);
      return {
        offset: offset + at,
        slot,
        itemId,
        // Same item-ID ranges as Dalamud/Utility/ItemUtil.cs; this is a
        // derived convenience value, not a separate field in the DAT record.
        baseItemId:
          itemId >= 1000000 && itemId < 2000000
            ? itemId - 1000000
            : itemId >= 500000 && itemId < 1000000
              ? itemId - 500000
              : itemId,
        highQuality: itemId >= 1000000 && itemId < 2000000,
        collectible: itemId >= 500000 && itemId < 1000000,
        glamourId: record.readUInt32LE(at + 4),
        stainIds: [record[at + 8], record[at + 9]],
        materia: Array.from({ length: 5 }, (_, i) => ({
          id: record.readUInt16LE(at + 10 + 2 * i),
          grade: record[at + 20 + i],
        })),
        flags: record[at + 25],
        itemMissing: !!(record[at + 25] & 1),
        // 0x1407f2d9d..2dad maps InventoryManager's per-item status[1]
        // to bit1. Original mainhand not found/usable enters a replacement
        // flow (0x14087b13e..b275, Addon4385), carried through +0x243c to
        // status[1] at 0x14087ace5..acfc. A failed equip also sets it at
        // 0x14087b7bf..7df. It means the registered item was not usable as
        // saved; this can coexist with a replacement, unlike missing bit0.
        registeredItemUnavailable: !!(record[at + 25] & 2),
        colorDiffers: !!(record[at + 25] & 4),
        materiaDiffers: !!(record[at + 25] & 8),
        appearanceDiffers: !!(record[at + 25] & 16),
        unknownFlags: record[at + 25] & 0xe0,
        unknownTailHex: record.subarray(at + 26, at + 28).toString('hex'),
      };
    });
    records.push({
      offset,
      recordIndex,
      isSavedGearsetSlot: recordIndex < 100,
      recordRole:
        recordIndex < 100
          ? 'savedGearset'
          : recordIndex === 100
            ? 'internalEquipmentSnapshot'
            : 'unrecognizedAdditionalRecord',
      id,
      name,
      nameBytesHex: nameBytes.toString('hex'),
      classJobId: record[0x31],
      glamourSetLinkRaw: record[0x32],
      unknownByte33: record[0x33],
      itemLevel: record.readInt16LE(0x34),
      bannerIndexPlusOne: record[0x36],
      bannerIndex: record[0x36] === 0 ? null : record[0x36] - 1,
      hasLinkedBanner: record[0x36] !== 0,
      flags,
      exists: !!(flags & 1),
      mainHandMissing: !!(flags & 4),
      headgearVisible: !!(flags & 8),
      weaponsVisible: !!(flags & 16),
      visorEnabled: !!(flags & 32),
      // Target 958b78e2..., 0x140bc53ed..5426 maps gear bit0x40 to
      // BannerGearVisibilityFlag.HideVieraEars (mask0x8 in the checksum input).
      hideVieraEars: !!(flags & 64),
      unknownFlags: flags & 0x82,
      items,
      glassesIds: [record.readUInt16LE(0x1c0), record.readUInt16LE(0x1c2)],
    });
  }
  return {
    status: 'partial',
    data: {
      metadataHex: payload.subarray(0, 4).toString('hex'),
      // 0x1407f5200 writes bytes 1/2 from module+B504/B508, zeroes 0/3,
      // and copies 101 x 0x1c4 bytes from module+0x50. 0x1407f4b26 reads
      // byte1 (signed, normalized to 255 outside 0..99) and byte2 (!=0).
      currentGearsetIndexRaw: payload[1],
      currentGearsetIndex: payload[1] < 100 ? payload[1] : null,
      currentGearsetLinkSuppressedRaw: payload[2],
      // GetCurrent 0x1407f0790 returns 255 whenever module+B508 != 0;
      // 0x1407f0810 exposes the opposite selection. This behavioral name
      // does not speculate about an undocumented UI mode label.
      currentGearsetLinkSuppressed: payload[2] !== 0,
      metadataReservedHex: Buffer.from([payload[0], payload[3]]).toString(
        'hex',
      ),
      // Slot 100 is copied to/from a temporary backup during
      // EquipGearsetInternal 0x1407f0930 / completion 0x1407f2c3b. The live
      // inventory snapshot is populated by 0x1407f2770 -> 0x1407f5360.
      internalEquipmentSnapshot: records[100] ?? null,

      recordSize: stride,
      recordCount: records.length,
      existingRecordCount: records.filter((record) => record.exists).length,
      savedSlotCount: Math.min(100, records.length),
      auxiliaryRecordCount: Math.max(0, records.length - 100),
      records,
    },
    coverage: {
      structureComplete: true,
      knownFields: [
        'currentGearsetIndexRaw',
        'currentGearsetIndex',
        'currentGearsetLinkSuppressed',
        'internalEquipmentSnapshot',
        'records[].recordRole',
        'records[].id',
        'records[].name',
        'records[].classJobId',
        'records[].glamourSetLinkRaw',
        'records[].itemLevel',
        'records[].bannerIndex',
        'records[].hasLinkedBanner',
        'records[].flags (known source bits)',
        'records[].items[].itemId',
        'records[].items[].glamourId',
        'records[].items[].stainIds',
        'records[].items[].materia',
        'records[].items[].flags (known source bits)',
        'records[].items[].registeredItemUnavailable',
        'records[].glassesIds',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'metadataReservedHex',
          reason:
            '原生写入器将前导第0、3字节置零；不作为业务字段，原值完整保留。',
          kind: 'storage',
        },
        ...(records.length > 101
          ? [
              {
                field: 'records[101..]',
                reason:
                  '目标写入器只保存100个注册套装和索引100的内部切换快照；更多记录保留原值，不能声称为用户套装。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        {
          field: 'records[].unknownByte33',
          reason: '结构中未命名的单字节，保留原值。',
          kind: 'storage',
        },
        {
          field: 'records[].items[].unknownTailHex',
          reason: '每件装备记录末尾2字节未命名，保留原值。',
          kind: 'storage',
        },
        ...(records.some(
          (r) => r.unknownFlags || r.items.some((item) => item.unknownFlags),
        )
          ? [
              {
                field:
                  'records[].unknownFlags / records[].items[].unknownFlags',
                reason: '存在源码枚举未定义的旗标位，已与已知旗标分开保留。',
                kind: 'meaning' as const,
              },
            ]
          : []),
      ],
    },
    warnings,
  };
}

function crc32(value: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function addonElementSettings(name: string | null, parameter: number) {
  // LoadAddonConfig 0x14067ad81..d8a maps saved +0x10 to AtkUnitBase.Param.
  // JobHud's inherited OnConfigLoaded 0x1415a8f30 tests the entire Param
  // for nonzero, applies UseSimpleGauge (+0x239), then normalizes to 0/1.
  if (name && /^JobHud[A-Z]{3}\d/.test(name))
    return { kind: 'jobGauge', useSimpleGauge: parameter !== 0 };
  // ActionBar OnConfigLoaded 0x141584c10 decodes this three-byte image;
  // 0x1415843f0 writes (GetBarId | ((layout+1) << 8) | (otherBarId <<16)).
  if (name && /^_ActionBar(?:\d{2}|Ex)?$/.test(name)) {
    const layoutStored = (parameter >>> 8) & 0xff;
    const layoutIndex = layoutStored === 0 ? null : layoutStored - 1;
    return {
      kind: 'hotbar',
      hotbarIndex: parameter & 0xff,
      alternateHotbarIndex: (parameter >>> 16) & 0xff,
      usesDefaultLayout: layoutStored === 0,
      layoutStored,
      layoutIndex,
      layoutName:
        layoutIndex === null
          ? null
          : (['12 × 1', '6 × 2', '4 × 3', '3 × 4', '2 × 6', '1 × 12'][
              layoutIndex
            ] ?? null),
      unknownBits: parameter >>> 24,
    };
  }
  return { kind: 'addonSpecific', parameterRaw: parameter };
}

function addonEntry(payload: Buffer, offset: number): Record<string, unknown> {
  const record = span(payload, offset, 32, 'ADDON config entry');
  const hash = record.readUInt32LE(0);
  const addonName = nativeAddonName(hash) ?? addonNamesByHash.get(hash) ?? null;
  const floating = [
    record.readFloatLE(4),
    record.readFloatLE(8),
    record.readFloatLE(12),
  ];
  return {
    offset,
    addonNameHash: hash,
    addonNameHashHex: hash.toString(16).padStart(8, '0'),
    addonName,
    isEmptyStorage: record.every((byte) => byte === 0),
    x: Number.isFinite(floating[0]) ? floating[0] : null,
    y: Number.isFinite(floating[1]) ? floating[1] : null,
    scale: Number.isFinite(floating[2]) ? floating[2] : null,
    positionAndScaleBytesHex: record.subarray(4, 16).toString('hex'),
    elementFlags: record.readUInt32LE(16),
    elementSettings: addonElementSettings(addonName, record.readUInt32LE(16)),
    width: record.readUInt16LE(20),
    height: record.readUInt16LE(22),
    // 0x1407da100 key0 -> byte+0x18, then LoadAddonConfig
    // 0x14067aa83 -> AtkUldWidgetInfo.WidgetAlignment.AlignmentType.
    // This is nine-way anchoring, NOT a visibility boolean.
    alignmentType: record[24],
    alignmentName:
      ['左上', '上', '右上', '左', '中', '右', '左下', '下', '右下'][
        record[24]
      ] ?? null,
    // ApplyHudLayout 0x1407de464 selects bit PadMode (ConfigOption90):
    // bit0 keyboard/mouse, bit1 gamepad. These are HUD settings, not the
    // transient open/closed state of every ordinary window.
    hudVisibilityRaw: record[25],
    hudVisibleKeyboardMouse: (record[25] & 1) !== 0,
    hudVisibleGamepad: (record[25] & 2) !== 0,
    unknownHudVisibilityBits: record[25] & 0xfc,
    // 0x1407de3e2 chooses parameter-only restoration when bit0 is set;
    // otherwise +0x00..0x23 are copied (0x1407de42e..445).
    flagsOnlyOverride: (record[26] & 1) !== 0,
    unknownOverrideBits: record[26] & 0xfe,
    byteValue1: record[24],
    byteValue2: record[25],
    byteValue3: record[26],
    alpha: record[27],
    unknownTailHex: record.subarray(28, 32).toString('hex'),
  };
}

export function decodeAddon(payload: Buffer, version: number): DatDecodeResult {
  if (version !== 105) return unsupported('ADDON', payload, version);
  span(payload, 0, 32, 'ADDON container header');
  if (payload.subarray(0, 4).toString('ascii') !== 'ADDN')
    throw new Error('Missing ADDN container signature');
  const datasetCount = payload.readUInt32LE(4);
  let offset = payload.readUInt32LE(8);
  if (datasetCount > 0 && offset < 32)
    throw new Error('ADDON dataset overlaps the container header');
  if (datasetCount > payload.length / 48)
    throw new Error('ADDON dataset count exceeds payload bounds');
  const datasets = [];
  for (let index = 0; index < datasetCount; index++) {
    const header = span(payload, offset, 48, 'ADDON dataset header');
    const byteLength = header.readUInt32LE(16);
    if (byteLength < 48)
      throw new Error('ADDON dataset length is shorter than its header');
    const dataset = span(payload, offset, byteLength, 'ADDON dataset');
    const configOffset = header.readUInt32LE(20);
    const hudOffset = header.readUInt32LE(28);
    if (configOffset < 48 || hudOffset < 48)
      throw new Error('ADDON section overlaps the dataset header');
    const configHeader = span(
      dataset,
      configOffset,
      16,
      'ADDON regular config header',
    );
    const configCount = configHeader.readUInt32LE(0);
    const configEntriesOffset = configOffset + configHeader.readUInt32LE(4);
    if (configHeader.readUInt32LE(4) < 16)
      throw new Error('ADDON regular entries overlap their section header');
    span(
      dataset,
      configEntriesOffset,
      configCount * 32,
      'ADDON regular config entries',
    );
    const entries = Array.from({ length: configCount }, (_, n) =>
      addonEntry(payload, offset + configEntriesOffset + n * 32),
    );
    const hudHeader = span(dataset, hudOffset, 16, 'ADDON HUD section header');
    const entriesPerLayout = hudHeader.readUInt32LE(4);
    const currentLayout = hudHeader.readUInt16LE(8);
    const layoutCount = hudHeader.readUInt16LE(10);
    let layoutOffset = hudOffset + hudHeader.readUInt32LE(0);
    if (hudHeader.readUInt32LE(0) < 16)
      throw new Error('ADDON HUD layouts overlap their section header');
    if (layoutCount > dataset.length / 64)
      throw new Error('ADDON HUD layout count exceeds dataset bounds');
    const layouts = [];
    for (let layoutIndex = 0; layoutIndex < layoutCount; layoutIndex++) {
      const layoutHeader = span(
        dataset,
        layoutOffset,
        64,
        'ADDON HUD layout header',
      );
      // +0x30 is an unknown u32; the relative entry offset is at +0x34.
      const entryOffset = layoutHeader.readUInt32LE(52);
      if (entryOffset < 64)
        throw new Error('ADDON HUD entries overlap their layout header');
      span(
        dataset,
        layoutOffset + entryOffset,
        entriesPerLayout * 32,
        'ADDON HUD entries',
      );
      layouts.push({
        offset: offset + layoutOffset,
        layoutIndex,
        // Writer 0x1407def01..51 reads _hudLayoutNames at dataSet+0x9ba8
        // (Utf8String stride 0x68), writes at most 15 bytes into this header.
        // Reader 0x1407dd580..597 assigns it back to that exact name array.
        // The target UI currently saves empty strings; this does not imply
        // that a user-facing layout rename operation exists.
        name: text(layoutHeader.subarray(0, 16)),
        nameCandidate: text(layoutHeader.subarray(0, 16)), // Compatibility alias.
        nameStorageHex: layoutHeader.subarray(0, 16).toString('hex'),
        headerHex: layoutHeader.toString('hex'),
        entries: Array.from({ length: entriesPerLayout }, (_, n) =>
          addonEntry(payload, offset + layoutOffset + entryOffset + n * 32),
        ),
      });
      layoutOffset += entryOffset + entriesPerLayout * 32;
    }
    datasets.push({
      offset,
      datasetIndex: index,
      name: text(header.subarray(0, 16)),
      byteLength,
      headerHex: header.toString('hex'),
      regularHeaderHex: configHeader.toString('hex'),
      regularEntryCount: entries.length,
      entries,
      currentLayout,
      layoutCount,
      hudHeaderHex: hudHeader.toString('hex'),
      layouts,
      trailingBytesHex: dataset.subarray(layoutOffset).toString('hex'),
    });
    offset += byteLength;
  }
  const allEntries = datasets
    .flatMap((dataset) => [
      ...dataset.entries,
      ...dataset.layouts.flatMap((layout) => layout.entries),
    ])
    .filter((entry) => !entry.isEmptyStorage);
  return {
    status: 'partial',
    data: {
      containerHeaderHex: payload.subarray(0, 32).toString('hex'),
      datasetCount,
      datasets,
      unusedCapacityOffset: offset,
      unusedCapacityByteLength: payload.length - offset,
      unusedCapacityAllZero: payload
        .subarray(offset)
        .every((value) => value === 0),
    },
    warnings: [
      'ADDON disk entries are 32 bytes; runtime-only HasValue/IsOpen bytes from the 36-byte memory struct are not stored here.',
      'Coordinates, scale, dimensions, hashes and raw flags are decoded; undocumented header/tail fields retain raw bytes.',
      'Addon names use exact CRC32(name + _a) matches against the supplied EXE strings/formats and pinned structure annotations; unmatched hashes remain null. All-zero storage slots are retained in structure data.',
    ],
    coverage: {
      structureComplete: true,
      knownFields: [
        'datasets[].name',
        'datasets[].currentLayout',
        'datasets[].entries[].addonNameHash',
        'datasets[].entries[].x',
        'datasets[].entries[].y',
        'datasets[].entries[].scale',
        'datasets[].entries[].width',
        'datasets[].entries[].height',
        'datasets[].entries[].alpha',
        'datasets[].entries[].alignmentType / alignmentName',
        'datasets[].entries[].hudVisibilityRaw / hudVisibleKeyboardMouse / hudVisibleGamepad',
        'datasets[].entries[].flagsOnlyOverride',
        'datasets[].entries[].elementSettings (job gauge/simple mode and hotbar layout)',
        'datasets[].layouts[].entries',
        'datasets[].layouts[].name',
      ],
      candidateFields: [],
      unknownFields: [
        ...(allEntries.some((entry) => {
          const settings = entry.elementSettings as Record<string, unknown>;
          return (
            (settings.kind === 'addonSpecific' && entry.elementFlags !== 0) ||
            (settings.kind === 'hotbar' &&
              (settings.unknownBits ||
                (!settings.usesDefaultLayout && settings.layoutName === null)))
          );
        })
          ? [
              {
                field:
                  'entries[].elementFlags (other addon-specific parameters)',
                reason:
                  '职业量谱简易模式与热键栏编号/形状已由原生加载器确认；其他窗口的非零Param仍各有独立用途，原值保留，不能套用量谱或热键栏解释。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        ...(allEntries.some((entry) => entry.alignmentName === null)
          ? [
              {
                field: 'entries[].alignmentType',
                reason: '出现9宫格锚点0..8之外的编号，原始字节保留。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        ...(allEntries.some(
          (entry) =>
            entry.unknownHudVisibilityBits || entry.unknownOverrideBits,
        )
          ? [
              {
                field:
                  'entries[].unknownHudVisibilityBits / unknownOverrideBits',
                reason:
                  'HUD显隐和参数覆盖字节出现已确认位之外的值，原始字节保留。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        {
          field:
            'containerHeaderHex / datasets[].headerHex / layouts[].headerHex / unknownTailHex',
          reason: '容器范围和偏移已核验；其余未使用的头尾字节原样保留。',
          kind: 'storage',
        },
      ],
    },
  };
}

// Source names are appended below; no sibling repository is needed at runtime.
// [Addon(...)] names from FFXIVClientStructs b72bc1f73, Client/UI/Addon*.cs.
const addonSourceNames = [
  'AOZNotebook',
  'ActionCrossEditor',
  'ActionMenu',
  'AdventureNoteBook',
  'AetherCurrent',
  'AirShipExploration',
  'AirShipExplorationResult',
  'Alliance48',
  'AreaMap',
  'ArmouryBoard',
  'Bank',
  'BannerEditor',
  'BannerPreview',
  'Buddy',
  'Cabinet',
  'CabinetWithdraw',
  'CastBarEnemy',
  'Character',
  'CharacterClass',
  'CharacterInspect',
  'CharacterRepute',
  'ChatLog',
  'ChatLogPanel_0',
  'ChatLogPanel_1',
  'ChatLogPanel_2',
  'ChatLogPanel_3',
  'ContentsFinder',
  'ContentsFinderConfirm',
  'ContextMenu',
  'Currency',
  'CursorAddon',
  'CutSceneSelectString',
  'Dialogue',
  'DifficultySelectYesNo',
  'DragDropS',
  'FGSEnterDialog',
  'FGSExitDialog',
  'FashionCheck',
  'FateProgress',
  'FateReward',
  'FieldMarker',
  'Filter',
  'FilterSystem',
  'FishGuide2',
  'FishingNote',
  'FlyText',
  'FreeShop',
  'FriendList',
  'FrontlineRecord',
  'GSInfoCardDeck',
  'GSInfoCardList',
  'GSInfoChocoboParam',
  'GSInfoEditDeck',
  'GSInfoEmj',
  'GSInfoGeneral',
  'GSInfoMinionBattle',
  'Gathering',
  'GatheringMasterpiece',
  'GcArmyCapture',
  'GcArmyExpedition',
  'GcArmyExpeditionReport',
  'GearSetList',
  'GlassSelect',
  'GoldSaucerInfo',
  'GrandCompanySupplyList',
  'GrandCompanySupplyReward',
  'GuildLeve',
  'GuildLeveDifficulty',
  'HWDAetherGauge',
  'HWDLottery',
  'InclusionShop',
  'InputNumeric',
  'Inventory',
  'InventoryBuddy',
  'InventoryEvent',
  'InventoryExpansion',
  'InventoryGrid',
  'InventoryGrid0',
  'InventoryGrid0E',
  'InventoryGrid1',
  'InventoryGrid1E',
  'InventoryGrid2E',
  'InventoryGrid3E',
  'InventoryLarge',
  'InventoryRetainer',
  'InventoryRetainerLarge',
  'ItemDetail',
  'ItemDetailCompare',
  'ItemInspectionResult',
  'ItemSearch',
  'ItemSearchResult',
  'JobHudACN0',
  'JobHudAST0',
  'JobHudBLM0',
  'JobHudBLM1',
  'JobHudBRD0',
  'JobHudDNC0',
  'JobHudDNC1',
  'JobHudDRG0',
  'JobHudDRK0',
  'JobHudDRK1',
  'JobHudGFF0',
  'JobHudGFF1',
  'JobHudGNB0',
  'JobHudMCH0',
  'JobHudMNK0',
  'JobHudMNK1',
  'JobHudNIN0',
  'JobHudNIN1v70',
  'JobHudPLD0',
  'JobHudRDB0',
  'JobHudRDB1',
  'JobHudRDM0',
  'JobHudRPM0',
  'JobHudRPM1',
  'JobHudRRP0',
  'JobHudRRP1',
  'JobHudSAM0',
  'JobHudSAM1',
  'JobHudSCH0',
  'JobHudSMN0',
  'JobHudSMN1',
  'JobHudWAR0',
  'JobHudWHM0',
  'JobHudXBM0',
  'JournalAccept',
  'JournalDetail',
  'JournalResult',
  'ListIcon',
  'LobbyDKTCheck',
  'LobbyDKTCheckExec',
  'LookingForGroup',
  'LookingForGroupCondition',
  'LookingForGroupDetail',
  'LotteryDaily',
  'LotteryWeeklyInput',
  'LovmPaletteEdit',
  'LovmResult',
  'MJICraftMaterialConfirmation',
  'MJICraftScheduleSetting',
  'MJIMinionNoteBook',
  'MKSRecord',
  'MYCWarResultNotebook',
  'Macro',
  'MateriaAttachDialog',
  'MateriaRetrieveDialog',
  'MiragePrismExecute',
  'MiragePrismPrismBox',
  'MiragePrismPrismBoxCrystallize',
  'MiragePrismPrismSetConvert',
  'MiragePrismPrismSetConvertC',
  'MiragePrismRemove',
  'MobHunt',
  'NamePlate',
  'NeedGreed',
  'OperationGuide',
  'PointMenu',
  'PurifyResult',
  'PvPCharacter',
  'RaceChocoboResult',
  'RaidFinder',
  'RecipeMaterialList',
  'RecipeNote',
  'ReconstructionBox',
  'RelicNoteBook',
  'Repair',
  'Request',
  'RetainerItemTransferProgress',
  'RetainerList',
  'RetainerSell',
  'RetainerTaskAsk',
  'RetainerTaskList',
  'RetainerTaskResult',
  'SalvageAutoDialog',
  'SalvageDialog',
  'SalvageItemSelector',
  'SalvageResult',
  'SatisfactionList',
  'SatisfactionSupply',
  'ScreenFrame',
  'SelectOk',
  'SelectString',
  'SelectYesno',
  'Shop',
  'ShopCardDialog',
  'ShopExchangeItemDialog',
  'Social',
  'SpearFishing',
  'Talk',
  'TalkSubtitle',
  'Teleport',
  'TelepotTown',
  'Tooltip',
  'Trade',
  'TradeMultiple',
  'TripleTriad',
  'WKSReward',
  'WeeklyBingo',
  'WeeklyPuzzle',
  'XBMMonsterBookDetail',
  'XBMMonsterNotebook',
  '_ActionBar',
  '_ActionBar01',
  '_ActionBar02',
  '_ActionBar03',
  '_ActionBar04',
  '_ActionBar05',
  '_ActionBar06',
  '_ActionBar07',
  '_ActionBar08',
  '_ActionBar09',
  '_ActionCross',
  '_ActionDoubleCrossL',
  '_ActionDoubleCrossR',
  '_AllianceList1',
  '_AllianceList2',
  '_BagWidget',
  '_CastBar',
  '_CharaSelectWorldServer',
  '_ConfigPartyListRoleSort',
  '_DTR',
  '_EnemyList',
  '_Exp',
  '_HudLayoutScreen',
  '_HudLayoutWindow',
  '_Image',
  '_Image3',
  '_LimitBreak',
  '_MainCross',
  '_MiniTalk',
  '_Money',
  '_NaviMap',
  '_Notification',
  '_ParameterWidget',
  '_PartyList',
  '_ToDoList',
];
const addonNamesByHash = new Map<number, string>(
  addonSourceNames.map((name) => [crc32(`${name}_a`), name]),
);
