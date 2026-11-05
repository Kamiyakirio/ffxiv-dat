// Static target: ffxiv_dx11.exe SHA-256
// 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// RTNR writer 0x14080d7a0: 1376 bytes at module+0x48; reader 0x14080d7e0.
// Record lookup 0x14080dc30, comment getter 0x14080dc80 and setter
// 0x14080dce0 confirm the u64 ID / 91-byte string binding at stride 136.
// 0x14080ddb0 clears record+0x64 u16[10] and +0x78 u8[10]; 0x14080de30
// inserts/deduplicates/reorders paired entries. They are NOT padding.
// Retainer-task UI consumers: 0x140cc48b0, 0x140cc6790, 0x140cc88cf.
// Lists match these u16 values to rows loaded from native sheet 0x129.
// 0x140cc8951 inserts flag=1 and then emits LogMessage 5796 (pinned to
// history); 0x140cc8a5e removes it and emits 5797 (removed from history).
// 0x140cc6813 records ordinary selections with flag=0 unless already pinned.
// Text corroboration: thewakingsands/ffxiv-datamining-cn LogMessage.csv,
// revision 2c6741cffe3cfe70f093c54c463791364e515d8d, rows 5795..5797.
// This public text reference is not a claim of target-matching SqPack input.

function string(data: Buffer): string {
  const end = data.indexOf(0);
  return data.subarray(0, end < 0 ? data.length : end).toString('utf8');
}

/** Decode the unmasked v102 RTNR record including its two paired arrays. */
export function decodeNativeRetainerComments(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 102 || data.length !== 1376) return null;
  const retainers = Array.from({ length: 10 }, (_, index) => {
    const offset = 8 + index * 136;
    return {
      index,
      offset,
      id: data.readBigUInt64LE(offset).toString(),
      comment: string(data.subarray(offset + 8, offset + 99)),
      commentRawHex: data.subarray(offset + 8, offset + 99).toString('hex'),
      alignmentByteRaw: data[offset + 99],
      savedTaskEntries: Array.from({ length: 10 }, (_, slot) => ({
        slot,
        taskIdRaw: data.readUInt16LE(offset + 100 + slot * 2),
        flagRaw: data[offset + 120 + slot],
        // Native setters write 0/1. Retain noncanonical raw bytes rather
        // than infer additional flag bits from the getter's !=0 test.
        isPinned:
          data[offset + 120 + slot] <= 1
            ? data[offset + 120 + slot] === 1
            : null,
      })),
      reservedTailHex: data
        .subarray(offset + 130, offset + 136)
        .toString('hex'),
      rawHex: data.subarray(offset, offset + 136).toString('hex'),
      // Compatibility storage view, now partitioned above rather than lost.
      unusedRecordBytesHex: data
        .subarray(offset + 99, offset + 136)
        .toString('hex'),
    };
  });
  return {
    layoutBasis:
      'target v102 native writer/reader, ID lookup/comment getter and paired-array setters',
    offsetBasis: 'relative to this decoded segment',
    headerHex: data.subarray(0, 8).toString('hex'),
    retainers,
    retainersCandidate: retainers,
    trailerHex: data.subarray(1368).toString('hex'),
    coverage: {
      structureComplete: true,
      knownFields: [
        'retainers.id',
        'retainers.comment',
        'retainers.savedTaskEntries.taskIdRaw',
        'retainers.savedTaskEntries.flagRaw',
        'retainers.savedTaskEntries.isPinned',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'retainers.savedTaskEntries.taskIdRaw',
          reason:
            '已确认雇员任务历史中的十项u16编号及配套固定状态；任务表编号关联尚待核实。固定状态由原生插入/移除调用链与公开LogMessage 5796/5797文字交叉确认，0为未固定、1为固定。',
          kind: 'meaning',
        },
        ...(retainers.some((retainer) =>
          retainer.savedTaskEntries.some((entry) => entry.isPinned === null),
        )
          ? [
              {
                field: 'retainers.savedTaskEntries.flagRaw',
                reason:
                  '出现原生设置函数仅写入的0/1之外的固定状态，保留原值，isPinned置为空值。',
                kind: 'meaning',
              },
            ]
          : []),
        {
          field: 'headerHex / alignmentByteRaw / reservedTailHex / trailerHex',
          reason:
            '保留块头、每条备注后1字节、记录尾6字节及块尾原值，不为未确认字节附会业务意义。',
          kind: 'meaning',
        },
      ],
    },
  };
}
