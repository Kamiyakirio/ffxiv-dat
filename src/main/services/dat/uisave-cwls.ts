import targetData from './native-save-data.json' with { type: 'json' };
const dataCenters: Record<string, string> = targetData.dataCenters;

// Static client evidence: CWLS writer 0x140807340, version getter
// 0x140825ca0, slot operations 0x140808c90/0x140808d00, and selection
// accessors 0x140808d80/0x140808dd0. Offsets refer to decoded bytes.
// Target SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Agent 0x1405937f5 toggles +0x5e8 bit0; 0x14098fa00 maps it to
// CommonList+0xc4 bit1. Sort 0x14095c3bb uses vtable 0x14219df28+0xd0
// (0x14095bbf0), comparing CharacterData.State & (1<<47), online first.
export function decodeNativeCwls(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 4 || data.length !== 1456) return null;

  const groups = Array.from({ length: 4 }, (_, index) => ({
    index,
    // 0x140809180 resolves WorldHelper.World.DataCenter against 101..104
    // when the target's WorldDCGroupType.Region is 5. Not a universal map.
    dataCenterIdForTargetClient: 101 + index,
    dataCenterNameForTargetClient: dataCenters[101 + index] ?? null,
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
    onlineMembersFirst: (data[1448] & 1) !== 0,
    unknownTailLowBits: data[1448] & 0xe,
    tailFlagsHighBits: data[1448] & 0xf0,
    tailReservedHex: data.subarray(1449).toString('hex'),
    note: '客户端读写实现确认四组各八个通讯贝槽与四个选中ID；四组在目标中国客户端对应数据中心101至104。尾部bit0控制成员列表在线优先排序；后续1152字节与低位bit1至3的用途仍未确认。以上来自静态指令，未观察游戏实际运行。',
    coverage: {
      structureComplete: true,
      knownFields: [
        'groups.index',
        'groups.dataCenterIdForTargetClient',
        'groups.slots.slot',
        'groups.slots.offset',
        'groups.slots.linkshellId',
        'groups.selectedLinkshellId',
        'onlineMembersFirst',
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
          field: 'unknownTailLowBits',
          reason:
            'bit0已证实为在线成员优先排序；bit1至3被序列化，但尚未找到对应的业务消费指令。',
          kind: 'meaning',
        },
        {
          field: 'headerHex / tailReservedHex / tailFlagsHighBits',
          reason:
            '八字节前导、七字节尾部和高四位保留原值；目标写入函数只保存旗标低四位，未将高位解释为业务开关。',
          kind: 'storage',
        },
      ],
    },
  };
}
