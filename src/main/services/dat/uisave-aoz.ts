import type { DecodeCoverage } from '../../../shared/types.ts';
import targetData from './native-save-data.json' with { type: 'json' };
import { decodeUtf8 } from './sections.ts';

// Static CN client SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Writer 0x140804a40, reader 0x140805500: five parallel columns, NOT five
// interleaved records. Bitmap reader 0x1408069b0 / bit getter 0x140806ff0.
// Save/load slot consumers 0x140805d00 / 0x140807040 distinguish macro bytes
// (bank*100+slot) from sheet-734 row IDs; getter 0x140833eb0 returns ActionId.
export interface AozActionReference {
  actionId: number;
  name?: string | null;
}
type References = Record<string, AozActionReference>;
const references: References = targetData.blueMageActions;

export function decodeNativeAoz(
  version: number,
  data: Buffer,
  actionReferences: References = references,
): Record<string, unknown> | null {
  if (version !== 3 || data.length !== 1825) return null;
  const unknown: DecodeCoverage['unknownFields'] = [];
  const action = (storedId: number, offset: number) => {
    const reference = actionReferences[storedId];
    return {
      offset,
      storedId,
      empty: storedId === 0,
      actionId: storedId === 0 ? 0 : (reference?.actionId ?? null),
      name: storedId === 0 ? null : (reference?.name ?? null),
      referenceSource:
        storedId !== 0 && reference ? `AozAction#${storedId}.Action` : null,
    };
  };
  const activeSets = Array.from({ length: 5 }, (_, index) => {
    const actionsOffset = index * 24,
      nameOffset = 0x78 + index * 60,
      hotbarsOffset = 0x1a4 + index * 248,
      macroFlagsOffset = 0x67c + index * 31;
    const nameBytes = data.subarray(nameOffset, nameOffset + 60),
      zero = nameBytes.indexOf(0),
      nameByteLength = zero < 0 ? 60 : zero,
      name = decodeUtf8(nameBytes.subarray(0, nameByteLength));
    if (name === null)
      unknown.push({
        field: `activeSets[${index}].name`,
        reason: '名称包含非UTF-8字节，保留完整60字节存储区。',
        kind: 'storage',
      });
    const slot = (linearIndex: number, slotIndex: number) => {
      const offset = hotbarsOffset + linearIndex,
        storedValue = data[offset],
        isMacro =
          (data[macroFlagsOffset + (linearIndex >>> 3)] &
            (1 << (linearIndex & 7))) !==
          0;
      const common = {
        slotIndex,
        offset,
        storedValue,
        isMacro,
        macroFlagOffset: macroFlagsOffset + (linearIndex >>> 3),
        macroFlagBit: linearIndex & 7,
      };
      if (isMacro) {
        const macroBank = Math.floor(storedValue / 100),
          macroIndex = storedValue % 100;
        if (macroBank > 1)
          unknown.push({
            field: `activeSets[${index}].hotbars[${linearIndex}]`,
            reason: '宏编码超出客户端写入的个人/公用各100项范围，保留原始值。',
            kind: 'storage',
          });
        return {
          ...common,
          kind: macroBank < 2 ? 'Macro' : 'InvalidMacro',
          macroBank,
          macroIndex,
          macroBankName:
            macroBank === 0 ? '个人' : macroBank === 1 ? '公用' : null,
          macroCommandId: macroBank < 2 ? (macroBank << 8) | macroIndex : null,
        };
      }
      if (storedValue === 255) return { ...common, kind: 'PreserveExisting' };
      // Zero clears an existing BLU Action/Macro, preserving unrelated commands.
      if (storedValue === 0) return { ...common, kind: 'ClearBlueMageOrMacro' };
      return { ...common, kind: 'Action', ...action(storedValue, offset) };
    };
    return {
      index,
      sourceOffsets: {
        actions: actionsOffset,
        name: nameOffset,
        hotbars: hotbarsOffset,
        macroFlags: macroFlagsOffset,
      },
      activeBlueMageActionIds: [
        ...data.subarray(actionsOffset, actionsOffset + 24),
      ],
      activeActions: Array.from({ length: 24 }, (_, actionIndex) => ({
        index: actionIndex,
        ...action(
          data[actionsOffset + actionIndex],
          actionsOffset + actionIndex,
        ),
      })),
      name,
      nameByteLength,
      nameStorageHex: nameBytes.toString('hex'),
      // The loader copies all 60 bytes and explicitly sets runtime byte 60=0.
      nameStorageNulTerminated: zero >= 0,
      standardHotbars: Array.from({ length: 10 }, (_, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 12 }, (_, slotIndex) =>
          slot(barIndex * 12 + slotIndex, slotIndex),
        ),
      })),
      crossHotbars: Array.from({ length: 8 }, (_, barIndex) => ({
        barIndex,
        nativeHotbarIndex: barIndex + 10,
        slots: Array.from({ length: 16 }, (_, slotIndex) =>
          slot(120 + barIndex * 16 + slotIndex, slotIndex),
        ),
      })),
      macroFlagsHex: data
        .subarray(macroFlagsOffset, macroFlagsOffset + 31)
        .toString('hex'),
    };
  });
  return {
    activeSets,
    recentActions: Array.from({ length: 10 }, (_, index) => ({
      index,
      ...action(data[0x717 + index], 0x717 + index),
    })),
    actionReferenceBasis:
      'Native sheet 734 rows return Action IDs. AozAction ID-to-Action/name references use the pinned public Chinese sheet; target EXL table-name binding was not re-extracted.',
    note: '五组独立列：24字节技能、60字节名称、248字节快捷栏、31字节宏位图；最后10字节为最近技能。宏位图低位优先，普通栏10×12后接十字栏8×16。宏引用是否存在需结合MACRO.DAT；此处不推定空宏为已存在。',
    coverage: {
      structureComplete: true,
      knownFields: [
        'activeSets.index',
        'activeSets.activeBlueMageActionIds',
        'activeSets.name',
        'activeSets.standardHotbars',
        'activeSets.crossHotbars',
        'activeSets.macroFlagsHex',
        'recentActions',
      ],
      candidateFields: ['activeSets.activeActions.referenceSource'],
      unknownFields: unknown,
    },
  };
}
