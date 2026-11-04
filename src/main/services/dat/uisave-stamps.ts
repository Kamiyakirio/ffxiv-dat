// Static layout observations from ffxiv_dx11.exe SHA-256
// 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// GPSTAMP writer: 0x14080c120; reader: 0x14080c160;
// reset: 0x140823df0; record/name/order/text setters: 0x14080c2d0..0x14080c600.
// Addresses describe static instructions, not observed game execution.

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
    return {
      index,
      groupIndex: Math.floor(index / recordsPerGroup),
      slot: index % recordsPerGroup,
      offset,
      rawHex: record.toString('hex'),
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
        'groups.texts',
        'groups.order',
        'groups.orderedRecordIndices',
        'records.storageFields',
        'recordCount',
        'recordSize',
      ],
      candidateFields: [
        'groups.hasSavedDataCandidate',
        'records.floatCandidateAt16',
      ],
      unknownFields: [
        {
          field: 'records.storageFields',
          reason:
            '客户端写入指令确认字段宽度和偏移；各数值的类型、位置、颜色等业务名称尚未确认，原值完整保留。',
          kind: 'meaning',
        },
        {
          field: 'groups.savedSettingRaw / displayFlagRaw',
          reason:
            '已定位独立保存设置和显示状态的读写位置，但数值选项与界面含义尚未完整对应。',
          kind: 'meaning',
        },
        {
          field: 'reservedPrefixHex / reservedTailHex / records.reservedHex',
          reason: '整体序列化包含这些间隙；字段设置函数不写入它们。',
          kind: 'storage',
        },
      ],
    },
  };
}
