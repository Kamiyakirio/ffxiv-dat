import catalog from './game-names.json' with { type: 'json' };

// Name-only extraction of public Chinese game sheets; revision is pinned in the
// catalog. No network requests or user configuration uploads occur at runtime.
const sheets: Record<string, Record<string, string>> = catalog.sheets;
export const nameCatalog = catalog.source;

export function equipmentSlotName(slot: string): string {
  const names: Record<string, string> = {
    MainHand: '主手',
    OffHand: '副手',
    Head: '头部',
    Body: '身体',
    Hands: '手部',
    Belt: '腰部（旧槽位）',
    Legs: '腿部',
    Feet: '脚部',
    Ears: '耳饰',
    Neck: '项链',
    Wrists: '手镯',
    RingRight: '右戒指',
    RingLeft: '左戒指',
    SoulStone: '灵魂水晶',
  };
  return names[slot] ?? slot;
}

export function gameName(sheet: string, id: number | string): string | null {
  return sheets[sheet]?.[String(id)] || null;
}

export function searchGameNames(sheet: string, query: string) {
  if (
    typeof sheet !== 'string' ||
    typeof query !== 'string' ||
    query.length > 100
  )
    return [];
  const search = query.trim().toLowerCase();
  if (!search) return [];
  return Object.entries(sheets[sheet] ?? {})
    .filter(
      ([id, name]) =>
        /^\d+$/.test(id) &&
        (id === search || name.toLowerCase().includes(search)),
    )
    .slice(0, 30)
    .map(([id, label]) => ({ value: Number(id), label }));
}

function itemIdentity(id: number) {
  const hq = id >= 1000000 && id < 2000000;
  const collectible = id >= 500000 && id < 1000000;
  const base = hq ? id - 1000000 : collectible ? id - 500000 : id;
  return { base, hq, collectible };
}

export function itemName(id: number): string {
  if (id === 0) return '空位';
  const { base, hq, collectible } = itemIdentity(id);
  const name = gameName('Item', base);
  return `${name ?? `未收录物品（ID ${base}）`}${hq ? ' · HQ' : collectible ? ' · 收藏品' : ''}`;
}

export const hotbarTypes = [
  'Empty',
  'Action',
  'Item',
  'InventoryItem',
  'EventItem',
  'KeyItem',
  'Emote',
  'Macro',
  'Marker',
  'CraftAction',
  'GeneralAction',
  'BuddyAction',
  'MainCommand',
  'Companion',
  'Crystal',
  'GearSet',
  'PetAction',
  'Mount',
  'FieldMarker',
  'ClassJob',
  'Recipe',
  'ChocoboRaceAbility',
  'ChocoboRaceItem',
  'Unknown23',
  'ExtraCommand',
  'PvPQuickChat',
  'PvPCombo',
  'BgcArmyAction',
  'Unknown28',
  'PerformanceInstrument',
  'McGuffin',
  'Ornament',
  'LostFindsItem',
  'Glasses',
  'PhantomAction',
  'QuickPanel',
];

const typeLabels: Record<string, string> = {
  Empty: '空槽',
  Action: '技能',
  Item: '物品',
  InventoryItem: '背包槽引用',
  EventItem: '任务物品',
  KeyItem: '任务物品槽引用',
  Emote: '情感动作',
  Macro: '宏',
  Marker: '目标标记',
  CraftAction: '制作技能',
  GeneralAction: '通用技能',
  BuddyAction: '搭档指令',
  MainCommand: '系统指令',
  Companion: '宠物',
  Crystal: '水晶槽引用',
  GearSet: '装备套装',
  PetAction: '召唤兽指令',
  Mount: '坐骑',
  FieldMarker: '场景标记',
  ClassJob: '职业',
  Recipe: '制作配方',
  ChocoboRaceAbility: '竞赛陆行鸟能力',
  ChocoboRaceItem: '竞赛道具',
  ExtraCommand: '额外指令',
  PvPQuickChat: 'PvP 快捷发言',
  PvPCombo: 'PvP 连击',
  BgcArmyAction: '冒险者分队指令',
  PerformanceInstrument: '乐器演奏',
  McGuffin: '特殊指令',
  Ornament: '时尚配饰',
  LostFindsItem: '失传技能',
  Glasses: '眼镜',
  PhantomAction: '辅助技能',
  QuickPanel: '快捷面板',
};
const directSheets = new Set([
  'Action',
  'Item',
  'EventItem',
  'Emote',
  'Marker',
  'CraftAction',
  'GeneralAction',
  'BuddyAction',
  'MainCommand',
  'Companion',
  'PetAction',
  'Mount',
  'FieldMarker',
  'ClassJob',
  'ExtraCommand',
  'Ornament',
  'McGuffin',
  'Glasses',
  'Recipe',
]);

export const hotbarEditChoices = hotbarTypes.map((type, value) => ({
  value,
  label: typeLabels[type] ?? type,
}));
export const hotbarReferenceSheets: Record<string, string> = Object.fromEntries(
  hotbarTypes.flatMap((type, value) => {
    const sheet =
      type === 'LostFindsItem'
        ? 'MYCTemporaryItem'
        : type === 'PvPCombo'
          ? 'ActionComboRoute'
          : type === 'PvPQuickChat'
            ? 'QuickChat'
            : directSheets.has(type)
              ? type
              : null;
    return sheet ? [[String(value), sheet]] : [];
  }),
);

export function describeHotbarCommand(type: string, id: number) {
  const commandTypeLabel = typeLabels[type] ?? `未确认类型（${type}）`;
  const sheet =
    type === 'LostFindsItem'
      ? 'MYCTemporaryItem'
      : type === 'PvPCombo'
        ? 'ActionComboRoute'
        : directSheets.has(type)
          ? type
          : type === 'PvPQuickChat'
            ? 'QuickChat'
            : null;
  const commandName =
    type === 'Empty'
      ? '空槽'
      : type === 'Item'
        ? gameName('Item', itemIdentity(id).base)
          ? itemName(id)
          : null
        : sheet
          ? gameName(sheet, id)
          : null;
  return {
    commandTypeLabel,
    commandName,
    nameSource:
      sheet && commandName
        ? `${sheet}#${type === 'Item' ? itemIdentity(id).base : id}`
        : null,
  };
}

type Row = Record<string, unknown>;
export function linkHotbarReferences(
  slots: Row[],
  macros: Row[],
  gearsets: Row[],
  sharedMacros: Row[] = [],
): void {
  for (const slot of slots) {
    if (
      slot.commandTypeName === 'Macro' &&
      typeof slot.commandId === 'number' &&
      Number.isInteger(slot.commandId) &&
      slot.commandId >= 0 &&
      slot.commandId <= 0x163
    ) {
      // Target writer 0x1407d90cd / reader 0x1407d8b57 copy CommandId
      // unchanged. Icon consumer 0x1407cd5d2..cd617 splits low-byte index
      // and high-byte bank, accepting two banks and indices below 100.
      const bank = slot.commandId >>> 8,
        index = slot.commandId & 255;
      const source = bank === 0 ? macros : sharedMacros;
      const record =
        index < 100 ? source.find((macro) => macro.index === index) : undefined;
      if (record) {
        slot.commandName =
          record.name ||
          `未命名${bank ? '公用' : '个人'}宏（槽位 ${index + 1}）`;
        slot.nameSource = `${bank ? 'MACROSYS' : 'MACRO'}.DAT#${index}`;
      }
    }
    if (slot.commandTypeName === 'GearSet') {
      const record = gearsets.find(
        (gearset) =>
          gearset.id === slot.commandId &&
          gearset.exists &&
          Number(gearset.recordIndex) < 100,
      );
      if (record) {
        slot.commandName =
          record.name || `未命名套装（槽位 ${slot.commandId}）`;
        slot.nameSource = `GEARSET.DAT#${slot.commandId}`;
      }
    }
  }
}

export function enrichDecodedData(data: Row, filename: string): void {
  const references: Record<string, [string, string]> = {
    bannerBg: ['BannerBg', 'backgroundName'],
    bannerFrame: ['BannerFrame', 'frameName'],
    bannerDecoration: ['BannerDecoration', 'decorationName'],
    bannerTimeline: ['BannerTimeline', 'timelineName'],
    expression: ['BannerFacial', 'expressionName'],
    recipeId: ['Recipe', 'recipeName'],
    aetheryteId: ['Aetheryte', 'destinationName'],
    contentFinderConditionId: ['ContentFinderCondition', 'dutyName'],
    petId: ['XBMPet', 'petName'],
    mycItemId: ['MYCTemporaryItem', 'mycItemName'],
  };
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const record = value as Row;
    if (typeof record.objectType === 'number')
      record.objectName = strategyObjectName(record.objectType);
    if (Array.isArray(record.rgba) && record.rgba.length === 4) {
      record.colorHex =
        '#' +
        record.rgba
          .slice(0, 3)
          .map((v: number) => v.toString(16).padStart(2, '0'))
          .join('');
      record.transparencyPercent = record.rgba[3];
    }
    const children = Object.entries(record).filter(
      ([key]) =>
        ![
          'coverage',
          'fields',
          'referenceSheets',
          'rawHex',
          'decodedHex',
        ].includes(key),
    );
    for (const [key, [sheet, label]] of Object.entries(references)) {
      if (typeof record[key] === 'number')
        record[label] =
          gameName(sheet, record[key]) ??
          (record[key] === 0 ? '未指定' : `名称未收录（${record[key]}）`);
    }
    if (
      typeof record.bannerTimelineName === 'string' &&
      record.bannerTimelineName
    )
      record.timelineName = record.bannerTimelineName;
    if (
      typeof record.commandType === 'number' &&
      typeof record.commandId === 'number' &&
      !record.commandTypeName
    ) {
      record.commandTypeName = hotbarTypes[record.commandType] ?? 'Unknown';
      Object.assign(
        record,
        describeHotbarCommand(String(record.commandTypeName), record.commandId),
      );
    }
    if (
      typeof record.commandType === 'number' &&
      typeof record.commandId === 'number'
    ) {
      record.typeName = record.commandTypeLabel;
    }
    for (const [, child] of children) walk(child);
  };
  walk(data);
  if (filename.toUpperCase() === 'UISAVE.DAT' && Array.isArray(data.segments)) {
    for (const segment of data.segments) {
      const values = segment.data as Row;
      if ([39, 40].includes(segment.id) && Array.isArray(values.entries)) {
        const sheet = segment.id === 39 ? 'MKDLore' : 'MKDSupportJob';
        for (const entry of values.entries)
          entry.name = gameName(sheet, entry.id) ?? `名称未收录（${entry.id}）`;
      }
      if (Array.isArray(values.unseenFishIds))
        values.fishEntries = values.unseenFishIds
          .filter((id) => id !== 0)
          .map((id, index) => ({
            index,
            id,
            name: gameName('FishParameter', id) ?? `鱼种 ${id}`,
          }));
      if (Array.isArray(values.achievementWatchlist))
        values.achievements = values.achievementWatchlist
          .filter((id) => id !== 0)
          .map((id) => ({
            id,
            name: gameName('Achievement', id) ?? `成就 ${id}`,
          }));
      if (Array.isArray(values.glassesIdListCandidate))
        values.glasses = values.glassesIdListCandidate
          .filter((id) => id !== 0)
          .map((id) => ({ id, name: gameName('Glasses', id) ?? `眼镜 ${id}` }));
      if (segment.id === 36 && Array.isArray(values.presets))
        for (const preset of values.presets)
          if (Array.isArray(preset.objectIds))
            preset.objectNames = preset.objectIds.map((id: number) =>
              id
                ? (gameName('MJICraftworksObject', id) ?? `工坊物品 ${id}`)
                : '空位',
            );
    }
  }
}

export function strategyObjectName(type: number): string {
  // ObjectType names: pinned TofuModule.Data.cs and xivdev stgy.hexpat.
  const shapes: Record<number, string> = {
    0: '无对象',
    1: '白色圆形',
    2: '白色圆形（网格）',
    3: '灰色圆形',
    4: '棋盘圆形',
    5: '白色方形',
    6: '白色方形（网格）',
    7: '灰色方形',
    8: '棋盘方形',
    9: '圆形范围',
    10: '扇形范围',
    11: '直线范围',
    12: '连线',
    13: '视线攻击',
    14: '分摊',
    15: '直线分摊',
    16: '距离衰减',
    17: '环形范围',
    60: '小型敌人',
    61: '小型敌人 2',
    62: '中型敌人',
    63: '中型敌人 2',
    64: '大型敌人',
    75: '方块标记',
    76: '圆圈标记',
    77: '十字标记',
    78: '三角标记',
    87: '圆圈符号',
    88: '叉号',
    89: '三角符号',
    90: '方形符号',
    94: '上箭头',
    100: '文本',
    103: '旋转',
    104: '保留旋转箭头',
    105: '组合',
    106: '连续分摊',
    107: '点名距离衰减',
    108: '单体强攻击',
    109: '放射击退',
    110: '直线击退',
    111: '踩塔',
    112: '目标指示器',
    113: '增益效果',
    114: '减益效果',
    118: '近战职业',
    119: '远程职业',
    120: '远程物理职业',
    121: '远程魔法职业',
    122: '纯治疗职业',
    123: '护盾治疗职业',
    124: '灰色圆形',
    125: '灰色方形',
    126: '移动圆形范围',
    127: '单人范围',
    128: '双人范围',
    129: '三人范围',
    130: '四人范围',
    131: '红色锁定标记',
    132: '蓝色锁定标记',
    133: '紫色锁定标记',
    134: '绿色锁定标记',
    135: '高亮圆圈',
    136: '高亮叉号',
    137: '高亮方形',
    138: '高亮三角',
    139: '顺时针旋转',
    140: '逆时针旋转',
  };
  const jobs: Record<number, number> = {
    18: 1,
    19: 2,
    20: 3,
    21: 4,
    22: 5,
    23: 6,
    24: 7,
    25: 26,
    26: 29,
    27: 19,
    28: 20,
    29: 21,
    30: 22,
    31: 23,
    32: 24,
    33: 25,
    34: 27,
    35: 28,
    36: 30,
    37: 31,
    38: 32,
    39: 33,
    40: 34,
    41: 35,
    42: 36,
    43: 37,
    44: 38,
    45: 39,
    46: 40,
    101: 41,
    102: 42,
  };
  if (jobs[type])
    return gameName('ClassJob', jobs[type]) ?? `职业 ${jobs[type]}`;
  if (type >= 47 && type <= 49)
    return `防护职业${type === 47 ? '' : type - 47}`;
  if (type >= 50 && type <= 52)
    return `治疗职业${type === 50 ? '' : type - 50}`;
  if (type >= 53 && type <= 59)
    return `进攻职业${type === 53 ? '' : type - 53}`;
  if (type >= 65 && type <= 69) return `攻击标记 ${type - 64}`;
  if (type >= 115 && type <= 117) return `攻击标记 ${type - 109}`;
  if (type >= 70 && type <= 72) return `止步标记 ${type - 69}`;
  if (type === 73 || type === 74) return `禁止标记 ${type - 72}`;
  if (type >= 79 && type <= 86)
    return `场景标记 ${['A', 'B', 'C', 'D', '1', '2', '3', '4'][type - 79]}`;
  if ([91, 92, 93, 95, 96, 97, 98, 99].includes(type))
    return `保留图形（${type}）`;
  return shapes[type] ?? `未定义对象（${type}）`;
}
