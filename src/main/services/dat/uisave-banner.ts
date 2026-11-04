function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const mantissa = bits & 1023;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

// Verified disk field widths consume all 53 records in the supplied character.
// Names follow BannerModuleEntry in FFXIVClientStructs b72bc1f73. The u16 key,
// variable customize block, and tag 24 remain explicitly unverified fields.
export function decodeBanners(data: Buffer): Record<string, unknown> | null {
  const chunks: Record<string, unknown>[] = [];
  let offset = 0;
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
    24: 'unknownTag24',
  };
  try {
    while (offset < data.length) {
      if (offset + 16 > data.length) return null;
      const id = data.readUInt32LE(offset);
      const length = data.readUInt32LE(offset + 4);
      if (offset + 16 + length > data.length) return null;
      const body = data.subarray(offset + 16, offset + 16 + length);
      const records: Record<string, unknown>[] = [];
      let position = 0;
      let record: Record<string, unknown> | null = null;
      let recordFields: Record<string, unknown>[] = [];
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
        if (size === undefined || position + size > body.length) return null;
        const bytes = body.subarray(position, position + size);
        position += size;
        if (tag === 0) {
          recordFields = [];
          record = {
            offset: start,
            recordKeyRaw: bytes.readUInt16LE(),
            fields: recordFields,
          };
          records.push(record);
        }
        if (!record) return null;
        recordFields.push({
          offset: start,
          tag,
          valueHex: bytes.toString('hex'),
        });
        if (tag === 1)
          record.bannerTimelineName = bytes
            .subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0))
            .toString('utf8');
        else if (names[tag]) record[names[tag]] = bytes.readUIntLE(0, size);
        else if (tag === 6) record.animationProgress = bytes.readFloatLE();
        else if (tag === 8 || tag === 9)
          record[tag === 8 ? 'cameraPosition' : 'cameraTarget'] = [0, 2, 4].map(
            (i) => half(bytes.readUInt16LE(i)),
          );
        else if (tag === 11) record.imageRotation = bytes.readInt16LE();
        else if (tag === 14 || tag === 16)
          record[
            tag === 14 ? 'directionalLightingColour' : 'ambientLightingColour'
          ] = [...bytes];
        else if (tag === 18)
          record.directionalLightingAngles = {
            vertical: bytes.readInt16LE(),
            horizontal: bytes.readInt16LE(2),
          };
        else if (tag === 19 || tag === 20)
          record[tag === 19 ? 'headDirection' : 'eyeDirection'] = [
            half(bytes.readUInt16LE()),
            half(bytes.readUInt16LE(2)),
          ];
        else if (tag === 22)
          record.customizeCandidate = {
            rawHex: bytes.toString('hex'),
            ...(bytes.length === 4
              ? {
                  race: bytes[0],
                  sex: bytes[1],
                  height: bytes[2],
                  tribe: bytes[3],
                }
              : {}),
          };
      }
      chunks.push({
        id,
        offset,
        length,
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        records,
      });
      offset += 16 + length;
    }
  } catch {
    return null;
  }
  return { chunks, completeFieldStream: offset === data.length };
}
