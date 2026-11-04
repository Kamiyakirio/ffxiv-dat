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
      const expectedType: Record<number, number> = {
        4: 1,
        5: 3,
        6: 1,
        7: 0,
        8: 2,
        9: 3,
        10: 1,
        11: 1,
        12: 1,
      };
      if (array.dataType !== expectedType[tag]) {
        throw new Error(
          `Unexpected Tofu object array type ${array.dataType} for field ${tag}`,
        );
      }
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
  const arrays: StreamArray[] = [];
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
          1: 'board folder references or folder IsBoard flags, depending on chunk',
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

interface UnknownField {
  field: string;
  reason: string;
  kind: 'meaning' | 'storage' | 'reference';
}

interface StreamArray {
  offset: number;
  tag: number;
  dataType: number;
  count: number;
  values: number[];
  valueHex: string;
  meaningCandidate?: string;
}

interface StreamData {
  records?: Record<string, unknown>[];
  arrays?: StreamArray[];
  rawHex?: string;
  decodeError?: string;
}

function annotateChunks(chunks: Record<string, unknown>[]) {
  let structureComplete = true;
  let boardsWithArguments = 0;
  let hasReservedObjectFlags = false;
  const unknownFields: UnknownField[] = [];
  const candidateFields: string[] = [];
  const knownFields = [
    'chunks.id',
    'chunks.length',
    'records.title',
    'records.objects.objectType',
    'records.objects.text',
    'records.objects.flags',
    'records.objects.visible',
    'records.objects.locked',
    'records.objects.flippedHorizontally',
    'records.objects.flippedVertically',
    'records.objects.position',
    'records.objects.angle',
    'records.objects.scale',
    'records.objects.rgba',
  ];
  const checks: Record<string, unknown>[] = [];
  const folderChunks = new Map<number, Map<number, Record<string, unknown>>>();
  for (const chunk of chunks) {
    const id = Number(chunk.id);
    const stream = chunk.data as StreamData;
    if (stream.decodeError || id > 4) {
      structureComplete = false;
      unknownFields.push({
        field: `chunks[${id}].data`,
        reason:
          stream.decodeError ??
          '该块标识尚无已支持的记录格式，原始字节完整保留。',
        kind: 'meaning',
      });
      continue;
    }
    if (id === 0) {
      const bytes = Buffer.from(stream.rawHex ?? '', 'hex');
      chunk.data = {
        ...stream,
        numericWords:
          bytes.length % 4 === 0
            ? Array.from({ length: bytes.length / 4 }, (_, index) =>
                bytes.readUInt32LE(index * 4),
              )
            : undefined,
      };
      if (bytes.length)
        unknownFields.push({
          field: 'chunks.settings',
          reason:
            '全局8字节设置只观察到0/1，TofuModuleData仍将相关字段标为Unk，不能命名为具体开关。',
          kind: 'meaning',
        });
      continue;
    }
    const records = stream.records ?? [];
    const maxCount = id === 1 ? 55 : id === 2 ? 50 : 20;
    const seen = new Set<number>();
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const key = Number(record.recordKeyRaw);
      record.serializedOrder = index;
      record.storageIndex = key;
      const valid =
        Number.isInteger(key) && key >= 0 && key < maxCount && !seen.has(key);
      checks.push({
        name: 'record-index-within-source-capacity',
        chunkId: id,
        index: key,
        capacity: maxCount,
        passed: valid,
      });
      if (!valid)
        unknownFields.push({
          field: `chunks[${id}].records[${index}].storageIndex`,
          reason:
            '记录键重复或超出该保存/分享数组的源码容量，不能建立稳定索引。',
          kind: 'reference',
        });
      seen.add(key);
      const objects = record.objects as Record<string, unknown>[];
      if (
        objects.some((object) =>
          ['argsA', 'argsB', 'argsC'].some((key) => key in object),
        )
      ) {
        boardsWithArguments++;
      }
      if (objects.some((object) => (Number(object.flags) & ~15) !== 0)) {
        hasReservedObjectFlags = true;
      }
    }
    if (records.length)
      candidateFields.push(`chunks[${id}].records.storageIndex`);
    for (const array of stream.arrays ?? []) {
      const expected = array.tag === 1 ? 0 : array.tag === 2 ? 2 : 1;
      const complete =
        array.values.length === records.length && array.dataType === expected;
      checks.push({
        name: 'record-property-array-count',
        chunkId: id,
        tag: array.tag,
        records: records.length,
        values: array.values.length,
        passed: complete,
      });
      if (!complete) {
        unknownFields.push({
          field: `chunks[${id}].arrays[tag=${array.tag}]`,
          reason:
            '数组数量或数据类型与记录流不一致，保留原值，不按记录顺序强行关联。',
          kind: 'reference',
        });
        continue;
      }
      if ((id === 1 || id === 3) && array.tag === 1) {
        array.values.forEach((value, index) => {
          records[index].isBoardPlaceholder =
            value === 0 ? false : value === 1 ? true : null;
          if (value > 1)
            unknownFields.push({
              field: `chunks[${id}].records[${index}].isBoardPlaceholder`,
              reason: '文件夹IsBoard数组出现0/1之外的值，不能当作布尔值。',
              kind: 'meaning',
            });
        });
        candidateFields.push(`chunks[${id}].records.isBoardPlaceholder`);
      } else if ((id === 2 || id === 4) && array.tag === 1) {
        array.values.forEach((value, index) => {
          records[index].folderIndex = value;
        });
        candidateFields.push(`chunks[${id}].records.folderIndex`);
      } else if ((id === 2 || id === 4) && array.tag === 2) {
        array.values.forEach((value, index) => {
          records[index].serverTime = value;
        });
        candidateFields.push(`chunks[${id}].records.serverTime`);
      } else if ((id === 2 || id === 4) && array.tag === 3) {
        array.values.forEach((value, index) => {
          records[index].background = value;
        });
        knownFields.push(`chunks[${id}].records.background`);
      } else {
        unknownFields.push({
          field: `chunks[${id}].arrays[tag=${array.tag}]`,
          reason: '该数组标签在此类数据块中的用途没有经过验证。',
          kind: 'meaning',
        });
      }
    }
    if (id === 1 || id === 3)
      folderChunks.set(
        id,
        new Map(records.map((record) => [Number(record.recordKeyRaw), record])),
      );
    if (String(chunk.reservedHex).replaceAll('0', '').length) {
      unknownFields.push({
        field: `chunks[${id}].reservedHex`,
        reason: '块头保留区包含非零字节，其用途未定义。',
        kind: 'storage',
      });
    }
  }
  // Board-folder references are resolved by their serialized key, never by
  // array position: the shared snapshots intentionally start at indices 17..19.
  for (const chunk of chunks) {
    const id = Number(chunk.id);
    if (id !== 2 && id !== 4) continue;
    const folders = folderChunks.get(id === 2 ? 1 : 3);
    const records = (chunk.data as StreamData).records ?? [];
    for (const record of records) {
      if (typeof record.folderIndex !== 'number') continue;
      const folder = folders?.get(record.folderIndex);
      const resolved = folder !== undefined;
      checks.push({
        name: 'board-folder-reference',
        chunkId: id,
        boardIndex: record.storageIndex,
        folderIndex: record.folderIndex,
        passed: resolved,
      });
      record.folderReferenceResolved = resolved;
      if (folder) {
        record.isInNamedFolder = folder.isBoardPlaceholder === false;
        record.folderName =
          folder.isBoardPlaceholder === false ? (folder.title ?? '') : null;
      } else
        unknownFields.push({
          field: `chunks[${id}].records[index=${record.storageIndex}].folderIndex`,
          reason: '引用的文件夹记录不存在，不能确定所属文件夹。',
          kind: 'reference',
        });
    }
  }
  if (boardsWithArguments)
    unknownFields.push({
      field: 'records.objects.argsA/argsB/argsC',
      reason: `${boardsWithArguments}条板面中的参数数值已完整读取；stgy格式只定义宽度，不同对象类型下的具体用途尚未定义。`,
      kind: 'meaning',
    });
  if (hasReservedObjectFlags)
    unknownFields.push({
      field: 'records.objects.flags.reservedBits',
      reason: '部分对象旗标包含stgy已定义4位之外的保留位。',
      kind: 'meaning',
    });
  return {
    checks,
    coverage: {
      structureComplete,
      knownFields: [...new Set(knownFields)],
      candidateFields: [...new Set(candidateFields)],
      unknownFields,
    },
  };
}

export function decodeTofu(data: Buffer): Record<string, unknown> | null {
  const chunks: Record<string, unknown>[] = [];
  let offset = 0;
  let completeFrame = true;
  while (offset < data.length) {
    if (offset + 16 > data.length) {
      if (!chunks.length) return null;
      completeFrame = false;
      break;
    }
    const id = data.readUInt32LE(offset);
    const length = data.readUInt32LE(offset + 4);
    if (offset + 16 + length > data.length) {
      if (!chunks.length) return null;
      completeFrame = false;
      break;
    }
    const body = data.subarray(offset + 16, offset + 16 + length);
    let decoded: StreamData;
    if (id === 0 || id > 4) decoded = { rawHex: body.toString('hex') };
    else {
      try {
        decoded = decodeStream(body);
      } catch (error) {
        decoded = {
          rawHex: body.toString('hex'),
          decodeError: error instanceof Error ? error.message : String(error),
        };
      }
    }
    chunks.push({
      id,
      offset,
      length,
      name:
        [
          'settings',
          'savedFolders',
          'savedBoards',
          'sharedFolders',
          'sharedBoards',
        ][id] ?? `unknown_${id}`,
      reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
      data: decoded,
    });
    offset += 16 + length;
  }
  const annotations = annotateChunks(chunks);
  if (!completeFrame) {
    annotations.coverage.structureComplete = false;
    annotations.coverage.unknownFields.push({
      field: 'remainingBytes',
      reason: '块头或声明的块长超出剩余字节，已保留此前完整块和剩余原始字节。',
      kind: 'storage',
    });
  }
  return {
    chunks,
    completeChunkStream: offset === data.length,
    ...annotations,
    remainingOffset: offset,
    remainingHex: data.subarray(offset).toString('hex'),
    note: 'Object fields follow stgy.hexpat; DAT chunk names and record keys are candidates. RGBA A stores transparency (0 is visible).',
  };
}
