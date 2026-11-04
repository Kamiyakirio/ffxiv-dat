import { decodeNativeUiSegment } from './uisave-native.ts';
import { decodeNativeCwls } from './uisave-cwls.ts';

function uints(data: Buffer, offset: number, count: number, width: number) {
  if (offset + count * width > data.length)
    throw new RangeError('Truncated UISAVE list');
  return Array.from({ length: count }, (_, i) =>
    data.readUIntLE(offset + i * width, width),
  );
}

function string(data: Buffer) {
  const zero = data.indexOf(0);
  return data.subarray(0, zero < 0 ? data.length : zero).toString('utf8');
}

/** Printable NUL-separated strings are candidates, not inferred record names. */
function stringCandidates(data: Buffer) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const result: { offset: number; byteLength: number; text: string }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = data.indexOf(0, offset);
    if (end < 0) break;
    if (end - offset >= 2) {
      try {
        const text = decoder.decode(data.subarray(offset, end));
        if (text.length >= 2 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) {
          result.push({ offset, byteLength: end - offset, text });
        }
      } catch {
        /* Binary data need not be UTF-8. */
      }
    }
    offset = end + 1;
  }
  return result;
}

function decodeAdditionalUiSegmentData(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 1 && version === 101 && data.length === 168) {
    return {
      retainerCount: data.readUInt32LE(0),
      countCandidate: data.readUInt32LE(0),
      unknownHeaderHex: data.subarray(4, 8).toString('hex'),
      tasks: Array.from({ length: 10 }, (_, index) => {
        const offset = 8 + index * 16;
        return {
          index,
          offset,
          retainerId: data.readBigUInt64LE(offset).toString(),
          retainerIdCandidate: data.readBigUInt64LE(offset).toString(),
          completionUnixCandidate: data.readUInt32LE(offset + 8),
          unknown: data.readUInt32LE(offset + 12),
        };
      }),
      note: 'u64/u32/u32 record widths and timestamps fit both samples; RetainerTaskDataModule does not publish field names.',
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
  if (id === 4 && version === 106 && data.length === 46080) {
    return {
      groupLabelsCandidate: Array.from({ length: 7 }, (_, index) => ({
        index,
        offset: 20 + index * 64,
        name: string(data.subarray(20 + index * 64, 80 + index * 64)),
      })),
      contactRecordsCandidate: Array.from({ length: 50 }, (_, index) => {
        const offset = 488 + index * 64;
        return {
          index,
          offset,
          name: string(data.subarray(offset, offset + 32)),
          contentIdCandidate: data.readBigUInt64LE(offset + 32).toString(),
          unknownAfterContentIdHex: data
            .subarray(offset + 40, offset + 64)
            .toString('hex'),
        };
      }),
      printableStringCandidates: stringCandidates(data),
      note: 'Group/title and 50 contact record strides are supported by the historical UISAVE reader and positive names/Content IDs. Other social blocks are not mapped to friend/blacklist/mutelist categories.',
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
        chunk.data = {
          settingsCandidate: {
            tileSet: bytes[0],
            hideHints: bytes[1] !== 0,
            hideDangerousTileMarker: bytes[2] !== 0,
            hideChatLog: bytes[3] !== 0,
            unknownSettingsByte4: bytes[4],
            unknownSettingsByte5: bytes[5],
            hideTileNames: bytes[6] !== 0,
            showHighResolutionLayout: bytes[7] !== 0,
            showTraditionalDoraIndicator: bytes[8] !== 0,
            ownPlayerNameSetting: bytes[9],
            othersPlayerNameSetting: bytes[10],
            disableCharacterVoices: bytes[11] !== 0,
            emjVoiceNpc: bytes[12],
            emjCostumeId: bytes[13],
            unknownTailHex: bytes.subarray(14).toString('hex'),
          },
        };
      } else if (chunk.key === 0 && bytes.length === 80) {
        chunk.data = {
          statisticsCandidate: {
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
      note: 'Block 2 has 14 settings bytes plus 2 stored bytes matching EmjModule+0x48..0x55; block 0 has 80 bytes matching +0x58..0xA8. The offsets fit all samples, but public settings are still default-valued in the available snapshots. The settings/statistics bindings remain candidates; other block meanings are not assigned.',
    };
  }
  if (id === 12 && version === 3 && data.length === 1825) {
    return {
      activeSetsCandidate: Array.from({ length: 5 }, (_, index) => {
        const offset = index * 333;
        return {
          index,
          offset,
          activeBlueMageActionIds: [...data.subarray(offset, offset + 24)],
          name: string(data.subarray(offset + 24, offset + 85)),
          standardHotbars: Array.from({ length: 10 }, (_, bar) => [
            ...data.subarray(offset + 85 + bar * 12, offset + 97 + bar * 12),
          ]),
          crossHotbars: Array.from({ length: 8 }, (_, bar) => [
            ...data.subarray(offset + 205 + bar * 16, offset + 221 + bar * 16),
          ]),
          macroFlagMaskCandidateHex: data
            .subarray(1665 + index * 32, 1697 + index * 32)
            .toString('hex'),
        };
      }),
      note: 'Five packed 333-byte action/name/hotbar sets plus 160 bytes consume this version exactly. The final 32-byte-per-set macro flag masks are candidates; bit ordering is not verified.',
    };
  }
  if (id === 22 && version === 102 && data.length === 1376) {
    return {
      headerHex: data.subarray(0, 8).toString('hex'),
      retainersCandidate: Array.from({ length: 10 }, (_, index) => {
        const offset = 8 + index * 136;
        return {
          index,
          offset,
          id: data.readBigUInt64LE(offset).toString(),
          comment: string(data.subarray(offset + 8, offset + 99)),
          unusedRecordBytesHex: data
            .subarray(offset + 99, offset + 136)
            .toString('hex'),
        };
      }),
      trailerHex: data.subarray(1368).toString('hex'),
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
  let candidateFields: string[] = [];
  switch (id) {
    case 1:
      knownFields = ['retainerCount', 'tasks.retainerId'];
      candidateFields = ['tasks.completionUnixCandidate'];
      storage('unknownHeaderHex');
      meaning(
        'tasks.unknown',
        '任务记录尾部的 u32 尚无非零样本或源码字段对应。',
      );
      decoded.note =
        '雇员数量和64位ID已与同角色的ITEMFDR/ITEMODR缓存交叉核对；时间数值保留，尚不能确定它代表完成、派遣还是更新。';
      break;
    case 2: {
      knownFields = ['patchMarkVersions', 'patchMarkStates', 'uiFlags'];
      candidateFields = ['namedFlagsCandidate'];
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
      candidateFields.push('namedFlags');
      meaning(
        'uiFlags.unlistedIndices',
        '源码只给出1、10、11、13、14、15、16、21的含义，其余索引值均保留但不能命名。',
      );
      storage('patchMarksHeaderHex');
      storage('uiFlagsHeaderHex');
      break;
    }
    case 4:
      candidateFields = [
        'groupLabelsCandidate',
        'contactRecordsCandidate.name',
        'contactRecordsCandidate.contentIdCandidate',
      ];
      storage('header[0..20]');
      meaning(
        'socialDataAfterContactRecords[3688..46080]',
        '此版本还含其他社交块，当前源码只定义动态运行时MuteList，无法确认磁盘块类别与边界。',
      );
      meaning(
        'contactRecordsCandidate.unknownAfterContentIdHex',
        '联系人后24字节无已核对的字段对应。',
      );
      break;
    case 11:
      knownFields = ['chunks.key', 'chunks.length', 'chunks.dataHex'];
      for (const chunk of decoded.chunks as Record<string, unknown>[]) {
        const content = chunk.data as Record<string, unknown> | undefined;
        if (chunk.key === 2 && content?.settingsCandidate) {
          candidateFields.push(
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
            ].map((field) => `chunks[key=2].data.settingsCandidate.${field}`),
          );
          meaning(
            'chunks[key=2].data.settingsCandidate.unknownSettingsByte4/5',
            '源码EmjModule将0x4C/0x4D定义为私有未知字节；不能命名成开关。',
          );
          storage(
            'chunks[key=2].data.settingsCandidate.unknownTailHex',
            '设置块末尾两字节在源码设置字段范围之外，原始值保留。',
          );
        } else if (chunk.key === 0 && content?.statisticsCandidate) {
          candidateFields.push(
            'chunks[key=0].data.statisticsCandidate.timestampCandidate',
          );
          meaning(
            'chunks[key=0].data.statisticsCandidate.unknownValue/historyValues',
            '对应源码Unk58和Unk68历史数组，数值类型可读，但统计项目的含义尚未定义。',
          );
          storage('chunks[key=0].data.statisticsCandidate.unknownGapHex');
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
    case 12:
      candidateFields = [
        'activeSetsCandidate.activeBlueMageActionIds',
        'activeSetsCandidate.name',
        'activeSetsCandidate.standardHotbars',
        'activeSetsCandidate.crossHotbars',
      ];
      meaning(
        'activeSetsCandidate.macroFlagMaskCandidateHex',
        '尾部160字节与5组各32字节对应，但位顺序及标志含义尚未通过读写函数验证。',
      );
      break;
    case 22:
      candidateFields = ['retainersCandidate.id', 'retainersCandidate.comment'];
      storage('headerHex');
      storage('retainersCandidate.unusedRecordBytesHex');
      storage('trailerHex');
      decoded.note =
        '结构定义明确给出ID与91字节备注字段，记录步长与样本一致；现有样本所有ID均为零，未验证非空备注关联。';
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
