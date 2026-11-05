import { addonDisplayName } from './addon-names.ts';
import { formatGameId } from '../../../shared/character-label.ts';
import type {
  DecodedFileDetail,
  ReadableSection,
} from '../../../shared/types.ts';
import {
  gameName,
  itemName,
  hotbarTypes,
  describeHotbarCommand,
} from './game-data.ts';
import { segmentNames } from '../../../shared/dat-labels.ts';

type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(object) : [];
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const number = (value: unknown) => Number(value ?? 0);
function playerWorld(record: Row): string | null {
  const worldId = number(record.worldId ?? record.worldIdRaw);
  return (
    (typeof record.worldName === 'string' && record.worldName) ||
    (worldId > 0
      ? gameName('World', worldId) || `未知服务器（ID ${worldId}）`
      : null)
  );
}
function playerLabel(record: Row, nameKey = 'name'): string {
  return formatGameId(record[nameKey], playerWorld(record));
}
const labels: Record<string, string> = {
  name: '名称',
  settingName: '过滤方式',
  channels: '应用频道',
  termFiltersEnabled: '启用屏蔽词',
  isUnseen: '有未读内容',
  storageIndex: '存储索引',
  serializedOrder: '记录顺序',
  folderName: '所属文件夹',
  isInNamedFolder: '已放入文件夹',
  serverTime: '服务器时间（对应待核对）',
  background: '背景编号',
  isBoardPlaceholder: '板面占位记录',

  actions: '技能记录',
  series: '笔记组',
  contents: '条目状态',
  achievements: '关注成就',
  fishEntries: '未查看鱼种',
  glasses: '眼镜记录',
  objectName: '对象类型',
  colorHex: '颜色',
  transparencyPercent: '透明度（%）',

  backgroundName: '肖像背景',
  frameName: '肖像边框',
  decorationName: '肖像装饰',
  timelineName: '肖像动作',
  expressionName: '面部表情',
  recipeName: '配方产物',
  destinationName: '传送目的地',
  dutyName: '副本名称',
  petName: '宠物名称',
  directionalLightingColourHex: '定向光颜色',
  ambientLightingColourHex: '环境光颜色',
  commandName: '内容名称',
  commandTypeLabel: '内容类型',
  typeName: '内容类型',
  petSettings: '宠物设置',
  sizeName: '大小',
  mirageName: '外形',
  isNewPetSeen: '已查看',
  setCount: '预设数量',
  numItems: '保存的物品数',
  panelCount: '面板数量',
  slotCount: '每面板槽位数',
  closePanelUponExecutingActions: '执行后关闭面板',
  openPanelAtMouseCursorPosition: '在鼠标位置打开面板',
  disableDraggingWithinCommandPanel: '禁止拖动面板内图标',
  firstTimeHelpSeen: '已阅读首次帮助',
  tint: '色调',
  panelOpenIndex: '打开的面板',
  isFavorite: '已收藏',
  present: '有记录',
  settingsCandidate: '麻将设置（布局对应待验证）',
  settings: '设置',
  statisticsCandidate: '麻将历史数值（业务含义待核对）',
  yakumanHistory: '役满成就记录',
  npcWins: '人机对战胜场',
  difficultyNameCandidate: '难度（公开表关联）',
  winCount: '胜场',
  yakuNameCandidate: '役满名称（公开表关联）',
  storedYakuId: '役满保存编号',
  hasRecord: '已保存记录',
  achievedAtUnix: '达成时间',
  jobHudManualStates: '职业量谱说明已读状态',
  savedIsSeen: '保存的已查看标志',
  jobHudManualVersion: '职业量谱说明状态版本',
  jobHudManualNeedsReset: '需重置旧版量谱说明状态',
  manualId: '说明编号',
  actionNameCandidate: '关联技能（公开表）',
  guideIdCandidate: '指南编号（公开表）',
  pvpWelcomeSeen: '已查看 PvP 欢迎说明',
  itemContextCustomizationVersion: '物品菜单设置版本',
  itemContextCustomizationNeedsMigration: '需要迁移物品菜单设置',
  classToJobHotbarPrompts: '转职热键栏提示',
  handled: '提示已处理',
  prerequisiteQuestId: '前置任务编号',
  miniGameHighScore: '小游戏历史最高分',
  unmappedUiFlags: '尚未命名的界面状态',
  tileSet: '牌面样式编号（候选）',
  hideHints: '隐藏提示（候选）',
  hideDangerousTileMarker: '隐藏危险牌标记（候选）',
  hideChatLog: '隐藏聊天记录（候选）',
  hideTileNames: '隐藏牌名（候选）',
  showHighResolutionLayout: '显示高分辨率布局（候选）',
  showTraditionalDoraIndicator: '显示传统宝牌指示（候选）',
  ownPlayerNameSetting: '自身名称显示方式（候选）',
  othersPlayerNameSetting: '其他玩家名称显示方式（候选）',
  disableCharacterVoices: '关闭角色语音（候选）',
  emjVoiceNpc: '语音角色编号（候选）',
  emjCostumeId: '服装编号（候选）',
  recordUpdatedAtUnix: '角色配置记录更新时间',
  timestampCandidate: '时间整数（用途待核对）',
  historyValues: '历史统计整数（项目含义待核对）',
  historyEntries: '历史条目（数值含义待核对）',
  valueRaw: '保存的整数值',
  timeRaw: '保存的时钟值（用途待核对）',
  seenVoiceNpcIds: '已查看的麻将语音角色编号',
  seenCostumeIds: '已查看的麻将服装条目编号',
  retainerCount: '雇员数量',
  objectNames: '工坊产品',
  customize: '外观摘要',
  race: '种族编号',
  sex: '性别',
  height: '身高滑杆',
  tribe: '部族编号',
  highlightsEnabled: '启用挑染',
  facialFeatures: '面部特征',
  smallIris: '小虹膜',
  lipstickEnabled: '启用口红',
  facePaintReversed: '反转面纹',

  index: '序号',
  slot: '槽位',
  displayIndex: '显示位置',
  page: '页',
  itemId: '物品',
  baseItemId: '物品',
  glamourId: '幻化物品',
  cardIds: '卡牌',
  contentId: '角色 ID',
  characterContentId: '角色 ID',
  contentIdCandidate: '角色 ID（候选）',
  retainerId: '雇员 ID',
  retainerIdCandidate: '雇员 ID（候选）',
  id: '编号',
  worldName: '服务器',
  worldId: '服务器',
  worldIdEncoded: '服务器编号',
  recordIndex: '记录序号',
  recordKeyRaw: '物理记录索引',
  comment: '备注',
  title: '标题',
  recipientName: '收件人',
  gil: '金币',
  quantity: '数量',
  count: '数量',
  contactCount: '联系人数量',
  craftType: '制作职业编号',
  recipeId: '配方 ID',
  isFavoriteRaw: '收藏状态值',
  aetheryteId: '目的地 ID',
  ward: '小区索引',
  plot: '地块索引',
  subIndex: '子编号',
  actionId: '技能',
  commandId: '命令 ID',
  type: '类型',
  flag0: '状态位 0',
  flag1: '状态位 1',
  x: 'X 坐标',
  y: 'Y 坐标',
  z: 'Z 坐标',
  active: '已启用',
  activeMask: '启用标记',
  cameraAngle: '镜头角度',
  cameraRotation: '镜头旋转',
  cameraPositionCandidate: '镜头位置（候选）',
  isCharacterOrientedCameraRaw: '镜头跟随角色状态值',
  isCharacterOrientedLightRaw: '灯光跟随角色状态值',
  isManualBrightnessEnabledRaw: '手动亮度状态值',
  manualBrightness: '手动亮度',
  characterLighting: '角色照明',
  enabledRaw: '启用状态值',
  red: '红色分量',
  green: '绿色分量',
  blue: '蓝色分量',
  position: '位置',
  rgba: '颜色 RGBA',
  angle: '旋转角度',
  scale: '缩放',
  text: '文字',
  visible: '可见',
  locked: '已锁定',
  flippedHorizontally: '水平翻转',
  flippedVertically: '垂直翻转',
  objectType: '对象类型 ID',
  argsA: '参数 A（含义未确认）',
  argsB: '参数 B（含义未确认）',
  argsC: '参数 C（含义未确认）',
  bannerBg: '背景 ID',
  bannerFrame: '边框 ID',
  bannerDecoration: '装饰 ID',
  bannerTimeline: '动作 ID',
  bannerTimelineName: '动作名称',
  expression: '表情 ID',
  animationProgress: '动画进度',
  cameraPosition: '镜头位置',
  cameraTarget: '镜头目标',
  cameraZoom: '镜头缩放',
  imageRotation: '画面旋转',
  directionalLightingBrightness: '定向光亮度',
  ambientLightingBrightness: '环境光亮度',
  directionalLightingColour: '定向光颜色',
  ambientLightingColour: '环境光颜色',
  directionalLightingAngles: '定向光角度',
  headDirection: '头部方向',
  eyeDirection: '视线方向',
  lastUpdatedUnix: '更新时间',
  unixTimestamp: '时间',
  completionUnix: '任务完成时间',
  completionUnixCandidate: '任务完成时间（旧字段）',
  automaticallyDisplayRecordRaw: '自动显示笔记状态值',
  numSubEntriesSeen: '子条目进度保存值',
  isUnseenRaw: '未读状态值',
  action1: '技能栏 1',
  action2: '技能栏 2',
  countdownLength: '倒计时秒数',
  term: '屏蔽词',
  channelFlags: '频道状态值',
  termFiltersEnabledRaw: '屏蔽词启用状态值',
  beatsPerMinute: '每分钟拍数',
  beatsPerMeasure: '每小节拍数',
  assignAllNotesToKeyboard: '键盘全音阶',
  muteOtherPerformers: '静音其他演奏者',
  playbackTypeAllMembers: '全员播放',
  displayControlGuide: '显示操作提示',
  keyboardMode: '键盘模式',
  controllerMode: '手柄模式',
  accentEachMeasure: '小节重音',
  enableCountIn: '启用预备拍',
  soundEffectsOnlyDuringCountIn: '仅预备拍播放音效',
  displayMetronome: '显示节拍器',
  objectIds: '对象 ID',
  flags: '状态位（含义未完全确认）',
  flagsCandidate: '状态位（候选）',
  seenIds: '已读条目 ID',
  unseenFishIds: '未查看鱼种 ID',
  achievementWatchlist: '关注的成就 ID',
  seenNoteFlags1: '笔记已读标记 1',
  seenNoteFlags2: '笔记已读标记 2',
  unseenAdventureEntryIds: '未读探索条目 ID',
  numSubEntriesSeenCandidate: '已读条目数（候选）',
  wishlistItemIdsCandidate: '收藏物品（候选）',
  glassesIdListCandidate: '眼镜 ID（候选）',
  tankOrder: '防护职业顺序',
  healerOrder: '治疗职业顺序',
  dpsOrder: '进攻职业顺序',
  actionsAndTraitsDisplayMode: '技能面板显示模式',
  summonedCompanionId: '当前宠物',
  hidePortraitUpdatePreviewRaw: '隐藏肖像更新预览状态值',
  groupLabelsCandidate: '社交分组（候选）',
  contactRecordsCandidate: '社交联系人（候选）',
  contacts: '联系人',
  tasks: '雇员任务',
  actionChangeEnabled: '启用技能变换',
  antiMisactivationEnabled: '防止复唱误发动',
  retainersCandidate: '雇员备注（候选）',
  presets: '预设',
  markers: '场地标点',
  lights: '灯光',
  recipes: '收藏配方',
  craftingTypes: '制作收藏',
  history: '历史记录',
  favorites: '收藏',
  unseen: '未查看记录',
  objects: '对象',
  data: '内容',
  chunks: '分组',
  items: '随信物品',
  records: '记录',
  entries: '条目',
  sets: '预设组',
  panels: '快捷面板',
  slots: '槽位',
  savedFolders: '保存的文件夹',
  savedBoards: '保存的战术板',
  sharedFolders: '分享的文件夹',
  sharedBoards: '分享的战术板',
  activeSetsCandidate: '青魔法预设（候选）',
  activeBlueMageActionIds: '青魔法技能编号',
  standardHotbars: '普通热键栏',
  crossHotbars: '十字热键栏',
  firstEightLinkshellIdCandidates: '通讯贝槽位（候选）',
  patchMarkVersions: '版本标记',
  patchMarkStates: '版本状态',
  namedFlagsCandidate: '界面状态（候选）',
  namedFlags: '界面状态',
  lastSeenMentorVersion: '已查看的指导者版本',
  hideMentorRenewDialogue: '隐藏指导者续期提示',
  defaultCurrencyRotationIndex: '默认货币轮换索引',
  currencySettingIds0To3: '货币设置编号 0–3',
  currencySettingIdForRotation5: '第5个货币轮换设置编号',
  actionsAndTraitsCompactView: '技能与特性紧凑视图',
  hidePortraitUpdatePreview: '隐藏肖像更新预览',
  seenNotes: '笔记阅读记录',
  termFilters: '屏蔽词',
  setNames: '预设名称',
  minionCompanionIds: '小游戏宠物栏',
  unseenTripleTriadCardIds: '未查看卡牌',
};
const slotNames = [
  '主手',
  '副手',
  '头部',
  '身体',
  '手部',
  '腰部（旧槽位）',
  '腿部',
  '脚部',
  '耳饰',
  '项链',
  '手镯',
  '右戒指',
  '左戒指',
  '灵魂水晶',
];
const containerNames: Record<string, string> = {
  inventory: '背包',
  armouryMainHand: '兵装库 · 主手',
  armouryOffHand: '兵装库 · 副手',
  armouryHead: '兵装库 · 头部',
  armouryBody: '兵装库 · 身体',
  armouryHands: '兵装库 · 手部',
  armouryLegs: '兵装库 · 腿部',
  armouryFeet: '兵装库 · 脚部',
  armouryEars: '兵装库 · 耳饰',
  armouryNeck: '兵装库 · 项链',
  armouryWrists: '兵装库 · 手镯',
  armouryRings: '兵装库 · 戒指',
  armourySoulCrystal: '兵装库 · 灵魂水晶',
  saddleBag: '陆行鸟鞍囊',
  premiumSaddleBag: '高级陆行鸟鞍囊',
  retainer: '雇员背包',
};
function named(sheet: string, id: unknown) {
  return number(id) === 0
    ? '空位'
    : (gameName(sheet, number(id)) ?? `未收录名称（ID ${id}）`);
}
function timestamp(value: unknown) {
  const n = number(value);
  return n > 0 && n < 253402300800
    ? new Date(n * 1000).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '未记录';
}
function valueText(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (key === 'itemId' || key === 'baseItemId' || key === 'glamourId')
    return itemName(number(value));
  if (key === 'actionId') return `${named('Action', value)}（${value}）`;
  const nameSheets: Record<string, string> = {
    bannerBg: 'BannerBg',
    bannerFrame: 'BannerFrame',
    bannerDecoration: 'BannerDecoration',
    bannerTimeline: 'BannerTimeline',
    expression: 'BannerFacial',
    recipeId: 'Recipe',
    aetheryteId: 'Aetheryte',
    contentFinderConditionId: 'ContentFinderCondition',
    petId: 'XBMPet',
    mycItemId: 'MYCTemporaryItem',
  };
  if (nameSheets[key])
    return `${gameName(nameSheets[key], number(value)) ?? (number(value) === 0 ? '未指定' : '名称未收录')}（${value}）`;
  if (key === 'worldId')
    return `${gameName('World', number(value)) ?? '未知服务器'}（${value}）`;
  if (key === 'summonedCompanionId') return named('Companion', value);
  if (
    key === 'unixTimestamp' ||
    key === 'lastUpdatedUnix' ||
    key === 'completionUnixCandidate' ||
    key === 'completionUnix' ||
    key === 'achievedAtUnix' ||
    key === 'recordUpdatedAtUnix'
  )
    return timestamp(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : '未记录';
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((v) =>
        typeof v === 'object'
          ? Object.values(object(v)).join(' / ')
          : String(v),
      )
      .join(' / ');
  return Object.values(object(value)).map(String).join(' / ');
}
function table(
  id: string,
  title: string,
  columns: [string, string][],
  data: Row[],
  note?: string,
): ReadableSection {
  return {
    id,
    title,
    note,
    columns: columns.map(([key, label]) => ({ key, label })),
    rows: data.map((row) =>
      Object.fromEntries(
        columns.map(([key]) => [key, valueText(key, row[key])]),
      ),
    ),
  };
}

function inventorySections(data: Row): ReadableSection[] {
  const result: ReadableSection[] = [];
  const items = (
    id: string,
    title: string,
    ids: unknown,
    counts?: unknown,
    equipment = false,
    paged = true,
  ) => {
    const quantities = list(counts);
    const entries = list(ids).flatMap((item, index) =>
      !number(item)
        ? []
        : [
            {
              position: equipment
                ? (slotNames[index] ?? index + 1)
                : paged
                  ? `${Math.floor(index / 35) + 1} / ${(index % 35) + 1}`
                  : index + 1,
              item: itemName(number(item)),
              itemIdRaw: number(item),
              quantity:
                quantities[index] === undefined
                  ? null
                  : number(quantities[index]),
            },
          ],
    );
    result.push(
      table(
        id,
        title,
        [
          ['position', equipment ? '装备槽' : paged ? '页 / 槽位' : '槽位'],
          ['item', '物品名称'],
          ...(counts === undefined
            ? []
            : [['quantity', '数量'] as [string, string]]),
          ['itemIdRaw', '原始物品 ID'],
        ],
        entries,
        '本地搜索缓存，可能与角色当前库存不同。',
      ),
    );
  };
  rows(data.retainers).forEach((retainer, index) => {
    const title = `雇员 ${index + 1}（${retainer.retainerId ?? '身份未记录'}）`;
    items(
      `retainer-${index}`,
      `${title} · 背包`,
      retainer.itemIds,
      retainer.itemCounts,
    );
    items(
      `retainer-equipment-${index}`,
      `${title} · 装备`,
      retainer.equippedItemIds,
      undefined,
      true,
    );
    result.push(
      table(
        `crystals-${index}`,
        `${title} · 水晶数量`,
        [
          ['slot', '缓存槽位'],
          ['name', '水晶种类'],
          ['quantity', '数量'],
        ],
        list(retainer.crystalQuantities).flatMap((quantity, slot) =>
          number(quantity)
            ? [{ slot: slot + 1, name: itemName(slot + 2), quantity }]
            : [],
        ),
        '原生物品搜索按物品编号减2读取18个水晶槽位。',
      ),
    );
  });
  for (const key of ['saddleBag', 'premiumSaddleBag']) {
    const bag = object(data[key]);
    items(key, containerNames[key], bag.itemIds, bag.itemCounts);
  }
  items(
    'glamourDresser',
    '投影台',
    object(data.glamourDresser).itemIds,
    undefined,
    false,
    false,
  );
  const dresserItems = list(object(data.glamourDresser).itemIds);
  for (const outfit of rows(object(data.glamourDresser).outfitSets)) {
    const displayedIndex = dresserItems
      .slice(0, number(outfit.slot))
      .filter((id) => number(id)).length;
    result.push(
      table(
        `glamourDresser-${displayedIndex}-components`,
        `${itemName(number(outfit.itemId))} · 套装部件`,
        [
          ['slot', '部件位置'],
          ['name', '物品名称'],
          ['state', '缓存状态'],
        ],
        rows(outfit.components).map((component) => ({
          slot: number(component.componentIndex) + 1,
          name: itemName(number(component.itemId)),
          state: component.isStored ? '已存入' : '缺少',
        })),
        '状态位1表示缺少该部件；部件编号按固定公开资源表关联，本地缓存可能与当前游戏状态不同。',
      ),
    );
  }
  result.push(
    table(
      'cabinet',
      '收藏柜',
      [
        ['index', '收藏柜条目编号'],
        ['item', '物品名称'],
        ['stored', '缓存状态'],
      ],
      list(object(data.cabinet).setBitIndices).map((index) => ({
        index,
        item: gameName('CabinetItem', number(index))
          ? itemName(number(gameName('CabinetItem', number(index))))
          : `名称未收录（条目 ${index}）`,
        stored: '已记录',
      })),
      '名称通过 Cabinet 条目关联到 Item；这是本地缓存记录，原始位图保留在技术数据中。',
    ),
  );
  return result;
}

// Build tables from known business fields. Unknown flags and binary-only fields
// remain in the structural view rather than being passed off as translated data.
function structuredSections(
  data: Row,
  prefix: string,
  title: string,
): ReadableSection[] {
  const sections: ReadableSection[] = [];
  const confirmedMahjongSettings = /^11-chunk-\d+-data-settings$/.test(prefix);
  const labelFor = (key: string) =>
    confirmedMahjongSettings
      ? labels[key]?.replace(/（候选）$/, '')
      : labels[key];
  const alternatives: Record<string, string> = {
    achievementWatchlist: 'achievements',
    unseenFishIds: 'fishEntries',
    glassesIdListCandidate: 'glasses',
    objectIds: 'objectNames',
    isFavoriteRaw: 'isFavorite',
    isUnseenRaw: 'isUnseen',
    termFiltersEnabledRaw: 'termFiltersEnabled',
    channelFlags: 'channels',
    flag0: 'actionChangeEnabled',
    flag1: 'antiMisactivationEnabled',
    completionUnixCandidate: 'completionUnix',
    settingsCandidate: 'settings',
    historyValues: 'historyEntries',
    unknownValue: 'historyEntries',
    timestampCandidate:
      data.recordUpdatedAtUnix !== undefined
        ? 'recordUpdatedAtUnix'
        : 'historyEntries',
    namedFlagsCandidate: 'namedFlags',
    statisticsCandidate: 'yakumanHistory',
    uiFlags: 'namedFlags',
  };
  const visibleKey = (key: string) =>
    !alternatives[key] || data[alternatives[key]] === undefined;

  const scalarKeys = Object.keys(data).filter(
    (key) =>
      labels[key] &&
      visibleKey(key) &&
      !Array.isArray(data[key]) &&
      (data[key] === null || typeof data[key] !== 'object'),
  );
  if (scalarKeys.length)
    sections.push({
      ...table(
        `${prefix}-values`,
        title,
        [
          ['field', '设置'],
          ['value', '内容'],
        ],
        scalarKeys.map((key) => ({
          field: labelFor(key),
          value: valueText(key, data[key]),
        })),
      ),
      sourceKeys: scalarKeys,
    });
  for (const [key, value] of Object.entries(data)) {
    if (!visibleKey(key)) continue;
    if (!labels[key] && key !== 'chunks' && key !== 'data' && key !== 'objects')
      continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      const objects = value.every(
        (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
      );
      if (!objects) {
        const entries = value.map((entry, index) => ({
          slot: index + 1,
          value: valueText(key, entry),
        }));
        sections.push(
          table(
            `${prefix}-${key}`,
            `${title} · ${labels[key] ?? key}`,
            [
              ['slot', '位置'],
              ['value', '内容'],
            ],
            entries,
          ),
        );
        continue;
      }
      const records = rows(value);
      if (key === 'chunks') {
        records.forEach((chunk, index) => {
          const content = Object.fromEntries(
            Object.entries(chunk).filter(([k]) =>
              ['data', 'records', 'objects'].includes(k),
            ),
          );
          sections.push(
            ...structuredSections(
              content,
              `${prefix}-chunk-${index}`,
              `${title} · ${labels[String(chunk.name)] ?? '记录组 ' + (index + 1)}`,
            ),
          );
        });
        continue;
      }
      const keys = [
        ...new Set(records.flatMap((row) => Object.keys(row))),
      ].filter(
        (k) =>
          labels[k] &&
          records.some(
            (row) =>
              row[k] !== undefined &&
              (row[k] === null ||
                typeof row[k] !== 'object' ||
                [
                  'position',
                  'rgba',
                  'cameraPosition',
                  'cameraTarget',
                  'directionalLightingAngles',
                  'headDirection',
                  'eyeDirection',
                  'objectIds',
                  'objectNames',
                  'channels',
                ].includes(k)),
          ),
      );
      if (keys.length) {
        const namesFor: Record<string, string> = {
          isFavoriteRaw: 'isFavorite',
          isUnseenRaw: 'isUnseen',
          channelFlags: 'channels',
          flag0: 'actionChangeEnabled',
          flag1: 'antiMisactivationEnabled',
          completionUnixCandidate: 'completionUnix',
          objectIds: 'objectNames',
          bannerBg: 'backgroundName',
          bannerFrame: 'frameName',
          bannerDecoration: 'decorationName',
          bannerTimeline: 'timelineName',
          expression: 'expressionName',
          recipeId: 'recipeName',
          aetheryteId: 'destinationName',
          contentFinderConditionId: 'dutyName',
          petId: 'petName',
          commandType: 'commandTypeLabel',
          type: 'typeName',
          directionalLightingColour: 'directionalLightingColourHex',
          ambientLightingColour: 'ambientLightingColourHex',
        };
        const columns = keys
          .filter(
            (k) =>
              !(k === 'typeName' && keys.includes('commandTypeLabel')) &&
              (!namesFor[k] || !keys.includes(namesFor[k])),
          )
          .filter(
            (k) =>
              !['itemId', 'baseItemId'].includes(k) ||
              !keys.includes('baseItemId') ||
              k === 'baseItemId',
          )
          .map((k) => [k, labels[k]] as [string, string]);
        sections.push(
          table(
            `${prefix}-${key}`,
            `${title} · ${labels[key] ?? '记录'}`,
            columns,
            records,
          ),
        );
      }
      records.forEach((entry, index) => {
        const nested = Object.fromEntries(
          Object.entries(entry).filter(
            ([field, v]) =>
              v !== null &&
              typeof v === 'object' &&
              ![
                'position',
                'rgba',
                'cameraPosition',
                'cameraTarget',
                'directionalLightingAngles',
                'headDirection',
                'eyeDirection',
                'objectIds',
                'objectNames',
                'channels',
              ].includes(field),
          ),
        );
        sections.push(
          ...structuredSections(
            nested,
            `${prefix}-${key}-${index}`,
            `${title} · ${String(entry.title ?? entry.name ?? entry.nameCandidate ?? (key === 'chunks' ? (entry.id ?? index + 1) : index + 1))}`,
          ),
        );
      });
    } else if (value !== null && typeof value === 'object') {
      sections.push(
        ...structuredSections(
          object(value),
          `${prefix}-${key}`,
          `${title} · ${key === 'settings' && prefix.startsWith('11-') ? '麻将设置' : (labels[key] ?? '内容')}`,
        ),
      );
    }
  }
  return sections;
}

export function readableSections(detail: DecodedFileDetail): ReadableSection[] {
  const data = detail.data;
  const filename = detail.summary.name.toUpperCase();
  if (
    [
      'HOTBAR.DAT',
      'GEARSET.DAT',
      'KEYBIND.DAT',
      'MACRO.DAT',
      'MACROSYS.DAT',
      'COMMON.DAT',
      'CONTROL0.DAT',
      'CONTROL1.DAT',
    ].includes(filename)
  )
    return [];
  if (filename === 'ITEMFDR.DAT') return inventorySections(data);
  if (filename === 'ITEMODR.DAT')
    return [...rows(data.containers), ...rows(data.retainers)].map(
      (container, index) =>
        table(
          `order-${index}`,
          `${containerNames[String(container.name)] ?? '物品排序'}${container.retainerId ? `（${container.retainerId}）` : ''}`,
          [
            ['displayPosition', '显示位置'],
            ['sourcePage', '原始页'],
            ['sourceSlot', '原始槽位'],
          ],
          Array.isArray(container.locations)
            ? rows(container.locations)
            : rows(container.slots).map((slot) => ({
                displayPosition: number(slot.displayIndex) + 1,
                sourcePage: number(slot.page) + 1,
                sourceSlot: number(slot.slot) + 1,
              })),
          '此文件记录显示位置与原始位置的对应关系，不包含物品内容；物品名称与数量请查看物品缓存。',
        ),
    );
  if (filename === 'GS.DAT')
    return [
      table(
        'decks',
        '九宫幻卡卡组',
        [
          ['name', '卡组名称'],
          ['cards', '卡牌'],
        ],
        rows(data.decks).map((deck) => ({
          name: deck.name || `卡组 ${number(deck.index) + 1}`,
          cards: list(deck.cardIds)
            .map((id) => named('TripleTriadCard', id))
            .join(' / '),
        })),
      ),
      table(
        'minions',
        '萌宠之王快捷栏',
        [
          ['slot', '槽位'],
          ['name', '宠物'],
        ],
        list(data.minionCompanionIds).flatMap((id, index) =>
          number(id) ? [{ slot: index + 1, name: named('Companion', id) }] : [],
        ),
      ),
      table(
        'unseen-cards',
        '未查看卡牌',
        [['name', '卡牌']],
        list(data.unseenTripleTriadCardIds)
          .filter(number)
          .map((id) => ({ name: named('TripleTriadCard', id) })),
      ),
    ];
  if (filename === 'ACQ.DAT') {
    const usage = object(data.mainCommandUsage);
    return [
      table(
        'contacts',
        '最近密语联系人',
        [
          ['name', '角色名称'],
          ['worldName', '服务器'],
          ['contentId', '角色 ID'],
          ['routeName', '回复路由'],
          ['flagsRaw', '路由保存值'],
        ],
        rows(data.contacts).map((contact) => ({
          ...contact,
          name: playerLabel(contact),
          routeName:
            object(contact.route).replyRoute === 'foray'
              ? '特殊区域密语'
              : object(contact.route).replyRoute === 'extended'
                ? '扩展上下文密语'
                : '普通密语',
          contentId:
            contact.contentIdHex ??
            object(object(contact.inferred).contentIdCandidate).hex ??
            '未记录',
        })),
        '本地历史联系人，名字和服务器可能已发生变化。',
      ),
      ...(data.lastReceivedTell
        ? [
            table(
              'last-received-tell',
              '最后收到密语的联系人',
              [
                ['name', '角色名称'],
                ['worldName', '服务器'],
                ['contentIdHex', '角色 ID'],
              ],
              [
                {
                  ...object(data.lastReceivedTell),
                  name: playerLabel(object(data.lastReceivedTell)),
                },
              ],
              '由原生特殊记录标记确认，与普通联系人历史单独保存。',
            ),
          ]
        : []),
      ...(data.mainCommandUsage
        ? [
            table(
              'command-usage-window',
              '系统指令统计周期',
              [
                ['field', '项目'],
                ['value', '内容'],
              ],
              [
                {
                  field: '汇总截止时间',
                  value: timestamp(usage.aggregationDeadlineUnix),
                },
                { field: '初始统计窗口', value: '7 天' },
              ],
            ),
            table(
              'contact-metadata',
              '系统指令使用统计',
              [
                ['counterIndex', '统计索引'],
                ['name', '指令（公开表关联）'],
                ['useCount', '使用次数'],
                ['failedUseCount', '其中失败次数'],
              ],
              rows(usage.entries).map((entry) => ({
                ...entry,
                name:
                  entry.commandNamesCandidate ||
                  `统计索引 ${entry.counterIndex}`,
              })),
              'ACQ中同时保存系统指令使用统计；次数由原生读写器与计数器确认，名称按固定公开MainCommand表关联。',
            ),
          ]
        : [
            table(
              'contact-metadata',
              '附加数值记录',
              [
                ['index', '记录序号'],
                ['firstValue', '第一列保存值'],
                ['secondValue', '第二列保存值'],
              ],
              rows(object(data.metadataBlock).entries),
              '此布局尚未符合目标客户端固定78项的系统指令统计格式，原始值保留。',
            ),
          ]),
    ];
  }
  if (filename === 'LOGFLTR.DAT')
    return rows(data.groups).map((group, index) =>
      table(
        `chat-${index}`,
        `聊天标签页 ${index + 1}`,
        [
          ['category', '消息类别'],
          ['state', '显示设置'],
          ['filterId', '类别编号'],
        ],
        (Array.isArray(group.filters)
          ? rows(group.filters)
          : list(group.filterStates).map((state, filterId) => ({
              filterId,
              rawState: state,
            }))
        ).map((filter) => ({
          filterId: filter.filterId,
          category:
            gameName('LogFilter', number(filter.filterId)) ??
            `保留类别 ${filter.filterId}`,
          state:
            object(filter).stateLabel ??
            (filter.rawState === 1
              ? '显示'
              : filter.rawState === 0
                ? '隐藏'
                : filter.rawState === 2
                  ? '保留项'
                  : `未知状态 ${filter.rawState}`),
        })),
        '类别按 LogFilter 表关联；显示/隐藏已与预设及样本交叉核对。保留项不是可编辑的布尔开关。',
      ),
    );
  if (filename === 'ADDON.DAT')
    return rows(data.datasets).flatMap((dataset, index) => {
      const entries = (records: unknown) =>
        rows(records)
          .filter((entry) => entry.isEmptyStorage !== true)
          .map((entry): Row => ({
            ...entry,
            offset: entry.offset,
            name: addonDisplayName(entry.addonName, entry.addonNameHashHex),
            anchor: entry.alignmentName ?? entry.alignmentType,
            elementSetting:
              object(entry.elementSettings).kind === 'jobGauge'
                ? object(entry.elementSettings).useSimpleGauge
                  ? '简易量谱'
                  : '标准量谱'
                : object(entry.elementSettings).kind === 'hotbar'
                  ? (object(entry.elementSettings).layoutName ?? '默认布局')
                  : entry.elementFlags,
            scale: `${Math.round(number(entry.scale) * 100)}%`,
            alpha: `${Math.round((number(entry.alpha) / 255) * 100)}%`,
          }));
      const columns: [string, string][] = [
        ['name', '界面元素'],
        ['x', 'X 坐标'],
        ['y', 'Y 坐标'],
        ['scale', '缩放'],
        ['width', '宽度'],
        ['height', '高度'],
        ['alpha', '不透明度'],
        ['anchor', '定位锚点'],
        ['elementSetting', '界面专属设置'],
      ];
      const section = (id: string, title: string, records: unknown) => {
        const visible = entries(records);
        return {
          ...table(
            id,
            title,
            id.startsWith('hud-')
              ? [
                  ...columns,
                  ['keyboardMouse', '键鼠模式'],
                  ['gamepad', '手柄模式'],
                  ['override', '继承方式'],
                ]
              : columns,
            visible.map((entry) => ({
              ...entry,
              keyboardMouse: entry.hudVisibleKeyboardMouse ? '显示' : '隐藏',
              gamepad: entry.hudVisibleGamepad ? '显示' : '隐藏',
              override: entry.flagsOnlyOverride ? '只覆盖界面设置' : '完整布局',
            })),
          ),
          sourceKeys: visible.map((entry) => String(entry.offset)),
        };
      };
      return [
        section(`ui-${index}`, '常规界面配置', dataset.entries),
        ...rows(dataset.layouts).map((layout, n) =>
          section(
            `hud-${index}-${n}`,
            `HUD 布局 ${n + 1}${layout.name ? ' · ' + layout.name : ''}`,
            layout.entries,
          ),
        ),
      ];
    });
  if (filename === 'UISAVE.DAT')
    return rows(data.segments).flatMap((segment) => {
      const value = { ...object(segment.data) };
      if (segment.id === 2 && Array.isArray(value.unmappedUiFlags))
        value.unmappedUiFlags = rows(value.unmappedUiFlags).filter(
          (entry) => number(entry.value) !== 0,
        );
      if (segment.id === 11 && Array.isArray(value.chunks))
        value.chunks = rows(value.chunks).map((chunk) => {
          const content = object(chunk.data);
          return Array.isArray(content.yakumanHistory)
            ? {
                ...chunk,
                data: {
                  ...content,
                  yakumanHistory: rows(content.yakumanHistory).filter(
                    (entry) => entry.hasRecord,
                  ),
                },
              }
            : chunk;
        });
      if (segment.id === 31)
        value.termFilters = rows(value.termFilters).filter((row) => row.term);
      if (segment.id === 0)
        value.records = rows(value.records)
          .filter(
            (row) =>
              row.recipientName ||
              number(row.gil) ||
              rows(row.items).some((item) => number(item.itemId)),
          )
          .map((row) => ({
            ...row,
            recipientName: playerLabel(row, 'recipientName'),
          }));
      if (segment.id === 1)
        value.tasks = rows(value.tasks).filter(
          (row) => row.retainerId && row.retainerId !== '0',
        );
      if (segment.id === 30 && Array.isArray(value.actions))
        value.actions = rows(value.actions).map((action) => ({
          ...action,
          actionChangeEnabled:
            action.actionChangeEnabled === null
              ? `未定义保存值（${action.flag0}）`
              : action.actionChangeEnabled,
          antiMisactivationEnabled:
            action.antiMisactivationEnabled === null
              ? `未定义保存值（${action.flag1}）`
              : action.antiMisactivationEnabled,
        }));

      const id = String(segment.id);
      const name = segmentNames[String(segment.name)] ?? String(segment.name);
      let sections: ReadableSection[];
      if (segment.id === 4 && Array.isArray(value.blocks)) {
        const make = (section: ReadableSection) => ({
          ...section,
          sourceId: id,
        });
        const cache = (key: string, title: string) =>
          make(
            table(
              key,
              title,
              [
                ['index', '保存槽位'],
                ['name', '角色名称'],
                ['contentId', '角色 ID'],
                ['world', '服务器'],
              ],
              rows(object(value[key]).entries).map((entry) => ({
                ...entry,
                name: playerLabel(entry),
                index: number(entry.index) + 1,
                world: playerWorld(entry) || '未知服务器',
              })),
            ),
          );
        return [
          make(
            table(
              'social-labels',
              '好友分组名称',
              [
                ['index', '分组'],
                ['name', '名称'],
              ],
              rows(value.friendGroups ?? value.groupLabels).map((entry) => ({
                ...entry,
                index: number(entry.index) + 1,
                name: entry.name || `分组 ${number(entry.index) + 1}`,
              })),
            ),
          ),
          make(
            table(
              'social-contacts',
              '联系人历史',
              [
                ['index', '保存槽位'],
                ['name', '角色名称'],
                ['contentId', '角色 ID'],
                ['world', '服务器'],
                ['job', '职业'],
              ],
              rows(value.recentContacts ?? value.contactRecords)
                .filter(
                  (entry) =>
                    entry.name ||
                    (entry.contentId ?? entry.identityIdRaw) !== '0' ||
                    number(entry.worldId),
                )
                .map((entry) => ({
                  ...entry,
                  name: playerLabel(entry),
                  index: number(entry.index) + 1,
                  contentId: entry.contentId ?? entry.identityIdRaw,
                  world: playerWorld(entry) || '未知服务器',
                  job: number(entry.classJobId)
                    ? (gameName('ClassJob', number(entry.classJobId)) ??
                      entry.classJobId)
                    : '未记录',
                })),
            ),
          ),
          make(
            table(
              'social-list',
              '黑名单',
              [
                ['index', '记录'],
                ['name', '角色名称'],
                ['comment', '备注'],
                ['identityType', '屏蔽范围'],
                ['accountId', '账号 ID'],
                ['contentId', '角色 ID'],
                ['world', '服务器'],
                ['serverRecordId', '服务器记录编号'],
              ],
              rows(object(value.blacklist ?? value.socialList).entries).map(
                (entry) => ({
                  ...entry,
                  name: playerLabel(entry),
                  index: number(entry.index) + 1,
                  identityType:
                    entry.identityKind === 'account' ? '账号' : '角色',
                  world: playerWorld(entry) || '未知服务器',
                  accountId: entry.accountId ?? '未保存',
                  contentId: entry.contentId ?? '未保存',
                }),
              ),
            ),
          ),
          cache('partyMemberCache', '队伍成员来源缓存'),
          cache('characterNameCache', '角色名称缓存'),
          make(
            table(
              'mute-list',
              '屏蔽记录（MuteList）',
              [
                ['index', '记录'],
                ['name', '名称'],
                ['comment', '备注'],
                ['accountId', '账号 ID'],
                ['world', '服务器'],
              ],
              rows(object(value.muteList).entries).map((entry) => ({
                ...entry,
                name: playerLabel(entry),
                index: number(entry.index) + 1,
                world: playerWorld(entry) || '未知服务器',
              })),
            ),
          ),
        ];
      }
      if (
        segment.id === 22 &&
        (Array.isArray(value.retainers) ||
          Array.isArray(value.retainersCandidate))
      ) {
        const savedTasks = (retainer: Row) =>
          rows(retainer.savedTaskEntries).filter(
            (entry) =>
              number(entry.taskIdRaw) !== 0 || number(entry.flagRaw) !== 0,
          );
        const retainers = rows(
          value.retainers ?? value.retainersCandidate,
        ).filter(
          (retainer) =>
            (retainer.id && retainer.id !== '0') ||
            retainer.comment ||
            savedTasks(retainer).length,
        );
        const make = (section: ReadableSection) => ({
          ...section,
          sourceId: id,
        });
        if (!retainers.length)
          return [
            make(
              table(
                'retainer-comments',
                '雇员备注与任务历史',
                [
                  ['retainerId', '雇员 ID'],
                  ['comment', '备注'],
                ],
                [],
                '没有保存的雇员备注或任务历史。',
              ),
            ),
          ];
        return retainers.flatMap((retainer) => {
          const index = number(retainer.index);
          return [
            make(
              table(
                `retainer-${index}-comment`,
                `雇员 ${index + 1} · 备注`,
                [
                  ['retainerId', '雇员 ID'],
                  ['comment', '备注'],
                ],
                [
                  {
                    retainerId: retainer.id,
                    comment: retainer.comment || '未填写',
                  },
                ],
              ),
            ),
            make(
              table(
                `retainer-${index}-task-history`,
                `雇员 ${index + 1} · 任务历史`,
                [
                  ['slot', '保存顺序'],
                  ['taskIdRaw', '任务编号（原值）'],
                  ['isPinned', '固定到历史'],
                ],
                savedTasks(retainer).map((entry) => ({
                  slot: number(entry.slot) + 1,
                  taskIdRaw: entry.taskIdRaw,
                  isPinned:
                    entry.isPinned === null
                      ? `未定义保存值（${entry.flagRaw}）`
                      : entry.isPinned,
                })),
                '任务编号保留存档原值，任务表名称关联仍待核对；固定状态表示固定到历史列表。',
              ),
            ),
          ];
        });
      }
      if (segment.id === 41 && Array.isArray(value.panels)) {
        const make = (section: ReadableSection) => ({
          ...section,
          sourceId: id,
        });
        const command = (
          type: unknown,
          commandId: unknown,
          linkedName?: unknown,
        ) => {
          const typeId = number(type);
          const storedId = number(commandId);
          const description = describeHotbarCommand(
            hotbarTypes[typeId] ?? String(typeId),
            storedId,
          );
          return {
            typeLabel: description.commandTypeLabel,
            name:
              (typeof linkedName === 'string' && linkedName
                ? linkedName
                : null) ??
              description.commandName ??
              `未收录名称（类型 ${typeId} / 编号 ${storedId}）`,
          };
        };
        const panels = rows(value.panels);
        return [
          make(
            table(
              'quick-panel-settings',
              '快捷面板 · 设置',
              [
                ['field', '设置'],
                ['value', '内容'],
              ],
              [
                {
                  field: '执行后关闭面板',
                  value: value.closePanelUponExecutingActions,
                },
                {
                  field: '在鼠标位置打开面板',
                  value: value.openPanelAtMouseCursorPosition,
                },
                {
                  field: '禁止拖动面板内图标',
                  value: value.disableDraggingWithinCommandPanel,
                },
                { field: '已阅读首次帮助', value: value.firstTimeHelpSeen },
                { field: '色调', value: value.tint },
                {
                  field: '开启时显示',
                  value: value.openLastUsedPanel
                    ? '最近使用的分页'
                    : `面板 ${number(value.panelOpenIndex) + 1}`,
                },
              ],
            ),
          ),
          make(
            table(
              'quick-panel-icons',
              '快捷面板 · 分页图标',
              [
                ['panel', '分页'],
                ['typeLabel', '图标来源类型'],
                ['name', '图标来源'],
                ['iconCommandType', '来源类型编号'],
                ['iconCommandId', '来源内容编号'],
                ['defaultIconId', '默认图标编号'],
              ],
              panels.map((panel) => {
                const index = number(panel.index);
                const useDefault = panel.usesDefaultIcon === true;
                return {
                  panel: index + 1,
                  ...(useDefault
                    ? {
                        typeLabel: '默认图标',
                        name: `快捷面板 ${index + 1} 默认图标`,
                      }
                    : command(
                        panel.iconCommandType,
                        panel.iconCommandId,
                        panel.iconCommandName,
                      )),
                  iconCommandType: panel.iconCommandType,
                  iconCommandId: panel.iconCommandId,
                  defaultIconId: useDefault ? panel.defaultIconId : '不适用',
                };
              }),
              '自定义图标按命令类型与编号关联；默认图标使用客户端的分页图标编号。',
            ),
          ),
          ...panels.map((panel) =>
            make(
              table(
                `quick-panel-${number(panel.index)}-slots`,
                `快捷面板 ${number(panel.index) + 1} · 已保存的内容`,
                [
                  ['slot', '槽位'],
                  ['typeLabel', '内容类型'],
                  ['name', '内容'],
                  ['commandType', '类型编号'],
                  ['commandId', '内容编号'],
                ],
                rows(panel.slots)
                  .filter(
                    (entry) =>
                      number(entry.commandType) !== 0 ||
                      number(entry.commandId) !== 0,
                  )
                  .map((entry) => ({
                    ...entry,
                    ...command(
                      entry.commandType,
                      entry.commandId,
                      entry.commandName,
                    ),
                    slot: number(entry.slot) + 1,
                  })),
              ),
            ),
          ),
        ];
      }
      if (segment.id === 1 && Array.isArray(value.tasks))
        return [
          {
            ...table(
              'retainer-tasks',
              '雇员任务',
              [
                ['index', '任务槽位'],
                ['retainerId', '雇员 ID'],
                ['completionUnix', '完成时间'],
              ],
              rows(value.tasks).map((task) => ({
                ...task,
                index: number(task.index) + 1,
                completionUnix:
                  task.completionUnix ?? task.completionUnixCandidate,
              })),
              rows(value.tasks).length ? undefined : '没有保存的雇员任务记录。',
            ),
            sourceId: id,
          },
        ];
      if (segment.id === 34 && Array.isArray(value.wishlist))
        return [
          {
            ...table(
              'market-wishlist',
              '市场收藏',
              [
                ['slot', '位置'],
                ['itemId', '收藏物品'],
              ],
              rows(value.wishlist).map((entry) => ({
                ...entry,
                slot: number(entry.slot) + 1,
              })),
              rows(value.wishlist).length ? undefined : '没有保存的市场收藏。',
            ),
            sourceId: id,
          },
        ];
      if (segment.id === 20 && Array.isArray(value.sets))
        return rows(value.sets).map((set, index) => ({
          ...table(
            `lost-action-set-${index}`,
            `失传技能 · ${set.name || `预设 ${index + 1}`}`,
            [
              ['index', '位置'],
              ['mycItemId', '失传技能'],
              ['quantity', '数量'],
            ],
            rows(set.items).map((entry) => ({
              ...entry,
              index: number(entry.index) + 1,
            })),
            number(set.numItems) === 0 ? '此预设未保存技能。' : undefined,
          ),
          sourceId: id,
        }));
      if (segment.id === 6 && Array.isArray(value.tiers)) {
        const menuSections = rows(value.tiers).map((tier, index) => ({
          ...table(
            `item-menu-tier-${index}`,
            `物品菜单 · 第 ${index + 1} 级`,
            [
              ['index', '顺序'],
              ['name', '菜单项'],
              ['allowedInMenu', '允许在菜单中显示'],
              ['menuEntryId', '菜单项编号'],
              ['addonRowId', '菜单文字编号'],
              ['helpAddonRowId', '说明文字编号'],
            ],
            rows(tier.entries).map((entry) => ({
              ...entry,
              index: number(entry.index) + 1,
            })),
            '位图按菜单编号保存显示许可。实际可见项还受物品与场景条件限制；名称按固定公开Addon表关联。',
          ),
          sourceId: id,
        }));
        if (value.usesDefaultMenu && Array.isArray(value.defaultMenuEntries))
          menuSections.push({
            ...table(
              'item-menu-default',
              '客户端默认菜单（静态推导）',
              [
                ['index', '默认顺序'],
                ['name', '菜单项'],
                ['allowedInMenu', '默认允许显示'],
                ['menuEntryId', '菜单项编号'],
              ],
              rows(value.defaultMenuEntries).map((entry) => ({
                ...entry,
                index: number(entry.index) + 1,
              })),
              '第一级没有自定义排序时，客户端使用目标EXE内58项默认顺序和显示许可；不是存档新增的58条配置。',
            ),
            sourceId: id,
          });
        return menuSections;
      }
      if (segment.id === 7 && Array.isArray(value.stateEntries))
        return [
          {
            ...table(
              'pvp-selections',
              'PvP 保存的选择',
              [
                ['classJobName', '职业'],
                ['selectionRaw', '保存值'],
                ['selectedIndex', '选择项索引'],
                ['selectedActionNameCandidate', '职能技能（公开表关联）'],
              ],
              rows(value.stateEntries).map((entry) => ({
                ...entry,
                index: number(entry.index) + 1,
                selectedActionNameCandidate:
                  entry.selectedIndex === null
                    ? '未设置'
                    : (entry.selectedActionNameCandidate ??
                      `公开表未收录索引 ${entry.selectedIndex}`),
              })),
              '零表示未设置；选择项索引从零开始。职能技能名称按固定公开表候选关联，尚未核验目标客户端同版本资源；未映射职业槽保留原值。',
            ),
            sourceId: id,
          },
        ];
      if (segment.id === 21 && Array.isArray(value.groups)) {
        const meaningful = (record: Row) =>
          number(record.enabledRaw) !== 0 ||
          (record.catalogEntryId !== null &&
            record.catalogEntryId !== undefined &&
            number(record.catalogEntryId) !== 0xffffffff) ||
          number(record.iconId) !== 0 ||
          number(record.stampType) === 4;
        const allRecords = rows(value.records);
        const groups = rows(value.groups);
        return [
          {
            ...table(
              'stamp-groups',
              '集体动作贴纸 · 配置组',
              [
                ['index', '组'],
                ['name', '名称'],
                ['hasSavedData', '已保存'],
                ['recordCount', '有内容的贴纸记录'],
                ['timeFormatNameCandidate', '时间模板（候选）'],
                ['timeFormatAddonId', '时间模板文字编号'],
                ['savedSettingRaw', '保存设置值（用途待核对）'],
              ],
              groups.map((group, index) => ({
                ...group,
                index: index + 1,
                name: group.name || `配置组 ${index + 1}`,
                hasSavedData:
                  group.hasSavedData ?? number(group.savedStateRaw) !== 0,
                recordCount: allRecords.filter(
                  (record) =>
                    number(record.groupIndex) === number(group.index) &&
                    meaningful(record),
                ).length,
                timeFormatNameCandidate:
                  group.clockFormatCandidate === '12-hour'
                    ? '12 小时制'
                    : group.clockFormatCandidate === '24-hour'
                      ? '24 小时制'
                      : '未关联',
              })),
              '时间模板名称由公共中文表关联；目标客户端已确认保存相应 Addon 行号，同版本资源文字尚未复核。',
            ),
            sourceId: id,
          },
          ...groups.flatMap((group, index) => {
            const title = String(group.name || `配置组 ${index + 1}`);
            const records = allRecords.filter(
              (record) =>
                number(record.groupIndex) === number(group.index) &&
                meaningful(record),
            );
            return [
              {
                ...table(
                  `stamp-groups-${index}-records`,
                  `${title} · 贴纸`,
                  [
                    ['name', '贴纸'],
                    ['slot', '组内槽位'],
                    ['index', '全局物理索引'],
                    ['stampTypeName', '类型'],
                    ['stampType', '类型保存值'],
                    ['enabled', '启用'],
                    ['catalogEntryId', '贴纸目录编号'],
                    ['iconId', '图标编号'],
                    ['drawPriority', '绘制优先级'],
                    ['alpha', '不透明度（0–255）'],
                    ['scale', '缩放倍数'],
                    ['positionNormalized', '归一化位置 X / Y'],
                    ['rotationDegrees', '旋转角度（度）'],
                    ['flipHorizontally', '水平翻转'],
                    ['flipVertically', '垂直翻转'],
                    ['fontSize', '字号'],
                    ['textColorPresetId', '文字颜色预设编号'],
                    ['textAlignmentName', '文字水平对齐'],
                    ['savedText', '保存的文字'],
                  ],
                  records.map((record) => {
                    const isText = record.stampType === 4,
                      slot = number(record.slot);
                    return {
                      ...record,
                      slot: slot + 1,
                      name: `贴纸 ${slot + 1} · ${record.stampTypeName || '未定义类型'}`,
                      stampTypeName:
                        record.stampTypeName ??
                        `未定义类型 ${record.stampType}`,
                      fontSize: isText ? record.fontSize : '不适用',
                      textColorPresetId: isText
                        ? record.textColorPresetId
                        : '不适用',
                      textAlignmentName: isText
                        ? ((
                            {
                              left: '靠左',
                              center: '居中',
                              right: '靠右',
                            } as Record<string, string>
                          )[String(record.textAlignment)] ??
                          `未定义保存值 ${record.textAlignmentRaw}`)
                        : '不适用',
                      flipHorizontally: isText
                        ? '不适用'
                        : record.flipHorizontally,
                      flipVertically: isText ? '不适用' : record.flipVertically,
                      savedText:
                        isText && slot >= 200 && slot < 210
                          ? (rows(group.texts).find(
                              (text) => number(text.slot) === slot - 200,
                            )?.text ?? null)
                          : null,
                    };
                  }),
                  records.length
                    ? '缩放、坐标、旋转、绘制优先级、不透明度、镜像和文字格式已由客户端消费指令确认；图片子类型名称仍有未核对项。'
                    : '没有保存有内容的贴纸记录；默认分配的210个槽位保留在技术数据中。',
                ),
                sourceId: id,
              },
              {
                ...table(
                  `stamp-groups-${index}-texts`,
                  `${title} · 保存文字`,
                  [
                    ['slot', '文字槽位'],
                    ['text', '文字'],
                  ],
                  rows(group.texts)
                    .filter((entry) => entry.text)
                    .map((entry) => ({
                      ...entry,
                      slot: number(entry.slot) + 1,
                    })),
                ),
                sourceId: id,
              },
              {
                ...table(
                  `stamp-groups-${index}-order`,
                  `${title} · 贴纸顺序`,
                  [
                    ['index', '显示顺序'],
                    ['storedIndex', '保存的记录索引（原值）'],
                  ],
                  list(group.order).flatMap((storedIndex, orderIndex) =>
                    number(storedIndex) === 0xffffffff
                      ? []
                      : [{ index: orderIndex + 1, storedIndex }],
                  ),
                  '顺序向量已读取；其记录索引采用组内还是全局编号仍未验证，不据此建立记录关联。',
                ),
                sourceId: id,
              },
            ];
          }),
        ];
      }
      if (segment.id === 12 && Array.isArray(value.activeSets)) {
        const sets = rows(value.activeSets);
        const actionRows = (entries: unknown) =>
          rows(entries)
            .filter((entry) => number(entry.storedId) !== 0)
            .map((entry) => ({
              slot: number(entry.index) + 1,
              name:
                entry.name ??
                (entry.actionId === null || entry.actionId === undefined
                  ? `未收录青魔技能 ${entry.storedId}`
                  : named('Action', entry.actionId)),
              storedId: entry.storedId,
              actionIdRaw: entry.actionId,
            }));
        const hotbarRows = (entries: unknown) =>
          rows(entries)
            .filter((entry) => entry.kind !== 'ClearBlueMageOrMacro')
            .map((entry) => ({
              slot: number(entry.slotIndex) + 1,
              name:
                entry.kind === 'Macro'
                  ? `${entry.macroBankName}宏 ${number(entry.macroIndex) + 1}`
                  : entry.kind === 'InvalidMacro'
                    ? `无效宏编码 ${entry.storedValue}`
                    : entry.kind === 'PreserveExisting'
                      ? '保留原快捷栏内容'
                      : (entry.name ??
                        (entry.actionId === null || entry.actionId === undefined
                          ? `未收录青魔技能 ${entry.storedId}`
                          : named('Action', entry.actionId))),
              kind:
                entry.kind === 'Macro'
                  ? '宏'
                  : entry.kind === 'InvalidMacro'
                    ? '无效宏'
                    : entry.kind === 'PreserveExisting'
                      ? '保留'
                      : '青魔技能',
              storedValue: entry.storedValue,
              actionIdRaw: entry.actionId,
            }));
        const referenceNote =
          '技能编号通过固定版本公开 AozAction 表关联到 Action；原生保存字节与 Action ID 分列。空槽省略，原槽位编号保留。';
        const result = [
          table(
            'aoz-sets',
            '青魔法预设',
            [
              ['slot', '预设'],
              ['name', '名称'],
              ['actionCount', '技能数'],
              ['hotbarCount', '保存的快捷栏内容数'],
            ],
            sets.map((set, index) => ({
              slot: index + 1,
              name: set.name || `预设 ${index + 1}`,
              actionCount: actionRows(set.activeActions).length,
              hotbarCount: [
                ...rows(set.standardHotbars),
                ...rows(set.crossHotbars),
              ].reduce((count, bar) => count + hotbarRows(bar.slots).length, 0),
            })),
          ),
          ...sets.flatMap((set, index) => {
            const title = set.name || `预设 ${index + 1}`;
            return [
              table(
                `aoz-sets-${index}-actions`,
                `${title} · 技能`,
                [
                  ['slot', '槽位'],
                  ['name', '技能'],
                  ['storedId', '青魔技能保存编号'],
                  ['actionIdRaw', 'Action ID'],
                ],
                actionRows(set.activeActions),
                referenceNote,
              ),
              ...['standardHotbars', 'crossHotbars'].flatMap((key) => {
                const bars = rows(set[key]),
                  barTitle =
                    key === 'standardHotbars' ? '普通快捷栏' : '十字快捷栏',
                  prefix = `aoz-sets-${index}-${key}`;
                return [
                  table(
                    prefix,
                    `${title} · ${barTitle}`,
                    [
                      ['slot', '快捷栏'],
                      ['contentCount', '保存内容数'],
                    ],
                    bars.map((bar, barIndex) => ({
                      slot: barIndex + 1,
                      contentCount: hotbarRows(bar.slots).length,
                    })),
                  ),
                  ...bars.map((bar, barIndex) =>
                    table(
                      `${prefix}-${barIndex}-slots`,
                      `${title} · ${barTitle} ${barIndex + 1} · 内容`,
                      [
                        ['slot', '槽位'],
                        ['kind', '类型'],
                        ['name', '内容'],
                        ['storedValue', '保存值'],
                        ['actionIdRaw', 'Action ID'],
                      ],
                      hotbarRows(bar.slots),
                      '宏编号按个人/公用宏列表显示；是否已创建需结合宏文件。未列出的0值槽位仅清除原青魔技能或宏，不覆盖其它类型；255表示保留原内容。',
                    ),
                  ),
                ];
              }),
            ];
          }),
          table(
            'aoz-recent',
            '最近使用的青魔技能',
            [
              ['slot', '保存位置'],
              ['name', '技能'],
              ['storedId', '青魔技能保存编号'],
              ['actionIdRaw', 'Action ID'],
            ],
            actionRows(value.recentActions),
            referenceNote,
          ),
        ];
        return result.map((section) => ({ ...section, sourceId: id }));
      }
      if (segment.id === 15 && value.cameraPositionOffset !== undefined) {
        const xyz = (v: unknown) => {
          const vector = object(v);
          return ['x', 'y', 'z']
            .map(
              (key) =>
                `${key.toUpperCase()} ${valueText(key, vector[key]) ?? '未记录'}`,
            )
            .join(' · ');
        };
        return [
          {
            ...table(
              'group-pose-camera',
              '集体动作 · 镜头',
              [
                ['field', '设置'],
                ['value', '内容'],
              ],
              [
                { field: '镜头缩放模式保存值', value: value.cameraZoomMode },
                { field: '镜头控制模式保存值', value: value.cameraControlMode },
                { field: '镜头距离', value: value.cameraDistance },
                { field: '镜头视野', value: value.cameraFieldOfView },
                {
                  field: '水平方向（弧度）',
                  value: value.cameraDirectionHorizontal,
                },
                {
                  field: '垂直方向（弧度）',
                  value: value.cameraDirectionVertical,
                },
                {
                  field: '相对镜头位置',
                  value: xyz(value.cameraPositionOffset),
                },
                {
                  field: '镜头位置坐标系',
                  value:
                    value.cameraPositionCoordinateSpace ===
                    'target-oriented-relative'
                      ? '相对目标位置与朝向'
                      : '相对目标位置',
                },
              ],
              '镜头位置仅含XYZ，为相对目标的偏移。尚未确认业务含义的内部镜头参数与向量对齐字节保留在技术数据中。',
            ),
            sourceId: id,
          },
          {
            ...table(
              'group-pose-lights',
              '集体动作 · 灯光',
              [
                ['slot', '灯光'],
                ['enabled', '启用'],
                ['red', '红'],
                ['green', '绿'],
                ['blue', '蓝'],
                ['type', '类型保存值'],
                ['positionText', '位置 XYZ'],
              ],
              rows(value.lights).map((light, index) => ({
                ...light,
                slot: index + 1,
                positionText: xyz(light.position),
              })),
              '灯光类型数值的界面名称仍待核对。',
            ),
            sourceId: id,
          },
          {
            ...table(
              'group-pose-lighting-settings',
              '集体动作 · 照明设置',
              [
                ['field', '设置'],
                ['value', '内容'],
              ],
              [
                {
                  field: '灯光随角色朝向',
                  value: value.isCharacterOrientedLight,
                },
                {
                  field: '启用手动亮度',
                  value: value.isManualBrightnessEnabled,
                },
                { field: '手动亮度', value: value.manualBrightness },
                { field: '角色照明', value: value.characterLighting },
              ],
            ),
            sourceId: id,
          },
        ];
      }
      if (segment.id === 13 && Array.isArray(value.groups))
        return [
          {
            ...table(
              'cwls-settings',
              '跨服通讯贝 · 列表设置',
              [
                ['field', '设置'],
                ['value', '内容'],
              ],
              [{ field: '在线成员优先', value: value.onlineMembersFirst }],
            ),
            sourceId: id,
          },
          ...rows(value.groups).map((group, index) => ({
            ...table(
              `cwls-group-${index}`,
              `跨服通讯贝 · ${group.dataCenterNameForTargetClient || `分组 ${index + 1}`}`,
              [
                ['slot', '槽位'],
                ['linkshellId', '通讯贝 ID'],
                ['selected', '当前选择'],
              ],
              rows(group.slots)
                .filter((entry) => entry.linkshellId !== '0')
                .map((entry) => ({
                  ...entry,
                  slot: number(entry.slot) + 1,
                  selected: entry.linkshellId === group.selectedLinkshellId,
                })),
              `${group.dataCenterNameForTargetClient ? `目标中国客户端对应${group.dataCenterNameForTargetClient}（数据中心 ${group.dataCenterIdForTargetClient}）；` : ''}通讯贝名称未保存在这组槽位数据中。`,
            ),
            sourceId: id,
          })),
        ];
      if (segment.id === 42 && Array.isArray(value.groups))
        return rows(value.groups).map((group, index) => ({
          ...table(
            `glasses-slot-${index}`,
            `眼镜样式 · 装备槽 ${index + 1}`,
            [
              ['slot', '列表位置'],
              ['name', '样式'],
              ['styleId', '样式编号'],
            ],
            rows(group.entries)
              .filter((entry) => entry.present)
              .map((entry) => ({ ...entry, slot: number(entry.slot) + 1 })),
            '列表行为符合未查看样式记录，具体用途仍待运行验证；编号表示样式，不区分颜色变体。',
          ),
          sourceId: id,
        }));
      if (segment.id === 23) {
        const portraits = (
          rows(value.chunks).length
            ? rows(value.chunks).flatMap((chunk) => rows(chunk.records))
            : rows(value.records)
        ).map((row) => ({
          ...row,
          portrait: number(row.recordIndex) + 1,
          race:
            gameName('Race', number(object(row.customize).race)) ??
            object(row.customize).race,
          sex:
            object(row.customize).sex === 0
              ? '男'
              : object(row.customize).sex === 1
                ? '女'
                : '未记录',
          height: object(row.customize).height,
          tribe:
            gameName('Tribe', number(object(row.customize).tribe)) ??
            object(row.customize).tribe,
          checksumValue:
            row.checksum === undefined || row.checksum === null
              ? null
              : '0x' + number(row.checksum).toString(16).padStart(8, '0'),
        }));
        const make = (
          id: string,
          title: string,
          columns: [string, string][],
          note?: string,
        ) => ({
          ...table(id, title, columns, portraits, note),
          sourceId: String(segment.id),
        });
        return [
          make('portraits', '肖像外观', [
            ['portrait', '记录'],
            ['backgroundName', '背景'],
            ['frameName', '边框'],
            ['decorationName', '装饰'],
            ['timelineName', '动作'],
            ['expressionName', '表情'],
          ]),
          make('portrait-camera', '镜头与视线', [
            ['portrait', '记录'],
            ['cameraPosition', '镜头位置'],
            ['cameraTarget', '镜头目标'],
            ['cameraZoom', '缩放'],
            ['imageRotation', '画面旋转'],
            ['headDirection', '头部方向'],
            ['eyeDirection', '视线方向'],
            ['animationProgress', '动画进度'],
          ]),
          make('portrait-light', '灯光', [
            ['portrait', '记录'],
            ['directionalLightingColourHex', '定向光颜色'],
            ['directionalLightingBrightness', '定向光亮度'],
            ['directionalLightingAngles', '定向光角度'],
            ['ambientLightingColourHex', '环境光颜色'],
            ['ambientLightingBrightness', '环境光亮度'],
          ]),
          make('portrait-person', '人物外观摘要', [
            ['portrait', '记录'],
            ['race', '种族'],
            ['sex', '性别'],
            ['height', '身高滑杆'],
            ['tribe', '部族'],
          ]),
          make(
            'portrait-links',
            '存储键与关联值',
            [
              ['portrait', '记录'],
              ['bannerIndex', '物理肖像索引'],
              ['bannerId', '运行时肖像 ID'],
              ['useDefaultPreset', '使用默认预设'],
              ['flagsRaw', '肖像旗标保存值'],
              ['checksumValue', '装备关联值'],
              ['equipmentChecksumStatus', '装备快照匹配状态'],
              ['matchedGearsetNames', '匹配的本地套装'],
              ['lastUpdatedUnix', '更新时间'],
            ],
            '装备关联值的 CRC 算法已还原；只有取得一致的装备、染色、眼镜和可见性输入时才能核验。未找到一致本地快照不等于文件损坏或校验失败。',
          ),
        ];
      }
      if (segment.id === 39 || segment.id === 40)
        return [
          {
            ...table(
              `${segment.id}-seen`,
              segment.id === 39 ? '已查看传说' : '已查看辅助职业（条目关联）',
              [
                ['id', '保存的编号'],
                ['name', '名称'],
              ],
              rows(value.entries),
              segment.id === 40
                ? '名称按 MKDSupportJob 行号关联；向量编号与 JobIndex 是否完全等价仍需核对。'
                : undefined,
            ),
            sourceId: String(segment.id),
          },
        ];
      if (segment.id === 35) {
        const entries: Row[] = [];
        list(value.seenDescriptionBitfields).forEach((word, group) => {
          for (let bit = 0; bit < 32; bit++)
            if ((number(word) >>> bit) & 1)
              entries.push({ index: group * 32 + bit, state: '已记录为已读' });
        });
        return [
          {
            ...table(
              'description-seen',
              '说明已读记录',
              [
                ['index', '说明内部索引'],
                ['state', '状态'],
              ],
              entries,
              entries.length
                ? '位图已完整展开；内部索引与具体说明文本的关联尚无足够依据。'
                : '当前没有已读说明标志。',
            ),
            sourceId: String(segment.id),
          },
        ];
      }
      if (segment.id === 43)
        return [
          {
            ...table(
              'pet-settings',
              '宠物笔记设置',
              [
                ['petName', '宠物'],
                ['sizeName', '大小'],
                ['isNewPetSeen', '已查看'],
                ['mirageName', '外形'],
                ['petId', '原始编号'],
              ],
              rows(value.petSettings),
            ),
            sourceId: String(segment.id),
          },
        ];

      if (
        segment.id === 8 ||
        segment.id === 9 ||
        segment.id === 10 ||
        segment.id === 19
      ) {
        const sheet =
          segment.id === 8
            ? 'Emote'
            : segment.id === 9
              ? 'Companion'
              : segment.id === 10
                ? 'MountOrder'
                : 'OrnamentOrder';
        sections = ['history', 'favorites', 'unseen', 'unseenOrnaments']
          .filter((key) => Array.isArray(value[key]))
          .map((key) =>
            table(
              `${id}-${key}`,
              key === 'favorites'
                ? '收藏'
                : key === 'history'
                  ? '历史记录'
                  : '未查看记录',
              [
                ['slot', '位置'],
                ['name', '名称'],
                ['storedId', '存储编号'],
              ],
              list(value[key]).flatMap((storedId, index) =>
                number(storedId)
                  ? [
                      {
                        slot: index + 1,
                        name: named(sheet, storedId),
                        storedId,
                      },
                    ]
                  : [],
              ),
            ),
          );
        if (segment.id === 8 && Array.isArray(value.emoteStates))
          sections.push(
            table(
              '8-states',
              '表情已读状态',
              [
                ['emoteId', '表情编号'],
                ['name', '表情'],
                ['stateName', '状态'],
                ['isUnseen', '未查看'],
                ['isSeen', '已查看'],
                ['state', '保存值'],
              ],
              rows(value.emoteStates)
                .filter((entry) => number(entry.state) !== 0)
                .map((entry) => ({
                  ...entry,
                  name:
                    gameName('Emote', number(entry.emoteId)) ??
                    `未收录表情 ${entry.emoteId}`,
                })),
            ),
          );
      } else sections = structuredSections(value, id, name);
      if (!sections.length)
        sections = [
          table(
            `${id}-unknown`,
            name,
            [['content', '内容']],
            [],
            value.empty
              ? '没有保存的记录。'
              : '已读取此子段，但业务字段含义仍未确认；完整数值和原始字节可在技术数据中查看。',
          ),
        ];
      return sections.map((section) => ({
        ...section,
        sourceId: id,
        note: section.note,
      }));
    });
  if (
    detail.header.format === 'character-backup' ||
    detail.header.format === 'system-backup'
  )
    return [
      table(
        'backup',
        '备份中的配置',
        [
          ['name', '文件'],
          ['size', '大小'],
          ['state', '解析结果'],
        ],
        rows(data.members).map((member) => ({
          name: member.name,
          size: `${number(member.length).toLocaleString()} 字节`,
          state:
            member.status === 'decoded'
              ? '已解析'
              : member.status === 'partial'
                ? '部分解析'
                : '尚未支持',
        })),
        '打开下方的配置文件，可独立查看备份内的对应内容。',
      ),
    ];
  if (detail.header.format === 'config-copy')
    return [
      table(
        'identity',
        '缓存角色信息',
        [
          ['name', '角色名称'],
          ['worldId', '服务器'],
          ['contentIdHex', '角色 ID'],
          ['recordUpdatedAtUnix', '配置记录更新时间'],
        ],
        [{ ...data, name: playerLabel(data) }],
        '这是本地缓存中的名字，不保证是改名后的当前名字。',
      ),
    ];
  if (detail.header.format === 'character-preset') {
    const customize = object(data.customize);
    const races = [
      '未记录',
      '人族',
      '精灵族',
      '拉拉菲尔族',
      '猫魅族',
      '鲁加族',
      '敖龙族',
      '硌狮族',
      '维埃拉族',
    ];
    const appearanceLabels: Record<string, string> = {
      height: '身高滑杆',
      face: '脸型',
      hairstyle: '发型',
      skinColor: '肤色色号',
      hairColor: '发色色号',
      rightEyeColor: '右眼色号',
      leftEyeColor: '左眼色号',
      eyebrows: '眉型',
      nose: '鼻型',
      jaw: '下颌',
      bustSize: '胸围滑杆',
    };
    return [
      {
        ...table(
          'appearance',
          '外观预设',
          [
            ['field', '项目'],
            ['value', '内容'],
          ],
          [
            {
              field: '种族',
              value: races[number(customize.race)] ?? `种族 ${customize.race}`,
            },
            {
              field: '性别',
              value:
                customize.sex === 0
                  ? '男'
                  : customize.sex === 1
                    ? '女'
                    : '未记录',
            },
            ...Object.entries(appearanceLabels).map(([key, label]) => ({
              field: label,
              value: customize[key],
            })),
            {
              field: '部族',
              value:
                gameName('Tribe', number(customize.tribe)) ?? customize.tribe,
            },
            { field: '体型编号', value: customize.bodyType },
            { field: '挑染', value: customize.highlights },
            ...list(customize.facialFeaturesEnabled).map((value, index) => ({
              field: `面部特征 ${index + 1}`,
              value,
            })),
            { field: '旧版纹身', value: customize.legacyTattoo },
            { field: '眼型', value: customize.eyeShape },
            { field: '小虹膜', value: customize.smallIris },
            { field: '嘴型', value: customize.mouth },
            { field: '口红', value: customize.lipstick },
            { field: '面纹', value: customize.facePaint },
            { field: '反转面纹', value: customize.facePaintReversed },
            { field: '声线', value: data.voice },
            { field: '备注', value: data.comment || '未填写' },
            {
              field: '完整性校验',
              value: data.checksumMatches ? '通过' : '未通过',
            },
          ],
          '颜色和外观样式保留游戏选项编号；预设中没有实际 RGB 颜色或预览图片。',
        ),
        sourceKeys: [
          'customize.race',
          'customize.sex',
          ...Object.keys(appearanceLabels).map((key) => `customize.${key}`),
          'customize.tribe',
          'customize.bodyType',
          'customize.highlights',
          ...Array.from({ length: 7 }, () => 'customize.facialFeatures'),
          'customize.facialFeatures',
          'customize.eyeShapeFlags',
          'customize.eyeShapeFlags',
          'customize.mouthFlags',
          'customize.mouthFlags',
          'customize.facePaintFlags',
          'customize.facePaintFlags',
          'voice',
          'comment',
          'checksumMatches',
        ],
      },
    ];
  }
  return structuredSections(data, 'content', '保存的内容');
}
