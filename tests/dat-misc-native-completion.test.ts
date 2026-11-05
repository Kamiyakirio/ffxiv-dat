import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeFlagDetails } from '../src/main/services/dat/uisave-flag-details.ts';
import {
  decodeEmjYakumanHistory,
  decodeEmjNpcWins,
} from '../src/main/services/dat/uisave-emj-history.ts';
import { decodeAdditionalUiSegment } from '../src/main/services/dat/uisave-other.ts';
import {
  expectRecord,
  expectRecords,
  expectDefined,
  expectCoverage,
} from './helpers/assertions.ts';

test('FLAGS job-gauge manual state crosses both native bitmap boundaries without shifting IDs', () => {
  const flags = Array(64).fill(0);
  flags[9] = 3;
  flags[2] = 0x80000003;
  flags[3] = 0x80000001;
  flags[20] = 0x80000001;
  const result = nativeFlagDetails(flags);
  assert.equal(result.jobHudManualStates.length, 95);
  assert.deepEqual(
    result.jobHudManualStates.filter((r) => r.isSeen).map((r) => r.manualId),
    [1, 31, 32, 63, 64, 95],
  );
  assert.deepEqual(
    result.jobHudManualStates
      .filter((r) => r.isSeen)
      .map((r) => [r.flagIndex, r.flagBit]),
    [
      [2, 1],
      [2, 31],
      [3, 0],
      [3, 31],
      [20, 0],
      [20, 31],
    ],
  );
  assert.equal(result.jobHudManualReservedBit0, 1);
});

test('FLAGS separates handled job-transition prompts, migration version, PVP introduction and score', () => {
  const flags = Array(64).fill(0);
  flags[0] = 1;
  flags[9] = 3;
  flags[17] = 629;
  flags[18] = 0x101;
  flags[22] = 905;
  const result = nativeFlagDetails(flags);
  assert.equal(result.pvpWelcomeSeen, true);
  assert.equal(result.itemContextCustomizationNeedsMigration, true);
  assert.deepEqual(
    result.classToJobHotbarPrompts
      .filter((r) => r.handled)
      .map((r) => [r.classJobId, r.prerequisiteQuestId]),
    [
      [21, 1050],
      [30, 214],
    ],
  );
  assert.equal(
    expectDefined(
      result.classToJobHotbarPrompts.find((r) => r.classJobId === 19),
    ).handled,
    false,
  );
  assert.equal(result.miniGameHighScore, 905);
  assert.deepEqual(
    result.unmappedUiFlags.filter((r) => r.value),
    [],
  );
  flags[17] = 630;
  flags[22] = 0xffffffff;
  flags[18] = 0x80000200;
  const guarded = nativeFlagDetails(flags);
  assert.equal(guarded.itemContextCustomizationNeedsMigration, false);
  assert.equal(guarded.miniGameHighScore, 0);
  assert.equal(guarded.miniGameHighScoreRaw, 0xffffffff);
  assert.equal(guarded.classToJobHotbarUnknownBits, 0x80000200);
});

test('FLAGS confirmed details are connected through the normal segment decoder', () => {
  const bytes = Buffer.alloc(384);
  bytes.writeUInt32LE(96, 4);
  bytes.writeUInt32LE(2, 112);
  bytes.writeUInt32LE(256, 116);
  bytes.writeUInt32LE(1, 128);
  bytes.writeUInt32LE(630, 128 + 17 * 4);
  bytes.writeUInt32LE(905, 128 + 22 * 4);
  const result = expectDefined(decodeAdditionalUiSegment(2, 100, bytes));
  assert.equal(result.pvpWelcomeSeen, true);
  assert.equal(result.itemContextCustomizationVersion, 630);
  assert.equal(result.miniGameHighScore, 905);
  assert(
    expectCoverage(result.coverage).knownFields.includes('jobHudManualStates'),
  );
  assert(
    expectCoverage(result.coverage).unknownFields.some(
      (f) => f.field === 'unmappedUiFlags',
    ),
  );
});

test('EMJ records are five Yakuman achievements with Unix seconds, preserving unknown IDs and storage', () => {
  const bytes = Buffer.alloc(80);
  bytes.writeInt32LE(41, 0);
  bytes.writeUInt32LE(1735689600, 4);
  bytes.writeInt32LE(45, 16);
  bytes.writeUInt32LE(0x80000000, 20);
  bytes.writeInt32LE(55, 32);
  bytes[40] = 0x7f;
  bytes.writeInt32LE(999, 48);
  const result = expectDefined(decodeEmjYakumanHistory(bytes));
  assert.equal(result.length, 5);
  assert.deepEqual(
    result
      .slice(0, 3)
      .map((r) => [
        r.storedYakuId,
        r.yakuCode,
        r.addonTextId,
        r.yakuNameCandidate,
      ]),
    [
      [41, 40, 12322, '天和'],
      [45, 44, 12326, '大三元'],
      [55, 54, 12336, '国士无双十三面'],
    ],
  );
  assert.equal(result[0].achievedAtUnix, 1735689600);
  assert.equal(result[1].achievedAtUnix, 0x80000000);
  assert.equal(result[2].reservedHex, '7f00000000000000');
  assert.equal(result[3].storedYakuId, 999);
  assert.equal(result[3].addonTextId, null);
  assert.equal(result[3].yakuNameCandidate, null);
  assert.equal(result[4].hasRecord, false);
  assert.equal(decodeEmjYakumanHistory(Buffer.alloc(79)), null);
});

test('EMJ native history interpretation is routed while raw compatibility output remains exact', () => {
  const header = Buffer.alloc(16),
    bytes = Buffer.alloc(80);
  header.writeUInt32LE(80, 4);
  bytes.writeInt32LE(45);
  bytes.writeUInt32LE(1735689600, 4);
  bytes[8] = 0x5a;
  const result = expectDefined(
    decodeAdditionalUiSegment(11, 0, Buffer.concat([header, bytes])),
  );
  const data = expectRecord(expectRecords(result.chunks)[0].data);
  assert.equal(
    expectRecords(data.yakumanHistory)[0].yakuNameCandidate,
    '大三元',
  );
  assert.equal(
    expectRecords(expectRecord(data.statisticsCandidate).historyEntries)[0]
      .valueRaw,
    45,
  );
  assert.equal(
    expectRecords(expectRecord(data.statisticsCandidate).historyEntries)[0]
      .reservedHex,
    '5a00000000000000',
  );
  assert(
    expectCoverage(result.coverage).knownFields.includes(
      'chunks[key=0].data.yakumanHistory.achievedAtUnix',
    ),
  );
  assert(
    !expectCoverage(result.coverage).unknownFields.some((f) =>
      f.field.includes('valueRaw/timeRaw'),
    ),
  );
});

test('EMJ NPC difficulty victories are three u16 counters and preserve the remaining32B block', () => {
  const bytes = Buffer.alloc(32, 0x5a);
  bytes.writeUInt16LE(1, 0);
  bytes.writeUInt16LE(9999, 2);
  bytes.writeUInt16LE(65535, 4);
  const result = expectDefined(decodeEmjNpcWins(bytes));
  assert.deepEqual(
    result.npcWins.map((r) => [r.difficultyIndex, r.winCount, r.nameAddonId]),
    [
      [0, 1, 12385],
      [1, 9999, 12386],
      [2, 65535, 12387],
    ],
  );
  assert.equal(result.countAddonId, 12388);
  assert.equal(result.reservedHex, '5a'.repeat(26));
  assert.equal(decodeEmjNpcWins(Buffer.alloc(31)), null);
});

test('FLAGS9 is the manual-bitmap revision and old revisions reset effective states only', () => {
  const flags = Array(64).fill(0);
  flags[9] = 2;
  flags[2] = 2;
  flags[3] = 1;
  flags[20] = 1;
  const old = nativeFlagDetails(flags);
  assert.equal(old.jobHudManualVersion, 2);
  assert.equal(old.jobHudManualNeedsReset, true);
  assert.deepEqual(
    old.jobHudManualStates.filter((r) => r.savedIsSeen).map((r) => r.manualId),
    [1, 32, 64],
  );
  assert.equal(old.jobHudManualStates.filter((r) => r.isSeen).length, 0);
  assert(!old.unmappedUiFlags.some((r) => r.index === 9));
  flags[9] = 3;
  assert.deepEqual(
    nativeFlagDetails(flags)
      .jobHudManualStates.filter((r) => r.isSeen)
      .map((r) => r.manualId),
    [1, 32, 64],
  );
});
