// Static layout observations from ffxiv_dx11.exe SHA-256
// 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// GPSTAMP writer: 0x14080c120; reader: 0x14080c160;
// reset: 0x140823df0; record/name/order/text setters: 0x14080c2d0..0x14080c600.
// Addresses describe static instructions, not observed game execution.
// Native consumer chain: 0x1413c5bb0 restores records to StampImage entries;
// 0x1413b80d0 applies them; 0x141452a30 multiplies normalized XY by viewport
// dimensions, 0x141453350 scales dimensions, and 0x1406604f0 converts degrees
// to AtkResNode.Rotation radians. 0x140660680 writes Color.A at +0x83.
// Text: 0x140663e00 writes FontSize (+0x165); 0x1413bc1b0/0x1413bc270
// resolve the saved color preset to UIColor foreground/edge entries.
// Win64 call at 0x1413c5962: r9 is finally entry+8 (0x1413c592f..5940),
// while entry+0x0c is saved as caller [rsp+0x20] (0x1413c5955..595d).
// After the setter's 0x28-byte prologue these are respectively record+0/u32
// and record+4/u8; the load copies at 0x1413c5d8e..5da4 agree exactly.
// Flip consumers 0x1413b7d40/0x1413b7de0 toggle image-node +0xcb bits 0/1
// and copy the new booleans into entry+0x3d/+0x3e (record+32/+33).

// Image texture branch 0x1413b81c7..0x1413b81e4 passes the current language
// only for stampType 2; 0/1/3 pass language 0. Their UI catalog names remain
// unknown. Group setting: 0x1413c582d -> 0x14080c5b0 stores UI+0x29314;
// 0x1413c6457..64c9 restores it and emits callback 145. UI initializer reads
// AtkValue[19] (0x1413c0160), event 19 updates it (0x1413bea0f), but this
// transfer alone does not identify the control without its matching ULD.

const byteLength = 65556;
const groupCount = 5;
const recordsPerGroup = 210;
const recordOffset = 328;
const recordSize = 52;
const indexOffset = 54928;
const settingsOffset = 59128;
const textOffset = 59148;
const flagsOffset = 65548;

function string(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
}

function finiteFloat(bytes: Buffer, offset: number): number | null {
  const value = bytes.readFloatLE(offset);
  return Number.isFinite(value) ? value : null;
}

/** Decode the unmasked v103 GPSTAMP structure; retain unexplained values. */
export function decodeNativeGroupStamps(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 103 || data.length !== byteLength) return null;

  const recordCount = groupCount * recordsPerGroup;
  const records = Array.from({ length: recordCount }, (_, index) => {
    const offset = recordOffset + index * recordSize;
    const record = data.subarray(offset, offset + recordSize);
    const stampType = record.readUInt32LE();
    const catalogEntryIdRaw = record.readUInt32LE(8);
    return {
      index,
      groupIndex: Math.floor(index / recordsPerGroup),
      slot: index % recordsPerGroup,
      offset,
      rawHex: record.toString('hex'),
      stampType,
      stampTypeName: stampType === 4 ? '文字' : stampType < 4 ? '图片' : null,
      enabledRaw: record[4],
      enabled: record[4] !== 0,
      // 0x1413c5e57..5ee1 matches this against the first column of the UI's
      // 1075-entry catalog and iconId against its second column. It is not
      // asserted to be an Excel sheet row or an Item ID.
      catalogEntryIdRaw,
      catalogEntryId:
        catalogEntryIdRaw === 0xffffffff ? null : catalogEntryIdRaw,
      drawPriority: record.readUInt16LE(12),
      alpha: record[14],
      scale: finiteFloat(record, 16),
      positionNormalized: {
        x: finiteFloat(record, 20),
        y: finiteFloat(record, 24),
      },
      rotationDegrees: finiteFloat(record, 28),
      flipHorizontallyRaw: record[32],
      flipHorizontally: record[32] <= 1 ? record[32] !== 0 : null,
      flipVerticallyRaw: record[33],
      flipVertically: record[33] <= 1 ? record[33] !== 0 : null,
      iconId:
        record.readUInt32LE(36) === 0xffffffff ? null : record.readUInt32LE(36),
      fontSize: record.readUInt32LE(40),
      textColorPresetId: record.readUInt32LE(44),
      textAlignmentRaw: record.readUInt32LE(48),
      // 0x1414532c0: left uses zero X origin, center the half-width origin,
      // right twice that origin (constant 2.0 at 0x14211bc50).
      textAlignment:
        ['left', 'center', 'right'][record.readUInt32LE(48)] ?? null,
      unknownU32: Array.from({ length: 13 }, (_, word) =>
        record.readUInt32LE(word * 4),
      ),
      floatCandidateAt16: finiteFloat(record, 16),
      // These widths come from the record setter. Names do not claim purpose.
      storageFields: [
        [0, 4],
        [4, 1],
        [8, 4],
        [12, 2],
        [14, 1],
        [16, 4],
        [20, 4],
        [24, 4],
        [28, 4],
        [32, 1],
        [33, 1],
        [36, 4],
        [40, 4],
        [44, 4],
        [48, 4],
      ].map(([relativeOffset, width]) => ({
        offset: relativeOffset,
        width,
        value: record.readUIntLE(relativeOffset, width),
      })),
      reservedHex: {
        at5: record.subarray(5, 8).toString('hex'),
        at15: record.subarray(15, 16).toString('hex'),
        at34: record.subarray(34, 36).toString('hex'),
      },
    };
  });
  const indexValues = Array.from({ length: recordCount }, (_, index) =>
    data.readUInt32LE(indexOffset + index * 4),
  );
  const groups = Array.from({ length: groupCount }, (_, index) => {
    const nameOffset = 5 + index * 64;
    const order = indexValues.slice(
      index * recordsPerGroup,
      (index + 1) * recordsPerGroup,
    );
    return {
      index,
      savedStateRaw: data[index],
      // 0x1413c5a9e..0x1413c5aaa sets this after saving; the load path
      // 0x1413c5440 tests it before offering the stored group.
      hasSavedData: data[index] !== 0,
      hasSavedDataCandidate: data[index] !== 0,
      nameOffset,
      name: string(data.subarray(nameOffset, nameOffset + 64)),
      nameRawHex: data.subarray(nameOffset, nameOffset + 64).toString('hex'),
      recordOffset: recordOffset + index * recordsPerGroup * recordSize,
      recordCount: recordsPerGroup,
      orderOffset: indexOffset + index * recordsPerGroup * 4,
      order,
      // The setter copies an ordered vector and pads unused slots with -1.
      orderedRecordIndices: order.filter((value) => value !== 0xffffffff),
      savedSettingOffset: settingsOffset + index * 4,
      savedSettingRaw: data.readUInt32LE(settingsOffset + index * 4),
      texts: Array.from({ length: 10 }, (_, slot) => {
        const offset = textOffset + (index * 10 + slot) * 128;
        const bytes = data.subarray(offset, offset + 128);
        return {
          slot,
          offset,
          text: string(bytes),
          rawHex: bytes.toString('hex'),
        };
      }),
      displayFlagOffset: flagsOffset + index,
      displayFlagRaw: data[flagsOffset + index],
      // 0x1413c5d31 -> StampImage+0x123c2 -> 0x1413baa50 slot 1.
      timeFormatAddonId: data[flagsOffset + index] === 0 ? 14061 : 14062,
      // Public Chinese Addon 14061/14062 corroborates 24-hour/12-hour text.
      // The target's matching SqPack is unavailable in this pass.
      clockFormatCandidate:
        data[flagsOffset + index] === 0 ? '24-hour' : '12-hour',
    };
  });

  return {
    layoutBasis:
      'client v103 writer copies 65556 bytes; reset and setters establish five groups of 210 records, order arrays, names and text slots',
    offsetBasis: 'relative to this decoded segment',
    groupCount,
    recordsPerGroup,
    groups,
    recordOffset,
    recordSize,
    recordCount,
    records,
    // Legacy numeric and byte views remain available for existing consumers.
    prefix: {
      offset: 0,
      byteLength: recordOffset,
      rawHex: data.subarray(0, recordOffset).toString('hex'),
    },
    trailingU32Array: {
      offset: indexOffset,
      count: recordCount,
      values: indexValues,
      note: 'Five ordered vectors of 210 entries; 0xFFFFFFFF marks unused slots.',
    },
    suffix: {
      offset: settingsOffset,
      byteLength: byteLength - settingsOffset,
      rawHex: data.subarray(settingsOffset).toString('hex'),
    },
    reservedPrefixHex: data.subarray(325, 328).toString('hex'),
    reservedTailHex: data.subarray(65553, 65556).toString('hex'),
    completePartition: true,
    coverage: {
      structureComplete: true,
      knownFields: [
        'groups.name',
        'groups.hasSavedData',
        'groups.texts',
        'groups.order',
        'groups.orderedRecordIndices',
        'records.storageFields',
        'records.stampType',
        'records.stampTypeName (image/text branch)',
        'records.enabled',
        'records.catalogEntryId',
        'records.drawPriority',
        'records.alpha',
        'records.scale',
        'records.positionNormalized',
        'records.rotationDegrees',
        'records.flipHorizontally',
        'records.flipVertically',
        'records.iconId',
        'records.fontSize',
        'records.textColorPresetId',
        'records.textAlignment',
        'groups.timeFormatAddonId',
        'recordCount',
        'recordSize',
      ],
      candidateFields: ['groups.clockFormatCandidate'],
      unknownFields: [
        {
          field: 'records.stampType image subtypes',
          reason:
            '类型4进入文字处理，0/1/2/3进入图片处理已由调用分支确认；四种图片子类的精确业务名称仍未逐一核实。目录条目编号与图标编号的双向关联已确认，不将其误作物品编号。',
          kind: 'meaning',
        },
        {
          field: 'groups.savedSettingRaw',
          reason:
            '已定位独立保存设置到界面状态+0x29314，但这个数值选项的业务名称仍未确认。',
          kind: 'meaning',
        },
        {
          field: 'groups.clockFormatCandidate',
          reason:
            '本客户端调用链确认旗标选择Addon 14061/14062；公共中文数据表对应24/12小时制。目标同版本资源当前缺失，文字含义保留候选级别。',
          kind: 'reference',
        },
        ...(records.some((record) => record.textAlignment === null)
          ? [
              {
                field: 'records.textAlignmentRaw',
                reason:
                  '出现0/1/2之外的水平锚点值，保留原值，不套用左/中/右枚举。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        ...(records.some(
          (record) =>
            record.flipHorizontally === null || record.flipVertically === null,
        )
          ? [
              {
                field: 'records.flipHorizontallyRaw / flipVerticallyRaw',
                reason:
                  '出现UI切换函数仅写入的0/1之外的镜像值，原值保留，不推断额外旗标位。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        ...(records.some(
          (record) =>
            record.scale === null ||
            record.positionNormalized.x === null ||
            record.positionNormalized.y === null ||
            record.rotationDegrees === null,
        )
          ? [
              {
                field: 'records transform floats',
                reason:
                  '部分变换包含非有限浮点值；对应数值以null呈现，原始IEEE位保持在rawHex/storageFields中。',
                kind: 'storage' as const,
              },
            ]
          : []),
        {
          field: 'reservedPrefixHex / reservedTailHex / records.reservedHex',
          reason: '整体序列化包含这些间隙；字段设置函数不写入它们。',
          kind: 'storage',
        },
      ],
    },
  };
}
