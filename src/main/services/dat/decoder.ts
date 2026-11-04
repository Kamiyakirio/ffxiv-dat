import { createHash } from 'node:crypto';
import path from 'node:path';
import { decodeConfigCopy, decodeCharacterPreset } from './extras.ts';
import { decodeTextConfig, decodeMacros, decodeKeybinds } from './text.ts';
import { decodeAddon, decodeGearset, decodeHotbar } from './layouts.ts';
import { decodeUiSave } from './uisave.ts';
import {
  decodeAcquaintance,
  decodeGoldSaucer,
  decodeItemOrder,
  decodeItemFinder,
  decodeLogFilter,
} from './inventory.ts';
import type { DatDecodeResult } from './types.ts';

export interface DecodedDat {
  filename: string;
  byteLength: number;
  sha256: string;
  header: Record<string, unknown>;
  checks: Record<string, unknown>[];
  payload: Buffer;
  result: DatDecodeResult;
  members: {
    name: string;
    offset: number;
    length: number;
    decoded: DecodedDat;
  }[];
}

const binaryNames = [
  'ADDON.DAT',
  'MACRO.DAT',
  'HOTBAR.DAT',
  'KEYBIND.DAT',
  'LOGFLTR.DAT',
  'GEARSET.DAT',
  'ACQ.DAT',
  'ITEMODR.DAT',
  'ITEMFDR.DAT',
  'UISAVE.DAT',
  'GS.DAT',
];
const backupNames = [
  'COMMON.DAT',
  'CONTROL0.DAT',
  'CONTROL1.DAT',
  'MACRO.DAT',
  'ADDON.DAT',
  'UISAVE.DAT',
  'GEARSET.DAT',
  'KEYBIND.DAT',
  'HOTBAR.DAT',
  'LOGFLTR.DAT',
  'GS.DAT',
  'ACQ.DAT',
  'ITEMFDR.DAT',
  'ITEMODR.DAT',
];
const decoders = [
  decodeAddon,
  decodeMacros,
  decodeHotbar,
  decodeKeybinds,
  decodeLogFilter,
  decodeGearset,
  decodeAcquaintance,
  decodeItemOrder,
  decodeItemFinder,
  decodeUiSave,
  decodeGoldSaucer,
];

function decodeBackup(bytes: Buffer, output: DecodedDat): DecodedDat {
  const system =
    bytes.subarray(0, 24).toString('ascii') === 'FFXIV_BKSYS_RESTORE_DATA';
  const headerLength = system ? 48 : 104;
  if (bytes.length < headerLength) throw new Error('Truncated backup header');
  const timestamp = bytes.readBigUInt64LE(24);
  const names = system ? ['MACROSYS.dat'] : backupNames;
  const sizesOffset = system ? 40 : 48;
  const sizes = names.map((_, index) =>
    bytes.readUInt32LE(sizesOffset + index * 4),
  );
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total !== bytes.length - headerLength)
    throw new Error('Backup length table does not cover the file exactly');
  if (bytes.readUInt32LE(system ? 36 : 44) !== total)
    throw new Error('Backup total length does not match length table');
  output.header = {
    format: system ? 'system-backup' : 'character-backup',
    headerLength,
    timestamp: timestamp.toString(),
    timestampIsoCandidate:
      timestamp < 253402300800n
        ? new Date(Number(timestamp) * 1000).toISOString()
        : null,
    version: bytes.readUInt32LE(system ? 32 : 40),
    contentId: system ? null : bytes.readBigUInt64LE(32).toString(),
    contentIdHex: system
      ? null
      : bytes.readBigUInt64LE(32).toString(16).padStart(16, '0').toUpperCase(),
    rawHex: bytes.subarray(0, headerLength).toString('hex'),
    sizes,
  };
  let offset = headerLength;
  for (const [index, name] of names.entries()) {
    const length = sizes[index];
    if (length)
      output.members.push({
        name,
        offset,
        length,
        decoded: decodeDat(bytes.subarray(offset, offset + length), name),
      });
    offset += length;
  }
  output.payload = bytes.subarray(headerLength);
  if (!system) {
    const expected = bytes.readBigUInt64LE(32).toString();
    for (const member of output.members) {
      const data = member.decoded.result.data;
      const id =
        member.name === 'UISAVE.DAT'
          ? data.contentId
          : member.name === 'ITEMFDR.DAT' &&
              typeof data.characterContentId === 'string'
            ? BigInt(`0x${data.characterContentId}`).toString()
            : null;
      if (typeof id === 'string')
        output.checks.push({
          name: 'member-content-id-matches-backup',
          member: member.name,
          expected,
          actual: id,
          passed: expected === id,
        });
    }
  }
  output.result = {
    status: 'partial',
    data: {
      memberCount: output.members.length,
      members: output.members.map(({ name, offset, length, decoded }) => ({
        name,
        offset,
        length,
        sha256: decoded.sha256,
        status: decoded.result.status,
      })),
    },
    warnings: [
      'Backup length table and member boundaries verified; timestamp/header semantics are inferred and member-specific unknowns remain',
    ],
  };
  return output;
}

export function decodeDat(bytes: Buffer, filename: string): DecodedDat {
  const name = path.basename(filename).toUpperCase();
  const output: DecodedDat = {
    filename,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    header: {},
    checks: [],
    payload: bytes,
    members: [],
    result: {
      status: 'unsupported',
      data: {},
      warnings: ['Unrecognized file format; bytes preserved'],
    },
  };
  try {
    if (
      /^FFXIV_BK(?:CHR|SYS)_RESTORE_DATA/.test(
        bytes.subarray(0, 24).toString('ascii'),
      )
    )
      return decodeBackup(bytes, output);
    if (/^FFXIV_CFGCPY[0-9A-F]+\.DAT$/.test(name)) {
      output.header = { format: 'config-copy', contentOffset: 1, xor: 0x73 };
      output.payload = Buffer.from(
        bytes.subarray(1).map((byte) => byte ^ 0x73),
      );
      output.result = decodeConfigCopy(bytes);
      return output;
    }
    if (/^FFXIV_CHARA_\d+\.DAT$/.test(name)) {
      output.header = {
        format: 'character-preset',
        contentOffset: 16,
        xor: null,
      };
      output.payload = bytes.subarray(16);
      output.result = decodeCharacterPreset(bytes);
      return output;
    }
    if (['COMMON.DAT', 'CONTROL0.DAT', 'CONTROL1.DAT'].includes(name)) {
      output.header = { format: 'utf8-text', contentOffset: 0, xor: null };
      output.result = decodeTextConfig(bytes);
      return output;
    }
    if (!binaryNames.includes(name) && name !== 'MACROSYS.DAT') return output;
    if (bytes.length < 16) throw new Error('Truncated DAT header');
    const type = bytes.readUInt16LE(0);
    const version = bytes.readUInt16LE(2);
    const capacity = bytes.readUInt32LE(4);
    const validLength = bytes.readUInt32LE(8);
    const expectedType =
      name === 'MACROSYS.DAT' ? 1 : binaryNames.indexOf(name);
    if (type !== expectedType)
      throw new Error(`File type ${type} does not match ${name}`);
    if (16 + validLength > bytes.length)
      throw new Error('Valid length extends beyond file');
    const sectionType = [1, 3, 5, 6, 7, 8, 10].includes(type);
    const contentOffset = sectionType ? 17 : 16;
    const xor = sectionType ? 0x73 : [2, 9].includes(type) ? 0x31 : null;
    const emptyAcquaintance =
      type === 6 && validLength === 1 && bytes[16] === 0;
    if (
      sectionType &&
      !emptyAcquaintance &&
      (validLength < 1 || bytes[16] !== 0xff)
    )
      throw new Error('Missing section-format marker');
    output.header = {
      format: 'character-dat',
      type,
      version,
      capacity,
      validLength,
      reserved: bytes.readUInt32LE(12),
      contentOffset,
      xor,
      sizeMinusCapacity: bytes.length - capacity,
      rawHex: bytes.subarray(0, contentOffset).toString('hex'),
      paddingLength: bytes.length - 16 - validLength,
      paddingNonzeroBytes: bytes
        .subarray(16 + validLength)
        .reduce((count, byte) => count + Number(byte !== 0), 0),
    };
    output.payload = Buffer.from(
      bytes.subarray(contentOffset, 16 + validLength),
    );
    if (xor !== null)
      output.payload = Buffer.from(output.payload.map((byte) => byte ^ xor));
    output.result = decoders[type](output.payload, version);
    const roleId = /FFXIV_CHR([0-9a-f]{16})[/\\]/i.exec(filename)?.[1];
    const storedId =
      type === 9
        ? output.result.data.contentId
        : type === 8
          ? output.result.data.characterContentId
          : null;
    if (roleId && typeof storedId === 'string') {
      const expected = BigInt(`0x${roleId}`).toString();
      const actual = type === 8 ? BigInt(`0x${storedId}`).toString() : storedId;
      output.checks.push({
        name: 'content-id-matches-character-directory',
        expected,
        actual,
        passed: expected === actual,
      });
      if (expected !== actual)
        output.result.warnings.push(
          'Stored Content ID does not match character directory',
        );
    }
    if (bytes.length - capacity !== 32) {
      output.result.warnings.push(
        `Nonstandard size-minus-capacity: ${bytes.length - capacity}; file bytes retained exactly`,
      );
    }
    return output;
  } catch (error) {
    output.result = {
      status: 'partial',
      data: {
        parseError: error instanceof Error ? error.message : String(error),
      },
      warnings: [
        'Parsing failed; original bytes and any unmasked payload are retained; no semantic completeness claimed',
      ],
    };
    return output;
  }
}
