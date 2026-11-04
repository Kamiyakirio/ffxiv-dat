import type { DatDecodeResult } from './types.ts';
import { decodeTofu } from './uisave-tofu.ts';
import { decodeBanners } from './uisave-banner.ts';
import { decodeAdditionalUiSegment } from './uisave-other.ts';
import { decodeRemainingUiSegment } from './uisave-remaining.ts';
import { segmentCoverage, coverageStatus } from './coverage.ts';
import { decodeUiRecords } from './uisave-records.ts';

// Names and field candidates follow FFXIVClientStructs b72bc1f73,
// Client/UI/Misc/UiSavePackModule.cs and the corresponding *Module.cs files.
// Disk containers are independently checked against both supplied characters.
// https://github.com/PunishedPineapple/UISAVE_Reader documents the outer format.
const segmentNames = [
  'LETTER',
  'RETTASK',
  'FLAGS',
  'RCFAV',
  'UIDATA',
  'TLPH',
  'ITCC',
  'PVPSET',
  'EMTH',
  'MNONLST',
  'MUNTLST',
  'EMJ',
  'AOZNOTE',
  'CWLS',
  'ARCHVLST',
  'GRPPOS',
  'CRAFT',
  'FMARKER',
  'MYCNOT',
  'ORNMLST',
  'MYCITEM',
  'GRPSTAMP',
  'RTNR',
  'BANNER',
  'ADVNOTE',
  'AKTKNOT',
  'VVDNOTE',
  'VVDACT',
  'TOFU',
  'FISHING',
  'ACTION',
  'TFILTER',
  'READYC',
  'PTRLST',
  'CATSBM',
  'DESCRI',
  'MJICWSP',
  'PERFORM',
  'MKDSJOB',
  'MKDLORE',
  'MKDSJN',
  'QPNL',
  'GLASSES',
  'XBMNOTE',
  'XBM',
];

interface Field {
  offset: number;
  tag: string;
  length: number;
  valueHex: string;
}

interface Interpretation {
  data: Record<string, unknown>;
  warnings: string[];
  status: 'decoded' | 'partial';
}

function uints(
  data: Buffer,
  offset: number,
  count: number,
  width = 2,
): number[] {
  if (offset < 0 || offset + count * width > data.length) {
    throw new RangeError('List extends beyond UISAVE segment');
  }
  return Array.from({ length: count }, (_, i) =>
    data.readUIntLE(offset + i * width, width),
  );
}

function text(data: Buffer): string {
  const end = data.indexOf(0);
  return data.subarray(0, end < 0 ? data.length : end).toString('utf8');
}

function fields(data: Buffer, tagLength = 1): Field[] | null {
  const result: Field[] = [];
  let offset = 0;
  while (offset < data.length) {
    if (offset + tagLength + 2 > data.length) return null;
    const tag = data.subarray(offset, offset + tagLength).toString('ascii');
    if (!/^[A-Za-z0-9]+$/.test(tag)) return null;
    const length = data.readUInt16LE(offset + tagLength);
    const end = offset + tagLength + 2 + length;
    if (end > data.length) return null;
    result.push({
      offset,
      tag,
      length,
      valueHex: data.subarray(offset + tagLength + 2, end).toString('hex'),
    });
    offset = end;
  }
  return result;
}

function value(field: Field): Buffer {
  return Buffer.from(field.valueHex, 'hex');
}

// Parsed record data; final status is determined from explicit per-field coverage.
function parsedRecord(data: Record<string, unknown>): Interpretation {
  return {
    status: 'partial',
    data: {
      ...data,
    },
    warnings: [],
  };
}

function interpretSegment(
  id: number,
  version: number,
  data: Buffer,
): Interpretation {
  if (data.length === 0) {
    return { status: 'decoded', data: { empty: true }, warnings: [] };
  }
  const records = decodeUiRecords(id, version, data);
  if (records) return parsedRecord(records);
  const remaining = decodeRemainingUiSegment(id, version, data);
  if (remaining) return parsedRecord(remaining);
  if (id === 23 && version === 0) {
    const banners = decodeBanners(data);
    if (banners) return parsedRecord(banners);
  }
  if (id === 28 && version === 0) {
    const tofu = decodeTofu(data);
    if (tofu) return parsedRecord(tofu);
  }
  const additional = decodeAdditionalUiSegment(id, version, data);
  if (additional) return parsedRecord(additional);

  // Fixed lists have an internal two-byte prefix before the source arrays.
  if (id === 3 && version === 100 && data.length === 322) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      craftingTypes: Array.from({ length: 8 }, (_, craftType) => ({
        craftType,
        recipes: Array.from({ length: 10 }, (_, slot) => {
          const offset = 2 + craftType * 40 + slot * 4;
          return {
            offset,
            recipeId: data.readUInt16LE(offset),
            isFavoriteRaw: data[offset + 2],
            isFavorite: data[offset + 2] !== 0,
            reserved: data[offset + 3],
          };
        }),
      })),
    });
  }
  if (id === 5 && version === 101 && data.length === 122) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      history: Array.from({ length: 20 }, (_, slot) => {
        const offset = 2 + slot * 6;
        return {
          slot,
          offset,
          aetheryteId: data.readUInt16LE(offset),
          flags: data[offset + 2],
          present: (data[offset + 2] & 1) !== 0,
          ward: data[offset + 3],
          plot: data[offset + 4],
          subIndex: data[offset + 5],
        };
      }),
    });
  }
  if (id === 8 && version === 102 && data.length === 310) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      history: uints(data, 2, 6),
      favorites: uints(data, 14, 20),
      seenEmotesBitmaskHex: data.subarray(54).toString('hex'),
    });
  }
  if ((id === 9 || id === 10) && version === 102 && data.length === 84) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      unseen: uints(data, 2, 10),
      favorites: uints(data, 22, 30),
      idMeaning:
        id === 10
          ? 'Mount.Order + 1 (not necessarily Mount row id)'
          : 'Companion row id',
      unknownSuffixHex: data.subarray(82).toString('hex'),
    });
  }
  if (id === 14 && version === 101 && data.length === 64) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      achievementWatchlist: uints(data, 2, 30),
      unknownSuffixHex: data.subarray(62).toString('hex'),
    });
  }
  if (id === 15 && version === 100 && data.length === 240) {
    const vector = (offset: number) =>
      Array.from({ length: 4 }, (_, i) => data.readFloatLE(offset + i * 4));
    return parsedRecord({
      cameraAngle: data.readFloatLE(12),
      cameraRotation: data.readFloatLE(32),
      cameraPositionCandidate: vector(48),
      isCharacterOrientedCameraRaw: data[64],
      lights: Array.from({ length: 3 }, (_, index) => {
        const offset = 80 + index * 48;
        return {
          index,
          offset,
          enabledRaw: data[offset],
          red: data.readFloatLE(offset + 4),
          green: data.readFloatLE(offset + 8),
          blue: data.readFloatLE(offset + 12),
          type: data.readUInt32LE(offset + 16),
          position: vector(offset + 32),
        };
      }),
      isCharacterOrientedLightRaw: data[224],
      isManualBrightnessEnabledRaw: data[225],
      manualBrightness: data.readFloatLE(228),
      characterLighting: data[232],
    });
  }
  if (id === 17 && version === 101 && data.length === 3140) {
    // Disk start +16 / stride 104 agrees with the historical reader and
    // current FieldMarkerPreset structure, including millimetre coordinates.
    return parsedRecord({
      headerHex: data.subarray(0, 16).toString('hex'),
      presets: Array.from({ length: 30 }, (_, slot) => {
        const offset = 16 + slot * 104;
        const activeMask = data[offset + 96];
        return {
          slot,
          offset,
          activeMask,
          markers: Array.from({ length: 8 }, (_, i) => ({
            name: ['A', 'B', 'C', 'D', '1', '2', '3', '4'][i],
            active: (activeMask & (1 << i)) !== 0,
            x: data.readInt32LE(offset + i * 12) / 1000,
            y: data.readInt32LE(offset + i * 12 + 4) / 1000,
            z: data.readInt32LE(offset + i * 12 + 8) / 1000,
          })),
          reserved: data[offset + 97],
          contentFinderConditionId: data.readUInt16LE(offset + 98),
          unixTimestamp: data.readInt32LE(offset + 100),
        };
      }),
      trailerHex: data.subarray(3136).toString('hex'),
    });
  }
  if (id === 18 && version === 101 && data.length === 110) {
    return parsedRecord({
      seenNoteFlags1: [...data.subarray(0, 55)],
      seenNoteFlags2: [...data.subarray(55)],
      note: 'Array names themselves are tentative in MycNoteModule.cs.',
    });
  }
  if (id === 19 && version === 101 && data.length === 22) {
    return parsedRecord({
      unknownPrefixHex: data.subarray(0, 2).toString('hex'),
      unseenOrnaments: uints(data, 2, 10),
      idMeaning: 'Ornament.Order + 1',
    });
  }
  if (id === 24 && version === 100 && data.length === 22) {
    return parsedRecord({
      unknownPrefixByte: data[0],
      automaticallyDisplayRecordRaw: data[1],
      unseenAdventureEntryIds: uints(data, 2, 10),
    });
  }
  if (id === 25 && version === 101 && data.length === 160) {
    return parsedRecord({
      entries: Array.from({ length: 80 }, (_, index) => ({
        index,
        numSubEntriesSeen: data[index * 2],
        isUnseenRaw: data[index * 2 + 1],
        isUnseen: data[index * 2 + 1] !== 0,
      })),
    });
  }
  if (id === 26 && version === 400 && data.length === 52) {
    return parsedRecord({
      seenNotes: Array.from({ length: 4 }, (_, series) => ({
        series,
        contents: [...data.subarray(series * 13, series * 13 + 13)],
      })),
    });
  }
  if (id === 27 && version === 100 && data.length === 2) {
    return parsedRecord({ action1: data[0], action2: data[1] });
  }
  if (id === 32 && version === 0 && data.length === 1) {
    return {
      status: 'decoded',
      data: { countdownLength: data[0] },
      warnings: [],
    };
  }
  if (id === 31 && version === 100 && data.length === 342) {
    return parsedRecord({
      headerHex: data.subarray(0, 16).toString('hex'),
      unknownPrefixByte: data[16],
      setting: data[17],
      settingName:
        data[17] === 0
          ? '显示过滤词编号'
          : data[17] === 1
            ? '隐藏整条消息'
            : `未定义设置 ${data[17]}`,
      termFilters: Array.from({ length: 10 }, (_, index) => {
        const offset = 18 + index * 32;
        return {
          index,
          offset,
          term: text(data.subarray(offset, offset + 31)),
          termBytesHex: data.subarray(offset, offset + 31).toString('hex'),
          channelFlags: data[offset + 31],
          channels: ['说话', '呼喊', '喊话', '悄悄话', '自定义情感动作'].filter(
            (_, bit) => (data[offset + 31] & (1 << bit)) !== 0,
          ),
          unknownChannelBits: data[offset + 31] & ~0x1f,
        };
      }),
      termFiltersEnabledRaw: data[338],
      termFiltersEnabled: data[338] !== 0,
      unknownSuffixHex: data.subarray(339).toString('hex'),
    });
  }
  if (id === 33 && version === 6 && data.length === 96) {
    return parsedRecord({
      tankOrder: uints(data, 0, 16),
      healerOrder: uints(data, 32, 16),
      dpsOrder: uints(data, 64, 16),
    });
  }
  if (id === 35 && version === 0 && data.length === 16) {
    return parsedRecord({ seenDescriptionBitfields: uints(data, 0, 4, 4) });
  }
  if (id === 36 && version === 0 && data.length === 240) {
    return parsedRecord({
      presets: Array.from({ length: 10 }, (_, index) => ({
        index,
        objectIds: uints(data, index * 24, 6, 4),
      })),
    });
  }
  if (id === 37 && version === 1 && data.length === 4) {
    const bpmSetting = data.readUInt16LE(0);
    return parsedRecord({
      bpmSetting,
      beatsPerMinute: bpmSetting & 0x1ff,
      beatsPerMeasure: (bpmSetting >> 9) & 0x0f,
      unknownBpmBits: bpmSetting >> 13,
      settings1: data[2],
      settings2: data[3],
      assignAllNotesToKeyboard: (data[2] & 1) !== 0,
      muteOtherPerformers: (data[2] & 2) !== 0,
      playbackTypeAllMembers: (data[2] & 4) !== 0,
      displayControlGuide: (data[2] & 8) !== 0,
      keyboardMode: (data[2] & 16) !== 0,
      controllerMode: (data[2] & 32) !== 0,
      accentEachMeasure: (data[2] & 64) !== 0,
      enableCountIn: (data[2] & 128) !== 0,
      soundEffectsOnlyDuringCountIn: (data[3] & 1) !== 0,
      displayMetronome: (data[3] & 2) !== 0,
      unknownSettings2Bits: data[3] & 0xfc,
    });
  }

  if ((id === 29 && version === 100) || (id === 30 && version === 1)) {
    const parsed = fields(data);
    if (parsed) {
      const result: Record<string, unknown> = {
        fields: parsed,
        completeFieldStream: true,
      };
      if (
        id === 29 &&
        parsed.length === 2 &&
        parsed[0].tag === 'N' &&
        parsed[0].length === 2 &&
        parsed[1].tag === 'i' &&
        parsed[1].length % 2 === 0
      ) {
        result.declaredCount = value(parsed[0]).readUInt16LE();
        result.unseenFishIds = uints(value(parsed[1]), 0, parsed[1].length / 2);
      }
      if (
        id === 30 &&
        parsed.length % 3 === 0 &&
        parsed.every(
          (f, i) =>
            f.tag === ['A', '0', '1'][i % 3] && f.length === [4, 1, 1][i % 3],
        )
      ) {
        result.actions = Array.from({ length: parsed.length / 3 }, (_, i) => ({
          actionId: value(parsed[i * 3]).readUInt32LE(),
          flag0: value(parsed[i * 3 + 1])[0],
          flag1: value(parsed[i * 3 + 2])[0],
        }));
      }
      return parsedRecord(result);
    }
  }

  if (id === 0 && version === 101 && data.length === 2580) {
    return parsedRecord({
      headerHex: data.subarray(0, 16).toString('hex'),
      countCandidate: data.readUInt32LE(4),
      records: Array.from({ length: 20 }, (_, index) => {
        const offset = 16 + index * 128;
        return {
          index,
          offset,
          recipientName: text(data.subarray(offset, offset + 36)),
          gil: data.readUInt32LE(offset + 36),
          unixTimestamp: data.readUInt32LE(offset + 40),
          items: Array.from({ length: 5 }, (_, item) => ({
            itemId: data.readUInt32LE(offset + 44 + item * 8),
            quantity: data.readUInt32LE(offset + 48 + item * 8),
          })),
          unknownTailHex: data
            .subarray(offset + 84, offset + 128)
            .toString('hex'),
        };
      }),
      trailerHex: data.subarray(2576).toString('hex'),
    });
  }

  return {
    status: 'partial',
    data: {
      decodedByteLength: data.length,
      allZero: data.every((byte) => byte === 0),
    },
    warnings: [
      'Disk record semantics for this segment/version are not established; bytes have only been unmasked.',
    ],
  };
}

/** Input is the outer valid data region after XOR 0x31, starting at file +16. */
export function decodeUiSave(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings: string[] = [];
  if (version !== 1)
    warnings.push(`UISAVE outer version ${version} is not verified.`);
  if (payload.length < 16) {
    return {
      status: 'unsupported',
      data: { decodedHex: payload.toString('hex') },
      warnings: ['UISAVE header is truncated.'],
    };
  }
  const headerSize = payload.readUInt32LE(0);
  const declaredCount = payload.readUInt32LE(4);
  if (headerSize !== 16) {
    return {
      status: 'unsupported',
      data: { headerSize, declaredCount, decodedHex: payload.toString('hex') },
      warnings: [`Unverified UISAVE inner header size ${headerSize}.`],
    };
  }
  const segments: Record<string, unknown>[] = [];
  let offset = headerSize;
  let completeContainer = true;
  const seenIds = new Set<number>();
  while (offset < payload.length) {
    if (offset + 16 > payload.length) {
      warnings.push(`Truncated segment header at payload +${offset}.`);
      completeContainer = false;
      break;
    }
    const id = payload.readUInt16LE(offset);
    const segmentVersion = payload.readUInt16LE(offset + 2);
    const capacity = payload.readUInt32LE(offset + 4);
    const length = payload.readUInt32LE(offset + 8);
    const reserved = payload.readUInt32LE(offset + 12);
    if (offset + 20 + length > payload.length) {
      warnings.push(
        `Truncated segment ${id} at payload +${offset}; declared ${length} data bytes plus 4 trailer bytes.`,
      );
      completeContainer = false;
      break;
    }
    const raw = payload.subarray(offset + 16, offset + 16 + length);
    const masked = raw[0] === 0xff;
    const decoded = masked
      ? Buffer.from(raw.subarray(1).map((byte) => byte ^ 0x73))
      : raw;
    const segmentWarnings: string[] = [];
    if (seenIds.has(id)) segmentWarnings.push('Duplicate segment id.');
    seenIds.add(id);
    if (length > capacity)
      segmentWarnings.push('Segment length exceeds declared capacity.');
    const trailer = payload.subarray(
      offset + 16 + length,
      offset + 20 + length,
    );
    if (trailer.some((byte) => byte !== 0))
      segmentWarnings.push('Nonzero segment trailer; purpose is unknown.');
    let interpretation: Interpretation;
    try {
      interpretation = interpretSegment(id, segmentVersion, decoded);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      interpretation = {
        status: 'partial',
        data: { decodedByteLength: decoded.length, parseError: reason },
        warnings: [
          `此子段解析未完成：${reason}；其他子段继续读取，原始字节已保留。`,
        ],
      };
    }
    const coverage = segmentCoverage(
      id,
      segmentVersion,
      interpretation.data,
      decoded.length,
    );
    if (
      segmentWarnings.some(
        (warning) =>
          warning.includes('Duplicate') || warning.includes('exceeds'),
      )
    ) {
      coverage.structureComplete = false;
      coverage.unknownFields.push({
        field: '子段结构',
        reason: segmentWarnings.join('；'),
        kind: 'meaning',
      });
    }
    segments.push({
      id,
      name: segmentNames[id] ?? `UNKNOWN_${id}`,
      version: segmentVersion,
      offset,
      contentOffset: offset + 16,
      decodedContentOffset: offset + 16 + (masked ? 1 : 0),
      capacity,
      length,
      reserved,
      trailerHex: trailer.toString('hex'),
      encoding: masked
        ? '0xff marker followed by XOR 0x73'
        : 'no additional mask identified',
      rawHex: raw.toString('hex'),
      decodedHex: decoded.toString('hex'),
      status: coverageStatus(coverage),
      coverage,
      data: interpretation.data,
      warnings: [...segmentWarnings, ...interpretation.warnings],
    });
    offset += 20 + length;
  }
  if (segments.length !== declaredCount)
    warnings.push(
      `Expected ${declaredCount} segments, found ${segments.length}.`,
    );
  return {
    status:
      version === 1 &&
      completeContainer &&
      offset === payload.length &&
      segments.length === declaredCount &&
      segments.every((segment) => segment.status === 'decoded')
        ? 'decoded'
        : 'partial',
    coverage: {
      structureComplete:
        completeContainer &&
        offset === payload.length &&
        segments.length === declaredCount,
      knownFields: segments
        .filter((segment) => segment.status === 'decoded')
        .map((segment) => `${segment.name}：主要字段已解释`),
      candidateFields: segments
        .filter((segment) => segment.status === 'partial')
        .map((segment) => `${segment.name}：详见子段字段说明`),
      unknownFields: segments.flatMap((segment) =>
        (
          (
            segment.coverage as import('../../../shared/types.ts').DecodeCoverage
          ).unknownFields ?? []
        ).map((field) => ({
          ...field,
          field: `${segment.name} / ${field.field}`,
        })),
      ),
    },
    data: {
      headerSize,
      declaredCount,
      contentId: payload.readBigUInt64LE(8).toString(),
      completeContainer:
        completeContainer &&
        offset === payload.length &&
        segments.length === declaredCount,
      segmentCount: segments.length,
      segments,
      remainingOffset: offset,
      remainingHex: payload.subarray(offset).toString('hex'),
      offsetBasis:
        'offsets are relative to the outer decoded payload; add 16 for file offsets',
    },
    warnings: [
      ...warnings,
      ...(segments.some((segment) => segment.status === 'partial')
        ? ['各子段已分别列出能解释的字段、候选对应和具体未定义字段。']
        : []),
    ],
  };
}
