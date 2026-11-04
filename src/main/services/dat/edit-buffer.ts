import type { EditableField, EditValue } from '../../../shared/types.ts';
import { gameName, itemName } from './game-data.ts';
import { decodeUtf8 } from './sections.ts';

type Codec = 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'f32' | 'f16';
type Options = Partial<
  Pick<EditableField, 'min' | 'max' | 'step' | 'reference' | 'choices'>
> & { factor?: number };
const codecs = {
  u8: [1, 0, 255],
  u16: [2, 0, 65535],
  u32: [4, 0, 4294967295],
  i8: [1, -128, 127],
  i16: [2, -32768, 32767],
  i32: [4, -2147483648, 2147483647],
  f32: [4, -3.4028234663852886e38, 3.4028234663852886e38],
  f16: [2, -65504, 65504],
};
function half(bits: number) {
  const sign = bits & 0x8000 ? -1 : 1,
    exp = (bits >> 10) & 31,
    m = bits & 1023;
  return (
    sign *
    (exp === 0
      ? 2 ** -24 * m
      : exp === 31
        ? m
          ? NaN
          : Infinity
        : 2 ** (exp - 15) * (1 + m / 1024))
  );
}
function halfBits(value: number) {
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const v = Math.abs(value);
  if (v < 2 ** -14) return sign | Math.round(v / 2 ** -24);
  let exp = Math.floor(Math.log2(v));
  let mantissa = Math.round((v / 2 ** exp - 1) * 1024);
  if (mantissa === 1024) {
    exp++;
    mantissa = 0;
  }
  if (exp > 15) throw new Error('数值超出半精度浮点范围。');
  return sign | ((exp + 15) << 10) | mantissa;
}
export class EditBuffer {
  readonly fields: EditableField[] = [];
  private writers = new Map<string, (value: EditValue) => void>();
  private replacements: { offset: number; length: number; bytes: Buffer }[] =
    [];
  private containers: {
    offset: number;
    width: number;
    start: number;
    length: number;
  }[] = [];
  readonly bytes: Buffer;
  constructor(
    bytes: Buffer,
    public prefix = '',
    public group = '',
  ) {
    this.bytes = Buffer.from(bytes);
  }
  private register(
    field: Omit<EditableField, 'id' | 'group'>,
    key: string,
    writer: (value: EditValue) => void,
  ) {
    const id = this.prefix + key;
    if (this.writers.has(id)) throw new Error(`重复编辑字段 ${id}`);
    this.fields.push({ ...field, id, group: this.group });
    this.writers.set(id, writer);
  }
  number(
    key: string,
    label: string,
    offset: number,
    codec: Codec = 'u8',
    options: Options = {},
  ) {
    const [width, min, max] = codecs[codec];
    if (offset < 0 || offset + width > this.bytes.length)
      throw new Error('编辑字段超出已验证范围。');
    const read = () =>
      codec === 'f32'
        ? this.bytes.readFloatLE(offset)
        : codec === 'f16'
          ? half(this.bytes.readUInt16LE(offset))
          : codec.startsWith('i')
            ? this.bytes.readIntLE(offset, width)
            : this.bytes.readUIntLE(offset, width);
    const factor = options.factor ?? 1;
    const value = read() * factor;
    if (!Number.isFinite(value)) return;
    const reference = options.reference;
    this.register(
      {
        type: 'number',
        value,
        label,
        min: options.min ?? min * factor,
        max: options.max ?? max * factor,
        step: options.step ?? (codec.startsWith('f') ? undefined : factor),
        reference,
        choices: options.choices,
        displayValue: reference
          ? reference === 'Item'
            ? itemName(value)
            : (gameName(reference, value) ?? undefined)
          : undefined,
      },
      key,
      (v) => {
        const stored = Number(v) / factor;
        if (
          !Number.isFinite(stored) ||
          (!codec.startsWith('f') &&
            !Number.isInteger(Math.round(stored * 1e6) / 1e6))
        )
          throw new Error(`${label} 的精度不符合存储格式。`);
        if (codec === 'f32') this.bytes.writeFloatLE(stored, offset);
        else if (codec === 'f16')
          this.bytes.writeUInt16LE(halfBits(stored), offset);
        else if (codec.startsWith('i'))
          this.bytes.writeIntLE(Math.round(stored), offset, width);
        else this.bytes.writeUIntLE(Math.round(stored), offset, width);
      },
    );
  }
  bits(
    key: string,
    label: string,
    offset: number,
    mask: number,
    width = 1,
    boolean = true,
  ) {
    const shift = Math.log2(mask & -mask);
    const current = this.bytes.readUIntLE(offset, width);
    this.register(
      {
        type: boolean ? 'boolean' : 'number',
        label,
        value: boolean ? !!(current & mask) : (current & mask) >>> shift,
        min: 0,
        max: mask >>> shift,
        step: 1,
      },
      key,
      (v) => {
        const original = this.bytes.readUIntLE(offset, width);
        const value = boolean ? (v ? mask : 0) : Number(v) << shift;
        this.bytes.writeUIntLE(
          ((original & ~mask) | value) >>> 0,
          offset,
          width,
        );
      },
    );
  }
  boolean(key: string, label: string, offset: number) {
    if (this.bytes[offset] > 1) return;
    this.bits(key, label, offset, 1);
  }
  text(key: string, label: string, offset: number, length: number) {
    if (length < 1) return;
    const bytes = this.bytes.subarray(offset, offset + length);
    if (bytes.length !== length) throw new Error('文本范围不完整。');
    const end = bytes.indexOf(0);
    const value = decodeUtf8(bytes.subarray(0, end < 0 ? length : end));
    if (value === null) return;
    this.register(
      { type: 'text', label, value, maxBytes: length - 1 },
      key,
      (v) => {
        const encoded = Buffer.from(String(v));
        // Clear the old string, but preserve unrelated bytes after its terminator.
        this.bytes.fill(
          0,
          offset,
          offset + Math.max(encoded.length + 1, end < 0 ? length : end + 1),
        );
        encoded.copy(this.bytes, offset);
      },
    );
  }
  variableText(
    key: string,
    label: string,
    value: string,
    offset: number,
    length: number,
    encode: (value: string) => Buffer,
    maxBytes = 65534,
  ) {
    this.register({ type: 'text', value, label, maxBytes }, key, (v) =>
      this.replacements.push({ offset, length, bytes: encode(String(v)) }),
    );
  }
  container(offset: number, width: 2 | 4, start: number, length: number) {
    this.containers.push({ offset, width, start, length });
  }
  apply(changes: { id: string; value: EditValue }[]) {
    for (const change of changes) this.writers.get(change.id)?.(change.value);
    for (const container of this.containers) {
      const delta = this.replacements
        .filter(
          (r) =>
            r.offset >= container.start &&
            r.offset + r.length <= container.start + container.length,
        )
        .reduce((n, r) => n + r.bytes.length - r.length, 0);
      const length = container.length + delta;
      if (length < 0 || length > (container.width === 2 ? 65535 : 4294967295))
        throw new Error('修改后的文本超出记录长度范围。');
      this.bytes.writeUIntLE(length, container.offset, container.width);
    }
    let result = this.bytes;
    for (const r of this.replacements.sort((a, b) => b.offset - a.offset))
      result = Buffer.concat([
        result.subarray(0, r.offset),
        r.bytes,
        result.subarray(r.offset + r.length),
      ]);
    return result;
  }
}

export function validateEdits(
  fields: EditableField[],
  changes: { id: string; value: EditValue }[],
) {
  if (!Array.isArray(changes) || changes.length > fields.length)
    throw new Error('无效的修改列表。');
  const known = new Map(fields.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (const change of changes) {
    const field = known.get(change?.id);
    if (!field || seen.has(change.id))
      throw new Error('修改包含只读、失效或重复字段。');
    seen.add(change.id);
    const v = change.value;
    if (field.type === 'boolean' && typeof v !== 'boolean')
      throw new Error(`${field.label} 必须是开关。`);
    if (
      field.type === 'number' &&
      (typeof v !== 'number' ||
        !Number.isFinite(v) ||
        v < field.min! ||
        v > field.max! ||
        (field.step === 1 && !Number.isInteger(v)))
    )
      throw new Error(`${field.label} 超出范围或不是有效数值。`);
    if (field.choices && !field.choices.some((c) => c.value === v))
      throw new Error(`${field.label} 不是已定义的选项。`);
    if (
      field.type === 'text' &&
      (typeof v !== 'string' ||
        /[\0\r\n]/.test(v) ||
        Buffer.byteLength(v) > field.maxBytes! ||
        v !== new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(v)))
    )
      throw new Error(
        `${field.label} 含无效字符或超出 ${field.maxBytes} 字节。`,
      );
  }
}
