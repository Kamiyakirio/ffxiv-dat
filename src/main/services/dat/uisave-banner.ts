import { decodeUtf8 } from './sections.ts';
// Static target: ffxiv_dx11.exe SHA-256
// 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.

function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const mantissa = bits & 1023;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

type UnknownField = {
  field: string;
  reason: string;
  kind: 'meaning' | 'storage' | 'reference';
};
const widths: Record<number, number> = {
  0: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 2,
  6: 4,
  7: 2,
  8: 6,
  9: 6,
  10: 2,
  11: 2,
  14: 4,
  15: 2,
  16: 4,
  17: 2,
  18: 4,
  19: 4,
  20: 4,
  21: 4,
  23: 4,
};
const names: Record<number, string> = {
  2: 'bannerBg',
  3: 'bannerFrame',
  4: 'bannerDecoration',
  5: 'bannerTimeline',
  7: 'expression',
  10: 'cameraZoom',
  15: 'ambientLightingBrightness',
  17: 'directionalLightingBrightness',
  21: 'lastUpdatedUnix',
  23: 'checksum',
};
const references: Record<string, string> = {
  bannerBg: 'BannerBg',
  bannerFrame: 'BannerFrame',
  bannerDecoration: 'BannerDecoration',
  bannerTimeline: 'BannerTimeline',
  expression: 'BannerFacial',
};

export interface BannerEquipmentInput {
  itemIds: readonly number[];
  /** Two stain bytes per slot, interleaved: [slot0.dye0, slot0.dye1, ...]. */
  stainIds: readonly number[];
  glassesIds: readonly number[];
  gearVisibilityFlag: number;
}

// Target SHA-256 958b78e2...: GenerateChecksum 0x140c19250..0x140c1938b.
// The called CRC object (0x1401f62d0) seeds 0x1401fcf00 with zero; that
// routine complements before/after the IEEE table (0x14213abf0).
export function bannerChecksumPayload(input: BannerEquipmentInput): Buffer {
  const validate = (values: readonly number[], count: number, max: number) => {
    if (
      values.length !== count ||
      values.some(
        (value) => !Number.isSafeInteger(value) || value < 0 || value > max,
      )
    )
      throw new RangeError('Invalid banner equipment snapshot');
  };
  validate(input.itemIds, 14, 0xffffffff);
  validate(input.stainIds, 28, 255);
  validate(input.glassesIds, 2, 65535);
  validate([input.gearVisibilityFlag], 1, 0xffffffff);
  const bytes = Buffer.alloc(92);
  for (let slot = 0; slot < 14; slot++) {
    // Belt never contributes. Hidden headgear suppresses both item and dyes.
    if (slot === 5 || (slot === 2 && input.gearVisibilityFlag & 1)) continue;
    bytes.writeUInt32LE(input.itemIds[slot] % 500000, slot * 6);
    bytes[slot * 6 + 4] = input.stainIds[slot * 2];
    bytes[slot * 6 + 5] = input.stainIds[slot * 2 + 1];
  }
  bytes.writeUInt16LE(input.glassesIds[0], 84);
  bytes.writeUInt16LE(input.glassesIds[1], 86);
  const flags =
    input.gearVisibilityFlag & 1
      ? (input.gearVisibilityFlag & 0xfffffff3) >>> 0
      : input.gearVisibilityFlag;
  bytes.writeUInt32LE(flags, 88);
  return bytes;
}
export function generateBannerChecksum(input: BannerEquipmentInput): number {
  let crc = 0xffffffff;
  for (const byte of bannerChecksumPayload(input)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Field names are cross-checked against BannerModuleEntry in FFXIVClientStructs
// b72bc1f73 and HaselTweaks PortraitPreset. Disk tag widths consume all records
// in both current files and four backups. The remaining unknowns are explicitly
// enumerated below; a reserved byte does not make all portrait fields tentative.
export function decodeBanners(data: Buffer): Record<string, unknown> | null {
  const chunks: Record<string, unknown>[] = [];
  const knownFields = new Set<string>();
  const unknownFields = new Map<string, UnknownField>();
  const candidateFields = new Set<string>();
  let offset = 0;
  let recordIndex = 0;
  let completeFieldStream = true;
  const loadedIndices = new Set<number>();
  let nextBannerId = 0;
  let runtimeMappingComplete = true;
  const unknown = (
    field: string,
    reason: string,
    kind: UnknownField['kind'] = 'meaning',
  ) => {
    unknownFields.set(field, { field, reason, kind });
  };
  const numeric = (
    record: Record<string, unknown>,
    field: string,
    values: number[],
  ) => {
    if (values.some((value) => !Number.isFinite(value))) {
      unknown(
        field,
        '存储值包含非有限浮点数，未将其转换成有效的镜头或方向数值。',
        'storage',
      );
      record[field] = values.map((value) =>
        Number.isFinite(value) ? value : null,
      );
    } else {
      record[field] = values;
      knownFields.add(field);
    }
  };
  try {
    while (offset < data.length) {
      if (offset + 16 > data.length) return null;
      const id = data.readUInt32LE(offset);
      const length = data.readUInt32LE(offset + 4);
      if (offset + 16 + length > data.length) return null;
      const body = data.subarray(offset + 16, offset + 16 + length);
      const records: Record<string, unknown>[] = [];
      const keys = new Set<number>();
      let position = 0;
      let record: Record<string, unknown> | null = null;
      let recordFields: Record<string, unknown>[] = [];
      let unparsedFieldsHex = '';
      let unparsedOffset: number | undefined;
      // Target client 958b78e2: BannerModule::ReadFile 0x1407f89b0 only
      // dispatches block 0 to 0x1408260a0. Block 1 is the emitted header.
      if (id !== 0) {
        chunks.push({
          id,
          offset,
          length,
          kind: id === 1 && length === 0 ? 'container-header' : 'ignored-block',
          reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
          records,
          rawHex: body.toString('hex'),
        });
        if (length)
          unknown(
            'chunks.ignoredBlocks',
            '客户端只加载编号0的肖像记录块；其他块原始字节已保留。',
            'storage',
          );
        offset += 16 + length;
        continue;
      }
      while (position < body.length) {
        if (position + 2 > body.length) return null;
        const start = position;
        const tag = body.readUInt16LE(position);
        position += 2;
        let size = widths[tag];
        const variable = tag === 1 || tag === 22 || tag === 24;
        if (variable) {
          if (position + 2 > body.length) return null;
          size = body.readUInt16LE(position);
          position += 2;
        }
        if (size === undefined) {
          // Unknown fixed-width tags cannot be skipped safely. Preserve the rest
          // of this bounded block and continue with the next known block.
          unparsedFieldsHex = body.subarray(start).toString('hex');
          unparsedOffset = start;
          runtimeMappingComplete = false;
          completeFieldStream = false;
          unknown(
            `tag${tag}`,
            `字段 ${tag} 的长度编码尚未确认；此块从该字段起的字节已完整保留。`,
            'storage',
          );
          break;
        }
        if (position + size > body.length) return null;
        const bytes = body.subarray(position, position + size);
        position += size;
        let alignmentHex = '';
        if ((tag === 22 || tag === 24) && size % 2) {
          if (position >= body.length) return null;
          alignmentHex = body.subarray(position, ++position).toString('hex');
        }
        if (tag === 0) {
          const key = bytes.readUInt16LE();
          if (
            keys.has(key) ||
            loadedIndices.has(key) ||
            key >= 110 ||
            nextBannerId >= 110
          ) {
            unknown(
              'recordKeyRaw',
              '记录键重复或超出110个物理槽位；目标客户端从此处停止加载该块，剩余字节完整保留。',
              'reference',
            );
            unparsedFieldsHex = body.subarray(start).toString('hex');
            unparsedOffset = start;
            completeFieldStream = false;
            break;
          }
          keys.add(key);
          loadedIndices.add(key);
          recordFields = [];
          record = {
            offset: start,
            recordIndex: recordIndex++,
            recordKeyRaw: key,
            // Writer 0x14082768a emits entry+0x86 (BannerIndex). Reader
            // 0x140826138..156 assigns each accepted index the next BannerId.
            bannerIndex: key,
            bannerId: runtimeMappingComplete ? nextBannerId : null,
            hasCustomTimelineName: false,
            fields: recordFields,
            references: {},
          };
          records.push(record);
          knownFields.add('recordKeyRaw');
          knownFields.add('recordIndex');
          knownFields.add('bannerIndex');
          knownFields.add('bannerId');
          nextBannerId++;
        }
        if (!record) return null;
        recordFields.push({
          offset: start,
          tag,
          valueHex: bytes.toString('hex'),
          ...(variable ? { declaredLength: size } : {}),
          ...(alignmentHex ? { alignmentHex } : {}),
        });
        if (tag === 1) {
          const end = bytes.indexOf(0);
          record.nameByteLength = end < 0 ? bytes.length : end;
          record.nameStorageByteLength = bytes.length;
          record.namePaddingHex =
            end < 0 ? '' : bytes.subarray(end).toString('hex');
          record.hasCustomTimelineName =
            end >= 0 && end < 64 ? end !== 0 : null;
          if (record.hasCustomTimelineName !== null)
            knownFields.add('hasCustomTimelineName');
          record.bannerTimelineName = decodeUtf8(
            bytes.subarray(0, end < 0 ? bytes.length : end),
          );
          if (record.bannerTimelineName === null)
            unknown(
              'bannerTimelineName',
              '动作自定义名称不是有效 UTF-8；原始字节已保留。',
              'storage',
            );
          else {
            knownFields.add('bannerTimelineName');
          }
          if (end < 0 || end > 63 || ((end + 4) & ~3) !== size) {
            unknown(
              'bannerTimelineName.storage',
              '名称未匹配目标客户端最多63字节并向上补齐至4字节的写入格式，原始声明长度和尾部字节已保留。',
              'storage',
            );
            completeFieldStream = false;
            runtimeMappingComplete = false;
          }
        } else if (names[tag]) {
          const field = names[tag];
          const byteBacked = [7, 10, 15, 17].includes(tag);
          const value = byteBacked
            ? bytes[0]
            : tag === 21
              ? bytes.readInt32LE()
              : bytes.readUIntLE(0, size);
          record[field] = value;
          knownFields.add(field);
          if (byteBacked && bytes[1] !== 0)
            unknown(
              `${field}.storageHighByte`,
              '字段以16位空间保存，但目标客户端只使用低8位；高字节原值已保留。',
              'storage',
            );
          if (references[field])
            (record.references as Record<string, unknown>)[field] = {
              sheet: references[field],
              rowId: value,
            };
        } else if (tag === 6) {
          const animation = bytes.readFloatLE();
          record.animationProgress = Number.isFinite(animation)
            ? animation
            : null;
          if (Number.isFinite(animation)) knownFields.add('animationProgress');
          else
            unknown('animationProgress', '存储值不是有限浮点数。', 'storage');
        } else if (tag === 8 || tag === 9)
          numeric(
            record,
            tag === 8 ? 'cameraPosition' : 'cameraTarget',
            [0, 2, 4].map((i) => half(bytes.readUInt16LE(i))),
          );
        else if (tag === 11) {
          record.imageRotation = bytes.readInt16LE();
          knownFields.add('imageRotation');
        } else if (tag === 14 || tag === 16) {
          // Writer 0x140827930/79b7 and export 0x140bc4c89..cde agree:
          // tag16 -> entry+0x64 directional RGB; tag14 -> +0x67 ambient RGB.
          const field =
            tag === 16 ? 'directionalLightingColour' : 'ambientLightingColour';
          record[field] = [...bytes];
          record[`${field}Rgb`] = {
            red: bytes[0],
            green: bytes[1],
            blue: bytes[2],
          };
          record[`${field}Hex`] = `#${bytes.subarray(0, 3).toString('hex')}`;
          knownFields.add(field);
          knownFields.add(`${field}Rgb`);
          unknown(
            `${field}.byte3`,
            '磁盘颜色字段宽度为 4 字节，运行时结构仅定义 RGB；第 4 字节的用途未公开。',
            'storage',
          );
        } else if (tag === 18) {
          record.directionalLightingAngles = {
            vertical: bytes.readInt16LE(),
            horizontal: bytes.readInt16LE(2),
          };
          knownFields.add('directionalLightingAngles');
        } else if (tag === 19 || tag === 20)
          numeric(record, tag === 19 ? 'headDirection' : 'eyeDirection', [
            half(bytes.readUInt16LE()),
            half(bytes.readUInt16LE(2)),
          ]);
        else if (tag === 22) {
          if (bytes.length === 4) {
            const customize = {
              race: bytes[0],
              sex: bytes[1],
              height: bytes[2],
              tribe: bytes[3],
            };
            record.customize = customize;
            // Preserve the previous key for existing consumers; these four byte
            // fields now also have their source-backed names in `customize`.
            record.customizeCandidate = {
              rawHex: bytes.toString('hex'),
              ...customize,
            };
            knownFields.add('customize.race');
            knownFields.add('customize.sex');
            knownFields.add('customize.height');
            knownFields.add('customize.tribe');
          } else {
            record.customizeCandidate = { rawHex: bytes.toString('hex') };
            unknown(
              'customize',
              `外观摘要长度为 ${bytes.length}，与已核对的 4 字节种族/性别/身高/部族格式不同。`,
              'storage',
            );
          }
        } else if (tag === 24) {
          // 0x140827ada writes tag24 + length2, then entry+0x40:u16.
          // 0x140826374 copies at most two declared bytes to those flags.
          record.flagsStorageHex = bytes.toString('hex');
          const flags = Buffer.alloc(2);
          bytes.copy(flags, 0, 0, Math.min(2, bytes.length));
          record.flagsRaw = flags.readUInt16LE();
          record.flagsBytes = [...flags];
          // GetFlag(0) at 0x140bc3f3c selects the DefaultBannerPreset at
          // helper+0x10, applied by 0x140bc4fe0 before exporting the portrait.
          record.useDefaultPreset = (Number(record.flagsRaw) & 1) !== 0;
          record.unknownFlags = Number(record.flagsRaw) & 0xfffe;
          record.setFlagIndices = Array.from(
            { length: 16 },
            (_, bit) => bit,
          ).filter((bit) => (Number(record!.flagsRaw) & (1 << bit)) !== 0);
          knownFields.add('flagsRaw');
          knownFields.add('flagsBytes');
          knownFields.add('setFlagIndices');
          knownFields.add('useDefaultPreset');
          if (record.unknownFlags)
            unknown(
              'flagsRaw',
              '第0位已确认选择默认肖像预设；第1至15位中存在尚未确认业务名称的标志，原值完整保留。',
            );
          if (bytes.length !== 2)
            unknown(
              'flagsStorageHex',
              '此版本写入2字节旗标；目标读取函数只复制声明内容的前2字节，剩余原值已保留。',
              'storage',
            );
        }
      }
      chunks.push({
        id,
        offset,
        length,
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        records,
        kind: 'portrait-records',
        ...(unparsedFieldsHex ? { unparsedFieldsHex, unparsedOffset } : {}),
      });
      knownFields.add('chunks.id');
      knownFields.add('chunks.kind');
      if (data.subarray(offset + 8, offset + 16).some((byte) => byte !== 0))
        unknown(
          'chunks.reserved',
          '块头出现非零保留字节，完整内容已保留。',
          'storage',
        );
      offset += 16 + length;
    }
  } catch {
    return null;
  }
  if (recordIndex) {
    unknown(
      'checksumVerification',
      '装备关联值使用已确认的92字节规范化快照与CRC-32算法；肖像子段不保存完整装备输入，需与对应的装备/幻化快照关联后才能验证具体记录。',
      'reference',
    );
  }
  return {
    chunks,
    recordCount: recordIndex,
    empty: recordIndex === 0 && completeFieldStream,
    completeFieldStream: completeFieldStream && offset === data.length,
    bannerIdToIndex: chunks.flatMap((chunk) =>
      (chunk.records as Record<string, unknown>[])
        .filter((record) => record.bannerId !== null)
        .map((record) => ({
          bannerId: record.bannerId,
          bannerIndex: record.bannerIndex,
        })),
    ),
    checksumAlgorithm:
      'CRC-32/ISO-HDLC over 92-byte normalized equipment snapshot',
    checksumPurpose:
      '装备外观关联指纹；输入为 14 件物品、28 个染色、2 个眼镜和装备可见性标志。',
    coverage: {
      structureComplete: completeFieldStream && offset === data.length,
      knownFields: [...knownFields],
      candidateFields: [...candidateFields],
      unknownFields: [...unknownFields.values()],
    },
  };
}
