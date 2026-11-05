import type {
  DecodedFileDetail,
  EditTarget,
  ReadableSection,
} from '../../shared/types';

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const presentIndex = (v: unknown, index: number) =>
  list(v).flatMap((value, i) => (Number(value) ? [i] : []))[index];
export const targetMatches = (id: string, target: EditTarget) =>
  !!target.ids?.includes(id) ||
  !!target.prefixes?.some((prefix) => id.startsWith(prefix));

export function recordEditTarget(filename: string, row: Row): EditTarget {
  const name = filename.toUpperCase();
  if (name === 'MACRO.DAT' || name === 'MACROSYS.DAT')
    return {
      label: `宏 ${Number(row.index) + 1} · ${row.name || '未命名'}`,
      prefixes: [`macro.${row.index}.`],
    };
  if (name === 'GEARSET.DAT')
    return {
      label: `套装 ${Number(row.recordIndex) + 1} · ${row.name || '未命名'}`,
      prefixes: [`gear.${row.recordIndex}.`],
    };
  if (name === 'HOTBAR.DAT')
    return {
      label: `热键栏 ${Number(row.barIndex) + 1} / 槽位 ${Number(row.slotIndex) + 1}`,
      prefixes: [`slots.${row.groupId}.${row.barIndex}.${row.slotIndex}.`],
    };
  if (name === 'KEYBIND.DAT')
    return { label: String(row.command), ids: [`keybind.${row.index}`] };
  return {
    label: String(row.name ?? '配置项'),
    ids: [`config.${Number(row.line) - 1}`],
  };
}

// Use source identifiers and original array positions, never display names or
// filtered row numbers, to locate the writer fields for the selected content.
export function sectionEditTarget(
  detail: DecodedFileDetail,
  section: ReadableSection,
  rowIndex?: number,
): EditTarget {
  const row = rowIndex === undefined ? undefined : section.rows[rowIndex];
  const target: EditTarget = {
    label: section.title + (row ? ` · 第 ${rowIndex! + 1} 条` : ''),
    prefixes: [],
    ids: [],
  };
  const prefix = (...values: string[]) => ({ ...target, prefixes: values });
  const ids = (...values: string[]) => ({ ...target, ids: values });
  const filename = detail.summary.name.toUpperCase(),
    data = detail.data,
    id = section.id;
  if (filename === 'ITEMFDR.DAT') {
    const m = /^(retainer|retainer-equipment|crystals)-(\d+)$/.exec(id);
    if (m) {
      const i = Number(m[2]),
        r = rows(data.retainers)[i];
      if (!r) return target;
      if (m[1] === 'crystals')
        return row
          ? ids(`finder.ret${i}.crystal${Number(row.slot) - 1}`)
          : prefix(`finder.ret${i}.crystal`);
      const equipment = m[1] === 'retainer-equipment',
        index =
          rowIndex === undefined
            ? undefined
            : presentIndex(
                r[equipment ? 'equippedItemIds' : 'itemIds'],
                rowIndex,
              );
      return index === undefined
        ? prefix(
            `finder.ret${i}.${equipment ? 'equip' : 'item'}`,
            ...(!equipment ? [`finder.ret${i}.count`] : []),
          )
        : ids(
            `finder.ret${i}.${equipment ? 'equip' : 'item'}${index}`,
            ...(!equipment ? [`finder.ret${i}.count${index}`] : []),
          );
    }
    if (id === 'saddleBag' || id === 'premiumSaddleBag') {
      const offset = id === 'saddleBag' ? 0 : 70,
        index =
          rowIndex === undefined
            ? undefined
            : presentIndex(obj(data[id]).itemIds, rowIndex);
      return index === undefined
        ? ids(
            ...Array.from({ length: 70 }, (_, i) => [
              `finder.bag.item${offset + i}`,
              `finder.bag.count${offset + i}`,
            ]).flat(),
          )
        : ids(
            `finder.bag.item${offset + index}`,
            `finder.bag.count${offset + index}`,
          );
    }
    if (id === 'glamourDresser')
      return row
        ? ids(`finder.dresser${Number(row.position) - 1}`)
        : prefix('finder.dresser');
    if (id === 'cabinet')
      return row ? ids(`finder.cabinet${row.index}`) : prefix('finder.cabinet');
    return target;
  }
  if (filename === 'ITEMODR.DAT') {
    const index = Number(/^order-(\d+)$/.exec(id)?.[1]),
      container = [...rows(data.containers), ...rows(data.retainers)][index];
    const slots = rows(container?.slots),
      selected = row
        ? slots.filter(
            (s) => Number(s.displayIndex) === Number(row.displayPosition) - 1,
          )
        : slots;
    return prefix(...selected.map((s) => `order.${Number(s.offset) + 2}.`));
  }
  if (filename === 'GS.DAT') {
    if (id === 'decks') return prefix(row ? `deck.${rowIndex}.` : 'deck.');
    if (id === 'minions')
      return row
        ? ids(`gs.minion${Number(row.slot) - 1}`)
        : prefix('gs.minion');
    if (id === 'unseen-cards')
      return row
        ? ids(
            `gs.unseen${presentIndex(data.unseenTripleTriadCardIds, rowIndex!)}`,
          )
        : prefix('gs.unseen');
  }
  if (filename === 'ACQ.DAT')
    return id === 'contacts' && rows(data.contacts).length > 0
      ? prefix(row ? `contact.${rowIndex}.` : 'contact.')
      : target;
  if (filename === 'LOGFLTR.DAT') {
    const group = rows(data.groups)[Number(/^chat-(\d+)$/.exec(id)?.[1])];
    if (!group) return target;
    const filters = rows(group.filters);
    if (row)
      return filters.some(
        (filter) =>
          filter.filterId === Number(row.filterId) && filter.isEditableSetting,
      )
        ? ids(`log.${group.index}.${row.filterId}`)
        : target;
    return filters.some((filter) => filter.isEditableSetting)
      ? prefix(`log.${group.index}.`)
      : target;
  }
  if (filename === 'ADDON.DAT') {
    const m = /^(ui|hud)-(\d+)(?:-(\d+))?$/.exec(id);
    if (!m) return target;
    const dataset = rows(data.datasets)[Number(m[2])];
    const entries =
      m[1] === 'ui'
        ? rows(dataset?.entries)
        : rows(rows(dataset?.layouts)[Number(m[3])]?.entries);
    const visible = entries.filter((entry) => entry.isEmptyStorage !== true);
    const sourceOffset =
      rowIndex === undefined ? NaN : Number(section.sourceKeys?.[rowIndex]);
    const selected = !row
      ? visible
      : Number.isFinite(sourceOffset)
        ? visible.filter((entry) => Number(entry.offset) === sourceOffset)
        : visible.slice(rowIndex, rowIndex! + 1);
    return prefix(...selected.map((entry) => `addon.${entry.offset}.`));
  }
  if (filename !== 'UISAVE.DAT') {
    if (filename.startsWith('FFXIV_CHARA_')) {
      if (rowIndex === undefined)
        return {
          ...target,
          prefixes: ['appearance.'],
          ids: ['voice', 'comment'],
        };
      const key = section.sourceKeys?.[rowIndex];
      if (key === 'voice' || key === 'comment') return ids(key);
      const fields = [
        'race',
        'sex',
        'bodyType',
        'height',
        'tribe',
        'face',
        'hairstyle',
        'highlights',
        'skinColor',
        'rightEyeColor',
        'hairColor',
        'highlightsColor',
        'facialFeatures',
        'facialFeatureColor',
        'eyebrows',
        'leftEyeColor',
        'eyeShapeFlags',
        'nose',
        'jaw',
        'mouthFlags',
        'lipColorFurPattern',
        'muscleToneOrTailOrEarLength',
        'tailEarsType',
        'bustSize',
        'facePaintFlags',
        'facePaintColorFlags',
      ];
      const index = fields.indexOf(key?.replace('customize.', '') ?? '');
      return index < 0 ? target : ids(`appearance.${index}`);
    }
    if (filename.startsWith('FFXIV_CFGCPY')) return ids('cachedName');
    return target;
  }
  const segments = rows(data.segments),
    si = segments.findIndex((s) => String(s.id) === section.sourceId),
    segment = segments[si];
  if (!segment) return target;
  const n = Number(segment.id),
    p = `ui.${si}.`,
    values = obj(segment.data);
  const scoped = (...keys: string[]) => prefix(...keys.map((k) => p + k));
  const exact = (...keys: string[]) => ids(...keys.map((k) => p + k));
  const sourceKey =
    rowIndex === undefined ? undefined : section.sourceKeys?.[rowIndex];
  if (sourceKey) {
    const scalarKeys: Record<number, Record<string, string>> = {
      15: {
        cameraDistance: 'cameraDistance',
        cameraFieldOfView: 'cameraFieldOfView',
        cameraDirectionHorizontal: 'cameraDirectionHorizontal',
        cameraDirectionVertical: 'cameraDirectionVertical',
        isCharacterOrientedCamera: 'characterCamera',
        isCharacterOrientedLight: 'characterLight',
        isManualBrightnessEnabled: 'manualEnabled',
        isCharacterOrientedCameraRaw: 'characterCamera',
        isCharacterOrientedLightRaw: 'characterLight',
        isManualBrightnessEnabledRaw: 'manualEnabled',
        manualBrightness: 'brightness',
        characterLighting: 'characterLighting',
      },
      24: { automaticallyDisplayRecordRaw: 'auto' },
      27: { action1: 'action1', action2: 'action2' },
      31: {
        setting: 'filterMode',
        settingName: 'filterMode',
        termFiltersEnabled: 'enabled',
        termFiltersEnabledRaw: 'enabled',
      },
      32: { countdownLength: 'countdown' },
      37: {
        beatsPerMinute: 'bpm',
        beatsPerMeasure: 'measure',
        assignAllNotesToKeyboard: 'settings1.0',
        muteOtherPerformers: 'settings1.1',
        playbackTypeAllMembers: 'settings1.2',
        displayControlGuide: 'settings1.3',
        keyboardMode: 'settings1.4',
        controllerMode: 'settings1.5',
        accentEachMeasure: 'settings1.6',
        enableCountIn: 'settings1.7',
        soundEffectsOnlyDuringCountIn: 'countInOnly',
        displayMetronome: 'metronome',
      },
    };
    if (scalarKeys[n])
      return scalarKeys[n][sourceKey]
        ? exact(scalarKeys[n][sourceKey])
        : target;
  }
  if (n === 23) {
    const tagSets: Record<string, number[]> = {
      portraits: [1, 2, 3, 4, 5, 7],
      'portrait-camera': [6, 8, 9, 10, 11, 19, 20],
      'portrait-light': [14, 15, 16, 17, 18],
      'portrait-person': [22],
      'portrait-links': [21],
    };
    const tags = tagSets[id];
    if (!tags) return target;
    const records = rows(values.chunks).flatMap((c, ci) =>
      rows(c.records).map((r) => ({ ci, r })),
    );
    const selected = row
      ? records.filter(
          ({ r }) => Number(r.recordIndex) + 1 === Number(row.portrait),
        )
      : records;
    return {
      ...target,
      ids: selected.flatMap(({ ci, r }) =>
        tags.map((tag) => p + `banner.${ci}.${r.recordIndex}.${tag}`),
      ),
      prefixes: selected.flatMap(({ ci, r }) =>
        tags.map((tag) => p + `banner.${ci}.${r.recordIndex}.${tag}.`),
      ),
    };
  }
  if (n === 28) {
    const m = /^28-chunk-(\d+)-data-records(?:-(\d+)-objects)?$/.exec(id);
    if (!m) return target;
    const ci = Number(m[1]);
    if (m[2] !== undefined)
      return row
        ? scoped(`board.${ci}.${m[2]}.object${rowIndex}.`)
        : scoped(`board.${ci}.${m[2]}.object`);
    return row ? scoped(`board.${ci}.${rowIndex}.`) : scoped(`board.${ci}.`);
  }
  if (n === 0) {
    const records = rows(values.records).filter(
      (r) =>
        r.recipientName ||
        Number(r.gil) ||
        rows(r.items).some((i) => Number(i.itemId)),
    );
    const nested = /^0-records-(\d+)-items$/.exec(id);
    if (nested) {
      const r = records[Number(nested[1])];
      if (!r) return target;
      return row
        ? exact(
            `letter.${r.index}.item${rowIndex}`,
            `letter.${r.index}.quantity${rowIndex}`,
          )
        : scoped(`letter.${r.index}.`);
    }
    if (id === '0-records')
      return row ? scoped(`letter.${row.index}.`) : scoped('letter.');
    return target;
  }
  if ([8, 9, 10, 19].includes(n)) {
    if (n === 8 && id === '8-states') return target;
    const kind = id.endsWith('-favorites')
      ? 'favorite'
      : id.endsWith('-history')
        ? 'recent'
        : 'unseen';
    return row ? exact(`${kind}.${Number(row.slot) - 1}`) : scoped(kind + '.');
  }
  if (n === 3) {
    if (id === '3-craftingTypes')
      return row ? scoped(`craft.${row.craftType}.`) : scoped('craft.');
    const m = /^3-craftingTypes-(\d+)-recipes$/.exec(id);
    return m
      ? row
        ? exact(
            `craft.${m[1]}.${rowIndex}`,
            `craft.${m[1]}.${rowIndex}.favorite`,
          )
        : scoped(`craft.${m[1]}.`)
      : target;
  }
  if (n === 5 && id === '5-history')
    return row ? scoped(`teleport.${row.slot}.`) : scoped('teleport.');
  if (n === 14)
    return row
      ? exact(`watch.${presentIndex(values.achievementWatchlist, rowIndex!)}`)
      : scoped('watch.');
  if (n === 15) {
    if (id === 'group-pose-lights')
      return row ? scoped(`light.${Number(row.slot) - 1}.`) : scoped('light.');
    if (id === 'group-pose-camera')
      return exact(
        'cameraDistance',
        'cameraFieldOfView',
        'cameraDirectionHorizontal',
        'cameraDirectionVertical',
        'cameraPosition0',
        'cameraPosition1',
        'cameraPosition2',
        'characterCamera',
      );
    if (id !== 'group-pose-lighting-settings') return target;
    return exact(
      'characterLight',
      'manualEnabled',
      'brightness',
      'characterLighting',
    );
  }
  if (n === 17) {
    const m = /^17-presets-(\d+)-markers$/.exec(id);
    return m
      ? row
        ? scoped(`marker.${m[1]}.${rowIndex}.`)
        : scoped(`marker.${m[1]}.`)
      : row
        ? scoped(`marker.${row.slot}.`)
        : scoped('marker.');
  }
  if (n === 20) {
    if (id !== '20-sets') return target;
    const names = rows(values.fields).flatMap((f, i) =>
      f.tag === 'n' ? [i] : [],
    );
    return row ? exact(`lostSet.${names[rowIndex!]}`) : scoped('lostSet.');
  }
  if (n === 24)
    return id.endsWith('unseenAdventureEntryIds')
      ? row
        ? exact(`unseen.${Number(row.slot) - 1}`)
        : scoped('unseen.')
      : exact('auto');
  if (n === 25) return row ? scoped(`entry.${row.index}.`) : scoped('entry.');
  if (n === 26) {
    const m = /^26-seenNotes-(\d+)-contents$/.exec(id);
    return m
      ? row
        ? exact(`note.${Number(m[1]) * 13 + Number(row.slot) - 1}`)
        : exact(
            ...Array.from(
              { length: 13 },
              (_, i) => `note.${Number(m[1]) * 13 + i}`,
            ),
          )
      : row
        ? exact(
            ...Array.from(
              { length: 13 },
              (_, i) => `note.${Number(row.series) * 13 + i}`,
            ),
          )
        : scoped('note.');
  }
  if (n === 27) return exact('action1', 'action2');
  if (n === 29)
    return row
      ? exact(`unseen.${presentIndex(values.unseenFishIds, rowIndex!)}`)
      : scoped('unseen.');
  if (n === 30) return row ? exact(`action.${rowIndex}`) : scoped('action.');
  if (n === 31)
    return id === '31-termFilters'
      ? row
        ? scoped(`term.${row.index}.`)
        : scoped('term.')
      : exact('filterMode', 'enabled');
  if (n === 32) return exact('countdown');
  if (n === 33) {
    const role = id.endsWith('tankOrder')
      ? 0
      : id.endsWith('healerOrder')
        ? 1
        : 2;
    return row
      ? exact(`roleOrder.${role * 16 + Number(row.slot) - 1}`)
      : exact(
          ...Array.from({ length: 16 }, (_, i) => `roleOrder.${role * 16 + i}`),
        );
  }
  if (n === 35)
    return row ? exact(`description.${row.index}`) : scoped('description.');
  if (n === 36) {
    const m = /^36-presets-(\d+)-objectNames$/.exec(id);
    return m
      ? row
        ? exact(`workshop.${Number(m[1]) * 6 + Number(row.slot) - 1}`)
        : exact(
            ...Array.from(
              { length: 6 },
              (_, i) => `workshop.${Number(m[1]) * 6 + i}`,
            ),
          )
      : row
        ? exact(
            ...Array.from(
              { length: 6 },
              (_, i) => `workshop.${Number(row.index) * 6 + i}`,
            ),
          )
        : scoped('workshop.');
  }
  if (n === 37) return scoped('');
  if (n === 39 || n === 40)
    return id === `${n}-seen`
      ? row
        ? exact(`seen.${rowIndex}`)
        : scoped('seen.')
      : target;
  if (n === 41) {
    const m = /^quick-panel-(\d+)-slots$/.exec(id);
    return m
      ? row
        ? scoped(`panel.${m[1]}.${Number(row.slot) - 1}.`)
        : scoped(`panel.${m[1]}.`)
      : target;
  }
  if (n === 43) return row ? exact(`pet.${rowIndex}.size`) : scoped('pet.');
  return target;
}
