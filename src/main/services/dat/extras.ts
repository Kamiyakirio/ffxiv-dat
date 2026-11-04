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
  const timestamp = /^[0-9a-f]{16}$/i.test(timeHex)
    ? Number(BigInt(`0x${timeHex}`))
    : null;
  return {
    status: 'partial',
    data: {
      name: names[0]?.text ?? null,
      worldId: worldBytes?.length === 2 ? worldBytes.readUInt16LE() : null,
      contentIdHex: /^[0-9a-f]{16}$/i.test(idHex) ? idHex : null,
      timestampCandidate: timestamp,
      timestampIsoCandidate:
        timestamp !== null && timestamp < 253402300800
          ? new Date(timestamp * 1000).toISOString()
          : null,
      sections,
    },
    warnings: [
      'Name/world/content ID shape is consistent across samples; timestamp semantics are inferred, not independently confirmed',
    ],
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
  const commentBytes = bytes.subarray(48, 88);
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
      reservedTailHex: bytes.subarray(88).toString('hex'),
    },
    warnings: [
      'Appearance byte fields follow CustomizeData and the documented preset layout; race-specific color/shape IDs require game data tables; trailing storage semantics remain unverified',
      ...(checksumMatches ? [] : ['Character preset checksum does not match']),
    ],
  };
}
