// Strategy board content fields are described by the author's pattern at
// https://github.com/xivdev/file-formats/blob/main/imhex/stgy.hexpat.
// DAT-specific folder/board chunk framing and 2-byte alignment were verified
// independently on the supplied UISAVE files. Unknown keys retain raw values.

function readArray(data: Buffer, offset: number, width: number, count: number) {
  if (offset + width * count > data.length)
    throw new RangeError('Truncated Tofu array');
  return Array.from({ length: count }, (_, i) =>
    data.readUIntLE(offset + i * width, width),
  );
}

function string(data: Buffer) {
  const zero = data.indexOf(0);
  return data.subarray(0, zero < 0 ? data.length : zero).toString('utf8');
}

function typedArray(data: Buffer, offset: number, width?: number) {
  if (offset + 4 > data.length)
    throw new RangeError('Truncated Tofu typed array');
  const dataType = data.readUInt16LE(offset);
  const count = data.readUInt16LE(offset + 2);
  const itemWidth = width ?? [1, 2, 4, 4][dataType];
  if (!itemWidth) throw new Error(`Unknown Tofu array type ${dataType}`);
  const length = count * itemWidth;
  if (offset + 4 + length > data.length)
    throw new RangeError('Truncated Tofu array values');
  const bytes = data.subarray(offset + 4, offset + 4 + length);
  return { dataType, count, itemWidth, bytes, end: offset + 4 + length };
}

function decodeRecord(data: Buffer) {
  const fields: Record<string, unknown>[] = [];
  const objects: Record<string, unknown>[] = [];
  const arrayWidths: Record<number, number> = {
    4: 2,
    5: 4,
    6: 2,
    7: 1,
    8: 4,
    9: 4,
    10: 2,
    11: 2,
    12: 2,
  };
  const result: Record<string, unknown> = { fields, objects };
  let offset = 0;
  while (offset < data.length) {
    if (offset + 2 > data.length)
      throw new RangeError('Truncated Tofu field key');
    const start = offset;
    const tag = data.readUInt16LE(offset);
    offset += 2;
    const field: Record<string, unknown> = { offset: start, tag };
    if (tag === 0 || tag === 2) {
      if (offset + 2 > data.length)
        throw new RangeError('Truncated Tofu scalar');
      const scalar = data.readUInt16LE(offset);
      offset += 2;
      field.value = scalar;
      if (tag === 0) result.recordKeyRaw = scalar;
      if (tag === 2)
        objects.push({ index: objects.length, objectType: scalar });
    } else if (tag === 1 || tag === 3) {
      if (offset + 2 > data.length)
        throw new RangeError('Truncated Tofu string length');
      const length = data.readUInt16LE(offset);
      offset += 2;
      if (offset + length > data.length)
        throw new RangeError('Truncated Tofu string');
      field.text = string(data.subarray(offset, offset + length));
      field.valueHex = data.subarray(offset, offset + length).toString('hex');
      if (tag === 1) result.title = field.text;
      if (tag === 3 && objects.length)
        objects[objects.length - 1].text = field.text;
      offset += length;
    } else if (arrayWidths[tag]) {
      const array = typedArray(data, offset, arrayWidths[tag]);
      field.dataType = array.dataType;
      field.count = array.count;
      field.valueHex = array.bytes.toString('hex');
      offset = array.end;
      for (let i = 0; i < array.count; i++) {
        // Never invent object allocations to fit a corrupt field array.
        if (!objects[i])
          throw new Error('Tofu array has more values than allocated objects');
        const bytes = array.bytes;
        if (tag === 4) {
          const flags = bytes.readUInt16LE(i * 2);
          objects[i].flags = flags;
          objects[i].visible = (flags & 1) !== 0;
          objects[i].flippedHorizontally = (flags & 2) !== 0;
          objects[i].flippedVertically = (flags & 4) !== 0;
          objects[i].locked = (flags & 8) !== 0;
        } else if (tag === 5) {
          objects[i].position = {
            x: bytes.readUInt16LE(i * 4),
            y: bytes.readUInt16LE(i * 4 + 2),
          };
        } else if (tag === 6) objects[i].angle = bytes.readInt16LE(i * 2);
        else if (tag === 7) objects[i].scale = bytes[i];
        else if (tag === 8)
          objects[i].rgba = [...bytes.subarray(i * 4, i * 4 + 4)];
        else if (tag === 9) {
          objects[i].argsA = bytes.readUInt16LE(i * 4);
          objects[i].argsB = bytes.readUInt16LE(i * 4 + 2);
        } else {
          const key = new Map([
            [10, 'argsA'],
            [11, 'argsB'],
            [12, 'argsC'],
          ]).get(tag);
          if (key) objects[i][key] = bytes.readUInt16LE(i * 2);
        }
      }
    } else throw new Error(`Unverified Tofu record field ${tag}`);
    if (offset % 2) {
      if (offset >= data.length)
        throw new RangeError('Missing Tofu field alignment byte');
      field.alignmentByte = data[offset++];
    }
    fields.push(field);
  }
  return result;
}

function decodeStream(data: Buffer) {
  let offset = 0;
  const records: Record<string, unknown>[] = [];
  const arrays: Record<string, unknown>[] = [];
  while (offset < data.length) {
    const start = offset;
    if (offset + 2 > data.length)
      throw new RangeError('Truncated Tofu stream tag');
    const tag = data.readUInt16LE(offset);
    offset += 2;
    if (tag === 0) {
      if (offset + 2 > data.length)
        throw new RangeError('Truncated Tofu record length');
      const length = data.readUInt16LE(offset);
      offset += 2;
      if (offset + length > data.length)
        throw new RangeError('Truncated Tofu record');
      const bytes = data.subarray(offset, offset + length);
      records.push({ offset: start, length, ...decodeRecord(bytes) });
      offset += length;
    } else if (tag >= 1 && tag <= 3) {
      const array = typedArray(data, offset);
      arrays.push({
        offset: start,
        tag,
        dataType: array.dataType,
        count: array.count,
        values: readArray(array.bytes, 0, array.itemWidth, array.count),
        valueHex: array.bytes.toString('hex'),
        meaningCandidate: {
          1: 'UI order or board/folder flag list',
          2: 'server timestamps',
          3: 'board backgrounds',
        }[tag],
      });
      offset = array.end;
    } else throw new Error(`Unverified Tofu stream tag ${tag}`);
    if (offset % 2) {
      if (offset >= data.length)
        throw new RangeError('Missing Tofu stream alignment byte');
      offset++;
    }
  }
  return { records, arrays, completeFieldStream: true };
}

export function decodeTofu(data: Buffer): Record<string, unknown> | null {
  const chunks: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (offset < data.length) {
      if (offset + 16 > data.length) return null;
      const id = data.readUInt32LE(offset);
      const length = data.readUInt32LE(offset + 4);
      if (id > 4 || offset + 16 + length > data.length) return null;
      const body = data.subarray(offset + 16, offset + 16 + length);
      chunks.push({
        id,
        offset,
        length,
        name: [
          'settings',
          'savedFolders',
          'savedBoards',
          'sharedFolders',
          'sharedBoards',
        ][id],
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        data: id === 0 ? { rawHex: body.toString('hex') } : decodeStream(body),
      });
      offset += 16 + length;
    }
  } catch {
    return null;
  }
  return {
    chunks,
    completeChunkStream: offset === data.length,
    note: 'Object fields follow stgy.hexpat; DAT chunk names and record keys are candidates. RGBA A stores transparency (0 is visible).',
  };
}
