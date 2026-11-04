import { decodeUtf8, readSections } from './sections.ts';
import type { DatDecodeResult, DatSection } from './types.ts';

// Layout references: FFXIVClientStructs b72bc1f73, Client/UI/Misc/
// AcquaintanceModule, GoldSaucerModule, ItemOrderModule and ItemFinderModule.
// These readers additionally validate the on-disk tags and lengths; they do not
// assume that the enclosing runtime modules can be copied directly from disk.

function exactLength(bytes: Buffer, expected: number, label: string): void {
  if (bytes.length !== expected) {
    throw new Error(
      `${label}: expected ${expected} bytes, received ${bytes.length}`,
    );
  }
}

function u16s(bytes: Buffer): number[] {
  if (bytes.length % 2) throw new Error('Incomplete uint16 array');
  return Array.from({ length: bytes.length / 2 }, (_, i) =>
    bytes.readUInt16LE(i * 2),
  );
}

function u32s(bytes: Buffer): number[] {
  if (bytes.length % 4) throw new Error('Incomplete uint32 array');
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readUInt32LE(i * 4),
  );
}

function id64(bytes: Buffer): string {
  exactLength(bytes, 8, '64-bit identifier');
  return bytes.readBigUInt64LE().toString(16).toUpperCase().padStart(16, '0');
}

function versionWarnings(version: number, expected: number): string[] {
  return version === expected
    ? []
    : [
        `Version ${version} has not been verified; the known layout version is ${expected}.`,
      ];
}

function sectionBytes(section: DatSection): Buffer {
  return Buffer.from(section.valueHex, 'hex');
}

export function decodeAcquaintance(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 100);
  const sections = readSections(payload);
  const contacts: Record<string, unknown>[] = [];
  let index = 0;
  while (index < sections.length && sections[index].tag === 'N') {
    const group = sections.slice(index, index + 7);
    if (group.map((field) => field.tag).join('') !== 'NWOTCCC') {
      warnings.push(
        `Unknown contact record at payload offset ${sections[index].offset}.`,
      );
      break;
    }
    const worldText = group[2].text;
    const cParts = group.slice(4).map((field) => field.text);
    const contentIdHex = cParts.every((part, partIndex) =>
      new RegExp(`^[0-9A-Fa-f]{${partIndex === 0 ? 4 : 6}}$`).test(part ?? ''),
    )
      ? cParts.join('').toUpperCase()
      : null;
    const flagsText = group[3].text;
    contacts.push({
      offset: group[0].offset,
      name: group[0].text,
      worldName: group[1].text,
      worldId:
        worldText && /^[0-9A-Fa-f]+$/.test(worldText)
          ? parseInt(worldText, 16)
          : null,
      worldIdEncoded: worldText,
      unknownT: flagsText,
      unknownCParts: cParts,
      inferred: {
        // AcquaintanceModule.Acquaintance has Flags (commented ushort at
        // 0xD2) and ContentId (ulong at 0xD8). The serialized T / C binding
        // is inferred from those fields and the observed 4/6/6 hex widths;
        // the game's ReadFile implementation is not available to confirm it.
        contentIdCandidate:
          contentIdHex === null
            ? null
            : {
                hex: contentIdHex,
                decimal: BigInt(`0x${contentIdHex}`).toString(),
                confidence: 'inferred',
              },
        flagsCandidate:
          flagsText && /^[0-9A-Fa-f]{4}$/.test(flagsText)
            ? { value: parseInt(flagsText, 16), confidence: 'inferred' }
            : null,
      },
      fields: group,
    });
    index += 7;
  }
  const additionalFields = sections.slice(index);
  const metadataFields = additionalFields
    .filter((field) => field.tag === 'M')
    .map((field) => ({
      offset: field.offset,
      hex: field.text,
      decimal:
        field.text && /^[0-9A-Fa-f]+$/.test(field.text)
          ? BigInt(`0x${field.text}`).toString()
          : null,
    }));
  // The first two six-digit M values form a plausible Unix timestamp in the
  // observed sample. This is an explicitly inferred candidate, not evidence
  // that the remaining M values are timestamps or are grouped the same way.
  const timeParts = metadataFields.slice(2, 4);
  const timeHex =
    timeParts.length === 2 &&
    timeParts.every((field) => /^[0-9A-Fa-f]{6}$/.test(field.hex ?? ''))
      ? timeParts.map((field) => field.hex).join('')
      : null;
  const timeSeconds = timeHex ? BigInt(`0x${timeHex}`) : null;
  const timestampCandidate =
    timeSeconds !== null && timeSeconds > 0n && timeSeconds < 253402300800n
      ? {
          hex: timeHex,
          unixSeconds: timeSeconds.toString(),
          isoUtc: new Date(Number(timeSeconds) * 1000).toISOString(),
          fieldOffsets: timeParts.map((field) => field.offset),
          confidence: 'inferred',
        }
      : null;
  if (sections.length) {
    warnings.push(
      'T/C/M fields are preserved verbatim; their identifier/flag semantics are not confirmed.',
    );
  }
  return {
    status: sections.length || warnings.length ? 'partial' : 'decoded',
    data: {
      contacts,
      contactCount: contacts.length,
      additionalFields,
      metadataFields,
      timestampCandidate,
      sections,
    },
    warnings,
  };
}

export function decodeGoldSaucer(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 103);
  if (payload.length < 648)
    throw new Error('Truncated Gold Saucer configuration');
  const decks = Array.from({ length: 10 }, (_, index) => {
    const offset = index * 58;
    const nameBytes = payload.subarray(offset, offset + 48);
    const terminator = nameBytes.indexOf(0);
    return {
      index,
      offset,
      name: decodeUtf8(
        terminator < 0 ? nameBytes : nameBytes.subarray(0, terminator),
      ),
      nameStorageHex: nameBytes.toString('hex'),
      cardIds: u16s(payload.subarray(offset + 48, offset + 58)),
    };
  });
  const padding = payload.subarray(626, 628);
  const trailing = payload.subarray(648);
  if (padding.some((value) => value !== 0))
    warnings.push('Nonzero alignment bytes after minion hotbar.');
  if (trailing.length)
    warnings.push('Additional Gold Saucer bytes follow the verified layout.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: {
      decks,
      minionCompanionIds: u16s(payload.subarray(580, 626)),
      alignmentHex: padding.toString('hex'),
      unseenTripleTriadCardIds: u16s(payload.subarray(628, 648)),
      trailingHex: trailing.toString('hex'),
    },
    warnings,
  };
}

interface OrderField {
  offset: number;
  tag: string;
  bytes: Buffer;
}

function readOrderFields(payload: Buffer): OrderField[] {
  const fields: OrderField[] = [];
  for (let offset = 0; offset < payload.length;) {
    if (offset + 2 > payload.length)
      throw new Error(`Truncated item order header at ${offset}`);
    const length = payload[offset + 1];
    const end = offset + 2 + length;
    if (length === 0 || end > payload.length)
      throw new Error(`Invalid item order field at ${offset}`);
    fields.push({
      offset,
      tag: String.fromCharCode(payload[offset]),
      bytes: payload.subarray(offset + 2, end),
    });
    offset = end;
  }
  return fields;
}

const orderContainers = [
  'inventory',
  'armouryMainHand',
  'armouryHead',
  'armouryBody',
  'armouryHands',
  'armouryLegs',
  'armouryFeet',
  'armouryOffHand',
  'armouryEars',
  'armouryNeck',
  'armouryWrists',
  'armouryRings',
  'armourySoulCrystal',
];

export function decodeItemOrder(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 104);
  const fields = readOrderFields(payload);
  let cursor = 0;
  function take(tag: string, length: number): OrderField {
    const field = fields[cursor++];
    if (!field || field.tag !== tag || field.bytes.length !== length) {
      throw new Error(
        `Expected item order ${tag}/${length} at field ${cursor - 1}`,
      );
    }
    return field;
  }
  function sorter(name: string, retainerId?: string): Record<string, unknown> {
    const countField = take('n', 4);
    const count = countField.bytes.readUInt32LE();
    if (count > fields.length - cursor)
      throw new Error('Item order count exceeds remaining records');
    const slots = Array.from({ length: count }, (_, displayIndex) => {
      const field = take('i', 4);
      return {
        displayIndex,
        offset: field.offset,
        slot: field.bytes.readUInt16LE(),
        page: field.bytes.readUInt16LE(2),
      };
    });
    return { name, retainerId, offset: countField.offset, count, slots };
  }
  const formatVersion = take('V', 4).bytes.readUInt32LE();
  if (formatVersion !== version)
    warnings.push('Item order inner version differs from its file header.');
  const containers = orderContainers.map((name) => sorter(name));
  const retainerCount = take('N', 4).bytes.readUInt32LE();
  if (retainerCount > fields.length - cursor)
    throw new Error('Retainer count exceeds remaining item order fields');
  const retainers = Array.from({ length: retainerCount }, () => {
    const retainerId = id64(take('R', 8).bytes);
    return sorter('retainer', retainerId);
  });
  containers.push(sorter('saddleBag'), sorter('premiumSaddleBag'));
  const additionalFields = fields.slice(cursor).map((field) => ({
    offset: field.offset,
    tag: field.tag,
    valueHex: field.bytes.toString('hex'),
  }));
  if (additionalFields.length)
    warnings.push('Unrecognized fields follow the item sorters.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: { formatVersion, containers, retainers, additionalFields },
    warnings,
  };
}

function decodeRetainerInventory(bytes: Buffer): Record<string, unknown> {
  exactLength(bytes, 1152, 'Retainer inventory');
  const body = bytes.subarray(8);
  return {
    retainerId: id64(bytes.subarray(0, 8)),
    equippedItemIds: u32s(body.subarray(0, 0x38)),
    itemIds: u32s(body.subarray(0x38, 0x2f4)),
    itemCounts: u16s(body.subarray(0x2f4, 0x452)),
    crystalQuantities: u16s(body.subarray(0x452, 0x476)),
    alignmentHex: body.subarray(0x476).toString('hex'),
  };
}

export function decodeItemFinder(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 203);
  const sections = readSections(payload);
  let cursor = 0;
  function take(tag: string, length?: number): DatSection {
    const section = sections[cursor++];
    if (
      !section ||
      section.tag !== tag ||
      (length !== undefined && section.length !== length)
    ) {
      throw new Error(
        `Expected item finder ${tag}/${length ?? '*'} at section ${cursor - 1}`,
      );
    }
    return section;
  }
  function number(tag: string, length: 2 | 4): number {
    const bytes = sectionBytes(take(tag, length));
    return length === 2 ? bytes.readUInt16LE() : bytes.readUInt32LE();
  }
  const characterContentId = id64(sectionBytes(take('C', 8)));
  const retainerFormatVersion = number('R', 2);
  const retainerCount = number('N', 4);
  if (retainerCount > sections.length - cursor)
    throw new Error('Retainer inventory count exceeds remaining sections');
  const retainers = Array.from({ length: retainerCount }, () => {
    const section = take('I');
    const bytes = sectionBytes(section);
    if (bytes.length !== 1152) {
      warnings.push(
        `Unverified retainer inventory length ${bytes.length} at ${section.offset}.`,
      );
      return { offset: section.offset, rawHex: section.valueHex };
    }
    return { offset: section.offset, ...decodeRetainerInventory(bytes) };
  });
  const saddleBagFormatVersion = number('B', 2);
  const bagsSection = take('I', 840);
  const bags = sectionBytes(bagsSection);
  const bagItemIds = u32s(bags.subarray(0, 560));
  const bagCounts = u16s(bags.subarray(560));
  const glamourDresserFormatVersion = number('M', 2);
  const dresserSection = take('I');
  const dresser = sectionBytes(dresserSection);
  if (dresser.length % 6)
    throw new Error('Invalid glamour dresser array length');
  const dresserCount = dresser.length / 6;
  if (dresserCount !== 800)
    warnings.push(
      `Glamour dresser holds ${dresserCount} entries, not the verified 800.`,
    );
  const cabinetFormatVersion = number('A', 2);
  const cabinetBitCount = number('N', 4);
  const cabinetSection = take('F');
  const cabinet = sectionBytes(cabinetSection);
  if (cabinetBitCount !== cabinet.length * 8)
    throw new Error('Cabinet bit count does not match its data size');
  const cabinetSetBitIndices: number[] = [];
  cabinet.forEach((value, byteIndex) => {
    for (let bit = 0; bit < 8; bit++)
      if (value & (1 << bit)) cabinetSetBitIndices.push(byteIndex * 8 + bit);
  });
  const additionalFields = sections.slice(cursor);
  if (additionalFields.length)
    warnings.push('Unrecognized fields follow the item finder cache.');
  return {
    status: warnings.length ? 'partial' : 'decoded',
    data: {
      characterContentId,
      retainerFormatVersion,
      retainers,
      saddleBagFormatVersion,
      saddleBag: {
        offset: bagsSection.offset,
        itemIds: bagItemIds.slice(0, 70),
        itemCounts: bagCounts.slice(0, 70),
      },
      premiumSaddleBag: {
        offset: bagsSection.offset,
        itemIds: bagItemIds.slice(70),
        itemCounts: bagCounts.slice(70),
      },
      glamourDresserFormatVersion,
      glamourDresser: {
        offset: dresserSection.offset,
        itemIds: u32s(dresser.subarray(0, dresserCount * 4)),
        itemSetUnlockBits: u16s(dresser.subarray(dresserCount * 4)),
      },
      cabinetFormatVersion,
      cabinet: {
        offset: cabinetSection.offset,
        bitCount: cabinetBitCount,
        unlockWords: u32s(cabinet),
        setBitIndices: cabinetSetBitIndices,
      },
      additionalFields,
      note: 'Client-side item-search cache, not authoritative server inventory. Cabinet bit indices are not necessarily Item sheet row IDs.',
    },
    warnings,
  };
}

export function decodeLogFilter(
  payload: Buffer,
  version: number,
): DatDecodeResult {
  const warnings = versionWarnings(version, 3);
  const groups: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 16 > payload.length)
      throw new Error(`Truncated log filter header at ${offset}`);
    const index = payload.readUInt16LE(offset);
    const groupVersion = payload.readUInt16LE(offset + 2);
    const length = payload.readUInt32LE(offset + 4);
    if (offset + 16 + length > payload.length)
      throw new Error(`Truncated log filter values at ${offset}`);
    groups.push({
      offset,
      index,
      // MoreMessageFilterPresets.cs:221-231 and :237-260 in the local
      // DailyRoutines.ModulesPublic repository selects one of four chat tabs
      // and copies its filter data. This establishes tab identity, but does
      // not establish a LogKind-to-filter-index mapping or state meanings.
      chatTab: index < 4 ? `Chat tab ${index + 1}` : null,
      version: groupVersion,
      unknownHeaderHex: payload
        .subarray(offset + 8, offset + 16)
        .toString('hex'),
      filterStates: Array.from(
        payload.subarray(offset + 16, offset + 16 + length),
      ),
    });
    offset += 16 + length;
  }
  warnings.push(
    'All filter-state bytes are exposed by index; category names and the meanings of state values 0/1/2 are not verified.',
  );
  return { status: 'partial', data: { groups }, warnings };
}
