// Serialized field streams verified against two character snapshots and four
// backups. Business meanings follow the pinned FFXIVClientStructs modules.
interface Field {
  offset: number;
  tag: string;
  bytes: Buffer;
}
interface UnknownField {
  field: string;
  reason: string;
  kind?: 'meaning' | 'storage' | 'reference';
}
function coverage(
  knownFields: string[],
  candidateFields: string[] = [],
  unknownFields: UnknownField[] = [],
) {
  return {
    structureComplete: true,
    knownFields,
    candidateFields,
    unknownFields,
  };
}
function fields(data: Buffer, tagLength = 1): Field[] {
  const result: Field[] = [];
  for (let offset = 0; offset < data.length;) {
    if (offset + tagLength + 2 > data.length)
      throw new RangeError('Truncated UISAVE tagged field header');
    const length = data.readUInt16LE(offset + tagLength);
    const end = offset + tagLength + 2 + length;
    if (end > data.length)
      throw new RangeError('Truncated UISAVE tagged field value');
    result.push({
      offset,
      tag: data.subarray(offset, offset + tagLength).toString('ascii'),
      bytes: data.subarray(offset + tagLength + 2, end),
    });
    offset = end;
  }
  return result;
}
function retained(list: Field[]) {
  return list.map((field) => ({
    offset: field.offset,
    tag: field.tag,
    length: field.bytes.length,
    valueHex: field.bytes.toString('hex'),
  }));
}
function unknowns(list: Field[]): UnknownField[] {
  return list.map((field) => ({
    field: `fields.${field.tag}@${field.offset}`,
    reason: '此标签的业务含义尚无已核对的源码或样本对应。',
    kind: 'meaning',
  }));
}
function fixed(
  field: Field | undefined,
  tag: string,
  size: number,
): Buffer | null {
  return field?.tag === tag && field.bytes.length === size ? field.bytes : null;
}
function cstring(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(0, end < 0 ? bytes.length : end),
  );
}
function bits(bytes: Buffer) {
  const ids: number[] = [];
  bytes.forEach((value, index) => {
    for (let bit = 0; bit < 8; bit++)
      if (value & (1 << bit)) ids.push(index * 8 + bit);
  });
  return ids;
}
function marked(bytes: Buffer, id: number) {
  if (id < 1 || id > bytes.length * 8) return null;
  return (bytes[(id - 1) >> 3] & (1 << ((id - 1) & 7))) !== 0;
}

export function decodeUiRecords(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  const versions: Record<number, number> = {
    16: 1,
    20: 1,
    38: 0,
    39: 0,
    40: 2,
    41: 1,
    43: 0,
    44: 1,
  };
  if (versions[id] !== version) return null;
  if (!data.length) return { empty: true, coverage: coverage(['empty']) };
  const list = fields(data, id === 41 ? 2 : 1);
  if (id === 16) {
    const flagField = list.find((field) => field.tag === 'F');
    if (!fixed(flagField, 'F', 4)) return null;
    const flags = flagField!.bytes.readUInt32LE();
    const extra = list.filter((field) => field !== flagField);
    return {
      flags,
      favoriteActions: extra.length ? null : [],
      fields: retained(list),
      coverage: coverage(
        ['flags'],
        [],
        [
          ...unknowns(extra),
          ...(flags
            ? [
                {
                  field: 'flags',
                  reason: 'CraftModule.Flags 的位含义未在源码中定义。',
                  kind: 'meaning' as const,
                },
              ]
            : []),
        ],
      ),
      note: extra.length
        ? '已读取制造收藏标志；额外的非空收藏字段保留原值。'
        : '此记录只含 F/u32 标志，没有保存制造技能收藏条目。',
    };
  }
  if (id === 39 || id === 40) {
    const n = fixed(list[0], 'N', 1);
    const values = list[1]?.tag === 'I' ? list[1].bytes : null;
    if (!n || !values || n[0] !== values.length) return null;
    const extra = list.slice(2);
    const entries = Array.from(values, (entryId, index) => ({
      index,
      id: entryId,
    }));
    return {
      count: n[0],
      seenIds: [...values],
      entries,
      fields: retained(list),
      coverage: coverage(['count', 'seenIds', 'entries'], [], unknowns(extra)),
      referenceSheet: id === 39 ? 'MKDLore' : 'MKDSupportJob',
    };
  }
  if (id === 20) {
    const seen = fixed(list[0], 'A', 13);
    const count = fixed(list[1], 'S', 1);
    if (!seen || !count || count[0] > 10) return null;
    let cursor = 2;
    const sets: Record<string, unknown>[] = [];
    const unknown: UnknownField[] = [];
    for (let index = 0; index < count[0]; index++) {
      const name = fixed(list[cursor++], 'n', 61);
      const length = fixed(list[cursor++], 'l', 1);
      if (!name || !length || length[0] > 100) return null;
      const itemFields: Field[] = [];
      while (cursor < list.length && list[cursor].tag !== 'n')
        itemFields.push(list[cursor++]);
      // Client writer 0x14080b878..0x14080b923 emits parallel u8 i/s
      // vectors. Reader 0x14080bb90..0x14080bbfd caps each vector at 100;
      // its consumer 0x140de74f2/0x140de755a uses MYCItem IDs/quantities.
      const itemIds = length[0] ? fixed(itemFields[0], 'i', length[0]) : null;
      const quantities = length[0]
        ? fixed(itemFields[1], 's', length[0])
        : null;
      if (length[0] && (!itemIds || !quantities)) return null;
      const items = Array.from({ length: length[0] }, (_, itemIndex) => ({
        index: itemIndex,
        mycItemId: itemIds![itemIndex],
        quantity: quantities![itemIndex],
      }));
      unknown.push(...unknowns(itemFields.slice(length[0] ? 2 : 0)));
      sets.push({
        index,
        name: cstring(name),
        numItems: length[0],
        items,
        itemFields: retained(itemFields),
      });
    }
    const extra = list.slice(cursor);
    unknown.push(...unknowns(extra));
    const setBits = bits(seen);
    return {
      setCount: count[0],
      sets,
      seenFlags: [...seen],
      setBitIndices: setBits,
      fields: retained(list),
      coverage: coverage(
        [
          'setCount',
          'sets.name',
          'sets.numItems',
          'sets.items.mycItemId',
          'sets.items.quantity',
        ],
        ['setBitIndices'],
        [
          ...unknown,
          {
            field: 'seenFlags',
            reason:
              '13 字节对应 MycItemModuleData.Bitflags；每一位是否为已读/解锁尚未在源码定义。',
            kind: 'meaning',
          },
        ],
      ),
    };
  }
  if (id === 41) {
    const expected: [string, number][] = [
      ['M0', 1],
      ['M1', 1],
      ['F0', 4],
      ['F1', 2],
      ['V0', 1],
      ['V1', 1],
    ];
    if (!expected.every(([tag, length], i) => fixed(list[i], tag, length)))
      return null;
    const panelCount = list[0].bytes[0];
    const slotCount = list[1].bytes[0];
    if (panelCount !== 4 || slotCount !== 25) return null;
    // Target SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
    // 0x140817b8e / 0x140817be9 serialize F0 from Settings+0x268 (u32),
    // F1 from Flags+0x26c (u16). Reader 0x140818122 / 0x1408181bc agrees.
    // 0x140c827fc closes on Settings bit0; 0x140c8340b maps bits1/2 to
    // mouse position / drag restrictions. 0x140c81722 checks Flags bit0
    // before showing help. V0/V1 map +0x26e/+0x26f (tint/open panel).
    const settings = list[2].bytes.readUInt32LE();
    const flags = list[3].bytes.readUInt16LE();
    const tint = list[4].bytes[0];
    const panelOpenIndex = list[5].bytes.readInt8();
    let cursor = 6;
    const panels: Record<string, unknown>[] = [];
    const unknown: UnknownField[] = [];
    for (let index = 0; index < panelCount; index++) {
      const p0 = fixed(list[cursor++], 'P0', 1);
      const p1 = fixed(list[cursor++], 'P1', 4);
      const types = fixed(list[cursor++], 'S0', slotCount);
      const ids = fixed(list[cursor++], 'S1', slotCount * 4);
      if (!p0 || !p1 || !types || !ids) return null;
      const unknownP0 = p0[0],
        unknownP1 = p1.readUInt32LE();
      panels.push({
        index,
        unknownP0, // Compatibility alias for iconCommandType.
        unknownP1, // Compatibility alias for iconCommandId.
        // Writer 0x140817d00/0x140817d53 and reader 0x1408183d5/
        // 0x140818470 map P0/P1 to +0x248/+0x24c at stride 8.
        // GetIconIdForSlot 0x1407cd490 reads this pair for QuickPanel,
        // then dispatches by HotbarSlotType and the source command ID.
        // Type zero selects default icon 0x2b7 + panel at 0x1407cd4de.
        iconCommandType: unknownP0,
        iconCommandId: unknownP1,
        usesDefaultIcon: unknownP0 === 0,
        defaultIconId: 0x2b7 + index,
        slots: Array.from({ length: slotCount }, (_, slot) => ({
          slot,
          type: types[slot],
          commandType: types[slot],
          commandId: ids.readUInt32LE(slot * 4),
        })),
      });
    }
    const extra = list.slice(cursor);
    unknown.push(...unknowns(extra));
    if (settings & ~7)
      unknown.push({
        field: 'settings',
        reason: `设置中存在未定义的位 0x${((settings & ~7) >>> 0).toString(16)}。`,
        kind: 'meaning',
      });
    if (flags & ~1)
      unknown.push({
        field: 'flags',
        reason: `标志中存在未定义的位 0x${(flags & ~1).toString(16)}。`,
        kind: 'meaning',
      });
    return {
      panelCount,
      slotCount,
      panels,
      settings,
      flags,
      tint,
      panelOpenIndex,
      openLastUsedPanel: panelOpenIndex < 0,
      closePanelUponExecutingActions: (settings & 1) !== 0,
      openPanelAtMouseCursorPosition: (settings & 2) !== 0,
      disableDraggingWithinCommandPanel: (settings & 4) !== 0,
      firstTimeHelpSeen: (flags & 1) !== 0,
      fields: retained(list),
      note: '静态原生读写及UI消费者确认：F0为设置，F1为帮助标志；P0/P1为面板图标来源的快捷栏命令类型/编号，0类型使用默认图标；unknownP0/P1仅为兼容别名。',
      coverage: coverage(
        [
          'panelCount',
          'slotCount',
          'panels.slots.commandType',
          'panels.slots.commandId',
          'panels.iconCommandType',
          'panels.iconCommandId',
          'panels.usesDefaultIcon',
          'panels.defaultIconId',
          'settings',
          'flags',
          'tint',
          'panelOpenIndex',
          'openLastUsedPanel',
          'closePanelUponExecutingActions',
          'openPanelAtMouseCursorPosition',
          'disableDraggingWithinCommandPanel',
          'firstTimeHelpSeen',
        ],
        [],
        unknown,
      ),
    };
  }
  if (id === 43) {
    const count = fixed(list[0], 'C', 1);
    const ids = list[1]?.tag === 'I' ? list[1].bytes : null;
    const sizes = list[2]?.tag === 'S' ? list[2].bytes : null;
    const seen = list[3]?.tag === 'N' ? list[3].bytes : null;
    const mirages = list[4]?.tag === 'M' ? list[4].bytes : null;
    if (
      !count ||
      !ids ||
      !sizes ||
      !seen ||
      !mirages ||
      count[0] !== ids.length ||
      sizes.length !== ids.length ||
      seen.length !== mirages.length
    )
      return null;
    const entries = Array.from(ids, (petId, index) => ({
      index,
      petId,
      size: sizes[index],
      sizeName: ['小型', '中型', '大型'][sizes[index]] ?? '未定义大小',
      isNewPetSeen: marked(seen, petId),
      mirage:
        marked(mirages, petId) === null ? null : marked(mirages, petId) ? 1 : 0,
      mirageName:
        marked(mirages, petId) === null
          ? '未记录'
          : marked(mirages, petId)
            ? '替代外形'
            : '普通外形',
    }));
    const unknown = unknowns(list.slice(5));
    for (const entry of entries) {
      if (entry.isNewPetSeen === null)
        unknown.push({
          field: `petSettings[${entry.index}].petId`,
          reason: '宠物 ID 超过已读/外形位图的范围。',
          kind: 'reference',
        });
      if (entry.size > 2)
        unknown.push({
          field: `petSettings[${entry.index}].size`,
          reason: '宠物大小超出源码 Small/Medium/Large 枚举。',
          kind: 'meaning',
        });
    }
    return {
      count: count[0],
      petSettings: entries,
      seenPetIds: bits(seen).map((bit) => bit + 1),
      alternativeMiragePetIds: bits(mirages).map((bit) => bit + 1),
      fields: retained(list),
      coverage: coverage(
        ['count', 'petSettings.petId', 'petSettings.size'],
        ['petSettings.isNewPetSeen', 'petSettings.mirage'],
        unknown,
      ),
      note: 'I/S 数组对应 XBMNoteModule.PetSetting 的 Id/Size；N/M 按 petId-1 编址，在有值样本中 N 置位恰好覆盖 I 中全部宠物。位图对 bool/mirage 的绑定有源码和样本支持，仍保留候选级别。',
    };
  }
  if (id === 38) {
    // The available snapshots contain no support-job settings. Preserve a
    // future nonempty layout rather than assigning unseen tags by intuition.
    return {
      fields: retained(list),
      coverage: coverage([], [], unknowns(list)),
    };
  }
  return { fields: retained(list), coverage: coverage([], [], unknowns(list)) };
}
