import { decodeNativeUiSegment } from './uisave-native.ts';
import { decodeNativeCwls } from './uisave-cwls.ts';
import { decodeNativeSocial } from './uisave-social.ts';
import { decodeNativeAoz } from './uisave-aoz.ts';
import { decodeNativeRetainerComments } from './uisave-retainers.ts';
import { nativeFlagDetails } from './uisave-flag-details.ts';
import {
  decodeEmjYakumanHistory,
  decodeEmjNpcWins,
} from './uisave-emj-history.ts';

function uints(data: Buffer, offset: number, count: number, width: number) {
  if (offset + count * width > data.length)
    throw new RangeError('Truncated UISAVE list');
  return Array.from({ length: count }, (_, i) =>
    data.readUIntLE(offset + i * width, width),
  );
}

function decodeAdditionalUiSegmentData(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 1 && version === 101 && data.length === 168) {
    // Target CN client: writer 0x1407ef9b0 zeroes 169 bytes, then writes
    // count:u8 and (RetainerId:u64, VentureComplete:u32) at stride 16.
    // 0x140cb9405/0x140cb951b pass RetainerManager's active RetainerId and
    // 0x140b051f0's Retainer+0x3c (VentureComplete) to 0x1407f0180.
    if (data[0] > 10) return null;
    return {
      savedEntryCount: data[0],
      retainerCount: data[0],
      countCandidate: data[0],
      reservedHeaderHex: data.subarray(1, 8).toString('hex'),
      unknownHeaderHex: data.subarray(4, 8).toString('hex'),
      tasks: Array.from({ length: 10 }, (_, index) => {
        const offset = 8 + index * 16;
        return {
          index,
          offset,
          isStoredEntry: index < data[0],
          retainerId: data.readBigUInt64LE(offset).toString(),
          retainerIdCandidate: data.readBigUInt64LE(offset).toString(),
          completionUnix: data.readUInt32LE(offset + 8),
          completionUnixCandidate: data.readUInt32LE(offset + 8),
          reservedTailHex: data
            .subarray(offset + 12, offset + 16)
            .toString('hex'),
          unknown: data.readUInt32LE(offset + 12),
        };
      }),
      note: '首字节表示保存的雇员任务条目数；最多10条，每条保存64位雇员ID与探险完成时间。其余前导与每条尾部四字节由目标客户端清零，旧Candidate字段作为兼容别名保留。',
    };
  }
  if (
    id === 2 &&
    version === 100 &&
    data.length === 384 &&
    data.readUInt32LE(4) === 96 &&
    data.readUInt32LE(112) === 2 &&
    data.readUInt32LE(116) === 256
  ) {
    const flags = uints(data, 128, 64, 4);
    return {
      patchMarksHeaderHex: data.subarray(0, 16).toString('hex'),
      patchMarkVersions: uints(data, 16, 32, 2),
      patchMarkStates: [...data.subarray(80, 112)],
      uiFlagsHeaderHex: data.subarray(112, 128).toString('hex'),
      uiFlags: flags,
      ...nativeFlagDetails(flags),
      namedFlagsCandidate: {
        summonedCompanionId: flags[1],
        lastSeenMentorVersion: flags[10],
        hideMentorRenewDialogueRaw: flags[11],
        defaultCurrencyRotationIndex: flags[13],
        currencySettingIdsPacked: flags[14],
        currencySettingRotation5: flags[15],
        actionsAndTraitsDisplayMode: flags[16],
        hidePortraitUpdatePreviewRaw: flags[21],
      },
      note: 'The disk contains a 96-byte patch-mark block and a 256-byte UI flag block. Runtime PatchMarkIds are not serialized in this sampled layout.',
    };
  }
  if (id === 11 && version === 0 && data.length >= 16) {
    const chunks: Record<string, unknown>[] = [];
    let offset = 0;
    while (
      offset + 16 <= data.length &&
      data.subarray(offset).some((byte) => byte !== 0)
    ) {
      const key = data.readUInt32LE(offset);
      const length = data.readUInt32LE(offset + 4);
      if (offset + 16 + length > data.length) return null;
      const body = data.subarray(offset + 16, offset + 16 + length);
      chunks.push({
        key,
        offset,
        length,
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        dataHex: body.toString('hex'),
        bytes: [...body],
        u32Values:
          body.length % 4 === 0
            ? uints(body, 0, body.length / 4, 4)
            : undefined,
      });
      offset += 16 + length;
    }
    for (const chunk of chunks) {
      const bytes = Buffer.from(String(chunk.dataHex), 'hex');
      if (chunk.key === 2 && bytes.length === 16) {
        // Target SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
        // 0x1408044a7..4bf writes key 2, size 16, from EmjModule+0x48;
        // 0x140804757 copies it back. The getter/setter at 0x140803e70/
        // 0x140803ef0 connect the first nine public settings to the UI at
        // 0x1410c0d40/0x1410c12e2. Voice/costume setters are called at
        // 0x1410c19ee/0x1410c1a02; disable-voice at 0x1410b8a1a.
        const savedSettings = {
          tileSet: bytes[0],
          hideHints: bytes[1],
          hideDangerousTileMarker: bytes[2],
          hideChatLog: bytes[3],
          unknownSettingsByte4: bytes[4],
          unknownSettingsByte5: bytes[5],
          hideTileNames: bytes[6],
          showHighResolutionLayout: bytes[7],
          showTraditionalDoraIndicator: bytes[8],
          ownPlayerNameSetting: bytes[9],
          othersPlayerNameSetting: bytes[10],
          disableCharacterVoices: bytes[11],
          emjVoiceNpc: bytes[12],
          emjCostumeId: bytes[13],
          unknownTailHex: bytes.subarray(14).toString('hex'),
        };
        const bool = (raw: number) => (raw <= 1 ? raw === 1 : null);
        // Match 0x140804767..7b7 load guards. For the other four bools the
        // reader keeps the byte: noncanonical values remain uninterpreted.
        const settings = {
          ...savedSettings,
          tileSet: bytes[0] < 2 ? bytes[0] : 0,
          hideHints: bool(bytes[1]),
          hideDangerousTileMarker: bool(bytes[2]),
          hideChatLog: bool(bytes[3]),
          hideTileNames: bytes[6] === 1,
          showHighResolutionLayout: bool(bytes[7]),
          showTraditionalDoraIndicator: bytes[8] !== 0,
          ownPlayerNameSetting: bytes[9] < 5 ? bytes[9] : 0,
          othersPlayerNameSetting: bytes[10] < 5 ? bytes[10] : 0,
          disableCharacterVoices: bytes[11] === 1,
          emjVoiceNpc: bytes[12] < 15 ? bytes[12] : 0,
          emjCostumeId: bytes[13] < 2 ? bytes[13] : 0,
        };
        chunk.data = {
          savedSettings,
          settings,
          settingsCandidate: settings, // Compatibility alias.
        };
      } else if (
        (chunk.key === 3 && bytes.length === 3) ||
        (chunk.key === 4 && bytes.length === 4)
      ) {
        // 0x1408044c6..512 writes keys 3/4 from +0xc8/+0xcc;
        // 0x140804742..755 reads them back. 0x1408042f0/0x1408043a0
        // test bit (ID - 1), rejecting voice IDs outside 1..14 and costume
        // seen IDs outside 1..21. Costume IDs come from EmjCostume+0x1c
        // (0x1410c31df), not its subrow index used by settings.emjCostumeId.
        const voice = chunk.key === 3;
        const limit = voice ? 14 : 21;
        const seenIds = Array.from(
          { length: limit },
          (_, index) => index + 1,
        ).filter((id) => (bytes[(id - 1) >> 3] & (1 << ((id - 1) & 7))) !== 0);
        const reservedBits = Buffer.from(bytes);
        for (let index = 0; index < limit; index++)
          reservedBits[index >> 3] &= ~(1 << (index & 7));
        chunk.data = {
          ...(voice
            ? { seenVoiceNpcIds: seenIds }
            : { seenCostumeIds: seenIds }),
          seenBitflagsHex: bytes.toString('hex'),
          reservedBitsHex: reservedBits.toString('hex'),
          idMeaning: voice
            ? 'EmjVoiceNpc row ID; bit index = ID - 1, valid IDs 1..14'
            : 'EmjCostume seen ID (+0x1c); bit index = ID - 1, valid IDs 1..21; not the costume subrow index',
        };
      } else if (chunk.key === 1 && bytes.length === 32) {
        chunk.data = decodeEmjNpcWins(bytes);
      } else if (chunk.key === 0 && bytes.length === 80) {
        chunk.data = {
          yakumanHistory: decodeEmjYakumanHistory(bytes),
          historyReferenceBasis:
            '原生和牌役列表的役满标志及五条历史写入链；役名使用固定公开Addon表文字，未重新提取目标SqPack。',
          statisticsCandidate: {
            // 0x140803fd0 shifts four 16B entries and writes the newest at
            // module+0x58. Value and clock meanings are intentionally unnamed.
            historyEntries: Array.from({ length: 5 }, (_, index) => ({
              index,
              valueRaw: bytes.readInt32LE(index * 16),
              timeRaw: bytes.readInt32LE(index * 16 + 4),
              reservedHex: bytes
                .subarray(index * 16 + 8, index * 16 + 16)
                .toString('hex'),
            })),
            unknownValue: bytes.readInt32LE(0),
            timestampCandidate: bytes.readInt32LE(4),
            unknownGapHex: bytes.subarray(8, 16).toString('hex'),
            historyValues: Array.from({ length: 16 }, (_, index) =>
              bytes.readInt32LE(16 + index * 4),
            ),
          },
        };
      }
    }
    return {
      chunks,
      zeroPaddingHex: data.subarray(offset).toString('hex'),
      note: 'Block 2 is the native 16-byte EmjModule+0x48 settings image; named public fields are confirmed by serialization and UI consumers. savedSettings retains byte values; settings applies native load guards. Blocks 3/4 are voice/costume seen bitmaps with ID-minus-one indexing. Private settings bytes remain unresolved. Block0 is Yakuman history; block1 contains NPC difficulty win counters. settingsCandidate is retained as a compatibility alias.',
    };
  }
  return null;
}

export function decodeAdditionalUiSegment(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 13) return decodeNativeCwls(version, data);
  if (id === 4) return decodeNativeSocial(version, data);
  if (id === 12) return decodeNativeAoz(version, data);
  if (id === 22) return decodeNativeRetainerComments(version, data);
  const native = decodeNativeUiSegment(id, version, data);
  if (native) return native;
  const decoded = decodeAdditionalUiSegmentData(id, version, data);
  if (!decoded) return null;
  type Unknown = {
    field: string;
    reason: string;
    kind: 'meaning' | 'storage' | 'reference';
  };
  const unknownFields: Unknown[] = [];
  const storage = (
    field: string,
    reason = '该存储区域尚无已定义的业务字段；原始字节完整保留。',
  ) => unknownFields.push({ field, reason, kind: 'storage' });
  const meaning = (field: string, reason: string) =>
    unknownFields.push({ field, reason, kind: 'meaning' });
  let knownFields: string[] = [];
  const candidateFields: string[] = [];
  switch (id) {
    case 1:
      knownFields = [
        'savedEntryCount',
        'retainerCount',
        'tasks.isStoredEntry',
        'tasks.retainerId',
        'tasks.completionUnix',
      ];
      storage(
        'reservedHeaderHex / unknownHeaderHex',
        '客户端只读写首字节数量，偏移1至7为前导填充；原值完整保留。',
      );
      storage(
        'tasks.reservedTailHex / tasks.unknown',
        '写入器清零每条记录尾部4字节，读取器不将其加入任务映射；保留原值。',
      );
      decoded.note =
        '静态调用链确认时间来自RetainerManager.Retainer.VentureComplete；客户端以此时间跨过当前秒触发完成通知。数据是本地保存快照；Candidate字段仅为旧输出兼容别名，不再表示此项仍为推断。';
      break;
    case 2: {
      knownFields = ['patchMarkVersions', 'patchMarkStates', 'uiFlags'];
      const flags = decoded.uiFlags as number[];
      decoded.namedFlags = {
        summonedCompanionId: flags[1],
        lastSeenMentorVersion: flags[10],
        hideMentorRenewDialogue: flags[11] <= 1 ? flags[11] !== 0 : null,
        defaultCurrencyRotationIndex: flags[13],
        currencySettingIds0To3: [0, 8, 16, 24].map(
          (shift) => (flags[14] >>> shift) & 255,
        ),
        currencySettingIdForRotation5: flags[15] & 255,
        actionsAndTraitsCompactView: flags[16] <= 1 ? flags[16] !== 0 : null,
        hidePortraitUpdatePreview: flags[21] <= 1 ? flags[21] !== 0 : null,
      };
      // Target 0x1407f8c90 writer maps module+0x1ac to file+128;
      // 0x1407f8e25 reader copies block 2 back to that same array.
      // Names/indices are from FlagStatusModule.cs b72bc1f73 remarks.
      // This is a static storage/source match, not a runtime observation.
      knownFields.push(
        ...Object.keys(decoded.namedFlags as Record<string, unknown>).map(
          (field) => `namedFlags.${field}`,
        ),
      );
      decoded.namedFlagsBasis =
        '目标客户端writer 0x1407f8c90 / reader 0x1407f8d80确认UIFlags数组偏移；字段名和8个索引来自FFXIVClientStructs b72bc1f73 FlagStatusModule.cs；未进行游戏运行时验证。';
      for (const [field, rawIndex] of [
        ['hideMentorRenewDialogue', 11],
        ['actionsAndTraitsCompactView', 16],
        ['hidePortraitUpdatePreview', 21],
      ] as const) {
        if (flags[rawIndex] > 1)
          meaning(
            `namedFlags.${field}`,
            `索引${rawIndex}出现0/1之外的布尔原值，uiFlags与兼容候选字段保留原值，未将其当作true。`,
          );
      }
      knownFields.push(
        'pvpWelcomeSeen',
        'jobHudManualStates',
        'jobHudManualVersion',
        'jobHudManualNeedsReset',
        'itemContextCustomizationVersion',
        'classToJobHotbarPrompts',
        'miniGameHighScore',
      );
      const hasUnmappedValues = (
        decoded.unmappedUiFlags as { index: number; value: number }[]
      ).some((entry) => entry.value !== 0);
      (hasUnmappedValues ? meaning : storage)(
        'unmappedUiFlags',
        hasUnmappedValues
          ? '出现未命名索引的非零保存值，需继续核对业务消费者。'
          : '未命名索引当前全部为零，完整原值保留；后续出现非零值时应作为未解业务字段报告。',
      );
      if (Number(decoded.classToJobHotbarUnknownBits))
        meaning(
          'classToJobHotbarUnknownBits',
          '九个原生职业提示位之外出现非零位，原值保留。',
        );
      storage(
        'jobHudManualReservedBit0',
        '职业量谱说明查询拒绝编号0；位0仍按原值保留。',
      );
      storage('patchMarksHeaderHex');
      storage('uiFlagsHeaderHex');
      break;
    }
    case 11:
      knownFields = ['chunks.key', 'chunks.length', 'chunks.dataHex'];
      for (const chunk of decoded.chunks as Record<string, unknown>[]) {
        const content = chunk.data as Record<string, unknown> | undefined;
        if (chunk.key === 2 && content?.settings) {
          knownFields.push(
            ...[
              'tileSet',
              'hideHints',
              'hideDangerousTileMarker',
              'hideChatLog',
              'hideTileNames',
              'showHighResolutionLayout',
              'showTraditionalDoraIndicator',
              'ownPlayerNameSetting',
              'othersPlayerNameSetting',
              'disableCharacterVoices',
              'emjVoiceNpc',
              'emjCostumeId',
            ].map((field) => `chunks[key=2].data.settings.${field}`),
          );
          meaning(
            'chunks[key=2].data.settings.unknownSettingsByte4/5',
            '原生读写确认对应EmjModule+0x4C/0x4D，但业务用途仍未确认，原值保留。',
          );
          storage(
            'chunks[key=2].data.settings.unknownTailHex',
            '设置块末尾两字节在源码设置字段范围之外，原始值保留。',
          );
          const settings = content.settings as Record<string, unknown>;
          for (const field of [
            'hideHints',
            'hideDangerousTileMarker',
            'hideChatLog',
            'showHighResolutionLayout',
          ]) {
            if (settings[field] === null)
              meaning(
                `chunks[key=2].data.settings.${field}`,
                '该布尔字节不是0/1，原生读入未规范化此字段；已保留savedSettings原值，未将任意非零值当作true。',
              );
          }
        } else if (
          (chunk.key === 3 && content?.seenVoiceNpcIds) ||
          (chunk.key === 4 && content?.seenCostumeIds)
        ) {
          knownFields.push(
            `chunks[key=${chunk.key}].data.${chunk.key === 3 ? 'seenVoiceNpcIds' : 'seenCostumeIds'}`,
            `chunks[key=${chunk.key}].data.seenBitflagsHex`,
            `chunks[key=${chunk.key}].data.idMeaning`,
          );
          storage(
            `chunks[key=${chunk.key}].data.reservedBitsHex`,
            '目标客户端的已查看查询拒绝其余位对应的编号，原始保存位保留。',
          );
        } else if (chunk.key === 0 && content?.statisticsCandidate) {
          knownFields.push(
            'chunks[key=0].data.yakumanHistory.storedYakuId',
            'chunks[key=0].data.yakumanHistory.yakuCode',
            'chunks[key=0].data.yakumanHistory.achievedAtUnix',
            'chunks[key=0].data.yakumanHistory.hasRecord',
          );
          const history = content.yakumanHistory as Record<string, unknown>[];
          if (history.some((entry) => entry.hasRecord))
            candidateFields.push(
              'chunks[key=0].data.yakumanHistory.yakuNameCandidate',
            );
          if (
            history.some(
              (entry) => entry.hasRecord && entry.addonTextId === null,
            )
          )
            meaning(
              'chunks[key=0].data.yakumanHistory.storedYakuId',
              '出现原生役满编号41至55之外的非零保存值，原值保留，未套用役名。',
            );
          storage(
            'chunks[key=0].data.yakumanHistory.reservedHex',
            '每条16字节记录后8字节整体移动保存，写入器只给前8字节赋役编号和Unix秒时间；保留尾部原值。',
          );
        } else if (chunk.key === 1 && Array.isArray(content?.npcWins)) {
          knownFields.push('chunks[key=1].data.npcWins.winCount');
          candidateFields.push(
            'chunks[key=1].data.npcWins.difficultyNameCandidate',
          );
          storage(
            'chunks[key=1].data.reservedHex',
            '原生只读写前三个16位人机胜场计数器；其余26字节原值保留。',
          );
        } else
          meaning(
            `chunks[key=${chunk.key}].data`,
            `该${chunk.length}字节块的业务用途未由源码或非默认样本确认；完整数值仍保留，不能强贴声优或服装标签。`,
          );
      }
      storage('chunks.reservedHex');
      if (decoded.zeroPaddingHex)
        storage(
          'zeroPaddingHex',
          '记录块后仍有全零尾区，未把它解释成业务字段。',
        );
      break;
  }
  return {
    ...decoded,
    coverage: {
      structureComplete: true,
      knownFields,
      candidateFields,
      unknownFields,
    },
  };
}
