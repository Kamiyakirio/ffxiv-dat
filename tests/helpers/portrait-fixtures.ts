export function fixed(tag: number, value: Buffer) {
  const header = Buffer.alloc(2);
  header.writeUInt16LE(tag);
  return Buffer.concat([header, value]);
}
export function word(value: number) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}
export function integer(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}
export function variable(tag: number, bytes: Buffer) {
  return Buffer.concat([
    word(tag),
    word(bytes.length),
    bytes,
    (tag === 22 || tag === 24) && bytes.length % 2
      ? Buffer.alloc(1)
      : Buffer.alloc(0),
  ]);
}
export function bannerRecord(id: number, name = '测试肖像') {
  const text = Buffer.from(name),
    storage = Buffer.alloc((text.length + 4) & ~3);
  text.copy(storage);
  const progress = Buffer.alloc(4);
  progress.writeFloatLE(0.375);
  return Buffer.concat([
    fixed(0, word(id)),
    variable(1, storage),
    fixed(2, word(2)),
    fixed(3, word(3)),
    fixed(4, word(4)),
    fixed(5, word(69)),
    fixed(6, progress),
    fixed(7, word(22)),
    fixed(8, Buffer.from([0, 60, 0, 64, 0, 66])),
    fixed(9, Buffer.alloc(6)),
    fixed(10, word(50)),
    fixed(11, word(10)),
    fixed(14, Buffer.from([32, 53, 255, 0xa5])),
    fixed(15, word(90)),
    fixed(16, Buffer.from([200, 150, 100, 0xfe])),
    fixed(17, word(80)),
    fixed(18, Buffer.from([10, 0, 20, 0])),
    fixed(19, Buffer.alloc(4)),
    fixed(20, Buffer.alloc(4)),
    fixed(21, integer(1700000000)),
    variable(22, Buffer.from([4, 1, 100, 7])),
    fixed(23, integer(12345678)),
    variable(24, word(0x100)),
  ]);
}
export function bannerChunk(body: Buffer, id = 0) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(id);
  header.writeUInt32LE(body.length, 4);
  header[12] = 0xa5;
  return Buffer.concat([header, body]);
}
export function datFile(
  type: number,
  version: number,
  payload: Buffer,
  spare = 32,
) {
  const section = [1, 3, 5, 6, 7, 8, 10].includes(type),
    mask = section ? 0x73 : [2, 9].includes(type) ? 0x31 : 0;
  const length = payload.length + Number(section),
    bytes = Buffer.alloc(32 + length + spare);
  bytes.writeUInt16LE(type);
  bytes.writeUInt16LE(version, 2);
  bytes.writeUInt32LE(length + spare, 4);
  bytes.writeUInt32LE(length, 8);
  bytes.writeUInt32LE(0x1234, 12);
  if (section) bytes[16] = 255;
  Buffer.from(payload.map((v) => v ^ mask)).copy(bytes, 16 + Number(section));
  bytes[bytes.length - 1] = 0xa7;
  return bytes;
}
export function uiSave(
  contentId: string,
  records = [bannerRecord(7)],
  masked = true,
  includeBanner = true,
) {
  const container = Buffer.alloc(16);
  container.writeUInt32LE(16);
  container.writeUInt32LE(includeBanner ? 3 : 2, 4);
  container.writeBigUInt64LE(BigInt(`0x${contentId}`), 8);
  const segment = (id: number, data: Buffer) => {
    const header = Buffer.alloc(16);
    header.writeUInt16LE(id);
    header.writeUInt32LE(data.length + 16, 4);
    header.writeUInt32LE(data.length, 8);
    header[12] = 0xb3;
    return Buffer.concat([header, data, Buffer.from([0xad, 0, 0, 0])]);
  };
  const banners = Buffer.concat([
    bannerChunk(Buffer.alloc(0), 1),
    bannerChunk(Buffer.concat(records)),
    bannerChunk(Buffer.from([1, 2, 3]), 9),
  ]);
  const stored = masked
    ? Buffer.concat([
        Buffer.from([255]),
        Buffer.from(banners.map((v) => v ^ 0x73)),
      ])
    : banners;
  return datFile(
    9,
    1,
    Buffer.concat([
      container,
      segment(32, Buffer.from([10])),
      ...(includeBanner ? [segment(23, stored)] : []),
      segment(999, Buffer.from([0xde, 0xad, 0xbe, 0xef])),
    ]),
  );
}
export function gearset(link = 8) {
  const payload = Buffer.alloc(4 + 452);
  payload[4 + 0x36] = link;
  payload[4 + 0x37] = 1;
  Buffer.from('测试套装').copy(payload, 5);
  return datFile(5, 110, payload);
}
