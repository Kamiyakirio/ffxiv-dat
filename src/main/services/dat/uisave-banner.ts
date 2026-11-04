import { decodeUtf8 } from './sections.ts';

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
  24: 4,
};
const names: Record<number, string> = {
  2: 'bannerBg',
  3: 'bannerFrame',
  4: 'bannerDecoration',
  5: 'bannerTimeline',
  7: 'expression',
  10: 'cameraZoom',
  15: 'directionalLightingBrightness',
  17: 'ambientLightingBrightness',
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
      while (position < body.length) {
        if (position + 2 > body.length) return null;
        const start = position;
        const tag = body.readUInt16LE(position);
        position += 2;
        let size = widths[tag];
        if (tag === 1 || tag === 22) {
          if (position + 2 > body.length) return null;
          size = body.readUInt16LE(position);
          position += 2;
        }
        if (size === undefined) {
          // Unknown fixed-width tags cannot be skipped safely. Preserve the rest
          // of this bounded block and continue with the next known block.
          unparsedFieldsHex = body.subarray(start).toString('hex');
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
        if (tag === 0) {
          const key = bytes.readUInt16LE();
          if (keys.has(key))
            unknown(
              'recordKeyRaw',
              '同一块出现重复记录键，不能按键唯一关联肖像。',
              'reference',
            );
          keys.add(key);
          recordFields = [];
          record = {
            offset: start,
            recordIndex: recordIndex++,
            recordKeyRaw: key,
            fields: recordFields,
            references: {},
          };
          records.push(record);
          knownFields.add('recordKeyRaw');
          knownFields.add('recordIndex');
          if (key < 110) {
            record.bannerIdCandidate = key;
            candidateFields.add('bannerIdCandidate');
          }
        }
        if (!record) return null;
        recordFields.push({
          offset: start,
          tag,
          valueHex: bytes.toString('hex'),
        });
        if (tag === 1) {
          const end = bytes.indexOf(0);
          record.bannerTimelineName = decodeUtf8(
            bytes.subarray(0, end < 0 ? bytes.length : end),
          );
          if (record.bannerTimelineName === null)
            unknown(
              'bannerTimelineName',
              '动作自定义名称不是有效 UTF-8；原始字节已保留。',
              'storage',
            );
          else knownFields.add('bannerTimelineName');
        } else if (names[tag]) {
          const field = names[tag];
          const value = bytes.readUIntLE(0, size);
          record[field] = value;
          knownFields.add(field);
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
          const field =
            tag === 14 ? 'directionalLightingColour' : 'ambientLightingColour';
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
          record.unknownTag24 = bytes.readUInt32LE();
          unknown(
            'unknownTag24',
            'tag 24 的 u32 值已读取；所给样本均为 2，但缺少将它绑定到业务字段的证据。',
          );
        }
      }
      chunks.push({
        id,
        offset,
        length,
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        records,
        ...(unparsedFieldsHex
          ? { unparsedFieldsHex, unparsedOffset: position - 2 }
          : {}),
      });
      unknown(
        'chunks.id',
        '长度分块的编号已读取；编号 0/1 的具体业务用途仍未由读写实现核实。',
        'storage',
      );
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
      'bannerIdCandidate',
      '记录键在样本中唯一，但它与运行时 BannerId / BannerIndex 的转换关系尚未由客户端读函数核实。',
      'reference',
    );
    unknown(
      'checksumVerification',
      'checksum 是装备/染色/眼镜/可见性关联值，不是肖像文件 CRC；没有核实全部装备快照和 GenerateChecksum 实现，故不宣称校验通过。',
      'reference',
    );
  }
  return {
    chunks,
    recordCount: recordIndex,
    empty: recordIndex === 0 && completeFieldStream,
    completeFieldStream: completeFieldStream && offset === data.length,
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
