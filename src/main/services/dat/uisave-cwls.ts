import targetData from './native-save-data.json' with { type: 'json' };
const dataCenters: Record<string, string> = targetData.dataCenters;

// Static client evidence: CWLS writer 0x140807340, version getter
// 0x140825ca0, slot operations 0x140808c90/0x140808d00, and selection
// accessors 0x140808d80/0x140808dd0. Offsets refer to decoded bytes.
// Target SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Writer 0x140807390..0x140807697 copies FIVE 0x120-byte banks from
// module+0x48; the first bank contains 4*8 IDs followed by 4 selections.
// Constructor/reset 0x140808f50 and 0x140808e70 clear the same five banks.
// CN lookup 0x140809180 returns only 0..3, so its slot/selection consumers
// address only the first bank. Extra bank/DC meanings remain unassigned.
// Agent 0x1405937f5 toggles +0x5e8 bit0; 0x14098fa00 maps it to
// CommonList+0xc4 bit1. Sort 0x14095c3bb uses vtable 0x14219df28+0xd0
// (0x14095bbf0), comparing CharacterData.State & (1<<47), online first.
export function decodeNativeCwls(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 4 || data.length !== 1456) return null;

  const storageBanks = Array.from({ length: 5 }, (_, bankIndex) => ({
    index: bankIndex,
    offset: 8 + bankIndex * 288,
    usedByTargetCnLookup: bankIndex === 0,
    allZero: data
      .subarray(8 + bankIndex * 288, 8 + (bankIndex + 1) * 288)
      .every((byte) => byte === 0),
    groups: Array.from({ length: 4 }, (_, index) => ({
      index,
      // Only the first bank has a verified target CN data-center mapping.
      dataCenterIdForTargetClient: bankIndex === 0 ? 101 + index : null,
      dataCenterNameForTargetClient:
        bankIndex === 0 ? (dataCenters[101 + index] ?? null) : null,
      slots: Array.from({ length: 8 }, (_, slot) => {
        const offset = 8 + bankIndex * 288 + index * 64 + slot * 8;
        return {
          slot,
          offset,
          linkshellId: data.readBigUInt64LE(offset).toString(),
        };
      }),
      selectedLinkshellId: data
        .readBigUInt64LE(264 + bankIndex * 288 + index * 8)
        .toString(),
    })),
  }));
  const groups = storageBanks[0].groups;

  return {
    headerHex: data.subarray(0, 8).toString('hex'),
    groups,
    storageBanks,
    additionalStorageBanks: storageBanks.slice(1),
    unknownRemainderHex: data.subarray(296, 1448).toString('hex'),
    tailFlagsRaw: data[1448],
    tailFlagsLowNibble: data[1448] & 0xf,
    onlineMembersFirst: (data[1448] & 1) !== 0,
    unknownTailLowBits: data[1448] & 0xe,
    tailFlagsHighBits: data[1448] & 0xf0,
    tailReservedHex: data.subarray(1449).toString('hex'),
    note: '原生读写确认5个各288字节的重复存储组，每组含四组各八个ID及四个选中ID。目标中国客户端的通讯贝查询只访问第一个存储组，对应数据中心101至104；其余组的业务/地区映射不做推测。尾部bit0控制在线成员优先排序，低位bit1至3的业务用途仍未确认。以上为静态证据，未观察游戏运行。',
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
        'storageBanks.index / offset / groups / allZero',
        'additionalStorageBanks (4 x 288-byte native storage layout)',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'unknownRemainderHex',
          reason:
            '后续1152字节已展开为4个重复288字节存储组。目标CN查询仅消费首组；额外组的业务/地区对应未确认，未擅自套用首组数据中心名称。',
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
