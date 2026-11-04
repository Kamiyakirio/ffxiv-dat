// Static client evidence: CWLS writer 0x140807340, version getter
// 0x140825ca0, slot operations 0x140808c90/0x140808d00, and selection
// accessors 0x140808d80/0x140808dd0. Offsets refer to decoded bytes.
export function decodeNativeCwls(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 4 || data.length !== 1456) return null;

  const groups = Array.from({ length: 4 }, (_, index) => ({
    index,
    slots: Array.from({ length: 8 }, (_, slot) => {
      const offset = 8 + index * 64 + slot * 8;
      return {
        slot,
        offset,
        linkshellId: data.readBigUInt64LE(offset).toString(),
      };
    }),
    selectedLinkshellId: data.readBigUInt64LE(264 + index * 8).toString(),
  }));

  return {
    headerHex: data.subarray(0, 8).toString('hex'),
    groups,
    unknownRemainderHex: data.subarray(296, 1448).toString('hex'),
    tailFlagsRaw: data[1448],
    tailFlagsLowNibble: data[1448] & 0xf,
    tailReservedHex: data.subarray(1449).toString('hex'),
    note: '客户端读写实现确认四组各八个通讯贝槽与四个选中ID。分组索引保留原值，不按地区名称解释；后续模块存储和尾部旗标的业务用途仍未确认。',
    coverage: {
      structureComplete: true,
      knownFields: [
        'groups.index',
        'groups.slots.slot',
        'groups.slots.offset',
        'groups.slots.linkshellId',
        'groups.selectedLinkshellId',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'unknownRemainderHex',
          reason:
            '解码偏移296至1448的1152字节由客户端完整复制保存，尚未核实其中的业务字段。',
          kind: 'meaning',
        },
        {
          field: 'tailFlagsRaw / tailFlagsLowNibble',
          reason:
            '客户端保存解码偏移1448的低四位；各位的具体业务含义尚未确认，高位原值也完整保留。',
          kind: 'meaning',
        },
        {
          field: 'headerHex / tailReservedHex',
          reason:
            '客户端写入八字节前导和七字节尾部保留区；完整原始存储已保留。',
          kind: 'storage',
        },
      ],
    },
  };
}
