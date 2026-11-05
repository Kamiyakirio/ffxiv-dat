import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBannerChecksum } from '../src/main/services/dat/uisave-banner.ts';
import { linkBannerEquipment } from '../src/main/services/dat/banner-equipment.ts';
import { decodeGearset } from '../src/main/services/dat/layouts.ts';

function gear(index = 2) {
  return {
    recordIndex: 3,
    id: 7,
    name: '测试套装',
    bannerIndex: index,
    exists: true,
    isSavedGearsetSlot: true,
    flags: 0x58,
    glassesIds: [2, 3],
    items: Array.from({ length: 14 }, (_, i) => ({
      itemId: i + 1,
      glamourId: 0,
      stainIds: [i, i + 1],
    })),
  };
}
function checksum(g, useGlamour = false) {
  return generateBannerChecksum({
    itemIds: g.items.map((item) =>
      useGlamour ? item.glamourId || item.itemId : item.itemId,
    ),
    stainIds: g.items.flatMap((item) => item.stainIds),
    glassesIds: g.glassesIds,
    gearVisibilityFlag: 8,
  });
}
function segment(record) {
  return [{ id: 23, data: { chunks: [{ id: 0, records: [record] }] } }];
}

test('gearset bit0x40 is a known Viera-ear setting rather than an unnamed bit', () => {
  const bytes = Buffer.alloc(4 + 452);
  bytes[4 + 0x37] = 0xc2;
  const r = decodeGearset(bytes, 110).data.records[0];
  assert.equal(r.hideVieraEars, true);
  assert.equal(r.unknownFlags, 0x82);
  assert.equal(r.flags, 0xc2);
});
test('portrait checksum links use the physical BannerIndex, not the dense runtime BannerId', () => {
  const g = gear(),
    portrait = { bannerIndex: 2, bannerId: 0, checksum: checksum(g) },
    s = segment(portrait);
  linkBannerEquipment(s, [gear(0), g]);
  assert.equal(portrait.equipmentChecksumMatches.length, 1);
  assert.equal(portrait.equipmentChecksumMatches[0].gearsetId, 7);
  assert.equal(s[0].data.checksumMatchedRecordCount, 1);
  assert.equal(portrait.equipmentChecksumStatus, '已匹配本地装备快照');
});
test('stored glamour can corroborate an input candidate while a mismatch is not reported as file corruption', () => {
  const g = gear();
  g.items[0].glamourId = 765;
  const portrait = { bannerIndex: 2, checksum: checksum(g, true) },
    s = segment(portrait);
  linkBannerEquipment(s, [g]);
  assert.equal(
    portrait.equipmentChecksumMatches[0].inputSource,
    'saved-glamour-candidate',
  );
  assert.equal(portrait.matchedGearsetNames, '测试套装');
  const missing = { bannerIndex: 2, checksum: 123 },
    other = segment(missing);
  linkBannerEquipment(other, [g]);
  assert.deepEqual(missing.equipmentChecksumMatches, []);
  assert.equal(missing.equipmentChecksumStatus, '未找到一致的本地装备快照');
  assert.equal(other[0].data.checksumUnmatchedRecordCount, 1);
  assert.equal(missing.checksum, 123);
});
