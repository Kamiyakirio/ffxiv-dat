import { gameName } from './game-data.ts';
import nativeData from './native-save-data.json' with { type: 'json' };

// Static CN EXE SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Generic UIFlag getter/setter are leaf functions 0x1407f9a80 / 0x1407f9aa0.
// UIModule vtable 0x14218c3e8[23] -> 0x140788500 -> module+0x92528.
// Index 0: AgentModule slot277 construction (0x140491f79..85) identifies
// PvpWelcome; show 0x140cfdc78..81 writes 1, event 0x140cfddff..de13 tests 0.
// Indices 2/3/20: JobHudManualHelper getter 0x1409c5be0 selects flag 2 for
// IDs1..31, 3 for32..63, 20 for64..95, bit=ID&31; 0x1409c6160 sets the bit.
// UIModule vtable[41] -> 0x1407885c0 identifies this helper; ID0 is rejected.
// Index9: reader0x1407f8eb4..8ef7 resets words2/3/20 when this revision
// differs from3, then stores3 and marks dirty.
// Index17: AgentModule slot217=ItemContextCustomize (ctor0x1410394c0,
// assignment0x14048f346). 0x14103a33f tests version<630, 0x14103a37f writes
// 630 after 0x14103abe0 migrates ItemContextCustomizeModule menu settings.
// Index18: AgentModule slot438=Class2JobHotbar (ctor0x1409ea670,
// assignment0x140494340); 0x1409eab6e tests and 0x1409eadcb sets each bit.
// Native table 0x14219ffa0: ClassJob u32, prerequisite quest u16, bit u8 at+8.
// Quest predicates0x140df8f10 /0x140df8fe0 access QuestManager complete/
// accepted arrays, so a handled bit must not be reported as proof of copying.
// Index22: 0x140a694f1..9538 loads and updates a high score, clamps INT_MAX.
// Lua GetHighScore string0x14248ada0 -> wrapper0x141cb3cc0 -> Agent396
// getter0x140a697b0 -> flag22. No assumption about that agent's minigame title.
const classToJob = [
  [21, 1050, 0],
  [19, 1056, 1],
  [20, 1062, 2],
  [22, 1068, 3],
  [25, 1074, 4],
  [24, 1080, 5],
  [23, 1086, 6],
  [27, 1092, 7],
  [30, 214, 8],
] as const;
export const namedUiFlagIndices = new Set([
  0, 1, 2, 3, 9, 10, 11, 13, 14, 15, 16, 17, 18, 20, 21, 22,
]);
export function nativeFlagDetails(flags: number[]) {
  return {
    pvpWelcomeSeen: flags[0] !== 0,
    pvpWelcomeRaw: flags[0],
    jobHudManualVersion: flags[9],
    jobHudManualNeedsReset: flags[9] !== 3,
    jobHudManualStates: Array.from({ length: 95 }, (_, index) => {
      const manualId = index + 1;
      const flagIndex = manualId < 32 ? 2 : manualId < 64 ? 3 : 20;
      const references: Record<string, { actionId: number; guideId: number }> =
        nativeData.jobHudManualReferences;
      const reference = references[manualId];
      return {
        actionIdCandidate: reference?.actionId ?? null,
        actionNameCandidate: reference
          ? gameName('Action', reference.actionId)
          : null,
        guideIdCandidate: reference?.guideId ?? null,
        manualId,
        savedIsSeen: ((flags[flagIndex] >>> (manualId & 31)) & 1) !== 0,
        isSeen:
          flags[9] === 3 && ((flags[flagIndex] >>> (manualId & 31)) & 1) !== 0,
        flagIndex,
        flagBit: manualId & 31,
      };
    }),
    jobHudManualReservedBit0: flags[2] & 1,
    itemContextCustomizationVersion: flags[17],
    itemContextCustomizationNeedsMigration: flags[17] < 630,
    classToJobHotbarPrompts: classToJob.map(
      ([classJobId, prerequisiteQuestId, bit]) => ({
        classJobId,
        classJobName: gameName('ClassJob', classJobId),
        prerequisiteQuestId,
        bit,
        handled: ((flags[18] >>> bit) & 1) !== 0,
      }),
    ),
    classToJobHotbarUnknownBits: (flags[18] & ~0x1ff) >>> 0,
    miniGameHighScore: flags[22] <= 0x7fffffff ? flags[22] : 0,
    miniGameHighScoreRaw: flags[22],
    unmappedUiFlags: flags.flatMap((value, index) =>
      namedUiFlagIndices.has(index) ? [] : [{ index, value }],
    ),
  };
}
