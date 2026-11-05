import type {
  DecodedFileDetail,
  EditTarget,
  ReadableSection,
  DecodeCoverage,
} from '../../shared/types';
import {
  keyActionLabel,
  segmentNames,
  settingLabel,
} from '../../shared/dat-labels';
import { recordEditTarget, sectionEditTarget } from './edit-target';

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const displayValue = (v: unknown): string =>
  v === undefined || v === null
    ? '未记录'
    : typeof v === 'boolean'
      ? v
        ? '是'
        : '否'
      : Array.isArray(v)
        ? v.map(displayValue).join(' / ')
        : typeof v === 'object'
          ? Object.entries(obj(v))
              .map(([k, n]) => `${k.toUpperCase()} ${displayValue(n)}`)
              .join(' · ')
          : String(v);
export interface BrowserNode {
  key: string;
  title: string;
  description?: string;
  kind: 'collection' | 'record';
  children?: BrowserNode[];
  sections?: ReadableSection[];
  editTarget?: EditTarget;
  coverage?: DecodeCoverage;
  raw?: unknown;
  code?: string;
  empty?: boolean;
  group?: string;
  fileId?: string;
  searchText?: string;
  readOnlyData?: boolean;
}
export const hasTarget = (target?: EditTarget) =>
  !!(target?.ids?.length || target?.prefixes?.length);
export function valueSection(
  id: string,
  title: string,
  values: [string, unknown][],
): ReadableSection {
  return {
    id,
    title,
    columns: [
      { key: 'field', label: '项目' },
      { key: 'value', label: '内容' },
    ],
    rows: values.map(([field, value]) => ({
      field,
      value: displayValue(value),
    })),
  };
}
const recordSection = (
  s: ReadableSection,
  row: ReadableSection['rows'][number],
): ReadableSection => ({
  ...s,
  id: s.id + '-detail',
  columns: s.columns.filter((c) => !['portrait'].includes(c.key)),
  rows: [row],
});
const rowTitle = (s: ReadableSection, row: Row, index: number) => {
  for (const key of [
    'name',
    'title',
    'recipientName',
    'item',
    'itemId',
    'mycItemId',
    'classJobName',
    'petName',
    'commandName',
    'objectName',
    'category',
    'field',
    'destinationName',
    'recipeName',
  ])
    if (row[key] && String(row[key]) !== '未记录') return String(row[key]);
  if (row.portrait !== undefined) return `肖像 ${row.portrait}`;
  if (row.slot !== undefined)
    return `槽位 ${Number(row.slot) + (!['slot'].includes(s.columns[0]?.key) ? 1 : 0)}`;
  if (row.displayPosition !== undefined)
    return `显示位置 ${row.displayPosition}`;
  if (row.position !== undefined) return `槽位 ${row.position}`;
  if (row.retainerId !== undefined) return `雇员 ${index + 1}`;
  return `记录 ${index + 1}`;
};
const rowSummary = (s: ReadableSection, row: Row, title: string) =>
  s.columns
    .filter(
      (c) =>
        ![
          'name',
          'title',
          'index',
          'portrait',
          'recordIndex',
          'itemIdRaw',
          'storedId',
        ].includes(c.key) &&
        displayValue(row[c.key]) !== title &&
        row[c.key] !== null,
    )
    .slice(0, 3)
    .map((c) => `${c.label}：${displayValue(row[c.key])}`)
    .join(' · ');
function sectionNode(
  detail: DecodedFileDetail,
  s: ReadableSection,
): BrowserNode {
  const node: BrowserNode = {
    key: 'section:' + s.id,
    title: s.title,
    kind: 'collection',
    description: s.note,
    editTarget: sectionEditTarget(detail, s),
    children: [],
  };
  if (
    s.columns.some((c) => c.key === 'field') &&
    s.columns.some((c) => c.key === 'value')
  ) {
    node.sections = [s];
    return node;
  }
  node.children = s.rows.map((row, i) => {
    const target = sectionEditTarget(detail, s, i),
      title = rowTitle(s, row, i);
    return {
      key:
        target.ids?.[0] ??
        target.prefixes?.[0] ??
        (row.emoteId === undefined ? `row:${i}` : `emote:${row.emoteId}`),
      title,
      description: rowSummary(s, row, title),
      kind: 'record',
      sections: [{ ...recordSection(s, row), title: '基本信息' }],
      editTarget: target,
      raw: row,
      searchText: Object.values(row).join(' '),
    };
  });
  return node;
}
function readableNodes(
  detail: DecodedFileDetail,
  sections: ReadableSection[],
): BrowserNode[] {
  const mapped = sections.map((s) => ({
    section: s,
    node: sectionNode(detail, s),
  }));
  const attached = new Set<string>();
  for (const entry of mapped) {
    const parents = mapped
      .filter(
        (p) => p !== entry && entry.section.id.startsWith(p.section.id + '-'),
      )
      .sort((a, b) => b.section.id.length - a.section.id.length);
    for (const parent of parents) {
      const suffix = entry.section.id.slice(parent.section.id.length + 1),
        match = /^(\d+)-/.exec(suffix);
      const record = match
        ? parent.node.children?.[Number(match[1])]
        : undefined;
      if (!record) continue;
      if (entry.node.children?.length && entry.node.children.length > 5) {
        record.children ??= [];
        record.children.push(entry.node);
      } else {
        record.sections ??= [];
        record.sections.push({
          ...entry.section,
          title: entry.section.title.split(' · ').at(-1) ?? entry.section.title,
        });
      }
      attached.add(entry.section.id);
      break;
    }
  }
  return mapped.filter((m) => !attached.has(m.section.id)).map((m) => m.node);
}
function withReadableSections(
  node: BrowserNode,
  detail: DecodedFileDetail,
  sections: ReadableSection[],
) {
  const children = readableNodes(detail, sections);
  const lists = children.filter((c) => !c.sections?.length),
    settings = children.filter((c) => c.sections?.length);
  node.sections = settings.flatMap((s) => s.sections ?? []);
  if (lists.length === 1) {
    node.children = lists[0].children;
    node.editTarget = lists[0].editTarget;
    if (lists[0].description) node.description = lists[0].description;
  } else node.children = lists;
  if (!lists.length && settings.length === 1)
    node.editTarget = settings[0].editTarget;
  if (lists.length) {
    const editableSettings = settings.filter((s) => hasTarget(s.editTarget));
    if (editableSettings.length) {
      node.sections = settings
        .filter((s) => !hasTarget(s.editTarget))
        .flatMap((s) => s.sections ?? []);
      node.children = [
        ...editableSettings.map((s) => ({
          ...s,
          title: editableSettings.length === 1 ? '通用设置' : s.title,
          kind: 'record' as const,
        })),
        ...(node.children ?? []),
      ];
    }
  }
  return node;
}
const categoryGroup = (id: number) =>
  [0, 1, 4, 13, 22, 31].includes(id)
    ? '社交与记录'
    : [3, 16, 36].includes(id)
      ? '制作与经营'
      : [8, 9, 10, 14, 18, 19, 24, 25, 26, 29, 34, 35, 39, 40, 42, 43].includes(
            id,
          )
        ? '收藏与笔记'
        : [2, 15, 21, 23, 28, 41].includes(id)
          ? '外观与界面'
          : '战斗与操作';
function portraits(
  detail: DecodedFileDetail,
  segment: Row,
  si: number,
): BrowserNode[] {
  const result: BrowserNode[] = [];
  for (const [ci, c] of rows(obj(segment.data).chunks).entries())
    for (const r of rows(c.records)) {
      const index = Number(r.recordIndex),
        number = index + 1;
      const sections = (detail.readable ?? [])
        .filter((s) => s.sourceId === String(segment.id))
        .flatMap((s) => {
          const row = s.rows.find((row) => Number(row.portrait) === number);
          return row ? [recordSection(s, row)] : [];
        });
      result.push({
        key: `portrait:${ci}:${index}`,
        title: `肖像 ${number}`,
        description: [r.timelineName, r.backgroundName]
          .filter(Boolean)
          .join(' · '),
        kind: 'record',
        sections,
        raw: r,
        editTarget: {
          label: `肖像 ${number}`,
          prefixes: [`ui.${si}.banner.${ci}.${index}.`],
        },
        searchText: sections
          .flatMap((s) => s.rows.flatMap((row) => Object.values(row)))
          .join(' '),
      });
    }
  return result;
}
function boards(segment: Row, si: number): BrowserNode[] {
  return rows(obj(segment.data).chunks).flatMap((chunk, ci) => {
    if (![2, 4].includes(Number(chunk.id))) return [];
    return rows(obj(chunk.data).records).map((r, ri) => ({
      key: `board:${ci}:${ri}`,
      title: String(r.title || `战术板 ${ri + 1}`),
      description: `${rows(r.objects).length} 个对象${r.folderName ? ` · ${r.folderName}` : ''}`,
      kind: 'record' as const,
      sections: [
        valueSection('board-info', '板面信息', [
          ['标题', r.title],
          ['所属文件夹', r.folderName || '未命名文件夹'],
          ['背景编号', r.background],
        ]),
      ],
      raw: r,
      editTarget: {
        label: String(r.title || '战术板'),
        ids: [
          `ui.${si}.board.${ci}.${ri}.title`,
          `ui.${si}.board.${ci}.${ri}.background`,
        ],
      },
      children: rows(r.objects).map((object, oi) => ({
        key: `object:${oi}`,
        title: `${oi + 1} · ${object.objectName || `对象 ${object.objectType}`}`,
        description: object.text
          ? String(object.text)
          : `位置 ${displayValue(object.position)}`,
        kind: 'record' as const,
        raw: object,
        sections: [
          valueSection('object', '对象属性', [
            ['类型', object.objectName ?? object.objectType],
            ['文字', object.text ?? '无'],
            ['位置', object.position],
            ['旋转角度', object.angle],
            ['缩放', object.scale],
            ['颜色', object.colorHex ?? object.rgba],
            [
              '透明度',
              object.transparencyPercent === undefined
                ? '未记录'
                : `${object.transparencyPercent}%`,
            ],
            ['可见', object.visible],
            ['锁定', object.locked],
            ['水平翻转', object.flippedHorizontally],
            ['垂直翻转', object.flippedVertically],
          ]),
        ],
        editTarget: {
          label: `${r.title || '战术板'} · 对象 ${oi + 1}`,
          prefixes: [`ui.${si}.board.${ci}.${ri}.object${oi}.`],
        },
      })),
    }));
  });
}
function gearsets(detail: DecodedFileDetail): BrowserNode[] {
  return rows(detail.data.records)
    .filter((r) => r.isSavedGearsetSlot !== false)
    .map((r) => {
      const index = Number(r.recordIndex),
        prefix = `gear.${index}.`;
      return {
        key: `gear:${index}`,
        title: String(r.name || `空套装 ${index + 1}`),
        description: `${r.classJobName || `职业 ${r.classJobId}`} · 装等 ${r.itemLevel}`,
        empty: !r.exists,
        kind: 'record',
        raw: r,
        editTarget: {
          label: `套装 ${r.name || index + 1}`,
          ids: [
            'name',
            'job',
            'glamourLink',
            'level',
            'banner',
            'flag1',
            'flag4',
            'flag8',
            'flag16',
            'flag32',
            'flag64',
            'glasses0',
            'glasses1',
          ].map((key) => prefix + key),
        },
        sections: [
          valueSection('gear-info', '套装信息', [
            ['名称', r.name],
            ['职业', r.classJobName ?? r.classJobId],
            ['装等', r.itemLevel],
            ['投影套装关联值', r.glamourSetLinkRaw],
            ['显示头部装备', r.headgearVisible],
            ['显示武器', r.weaponsVisible],
            ['开启面罩', r.visorEnabled],
            ['隐藏维埃拉族耳朵', r.hideVieraEars],
            ['眼镜', r.glassesNames],
            ['关联肖像', r.hasLinkedBanner ? `索引 ${r.bannerIndex}` : '无'],
          ]),
        ],
        children: rows(r.items).map((item, i) => ({
          key: `equipment:${i}`,
          title: String(item.slotLabel ?? item.slot),
          description: String(item.itemName || '未装备'),
          empty: !Number(item.itemId),
          kind: 'record',
          raw: item,
          editTarget: {
            label: `${r.name || '套装'} · ${item.slotLabel ?? item.slot}`,
            prefixes: [prefix + `items.${i}.`],
          },
          sections: [
            valueSection('equipment', '装备信息', [
              ['装备槽', item.slotLabel ?? item.slot],
              ['物品', item.itemName ?? item.itemId],
              ['幻化', item.glamourName ?? item.glamourId],
              ['染色', item.stainNames ?? item.stainIds],
              [
                '魔晶石 / 保存属性',
                rows(item.materiaDetails)
                  .map((m) => m.name)
                  .join(' / ') || '无',
              ],
              ['物品缺失', item.itemMissing],
              ['染色不同', item.colorDiffers],
              ['魔晶石不同', item.materiaDiffers],
              ['外观不同', item.appearanceDiffers],
            ]),
          ],
        })),
      } satisfies BrowserNode;
    });
}
function keyLabel(value: unknown) {
  const key = obj(value);
  if (key.unbound) return '未设置';
  return [
    ...list(key.modifierNames),
    key.keyName ?? key.keyCode ?? key.raw ?? '未设置',
  ]
    .join(' + ')
    .replaceAll('NUMPAD', '小键盘 ');
}
function keyCategory(command: string) {
  return /HOTBAR|CROSSBAR/.test(command)
    ? '热键栏'
    : /CAMERA|MOVE|STRAFE|JUMP|AUTO_RUN/.test(command)
      ? '移动与镜头'
      : /CHAT|TELL|SAY|REPLY|SHOUT/.test(command)
        ? '聊天'
        : /TARGET|FOCUS|ASSIST/.test(command)
          ? '目标选择'
          : '其他操作';
}
function macros(detail: DecodedFileDetail): BrowserNode[] {
  return rows(detail.data.macros).map((r) => ({
    key: `macro:${r.index}`,
    title: String(r.name || `未命名宏 ${Number(r.index) + 1}`),
    description: `槽位 ${Number(r.index) + 1} · 图标 ${r.iconId ?? r.iconHex}`,
    kind: 'record',
    empty: !r.name && !list(r.lines).some(Boolean),
    raw: r,
    code: list(r.lines).map(String).join('\n').trimEnd(),
    editTarget: recordEditTarget(detail.summary.name, r),
    sections: [
      valueSection('macro-info', '宏信息', [
        ['名称', r.name || '未命名'],
        ['槽位', Number(r.index) + 1],
        ['图标编号', r.iconId ?? r.iconHex],
      ]),
    ],
  }));
}
function settings(detail: DecodedFileDetail): BrowserNode[] {
  const groups = new Map<string, BrowserNode[]>();
  for (const row of rows(detail.data.entries)) {
    const group = String(row.section || '通用设置'),
      children = groups.get(group) ?? [];
    groups.set(group, children);
    children.push({
      key: `setting:${row.line}`,
      title: settingLabel(String(row.name)),
      description: String(row.value),
      kind: 'record',
      raw: row,
      editTarget: recordEditTarget(detail.summary.name, row),
      sections: [
        valueSection('setting', '配置项', [
          ['项目', settingLabel(String(row.name))],
          ['当前值', row.value],
          ['原始名称', row.name],
        ]),
      ],
    });
  }
  return groups.size === 1
    ? [...groups.values()][0]
    : [...groups].map(([title, children]) => ({
        key: 'settings:' + title,
        title,
        kind: 'collection',
        children,
      }));
}
function hotbars(detail: DecodedFileDetail): BrowserNode[] {
  const names = obj(detail.data.groupNames);
  return list(detail.data.groupIds).map((group) => ({
    key: `group:${group}`,
    title:
      Number(group) === 0
        ? '共享热键栏'
        : String(names[String(group)] || `存储组 ${group}`),
    kind: 'collection',
    children: [
      ...new Set(
        rows(detail.data.slots)
          .filter((s) => s.groupId === group)
          .map((s) => Number(s.barIndex)),
      ),
    ].map((bar) => ({
      key: `bar:${bar}`,
      title: bar < 10 ? `热键栏 ${bar + 1}` : `十字热键栏 ${bar - 9}`,
      kind: 'collection',
      children: rows(detail.data.slots)
        .filter((s) => s.groupId === group && s.barIndex === bar)
        .map((s) => ({
          key: `slot:${s.slotIndex}`,
          title: `槽位 ${Number(s.slotIndex) + 1}`,
          description: String(s.commandName || s.commandTypeLabel || '空槽'),
          empty: !Number(s.commandType),
          kind: 'record',
          raw: s,
          editTarget: recordEditTarget(detail.summary.name, s),
          sections: [
            valueSection('command', '快捷栏内容', [
              ['位置', `${bar + 1} / ${Number(s.slotIndex) + 1}`],
              ['类型', s.commandTypeLabel ?? s.commandTypeName],
              ['内容', s.commandName || '未匹配到名称'],
              ['保存编号', s.commandId],
            ]),
          ],
        })),
    })),
  }));
}
function retainerContainers(
  detail: DecodedFileDetail,
  sections: ReadableSection[],
): BrowserNode[] {
  const grouped = new Map<string, BrowserNode>();
  const result: BrowserNode[] = [];
  for (const s of sections) {
    const match = /^(retainer|retainer-equipment|crystals)-(\d+)$/.exec(s.id);
    if (!match) {
      result.push(sectionNode(detail, s));
      continue;
    }
    const key = `retainer:${match[2]}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        title: `雇员 ${Number(match[2]) + 1}`,
        kind: 'collection',
        children: [],
      };
      grouped.set(key, group);
      result.push(group);
    }
    const child = sectionNode(detail, s);
    child.title =
      match[1] === 'retainer'
        ? '背包'
        : match[1] === 'retainer-equipment'
          ? '装备'
          : '水晶数量';
    group.children!.push(child);
  }
  return result;
}
export const fileDescriptions: Record<string, string> = {
  'UISAVE.DAT': '收藏、社交、肖像、战术板等角色配置',
  'MACRO.DAT': '角色宏',
  'MACROSYS.DAT': '共享宏',
  'GEARSET.DAT': '套装、装备、染色与保存属性',
  'HOTBAR.DAT': '技能、物品与命令的热键栏配置',
  'KEYBIND.DAT': '键盘、鼠标和手柄的操作绑定',
  'ADDON.DAT': '界面窗口与 HUD 布局',
  'ITEMFDR.DAT': '雇员、鞍囊、投影台与收藏柜的本地缓存',
  'ITEMODR.DAT': '背包与兵装库排序',
  'GS.DAT': '幻卡牌组与小游戏配置',
  'ACQ.DAT': '最近密语联系人缓存',
  'LOGFLTR.DAT': '各聊天标签页的消息过滤',
  'COMMON.DAT': '角色通用设置',
  'CONTROL0.DAT': '键盘与鼠标设置',
  'CONTROL1.DAT': '手柄设置',
};
function buildRoot(detail: DecodedFileDetail): BrowserNode {
  const name = detail.summary.name.toUpperCase(),
    sections = detail.readable ?? [];
  const root: BrowserNode = {
    key: 'file',
    title: detail.summary.name,
    description: fileDescriptions[name] || '本地游戏配置',
    kind: 'collection',
    coverage: detail.coverage,
    raw: detail.data,
    children: [],
  };
  if (name === 'UISAVE.DAT') {
    root.children = rows(detail.data.segments).map((segment, si) => {
      const title = segmentNames[String(segment.name)] || String(segment.name),
        node: BrowserNode = {
          key: 'segment:' + segment.id,
          title,
          kind: 'collection',
          group: categoryGroup(Number(segment.id)),
          coverage: segment.coverage as DecodeCoverage,
          raw: segment.data,
          empty: !!obj(segment.data).empty,
        };
      if (segment.id === 23) {
        node.children = portraits(detail, segment, si);
        node.description = '每份肖像独立查看外观、镜头、灯光与关联信息。';
        return node;
      }
      if (segment.id === 28) {
        node.children = boards(segment, si);
        node.description = '打开一块战术板，再查看其中的对象与布局。';
        return node;
      }
      if (
        [6, 7, 21].includes(Number(segment.id)) &&
        !(node.coverage?.knownFields ?? []).some(
          (field) =>
            !/(recordCount|recordSize|byteValues|rawHex|unknownU32|trailingU32Array)/.test(
              field,
            ),
        )
      ) {
        node.children = [];
        node.readOnlyData = true;
        node.description =
          '此类别的业务字段尚未确认，可在技术数据中查看原始记录。';
        return node;
      }
      const result = withReadableSections(
        node,
        detail,
        sections.filter((s) => s.sourceId === String(segment.id)),
      );
      if (segment.id === 0) {
        result.description =
          '本地邮件摘要，包含角色名、时间、金币和附件；不包含邮件正文。';
        for (const record of result.children ?? [])
          for (const section of record.sections ?? [])
            section.title = section.columns.some(
              (c) => c.key === 'recipientName',
            )
              ? '邮件信息'
              : section.columns.some(
                    (c) => c.key === 'itemId' || c.key === 'baseItemId',
                  )
                ? '附件'
                : section.title;
      }
      return result;
    });
    return root;
  }
  if (name === 'GEARSET.DAT') {
    root.children = gearsets(detail);
    return root;
  }
  if (name === 'MACRO.DAT' || name === 'MACROSYS.DAT') {
    root.children = macros(detail);
    return root;
  }
  if (name === 'HOTBAR.DAT') {
    root.children = hotbars(detail);
    return root;
  }
  if (['COMMON.DAT', 'CONTROL0.DAT', 'CONTROL1.DAT'].includes(name)) {
    root.children = settings(detail);
    return root;
  }
  if (name === 'KEYBIND.DAT') {
    const groups = new Map<string, BrowserNode[]>();
    for (const binding of rows(detail.data.bindings)) {
      const command = String(binding.command),
        group = keyCategory(command),
        children = groups.get(group) ?? [];
      groups.set(group, children);
      children.push({
        key: `binding:${binding.index}`,
        title: keyActionLabel(command),
        description: list(binding.keys).map(keyLabel).join(' / '),
        kind: 'record',
        raw: binding,
        editTarget: recordEditTarget(name, binding),
        sections: [
          valueSection('keys', '按键绑定', [
            ['操作', keyActionLabel(command)],
            ['第一按键', keyLabel(list(binding.keys)[0])],
            ['第二按键', keyLabel(list(binding.keys)[1])],
          ]),
        ],
      });
    }
    root.children = [...groups].map(([title, children]) => ({
      key: 'bindings:' + title,
      title,
      kind: 'collection',
      children,
    }));
    return root;
  }
  if (name === 'ITEMFDR.DAT') {
    root.children = retainerContainers(detail, sections);
    return root;
  }
  return withReadableSections(root, detail, sections);
}
export function buildFileNode(detail: DecodedFileDetail): BrowserNode {
  const root = buildRoot(detail);
  const index = (node: BrowserNode) => {
    for (const child of node.children ?? []) index(child);
    node.searchText = [
      node.title,
      node.description ?? '',
      node.searchText ?? '',
      node.code ?? '',
      ...(node.sections ?? []).flatMap((section) =>
        section.rows.flatMap((row) => Object.values(row)),
      ),
      ...(node.children ?? []).map((child) => child.searchText ?? ''),
    ].join(' ');
    return node;
  };
  return index(root);
}
export function resolveNode(root: BrowserNode, path: string[]) {
  const trail = [root];
  let node = root;
  for (const key of path) {
    const child = node.children?.find((n) => n.key === key);
    if (!child) break;
    trail.push(child);
    node = child;
  }
  return { node, trail, validPath: trail.slice(1).map((n) => n.key) };
}
export function recordCount(node: BrowserNode): number {
  return node.children?.length
    ? node.children.reduce(
        (n, child) =>
          n +
          (child.kind === 'record' && !child.empty ? 1 : recordCount(child)),
        0,
      )
    : 0;
}
