// Snapshot-derived layouts, checked against two character files and four
// character backups. No client executable/read-write implementation was
// available, so raw offsets and numeric views deliberately avoid field names.

function floatCandidate(bytes: Buffer, offset: number): number | null {
  const value = bytes.readFloatLE(offset);
  return Number.isFinite(value) ? value : null;
}

export function decodeRemainingUiSegment(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 21 && version === 103 && data.length === 65556) {
    const recordOffset = 328;
    const recordSize = 52;
    const recordCount = 1050;
    const indexOffset = recordOffset + recordSize * recordCount;
    const tailOffset = indexOffset + recordCount * 4;
    if (indexOffset !== 54928 || tailOffset !== 59128) return null;
    const records = Array.from({ length: recordCount }, (_, index) => {
      const offset = recordOffset + index * recordSize;
      const record = data.subarray(offset, offset + recordSize);
      if (record.length !== recordSize)
        throw new RangeError('Truncated GRPSTAMP record');
      return {
        index,
        offset,
        rawHex: record.toString('hex'),
        unknownU32: Array.from({ length: 13 }, (_, word) =>
          record.readUInt32LE(word * 4),
        ),
        floatCandidateAt16: floatCandidate(record, 16),
      };
    });
    return {
      layoutBasis:
        'candidate from six matching snapshot sizes and repeated records; client read/write code has not been observed',
      offsetBasis:
        'relative to this decoded segment; unknownU32 word n is at record.offset + n * 4',
      prefix: {
        offset: 0,
        byteLength: recordOffset,
        rawHex: data.subarray(0, recordOffset).toString('hex'),
      },
      recordOffset,
      recordSize,
      recordCount,
      records,
      trailingU32Array: {
        offset: indexOffset,
        count: recordCount,
        values: Array.from({ length: recordCount }, (_, index) =>
          data.readUInt32LE(indexOffset + index * 4),
        ),
        note: 'All six samples contain 0xFFFFFFFF at every entry. Index/ordering/sentinel semantics are not confirmed.',
      },
      suffix: {
        offset: tailOffset,
        byteLength: data.length - tailOffset,
        rawHex: data.subarray(tailOffset).toString('hex'),
      },
      completePartition:
        tailOffset + data.subarray(tailOffset).length === data.length,
      note: 'The observed record includes u32=3 at +0, u32=0xFFFFFFFF at +8, float32=1.0 at +16, and u32=28 at +40. These values do not establish type, colour, scale or font meanings.',
      coverage: {
        structureComplete: true,
        knownFields: [
          'recordCount',
          'recordSize',
          'records.rawHex',
          'records.unknownU32',
          'trailingU32Array.values',
        ],
        candidateFields: ['records.floatCandidateAt16'],
        unknownFields: [
          {
            field: 'records.unknownU32[0..12]',
            reason:
              '52字节重复记录的边界已核对，但13个数值的业务名称尚无源码定义或有效变化样本。',
            kind: 'meaning',
          },
          {
            field: 'trailingU32Array',
            reason: '全部样本均为FFFFFFFF，无法确定是索引、顺序还是哨兵。',
            kind: 'meaning',
          },
          {
            field: 'prefix',
            reason: '328字节前区在全部样本中全零，用途未知。',
            kind: 'storage',
          },
          {
            field: 'suffix',
            reason: '6428字节尾区在全部样本中全零，用途未知。',
            kind: 'storage',
          },
        ],
      },
    };
  }
  if (id === 7 && version === 400 && data.length === 66) {
    return {
      layoutBasis:
        'candidate numeric partition only; serialized header/entry semantics have not been established',
      prefix: {
        offset: 0,
        byteLength: 16,
        rawHex: data.subarray(0, 16).toString('hex'),
        unknownU16: Array.from({ length: 8 }, (_, index) =>
          data.readUInt16LE(index * 2),
        ),
        unknownU32: Array.from({ length: 4 }, (_, index) =>
          data.readUInt32LE(index * 4),
        ),
      },
      byteValues: Array.from({ length: 50 }, (_, index) => ({
        index,
        offset: 16 + index,
        value: data[16 + index],
      })),
      completePartition: true,
      note: 'In the six supplied snapshots the first 16 bytes match, changes occur only at offsets 16..37, and offsets 38..65 are zero. The 50 byte values are not asserted to be per-job entries or flags.',
      coverage: {
        structureComplete: true,
        knownFields: ['byteValues.offset', 'byteValues.value'],
        candidateFields: [],
        unknownFields: [
          {
            field: 'prefix',
            reason:
              '16字节前区可读出数值，但布局含义未在当前PvpSetModule定义。',
            kind: 'meaning',
          },
          {
            field: 'byteValues',
            reason:
              '当前源码旧PvP字段已注释，50个字节不能确认是技能、职业条目还是旗标。',
            kind: 'meaning',
          },
        ],
      },
    };
  }
  return null;
}
