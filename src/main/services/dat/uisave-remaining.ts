import { decodeNativeUiSegment } from './uisave-native.ts';
import { decodeNativeGroupStamps } from './uisave-stamps.ts';

export function decodeRemainingUiSegment(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 21) return decodeNativeGroupStamps(version, data);
  return decodeNativeUiSegment(id, version, data);
}
