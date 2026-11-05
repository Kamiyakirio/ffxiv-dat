// Static CN EXE SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// 0x140803fd0 shifts 4x16B, then stores YakuCode+1 and current Unix seconds.
// Caller0x14110b00f..048 walks the winning-yaku list: bit17 selects Yakuman;
// only the local-player branch logs. Addon text normally =0x2ffa+YakuCode,
// pao variants44/45 use12339/12340 for UI text but retain code+1 in history.
// Clock0x1400e0e80 ->0x140482820 returns server seconds, with fallback
// 0x1401e4dd0: GetSystemTime / SystemTimeToFileTime minus1970-01-01.
// Chinese labels corroborate Addon12322..12336 from public data revision
// 2c6741cffe3cfe70f093c54c463791364e515d8d. They are not target SqPack text.
const yakumanLabels = [
  '天和',
  '地和',
  '九莲宝灯',
  '纯正九莲宝灯',
  '大三元',
  '大四喜',
  '小四喜',
  '四暗刻',
  '四暗刻单骑',
  '四杠子',
  '字一色',
  '清老头',
  '绿一色',
  '国士无双',
  '国士无双十三面',
];
export function decodeEmjYakumanHistory(bytes: Buffer) {
  if (bytes.length !== 80) return null;
  return Array.from({ length: 5 }, (_, index) => {
    const storedYakuId = bytes.readInt32LE(index * 16);
    const known = storedYakuId >= 41 && storedYakuId <= 55;
    return {
      index,
      hasRecord: storedYakuId !== 0,
      storedYakuId,
      yakuCode: storedYakuId > 0 ? storedYakuId - 1 : null,
      addonTextId: known ? 12281 + storedYakuId : null,
      yakuNameCandidate: known ? yakumanLabels[storedYakuId - 41] : null,
      achievedAtUnix: bytes.readUInt32LE(index * 16 + 4),
      reservedHex: bytes
        .subarray(index * 16 + 8, index * 16 + 16)
        .toString('hex'),
    };
  });
}

// Block1 serializes module+0xa8 (32B). Only the first three u16 counters are
// assigned by 0x140804020 (increment, saturating9999) /0x140804060 (clamp).
// 0x1410e1fac..1fcc increments the mode0 winning result's difficulty counter.
// 0x1410ba0ff obtains EmjModule, 0x1410ba3bf/3db/3fc display +A8/+AA/+AC
// through Addon12388 (wins). The three public labels12385..12387 are text
// references, not a re-extracted target ULD/localization claim.
export function decodeEmjNpcWins(bytes: Buffer) {
  if (bytes.length !== 32) return null;
  return {
    npcWins: ['初级', '中级', '上级'].map(
      (difficultyNameCandidate, difficultyIndex) => ({
        difficultyIndex,
        difficultyNameCandidate,
        winCount: bytes.readUInt16LE(difficultyIndex * 2),
        nameAddonId: 12385 + difficultyIndex,
      }),
    ),
    countAddonId: 12388,
    reservedHex: bytes.subarray(6).toString('hex'),
  };
}
