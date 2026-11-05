import { decodeUtf8, readSections } from './sections.ts';
import type { DatDecodeResult } from './types.ts';

export function decodeConfigCopy(bytes: Buffer): DatDecodeResult {
  if (bytes[0] !== 0xff) throw new Error('Missing cfgcopy section marker');
  const payload = Buffer.from(bytes.subarray(1).map((byte) => byte ^ 0x73));
  const sections = readSections(payload);
  const names = sections.filter((field) => field.tag === 'N');
  const world = sections.find((field) => field.tag === 'W');
  const worldBytes = world ? Buffer.from(world.valueHex, 'hex') : null;
  const idParts = sections
    .filter((field) => field.tag === 'I')
    .map((field) => field.text);
  const timeParts = sections
    .filter((field) => field.tag === 'T')
    .map((field) => field.text);
  const idHex = idParts.join('');
  const timeHex = timeParts.join('');
  const timestampInteger = /^[0-9a-f]{16}$/i.test(timeHex)
    ? BigInt(`0x${timeHex}`)
    : null;
  const timestamp =
    timestampInteger !== null &&
    timestampInteger <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(timestampInteger)
      : null;
  const contentIdHex = /^[0-9a-f]{16}$/i.test(idHex)
    ? idHex.toUpperCase()
    : null;
  const formatMatches =
    sections.map((section) => section.tag).join('') === 'NWIIITTT' &&
    worldBytes?.length === 2 &&
    contentIdHex !== null;
  return {
    status:
      formatMatches &&
      timestampInteger !== null &&
      timestampInteger < 253402300800n
        ? 'decoded'
        : 'partial',
    data: {
      name: names[0]?.text ?? null,
      worldId: worldBytes?.length === 2 ? worldBytes.readUInt16LE() : null,
      contentIdHex,
      contentId: contentIdHex ? BigInt(`0x${contentIdHex}`).toString() : null,
      // Target setter0x140150850 (via140146e10) refreshes record+0 from
      // server seconds0x140482820. Config save0x1407c78e0 refreshes it before
      // writer0x140151070 serializes T from that field. Not a login time.
      recordUpdatedAtUnix:
        timestampInteger !== null && timestampInteger < 253402300800n
          ? Number(timestampInteger)
          : null,
      timestampInteger: timestampInteger?.toString() ?? null,
      timestampCandidate: timestamp,
      timestampIsoCandidate:
        timestamp !== null && timestamp < 253402300800
          ? new Date(timestamp * 1000).toISOString()
          : null,
      sections,
    },
    warnings: [
      'Native configuration-save flow refreshes T with server Unix seconds; it is the character configuration record update time. Raw integers and split fields remain preserved.',
    ],
    coverage: {
      structureComplete: true,
      knownFields: [
        'name',
        'worldId',
        'contentIdHex',
        'contentId',
        'recordUpdatedAtUnix',
        'sections',
      ],
      candidateFields: [],
      unknownFields: [
        ...(timestampInteger === null || timestampInteger >= 253402300800n
          ? [
              {
                field: 'timestampInteger',
                reason:
                  '时间原值超出可显示的Unix秒数范围；保留完整64位原值，不伪造日期。',
                kind: 'meaning' as const,
              },
            ]
          : []),
        ...(!formatMatches
          ? [
              {
                field: 'sections',
                reason:
                  '字段流完整，但未匹配已核验的N/W/I/I/I/T/T/T缓存记录序列。',
                kind: 'meaning' as const,
              },
            ]
          : []),
      ],
    },
  };
}

export function decodeCharacterPreset(bytes: Buffer): DatDecodeResult {
  if (bytes.length !== 212 || bytes.readUInt32LE(0) !== 0x2013ff14) {
    return {
      status: 'unsupported',
      data: { rawHex: bytes.toString('hex') },
      warnings: ['Unknown character preset size or magic'],
    };
  }
  const names = [
    'race',
    'sex',
    'bodyType',
    'height',
    'tribe',
    'face',
    'hairstyle',
    'highlightsFlags',
    'skinColor',
    'rightEyeColor',
    'hairColor',
    'highlightsColor',
    'facialFeatures',
    'facialFeatureColor',
    'eyebrows',
    'leftEyeColor',
    'eyeShapeFlags',
    'nose',
    'jaw',
    'mouthFlags',
    'lipColorFurPattern',
    'muscleToneOrTailOrEarLength',
    'tailEarsType',
    'bustSize',
    'facePaintFlags',
    'facePaintColorFlags',
  ];
  const customize = Object.fromEntries(
    names.map((name, index) => [name, bytes[16 + index]]),
  );
  // CustomizeData bit definitions are explicit in DrawDataContainer.cs.
  Object.assign(customize, {
    highlights: (bytes[23] & 0x80) !== 0,
    facialFeaturesEnabled: Array.from(
      { length: 7 },
      (_, i) => (bytes[28] & (1 << i)) !== 0,
    ),
    legacyTattoo: (bytes[28] & 0x80) !== 0,
    eyeShape: bytes[32] & 0x7f,
    smallIris: (bytes[32] & 0x80) !== 0,
    mouth: bytes[35] & 0x7f,
    lipstick: (bytes[35] & 0x80) !== 0,
    facePaint: bytes[40] & 0x7f,
    facePaintReversed: (bytes[40] & 0x80) !== 0,
  });
  // Anamnesis DatCharacterFile.GetName reads all 164 bytes from +0x30,
  // not only 40 bytes; UTF-8 comments can require more than one byte/character.
  const commentBytes = bytes.subarray(48);
  const nul = commentBytes.indexOf(0);
  const timestamp = bytes.readUInt32LE(44);
  // Independently verified against the sample using Anamnesis DatCharacterFile.
  let computedChecksum = 0;
  for (let index = 0; index < 32; index++) {
    computedChecksum ^= bytes[16 + index] << (index % 24);
  }
  computedChecksum >>>= 0;
  const checksumMatches = computedChecksum === bytes.readUInt32LE(8);
  return {
    status: 'partial',
    data: {
      magic: '2013ff14',
      version: bytes.readUInt32LE(4),
      storedChecksum: bytes.readUInt32LE(8),
      computedChecksum,
      checksumMatches,
      reservedHeaderHex: bytes.subarray(12, 16).toString('hex'),
      customize,
      voice: bytes[42],
      reservedByte: bytes[43],
      timestamp,
      createdAt: new Date(timestamp * 1000).toISOString(),
      comment: decodeUtf8(commentBytes.subarray(0, nul < 0 ? undefined : nul)),
      commentStorageHex: commentBytes.toString('hex'),
      commentTerminatorOffset: nul < 0 ? null : 48 + nul,
      paddingAfterCommentHex:
        nul < 0 ? '' : commentBytes.subarray(nul + 1).toString('hex'),
      reservedTailHex: bytes.subarray(88).toString('hex'),
    },
    warnings: [
      'Appearance byte fields follow CustomizeData and the documented preset layout; race-specific color/shape IDs require game data tables; trailing storage semantics remain unverified',
      ...(checksumMatches ? [] : ['Character preset checksum does not match']),
    ],
    coverage: {
      structureComplete: true,
      knownFields: [
        'customize.race',
        'customize.sex',
        'customize.bodyType',
        'customize.height',
        'customize.tribe',
        'customize.face',
        'customize.hairstyle',
        'customize.highlights',
        'customize.facialFeaturesEnabled',
        'customize.legacyTattoo',
        'customize.eyeShape',
        'customize.smallIris',
        'customize.mouth',
        'customize.lipstick',
        'customize.facePaint',
        'customize.facePaintReversed',
        'customize (remaining raw option indices)',
        'voice',
        'timestamp',
        'comment',
        'checksumMatches',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'reservedHeaderHex / reservedByte / paddingAfterCommentHex',
          reason:
            '保留存储字节没有已发布的业务用途；不影响外观选项、备注和校验的读取。',
          kind: 'storage',
        },
        {
          field: 'customize colour/style option indices',
          reason:
            '选项编号已读取；实际色板RGB和特定种族的样式资源仍需关联游戏资源。',
          kind: 'reference',
        },
      ],
    },
  };
}
