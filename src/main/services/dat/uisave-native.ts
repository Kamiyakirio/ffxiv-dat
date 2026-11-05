import type { DecodeCoverage } from '../../../shared/types.ts';
import targetData from './native-save-data.json' with { type: 'json' };

// Static serialization and consumer instructions from the supplied Chinese
// client, SHA-256 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// See docs/dat-decoder.md for supported layouts and remaining unknowns.
const layoutBasis = 'client serialization; docs/dat-decoder.md';

const jobs: Record<string, { classJobId: number; name: string }> =
  targetData.jobs;
const glassesStyles: Record<string, { slotIndex: number; name: string }> =
  targetData.glassesStyles;
const menuEntries: Record<
  string,
  {
    addonRowId: number;
    name: string | null;
    helpAddonRowId: number;
    nativeListIndex: number;
    flagsRaw: number[];
  }
> = targetData.itemContextEntries;
const pvpGroups: Record<string, number> = targetData.pvpRoleGroupByClassJob;
const pvpActions: Record<
  string,
  { index: number; actionId: number; name: string | null }[]
> = targetData.pvpRoleActions;

function coverage(
  knownFields: string[],
  unknownFields: DecodeCoverage['unknownFields'] = [],
): DecodeCoverage {
  return {
    structureComplete: true,
    knownFields,
    candidateFields: [],
    unknownFields,
  };
}

export function decodeNativeUiSegment(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  // 0x140800950 writes all 0x120 bytes, including the final 256-bit bitmap.
  // 0x140800b70 walks two 128-byte, zero-terminated menu priority arrays.
  if (id === 6 && version === 90 && data.length === 288) {
    // Getter 0x140800180..324 passes bit(menuId) as descriptor+0xc;
    // 0x140498067 / 0x1404ec767 skip dispatch when this byte is zero.
    // Setter 0x140800430..503 saves that same display-permission byte.
    const allowed = (menuId: number) =>
      (data[256 + (menuId >>> 3)] & (1 << (menuId & 7))) !== 0;
    const tiers = [0, 1].map((tier) => {
      const offset = tier * 128;
      const values = [...data.subarray(offset, offset + 128)];
      const zero = values.indexOf(0);
      const count = zero < 0 ? 128 : zero;
      return {
        tier,
        offset,
        count,
        values,
        entries: values.slice(0, count).map((menuEntryId, index) => ({
          index,
          offset: offset + index,
          menuEntryId,
          name: menuEntries[menuEntryId]?.name ?? null,
          addonRowId: menuEntries[menuEntryId]?.addonRowId ?? null,
          helpAddonRowId: menuEntries[menuEntryId]?.helpAddonRowId ?? null,
          nativeListIndex: menuEntries[menuEntryId]?.nativeListIndex ?? null,
          allowedInMenu: allowed(menuEntryId),
        })),
      };
    });
    return {
      layoutBasis,
      tiers,
      usesDefaultMenu: tiers[0].count === 0,
      defaultMenuEntries: targetData.itemContextDefaultOrder.map(
        (menuEntryId, index) => ({
          index,
          menuEntryId,
          name: menuEntries[menuEntryId]?.name ?? null,
          addonRowId: menuEntries[menuEntryId]?.addonRowId ?? null,
          allowedInMenu: menuEntries[menuEntryId]?.flagsRaw[0] === 1,
        }),
      ),
      visibilityBitmaskHex: data.subarray(256).toString('hex'),
      visibleMenuEntryIds: Array.from({ length: 69 }, (_, id) => id + 1).filter(
        allowed,
      ),
      customizationBitmaskHex: data.subarray(256).toString('hex'),
      customizedEntryIndices: Array.from(
        { length: 256 },
        (_, index) => index,
      ).filter(
        (index) => (data[256 + (index >>> 3)] & (1 << (index & 7))) !== 0,
      ),
      coverage: coverage(
        [
          'tiers',
          'tiers.entries.menuEntryId',
          'tiers.entries.addonRowId',
          'tiers.entries.name (fixed public Addon text)',
          'tiers.entries.allowedInMenu',
          'visibleMenuEntryIds',
          'usesDefaultMenu / defaultMenuEntries (native default lookup)',
          'customizationBitmaskHex',
          'customizedEntryIndices',
        ],
        [
          ...tiers
            .flatMap((tier) => tier.entries)
            .filter((entry) => !menuEntries[entry.menuEntryId])
            .map((entry) => ({
              field: `tiers.entries.menuEntryId ${entry.menuEntryId}`,
              reason: '此存档编号不在目标客户端0..69菜单表中，原值已保留。',
              kind: 'meaning' as const,
            })),
          ...(Array.from({ length: 256 }, (_, id) => id).some(
            (id) => (id === 0 || id >= 70) && allowed(id),
          )
            ? [
                {
                  field: 'visibilityBitmaskHex reserved menu IDs',
                  reason:
                    '位图表示菜单项显示许可，0为哨兵而70..255没有当前目标菜单定义；额外置位的原值保留。',
                  kind: 'meaning' as const,
                },
              ]
            : []),
        ],
      ),
    };
  }

  // 0x140801eb0 writes 46 bytes at +16; +62..65 are not state entries.
  // Consumers store selection + 1 and subtract 1 after testing for zero.
  if (id === 7 && version === 400 && data.length === 66) {
    const stateEntries = Array.from({ length: 46 }, (_, index) => ({
      index,
      jobIndex: index + 1,
      classJobId: jobs[index + 1]?.classJobId ?? null,
      classJobName: jobs[index + 1]?.name ?? `未映射职业槽 ${index + 1}`,
      offset: 16 + index,
      selectionRaw: data[16 + index],
      selectedIndex: data[16 + index] === 0 ? null : data[16 + index] - 1,
      selectionKind: 'role-action',
      roleGroupIndexCandidate: jobs[index + 1]
        ? (pvpGroups[jobs[index + 1].classJobId] ?? null)
        : null,
      selectedActionIdCandidate:
        data[16 + index] === 0
          ? null
          : (pvpActions[String(pvpGroups[jobs[index + 1]?.classJobId])]?.find(
              (choice) => choice.index === data[16 + index] - 1,
            )?.actionId ?? null),
      selectedActionNameCandidate:
        data[16 + index] === 0
          ? null
          : (pvpActions[String(pvpGroups[jobs[index + 1]?.classJobId])]?.find(
              (choice) => choice.index === data[16 + index] - 1,
            )?.name ?? null),
    }));
    const pvpCoverage = coverage(
      [
        'formatVersion',
        'recordType',
        'stateEntries.offset',
        'stateEntries.jobIndex',
        'stateEntries.classJobId',
        'stateEntries.selectionRaw',
        'stateEntries.selectedIndex',
        'stateEntries.selectionKind',
      ],
      [
        {
          field: 'stateEntries.selectedActionCandidate',
          reason:
            '职能技能的选择含义由原生消费者确认；名称关联使用固定公开表，尚未重新核对目标版本SqPack。',
          kind: 'reference',
        },
        {
          field: 'prefix / unknownTailHex',
          reason: '内部其余头字段和未复制的尾部4字节保留原值。',
          kind: 'storage',
        },
      ],
    );
    pvpCoverage.candidateFields = [
      'stateEntries.roleGroupIndexCandidate',
      'stateEntries.selectedActionIdCandidate',
      'stateEntries.selectedActionNameCandidate',
    ];
    return {
      layoutBasis,
      formatVersion: data.readUInt16LE(2),
      recordType: data.readUInt32LE(4),
      prefix: {
        offset: 0,
        byteLength: 16,
        rawHex: data.subarray(0, 16).toString('hex'),
        unknownU16: Array.from({ length: 8 }, (_, index) =>
          data.readUInt16LE(index * 2),
        ),
        unknownU32: Array.from({ length: 4 }, (_, index) =>
          data.readUInt32LE(index * 4),
        ),
      },
      stateEntries,
      lookupSource: targetData.source.publicTextSource,
      // Retain the legacy raw byte view, including the four untouched bytes.
      byteValues: Array.from({ length: 50 }, (_, index) => ({
        index,
        offset: 16 + index,
        value: data[16 + index],
      })),
      unknownTailHex: data.subarray(62).toString('hex'),
      completePartition: true,
      coverage: pvpCoverage,
    };
  }

  // 0x140814f70 writes 100 u32s; 0x140814ff0 recomputes the active count
  // up to the first zero, with a limit of 100 (not the old source's 16).
  if (id === 34 && version === 0 && data.length === 400) {
    const wishlistItemIds = Array.from({ length: 100 }, (_, index) =>
      data.readUInt32LE(index * 4),
    );
    const zero = wishlistItemIds.indexOf(0);
    const itemCount = zero < 0 ? 100 : zero;
    const trailingNonzero = wishlistItemIds
      .slice(itemCount)
      .some((itemId) => itemId !== 0);
    return {
      layoutBasis,
      itemCount,
      wishlistItemIds,
      wishlist: wishlistItemIds.slice(0, itemCount).map((itemId, slot) => ({
        slot,
        offset: slot * 4,
        itemId,
      })),
      coverage: coverage(
        ['itemCount', 'wishlistItemIds', 'wishlist.slot', 'wishlist.itemId'],
        trailingNonzero
          ? [
              {
                field: 'wishlistItemIds after the first zero',
                reason:
                  '首个零值后的非零编号已保留，但客户端重算数量时不会将这些槽位算入有效收藏。',
                kind: 'meaning',
              },
            ]
          : [],
      ),
    };
  }

  // The stored value is GlassesStyle ID + 1, not a colored Glasses row ID.
  // 0x140818f50 selects the list using GlassesStyle's equipment-slot column.
  if (id === 42 && version === 100 && data.length === 42) {
    const groups = [0, 1].map((slotIndex) => ({
      slotIndex,
      entries: Array.from({ length: 10 }, (_, slot) => {
        const offset = 2 + slotIndex * 20 + slot * 2;
        const storedId = data.readUInt16LE(offset);
        const styleId = storedId === 0 ? null : storedId - 1;
        return {
          slot,
          offset,
          storedId,
          styleId,
          present: storedId !== 0,
          name:
            styleId === null
              ? null
              : (glassesStyles[styleId]?.name ?? `未收录样式 ${styleId}`),
        };
      }),
    }));
    const resultCoverage = coverage(
      [
        'groups.slotIndex',
        'groups.entries.storedId',
        'groups.entries.styleId',
        'groups.entries.name',
      ],
      [
        {
          field: 'groups.entries list purpose',
          reason:
            '解锁时插入、在列表中选中查看后移除的静态调用支持未查看样式解释；未观察游戏实际运行。第二装备槽在目标表中尚无非空样式。',
          kind: 'meaning',
        },
        {
          field: 'formatMarker / reservedPrefixHex',
          reason: '前导字节写为1，后续保留字节未定义。',
          kind: 'storage',
        },
      ],
    );
    resultCoverage.candidateFields = ['groups.entries as unseen styles'];
    return {
      layoutBasis,
      formatMarker: data[0],
      reservedPrefixHex: data.subarray(1, 2).toString('hex'),
      groups,
      coverage: resultCoverage,
    };
  }

  return null;
}
