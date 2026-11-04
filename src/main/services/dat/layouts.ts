import type { DatDecodeResult } from './types.ts';
import {
  describeHotbarCommand,
  hotbarTypes,
  gameName,
  nameCatalog,
} from './game-data.ts';

// Field meanings: FFXIVClientStructs b72bc1f73, UI/Misc/
// RaptureHotbarModule.HotbarSlotType, RaptureGearsetModule and AddonConfig.
// Disk offsets below were independently checked against both supplied characters.

const equipmentSlots = [
  'MainHand',
  'OffHand',
  'Head',
  'Body',
  'Hands',
  'Belt',
  'Legs',
  'Feet',
  'Ears',
  'Neck',
  'Wrists',
  'RingRight',
  'RingLeft',
  'SoulStone',
];

function span(
  data: Buffer,
  offset: number,
  length: number,
  label: string,
): Buffer {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > data.length
  ) {
    throw new Error(
      `${label} range ${offset}+${length} exceeds ${data.length} bytes`,
    );
  }
  return data.subarray(offset, offset + length);
}

function text(bytes: Buffer): string | null {
  const end = bytes.indexOf(0);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      end < 0 ? bytes : bytes.subarray(0, end),
    );
  } catch {
    return null;
  }
}

function unsupported(
  kind: string,
  payload: Buffer,
  version: number,
): DatDecodeResult {
  return {
    status: 'unsupported',
    data: { kind, version, byteLength: payload.length },
    warnings: [
      `No verified ${kind} record layout for version ${version}; decoded bytes are retained separately.`,
    ],
  };
}

export function decodeHotbar(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  if (version !== 4) return unsupported('HOTBAR', payload, version);
  if (payload.length % 8 !== 0)
    throw new Error('HOTBAR v4 requires complete 8-byte disk records');
  const seen = new Set<string>();
  const groups = new Set<number>();
  const unknownTypes = new Set<number>();
  const slots = [];
  for (let offset = 0; offset < payload.length; offset += 8) {
    const commandId = payload.readUInt32LE(offset);
    const groupId = payload[offset + 4];
    const barIndex = payload[offset + 5];
    const slotIndex = payload[offset + 6];
    const commandType = payload[offset + 7];
    if (barIndex >= 18 || slotIndex >= 16)
      throw new Error(`Invalid HOTBAR coordinate at payload offset ${offset}`);
    const key = `${groupId}:${barIndex}:${slotIndex}`;
    if (seen.has(key)) throw new Error(`Duplicate HOTBAR coordinate ${key}`);
    seen.add(key);
    groups.add(groupId);
    if (!(commandType in hotbarTypes)) unknownTypes.add(commandType);
    slots.push({
      offset,
      groupId,
      groupKindCandidate:
        groupId === 0 ? 'shared' : groupId < 64 ? 'classJob' : 'pvpStoredGroup',
      classJobIdCandidate: groupId > 0 && groupId < 64 ? groupId : null,
      barIndex,
      slotIndex,
      commandType,
      commandTypeName: hotbarTypes[commandType] ?? 'Unknown',
      commandId,
      ...describeHotbarCommand(
        hotbarTypes[commandType] ?? 'Unknown',
        commandId,
      ),
    });
  }
  const groupNames: Record<number, string | null> = Object.fromEntries(
    [...groups]
      .filter((id) => id > 0 && id < 64)
      .map((id) => [id, gameName('ClassJob', id)]),
  );
  const groupJobHints: Record<
    number,
    { classJobId: number; matchingActions: number; basis: string }
  > = {};
  for (const groupId of groups) {
    if (groupId < 64) continue;
    const jobs = new Map<number, number>();
    for (const slot of slots) {
      if (slot.groupId !== groupId || slot.commandTypeName !== 'Action')
        continue;
      const job = Number(gameName('ActionClassJob', slot.commandId));
      if (job > 0) jobs.set(job, (jobs.get(job) ?? 0) + 1);
    }
    if (jobs.size === 1) {
      const [job, count] = [...jobs][0];
      groupNames[groupId] = `${gameName('ClassJob', job) ?? job}（技能匹配）`;
      groupJobHints[groupId] = {
        classJobId: job,
        matchingActions: count,
        basis:
          '此组所有带明确职业引用的技能均指向同一 ClassJob；这是内容匹配，不宣称执行了客户端的存储索引转换。',
      };
    }
  }
  return {
    status: unknownTypes.size ? 'partial' : 'decoded',
    data: {
      recordSize: 8,
      slotCount: slots.length,
      nonemptySlotCount: slots.filter((slot) => slot.commandType !== 0).length,
      groupIds: [...groups].sort((a, b) => a - b),
      groupNames,
      groupJobHints,
      nameCatalog,
      indexConvention:
        'barIndex and slotIndex are zero-based; groupId is the stored byte, not a runtime array index',
      groupMappingEvidence:
        'PvE/shared candidates follow SavedHotbars source comments; classifying stored bytes 64..85 as PvP is inferred from these samples. No PvP group-to-ClassJob conversion is asserted.',
      slots,
    },
    warnings: [...unknownTypes].map(
      (type) => `Unknown hotbar command type ${type}`,
    ),
    coverage: {
      structureComplete: true,
      knownFields: [
        'slots[].groupId',
        'slots[].barIndex',
        'slots[].slotIndex',
        'slots[].commandType',
        'slots[].commandId',
        'slots[].commandTypeName (defined enum values)',
      ],
      candidateFields: [
        'slots[].groupKindCandidate',
        'slots[].classJobIdCandidate',
      ],
      unknownFields: [...unknownTypes].map((type) => ({
        field: `slots[].commandType ${type}`,
        reason: '存储类型字节可读取，但当前源码枚举未定义该类型。',
        kind: 'meaning',
      })),
    },
  };
}

export function decodeGearset(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  if (version !== 110) return unsupported('GEARSET', payload, version);
  span(payload, 0, 4, 'GEARSET metadata');
  const stride = 0x1c4;
  if ((payload.length - 4) % stride !== 0)
    throw new Error(
      'GEARSET v110 payload is not 4 bytes plus complete 452-byte records',
    );
  const warnings = [
    'The four leading metadata bytes and the role of any record beyond the first 100 slots remain unidentified.',
    'Unknown flag bits, alignment bytes, and item padding are retained as raw values.',
  ];
  const records = [];
  for (
    let offset = 4, recordIndex = 0;
    offset < payload.length;
    offset += stride, recordIndex++
  ) {
    const record = span(payload, offset, stride, 'GEARSET record');
    const id = record[0];
    const nameBytes = record.subarray(1, 0x31);
    const name = text(nameBytes);
    if (name === null)
      warnings.push(
        `GEARSET record ${recordIndex} has a non-UTF-8 name; raw bytes are retained`,
      );
    const flags = record[0x37];
    const items = equipmentSlots.map((slot, index) => {
      const at = 0x38 + index * 0x1c;
      const itemId = record.readUInt32LE(at);
      return {
        offset: offset + at,
        slot,
        itemId,
        // Same item-ID ranges as Dalamud/Utility/ItemUtil.cs; this is a
        // derived convenience value, not a separate field in the DAT record.
        baseItemId:
          itemId >= 1000000 && itemId < 2000000
            ? itemId - 1000000
            : itemId >= 500000 && itemId < 1000000
              ? itemId - 500000
              : itemId,
        highQuality: itemId >= 1000000 && itemId < 2000000,
        collectible: itemId >= 500000 && itemId < 1000000,
        glamourId: record.readUInt32LE(at + 4),
        stainIds: [record[at + 8], record[at + 9]],
        materia: Array.from({ length: 5 }, (_, i) => ({
          id: record.readUInt16LE(at + 10 + 2 * i),
          grade: record[at + 20 + i],
        })),
        flags: record[at + 25],
        itemMissing: !!(record[at + 25] & 1),
        colorDiffers: !!(record[at + 25] & 4),
        materiaDiffers: !!(record[at + 25] & 8),
        appearanceDiffers: !!(record[at + 25] & 16),
        unknownFlags: record[at + 25] & 0xe2,
        unknownTailHex: record.subarray(at + 26, at + 28).toString('hex'),
      };
    });
    records.push({
      offset,
      recordIndex,
      isSavedGearsetSlot: recordIndex < 100,
      id,
      name,
      nameBytesHex: nameBytes.toString('hex'),
      classJobId: record[0x31],
      glamourSetLinkRaw: record[0x32],
      unknownByte33: record[0x33],
      itemLevel: record.readInt16LE(0x34),
      bannerIndexPlusOne: record[0x36],
      bannerIndex: record[0x36] === 0 ? null : record[0x36] - 1,
      hasLinkedBanner: record[0x36] !== 0,
      flags,
      exists: !!(flags & 1),
      mainHandMissing: !!(flags & 4),
      headgearVisible: !!(flags & 8),
      weaponsVisible: !!(flags & 16),
      visorEnabled: !!(flags & 32),
      unknownFlags: flags & 0xc2,
      items,
      glassesIds: [record.readUInt16LE(0x1c0), record.readUInt16LE(0x1c2)],
    });
  }
  return {
    status: 'partial',
    data: {
      metadataHex: payload.subarray(0, 4).toString('hex'),
      recordSize: stride,
      recordCount: records.length,
      existingRecordCount: records.filter((record) => record.exists).length,
      savedSlotCount: Math.min(100, records.length),
      auxiliaryRecordCount: Math.max(0, records.length - 100),
      records,
    },
    coverage: {
      structureComplete: true,
      knownFields: [
        'records[].id',
        'records[].name',
        'records[].classJobId',
        'records[].glamourSetLinkRaw',
        'records[].itemLevel',
        'records[].bannerIndex',
        'records[].hasLinkedBanner',
        'records[].flags (known source bits)',
        'records[].items[].itemId',
        'records[].items[].glamourId',
        'records[].items[].stainIds',
        'records[].items[].materia',
        'records[].items[].flags (known source bits)',
        'records[].glassesIds',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'metadataHex',
          reason:
            '前4字节的存储边界已确认，但未找到它们与运行时字段绑定的实现。',
          kind: 'meaning',
        },
        ...(records.length > 100
          ? [
              {
                field: 'records[100..]',
                reason:
                  '运行时源码仅定义100个用户套装槽；附加记录可按相同布局读取，但其用途未确认，不作为可用套装。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        {
          field: 'records[].unknownByte33',
          reason: '结构中未命名的单字节，保留原值。',
          kind: 'storage',
        },
        {
          field: 'records[].items[].unknownTailHex',
          reason: '每件装备记录末尾2字节未命名，保留原值。',
          kind: 'storage',
        },
        ...(records.some(
          (r) => r.unknownFlags || r.items.some((item) => item.unknownFlags),
        )
          ? [
              {
                field:
                  'records[].unknownFlags / records[].items[].unknownFlags',
                reason: '存在源码枚举未定义的旗标位，已与已知旗标分开保留。',
                kind: 'meaning' as const,
              },
            ]
          : []),
      ],
    },
    warnings,
  };
}

function crc32(value: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function addonEntry(payload: Buffer, offset: number): Record<string, unknown> {
  const record = span(payload, offset, 32, 'ADDON config entry');
  const hash = record.readUInt32LE(0);
  const floating = [
    record.readFloatLE(4),
    record.readFloatLE(8),
    record.readFloatLE(12),
  ];
  return {
    offset,
    addonNameHash: hash,
    addonNameHashHex: hash.toString(16).padStart(8, '0'),
    addonName: addonNamesByHash.get(hash) ?? null,
    x: Number.isFinite(floating[0]) ? floating[0] : null,
    y: Number.isFinite(floating[1]) ? floating[1] : null,
    scale: Number.isFinite(floating[2]) ? floating[2] : null,
    positionAndScaleBytesHex: record.subarray(4, 16).toString('hex'),
    elementFlags: record.readUInt32LE(16),
    width: record.readUInt16LE(20),
    height: record.readUInt16LE(22),
    byteValue1: record[24],
    byteValue2: record[25],
    byteValue3: record[26],
    alpha: record[27],
    unknownTailHex: record.subarray(28, 32).toString('hex'),
  };
}

export function decodeAddon(payload: Buffer, version: number): DatDecodeResult {
  if (version !== 105) return unsupported('ADDON', payload, version);
  span(payload, 0, 32, 'ADDON container header');
  if (payload.subarray(0, 4).toString('ascii') !== 'ADDN')
    throw new Error('Missing ADDN container signature');
  const datasetCount = payload.readUInt32LE(4);
  let offset = payload.readUInt32LE(8);
  if (datasetCount > 0 && offset < 32)
    throw new Error('ADDON dataset overlaps the container header');
  if (datasetCount > payload.length / 48)
    throw new Error('ADDON dataset count exceeds payload bounds');
  const datasets = [];
  for (let index = 0; index < datasetCount; index++) {
    const header = span(payload, offset, 48, 'ADDON dataset header');
    const byteLength = header.readUInt32LE(16);
    if (byteLength < 48)
      throw new Error('ADDON dataset length is shorter than its header');
    const dataset = span(payload, offset, byteLength, 'ADDON dataset');
    const configOffset = header.readUInt32LE(20);
    const hudOffset = header.readUInt32LE(28);
    if (configOffset < 48 || hudOffset < 48)
      throw new Error('ADDON section overlaps the dataset header');
    const configHeader = span(
      dataset,
      configOffset,
      16,
      'ADDON regular config header',
    );
    const configCount = configHeader.readUInt32LE(0);
    const configEntriesOffset = configOffset + configHeader.readUInt32LE(4);
    if (configHeader.readUInt32LE(4) < 16)
      throw new Error('ADDON regular entries overlap their section header');
    span(
      dataset,
      configEntriesOffset,
      configCount * 32,
      'ADDON regular config entries',
    );
    const entries = Array.from({ length: configCount }, (_, n) =>
      addonEntry(payload, offset + configEntriesOffset + n * 32),
    );
    const hudHeader = span(dataset, hudOffset, 16, 'ADDON HUD section header');
    const entriesPerLayout = hudHeader.readUInt32LE(4);
    const currentLayout = hudHeader.readUInt16LE(8);
    const layoutCount = hudHeader.readUInt16LE(10);
    let layoutOffset = hudOffset + hudHeader.readUInt32LE(0);
    if (hudHeader.readUInt32LE(0) < 16)
      throw new Error('ADDON HUD layouts overlap their section header');
    if (layoutCount > dataset.length / 64)
      throw new Error('ADDON HUD layout count exceeds dataset bounds');
    const layouts = [];
    for (let layoutIndex = 0; layoutIndex < layoutCount; layoutIndex++) {
      const layoutHeader = span(
        dataset,
        layoutOffset,
        64,
        'ADDON HUD layout header',
      );
      // +0x30 is an unknown u32; the relative entry offset is at +0x34.
      const entryOffset = layoutHeader.readUInt32LE(52);
      if (entryOffset < 64)
        throw new Error('ADDON HUD entries overlap their layout header');
      span(
        dataset,
        layoutOffset + entryOffset,
        entriesPerLayout * 32,
        'ADDON HUD entries',
      );
      layouts.push({
        offset: offset + layoutOffset,
        layoutIndex,
        nameCandidate: text(layoutHeader.subarray(0, 48)),
        headerHex: layoutHeader.toString('hex'),
        entries: Array.from({ length: entriesPerLayout }, (_, n) =>
          addonEntry(payload, offset + layoutOffset + entryOffset + n * 32),
        ),
      });
      layoutOffset += entryOffset + entriesPerLayout * 32;
    }
    datasets.push({
      offset,
      datasetIndex: index,
      name: text(header.subarray(0, 16)),
      byteLength,
      headerHex: header.toString('hex'),
      regularHeaderHex: configHeader.toString('hex'),
      regularEntryCount: entries.length,
      entries,
      currentLayout,
      layoutCount,
      hudHeaderHex: hudHeader.toString('hex'),
      layouts,
      trailingBytesHex: dataset.subarray(layoutOffset).toString('hex'),
    });
    offset += byteLength;
  }
  return {
    status: 'partial',
    data: {
      containerHeaderHex: payload.subarray(0, 32).toString('hex'),
      datasetCount,
      datasets,
      unusedCapacityOffset: offset,
      unusedCapacityByteLength: payload.length - offset,
      unusedCapacityAllZero: payload
        .subarray(offset)
        .every((value) => value === 0),
    },
    warnings: [
      'ADDON disk entries are 32 bytes; runtime-only HasValue/IsOpen bytes from the 36-byte memory struct are not stored here.',
      'Coordinates, scale, dimensions, hashes and raw flags are decoded; undocumented header/tail fields retain raw bytes.',
      'Addon name lookup covers names explicitly annotated in the pinned structure source; unmatched hashes remain null.',
    ],
    coverage: {
      structureComplete: true,
      knownFields: [
        'datasets[].name',
        'datasets[].currentLayout',
        'datasets[].entries[].addonNameHash',
        'datasets[].entries[].x',
        'datasets[].entries[].y',
        'datasets[].entries[].scale',
        'datasets[].entries[].width',
        'datasets[].entries[].height',
        'datasets[].entries[].alpha',
        'datasets[].layouts[].entries',
      ],
      candidateFields: ['datasets[].layouts[].nameCandidate'],
      unknownFields: [
        {
          field: 'entries[].elementFlags',
          reason:
            '该值会随界面元素表示热键栏形状或职业量谱模式等，当前源码未定义各元素的位掩码。',
          kind: 'meaning',
        },
        {
          field: 'entries[].byteValue1 / byteValue2 / byteValue3',
          reason:
            '当前源码仅对可见/启用用途加问号注释，不能将它们一律当成布尔开关。',
          kind: 'meaning',
        },
        {
          field:
            'containerHeaderHex / datasets[].headerHex / layouts[].headerHex / unknownTailHex',
          reason: '容器范围和偏移已核验；其余未使用的头尾字节原样保留。',
          kind: 'storage',
        },
      ],
    },
  };
}

// Source names are appended below; no sibling repository is needed at runtime.
// [Addon(...)] names from FFXIVClientStructs b72bc1f73, Client/UI/Addon*.cs.
const addonSourceNames = [
  'AOZNotebook',
  'ActionCrossEditor',
  'ActionMenu',
  'AdventureNoteBook',
  'AetherCurrent',
  'AirShipExploration',
  'AirShipExplorationResult',
  'Alliance48',
  'AreaMap',
  'ArmouryBoard',
  'Bank',
  'BannerEditor',
  'BannerPreview',
  'Buddy',
  'Cabinet',
  'CabinetWithdraw',
  'CastBarEnemy',
  'Character',
  'CharacterClass',
  'CharacterInspect',
  'CharacterRepute',
  'ChatLog',
  'ChatLogPanel_0',
  'ChatLogPanel_1',
  'ChatLogPanel_2',
  'ChatLogPanel_3',
  'ContentsFinder',
  'ContentsFinderConfirm',
  'ContextMenu',
  'Currency',
  'CursorAddon',
  'CutSceneSelectString',
  'Dialogue',
  'DifficultySelectYesNo',
  'DragDropS',
  'FGSEnterDialog',
  'FGSExitDialog',
  'FashionCheck',
  'FateProgress',
  'FateReward',
  'FieldMarker',
  'Filter',
  'FilterSystem',
  'FishGuide2',
  'FishingNote',
  'FlyText',
  'FreeShop',
  'FriendList',
  'FrontlineRecord',
  'GSInfoCardDeck',
  'GSInfoCardList',
  'GSInfoChocoboParam',
  'GSInfoEditDeck',
  'GSInfoEmj',
  'GSInfoGeneral',
  'GSInfoMinionBattle',
  'Gathering',
  'GatheringMasterpiece',
  'GcArmyCapture',
  'GcArmyExpedition',
  'GcArmyExpeditionReport',
  'GearSetList',
  'GlassSelect',
  'GoldSaucerInfo',
  'GrandCompanySupplyList',
  'GrandCompanySupplyReward',
  'GuildLeve',
  'GuildLeveDifficulty',
  'HWDAetherGauge',
  'HWDLottery',
  'InclusionShop',
  'InputNumeric',
  'Inventory',
  'InventoryBuddy',
  'InventoryEvent',
  'InventoryExpansion',
  'InventoryGrid',
  'InventoryGrid0',
  'InventoryGrid0E',
  'InventoryGrid1',
  'InventoryGrid1E',
  'InventoryGrid2E',
  'InventoryGrid3E',
  'InventoryLarge',
  'InventoryRetainer',
  'InventoryRetainerLarge',
  'ItemDetail',
  'ItemDetailCompare',
  'ItemInspectionResult',
  'ItemSearch',
  'ItemSearchResult',
  'JobHudACN0',
  'JobHudAST0',
  'JobHudBLM0',
  'JobHudBLM1',
  'JobHudBRD0',
  'JobHudDNC0',
  'JobHudDNC1',
  'JobHudDRG0',
  'JobHudDRK0',
  'JobHudDRK1',
  'JobHudGFF0',
  'JobHudGFF1',
  'JobHudGNB0',
  'JobHudMCH0',
  'JobHudMNK0',
  'JobHudMNK1',
  'JobHudNIN0',
  'JobHudNIN1v70',
  'JobHudPLD0',
  'JobHudRDB0',
  'JobHudRDB1',
  'JobHudRDM0',
  'JobHudRPM0',
  'JobHudRPM1',
  'JobHudRRP0',
  'JobHudRRP1',
  'JobHudSAM0',
  'JobHudSAM1',
  'JobHudSCH0',
  'JobHudSMN0',
  'JobHudSMN1',
  'JobHudWAR0',
  'JobHudWHM0',
  'JobHudXBM0',
  'JournalAccept',
  'JournalDetail',
  'JournalResult',
  'ListIcon',
  'LobbyDKTCheck',
  'LobbyDKTCheckExec',
  'LookingForGroup',
  'LookingForGroupCondition',
  'LookingForGroupDetail',
  'LotteryDaily',
  'LotteryWeeklyInput',
  'LovmPaletteEdit',
  'LovmResult',
  'MJICraftMaterialConfirmation',
  'MJICraftScheduleSetting',
  'MJIMinionNoteBook',
  'MKSRecord',
  'MYCWarResultNotebook',
  'Macro',
  'MateriaAttachDialog',
  'MateriaRetrieveDialog',
  'MiragePrismExecute',
  'MiragePrismPrismBox',
  'MiragePrismPrismBoxCrystallize',
  'MiragePrismPrismSetConvert',
  'MiragePrismPrismSetConvertC',
  'MiragePrismRemove',
  'MobHunt',
  'NamePlate',
  'NeedGreed',
  'OperationGuide',
  'PointMenu',
  'PurifyResult',
  'PvPCharacter',
  'RaceChocoboResult',
  'RaidFinder',
  'RecipeMaterialList',
  'RecipeNote',
  'ReconstructionBox',
  'RelicNoteBook',
  'Repair',
  'Request',
  'RetainerItemTransferProgress',
  'RetainerList',
  'RetainerSell',
  'RetainerTaskAsk',
  'RetainerTaskList',
  'RetainerTaskResult',
  'SalvageAutoDialog',
  'SalvageDialog',
  'SalvageItemSelector',
  'SalvageResult',
  'SatisfactionList',
  'SatisfactionSupply',
  'ScreenFrame',
  'SelectOk',
  'SelectString',
  'SelectYesno',
  'Shop',
  'ShopCardDialog',
  'ShopExchangeItemDialog',
  'Social',
  'SpearFishing',
  'Talk',
  'TalkSubtitle',
  'Teleport',
  'TelepotTown',
  'Tooltip',
  'Trade',
  'TradeMultiple',
  'TripleTriad',
  'WKSReward',
  'WeeklyBingo',
  'WeeklyPuzzle',
  'XBMMonsterBookDetail',
  'XBMMonsterNotebook',
  '_ActionBar',
  '_ActionBar01',
  '_ActionBar02',
  '_ActionBar03',
  '_ActionBar04',
  '_ActionBar05',
  '_ActionBar06',
  '_ActionBar07',
  '_ActionBar08',
  '_ActionBar09',
  '_ActionCross',
  '_ActionDoubleCrossL',
  '_ActionDoubleCrossR',
  '_AllianceList1',
  '_AllianceList2',
  '_BagWidget',
  '_CastBar',
  '_CharaSelectWorldServer',
  '_ConfigPartyListRoleSort',
  '_DTR',
  '_EnemyList',
  '_Exp',
  '_HudLayoutScreen',
  '_HudLayoutWindow',
  '_Image',
  '_Image3',
  '_LimitBreak',
  '_MainCross',
  '_MiniTalk',
  '_Money',
  '_NaviMap',
  '_Notification',
  '_ParameterWidget',
  '_PartyList',
  '_ToDoList',
];
const addonNamesByHash = new Map<number, string>(
  addonSourceNames.map((name) => [crc32(`${name}_a`), name]),
);
