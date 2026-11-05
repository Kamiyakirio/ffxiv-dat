import { generateBannerChecksum } from './uisave-banner.ts';

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(Number) : [];
export function linkBannerEquipment(segments: Row[], gearsets: Row[]) {
  const segment = segments.find((segment) => segment.id === 23);
  if (!segment) return;
  const data = segment.data as Row;
  const portraits = rows(data.chunks).flatMap((chunk) => rows(chunk.records));
  let matched = 0;
  for (const portrait of portraits) {
    const matches: Row[] = [];
    for (const gear of gearsets) {
      if (
        !gear.exists ||
        gear.isSavedGearsetSlot === false ||
        gear.bannerIndex !== portrait.bannerIndex
      )
        continue;
      const items = rows(gear.items),
        glasses = numbers(gear.glassesIds);
      if (items.length !== 14 || glasses.length !== 2) continue;
      const flags = Number(gear.flags);
      // Target 0x140bc53ed..5426: gear flags -> BannerGearVisibilityFlag.
      const visibility =
        (flags & 8 ? 0 : 1) |
        (flags & 16 ? 0 : 2) |
        (flags & 32 ? 4 : 0) |
        (flags & 64 ? 8 : 0);
      const stains = items.flatMap((item) => numbers(item.stainIds));
      if (stains.length !== 28) continue;
      for (const useStoredGlamour of [false, true]) {
        const itemIds = items.map((item) =>
          Number(
            useStoredGlamour ? item.glamourId || item.itemId : item.itemId,
          ),
        );
        const checksum = generateBannerChecksum({
          itemIds,
          stainIds: stains,
          glassesIds: glasses,
          gearVisibilityFlag: visibility,
        });
        if (checksum !== portrait.checksum) continue;
        matches.push({
          gearsetRecordIndex: gear.recordIndex,
          gearsetId: gear.id,
          name: gear.name,
          checksum,
          inputSource: useStoredGlamour
            ? 'saved-glamour-candidate'
            : 'saved-equipment',
        });
        break;
      }
    }
    portrait.equipmentChecksumMatches = matches;
    portrait.equipmentChecksumStatus = matches.length
      ? '已匹配本地装备快照'
      : '未找到一致的本地装备快照';
    portrait.matchedGearsetNames = [
      ...new Set(
        matches.map((match) =>
          String(match.name || `套装 ${Number(match.gearsetRecordIndex) + 1}`),
        ),
      ),
    ].join(' / ');
    if (matches.length) matched++;
  }
  data.checksumAlgorithm = 'CRC-32/ISO-HDLC';
  data.checksumMatchedRecordCount = matched;
  data.checksumUnmatchedRecordCount = portraits.length - matched;
  // A negative result is not a failed file checksum. The game can apply a
  // runtime validity mask and a linked glamour plate before making the 92B
  // snapshot (0x1407f2180); those inputs are not all present in GEARSET.DAT.
}
