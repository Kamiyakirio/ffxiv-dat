import type { DatSection } from './types.ts';

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

export function readSections(payload: Buffer): DatSection[] {
  const sections: DatSection[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 3 > payload.length) {
      throw new Error(`Truncated section header at payload offset ${offset}`);
    }
    const length = payload.readUInt16LE(offset + 1);
    const end = offset + 3 + length;
    if (length === 0 || end > payload.length) {
      throw new Error(`Invalid section length ${length} at offset ${offset}`);
    }
    const bytes = payload.subarray(offset + 3, end);
    const nulTerminated = bytes.at(-1) === 0;
    sections.push({
      offset,
      tag: String.fromCharCode(payload[offset]),
      length,
      valueHex: bytes.toString('hex'),
      text: decodeUtf8(nulTerminated ? bytes.subarray(0, -1) : bytes),
      nulTerminated,
    });
    offset = end;
  }
  return sections;
}
