import path from 'node:path';
import type { EditableField, EditValue } from '../../../shared/types.ts';
import { decodeDat } from './decoder.ts';
import type { DecodedDat } from './decoder.ts';
import { EditBuffer, validateEdits } from './edit-buffer.ts';
import { readSections } from './sections.ts';
import {
  equipmentSlotName,
  gameName,
  hotbarEditChoices,
  hotbarReferenceSheets,
} from './game-data.ts';
import { settingLabel, keyActionLabel } from '../../../shared/dat-labels.ts';
import { uiEditBuffers } from './editor-uisave.ts';

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const obj = (value: unknown): Row =>
  value && typeof value === 'object' ? (value as Row) : {};
export interface EditPlan {
  fields: EditableField[];
  notes: string[];
  apply: (changes: { id: string; value: EditValue }[]) => Buffer;
}
function sectionString(
  editor: EditBuffer,
  key: string,
  label: string,
  section: ReturnType<typeof readSections>[number],
) {
  if (section.text === null || !section.nulTerminated) return;
  editor.variableText(
    key,
    label,
    section.text,
    section.offset,
    section.length + 3,
    (value) => {
      const text = Buffer.from(`${value}\0`);
      const header = Buffer.alloc(3);
      header[0] = section.tag.charCodeAt(0);
      header.writeUInt16LE(text.length, 1);
      return Buffer.concat([header, text]);
    },
  );
}
function populate(editor: EditBuffer, decoded: DecodedDat) {
  const name = path.basename(decoded.filename).toUpperCase();
  const version = decoded.header.version;
  const data = decoded.result.data;
  if (name === 'HOTBAR.DAT' && version === 4) {
    for (const s of rows(data.slots)) {
      const at = Number(s.offset),
        key = `slots.${s.groupId}.${s.barIndex}.${s.slotIndex}.`;
      editor.group = `${obj(data.groupNames)[String(s.groupId)] ?? `存储组 ${s.groupId}`} / 热键栏 ${Number(s.barIndex) + 1}`;
      editor.number(
        key + 'type',
        `槽位 ${Number(s.slotIndex) + 1} · 类型`,
        at + 7,
        'u8',
        { choices: hotbarEditChoices },
      );
      editor.number(
        key + 'command',
        `槽位 ${Number(s.slotIndex) + 1} · 内容编号`,
        at,
        'u32',
      );
      const f = editor.fields.at(-1);
      if (f) {
        f.displayValue = String(s.commandName ?? '');
        f.referenceType = {
          fieldId: key + 'type',
          sheets: hotbarReferenceSheets,
        };
      }
    }
  }
  if (name === 'GEARSET.DAT' && version === 110) {
    for (const r of rows(data.records).filter((r) => r.isSavedGearsetSlot)) {
      const at = Number(r.offset),
        key = `gear.${r.recordIndex}.`;
      editor.group = `套装 ${Number(r.recordIndex) + 1} · ${r.name || '空槽'}`;
      editor.text(key + 'name', '名称', at + 1, 48);
      editor.number(key + 'job', '职业', at + 0x31, 'u8', {
        reference: 'ClassJob',
      });
      editor.number(key + 'glamourLink', '投影套装关联值', at + 0x32);
      editor.number(key + 'level', '保存装等', at + 0x34, 'i16', { min: 0 });
      editor.number(key + 'banner', '肖像索引 + 1（0 为不关联）', at + 0x36);
      for (const [bit, label] of [
        [1, '有效套装'],
        [4, '主手缺失'],
        [8, '显示头部装备'],
        [16, '显示武器'],
        [32, '开启面罩'],
      ] as const)
        editor.bits(key + `flag${bit}`, label, at + 0x37, bit);
      for (const [i, item] of rows(r.items).entries()) {
        const p = Number(item.offset),
          k = key + `items.${i}.`,
          slot = equipmentSlotName(String(item.slot));
        editor.number(k + 'item', slot + ' · 物品', p, 'u32', {
          reference: 'Item',
        });
        editor.number(k + 'glamour', slot + ' · 幻化', p + 4, 'u32', {
          reference: 'Item',
        });
        for (let j = 0; j < 2; j++)
          editor.number(
            k + `stain${j}`,
            `${slot} · 染色 ${j + 1}`,
            p + 8 + j,
            'u8',
            { reference: 'Stain' },
          );
        for (let j = 0; j < 5; j++) {
          editor.number(
            k + `materia${j}`,
            `${slot} · 魔晶石 ${j + 1} 编号`,
            p + 10 + j * 2,
            'u16',
          );
          editor.number(
            k + `grade${j}`,
            `${slot} · 魔晶石 ${j + 1} 等级（从 0 起）`,
            p + 20 + j,
            'u8',
            { max: 15 },
          );
        }
        for (const [bit, label] of [
          [1, '物品缺失'],
          [4, '染色不同'],
          [8, '魔晶石不同'],
          [16, '外观不同'],
        ] as const)
          editor.bits(k + `flag${bit}`, `${slot} · ${label}`, p + 25, bit);
      }
      for (let j = 0; j < 2; j++)
        editor.number(
          key + `glasses${j}`,
          `眼镜 ${j + 1}`,
          at + 0x1c0 + j * 2,
          'u16',
          { reference: 'Glasses' },
        );
    }
  }
  if (name === 'ADDON.DAT' && version === 105) {
    for (const d of rows(data.datasets)) {
      const at = Number(d.offset),
        hud = at + editor.bytes.readUInt32LE(at + 28);
      editor.group = `界面配置 ${d.name}`;
      editor.text(`addon.${d.datasetIndex}.name`, '配置名称', at, 16);
      editor.number(
        `addon.${d.datasetIndex}.layout`,
        '当前 HUD 布局（从 0 起）',
        hud + 8,
        'u16',
        { max: Math.max(0, Number(d.layoutCount) - 1) },
      );
      const groups = [
        { name: '窗口', entries: rows(d.entries) },
        ...rows(d.layouts).map((l) => ({
          name: `HUD ${Number(l.layoutIndex) + 1}`,
          entries: rows(l.entries),
        })),
      ];
      for (const group of groups)
        for (const entry of group.entries) {
          const p = Number(entry.offset),
            k = `addon.${p}.`;
          editor.group = `${d.name} / ${group.name} / ${entry.addonName ?? entry.addonNameHashHex}`;
          for (const [offset, label, key] of [
            [4, '横坐标', 'x'],
            [8, '纵坐标', 'y'],
            [12, '缩放', 'scale'],
          ] as const)
            editor.number(
              k + key,
              label,
              p + offset,
              'f32',
              key === 'scale' ? { min: 0.01, max: 10 } : {},
            );
          editor.number(k + 'width', '宽度', p + 20, 'u16');
          editor.number(k + 'height', '高度', p + 22, 'u16');
          editor.number(k + 'alpha', '不透明度', p + 27);
        }
    }
  }
  if (
    (name === 'MACRO.DAT' || name === 'MACROSYS.DAT') &&
    version === 2 &&
    Array.isArray(data.macros)
  ) {
    const sections = readSections(editor.bytes);
    for (let i = 0; i < 100; i++) {
      editor.group = `宏 ${i + 1} · ${obj((data.macros as unknown[])[i]).name || '未命名'}`;
      const p = i * 18;
      sectionString(editor, `macro.${i}.name`, '名称', sections[p]);
      // I/K are hexadecimal strings; preserve their encoding through an explicit numeric conversion.
      for (const [j, label] of [
        [1, '图标编号'],
        [2, '图标行号'],
      ] as const) {
        const s = sections[p + j];
        if (s.text !== null && /^[0-9a-f]+$/i.test(s.text)) {
          const key = `macro.${i}.icon${j}`;
          sectionString(editor, key, label, s);
          const f = editor.fields.at(-1)!;
          f.type = 'text';
          f.label = label + '（十六进制）';
        }
      }
      for (let line = 0; line < 15; line++)
        sectionString(
          editor,
          `macro.${i}.line${line}`,
          `第 ${line + 1} 行`,
          sections[p + 3 + line],
        );
    }
  }
  if (name === 'KEYBIND.DAT' && version === 101) {
    const sections = readSections(editor.bytes);
    for (const binding of rows(data.bindings)) {
      const index = Number(binding.index),
        section = sections[index * 2 + 1];
      editor.group = '按键绑定';
      sectionString(
        editor,
        `keybind.${index}`,
        keyActionLabel(String(binding.command)) + '（主键,副键）',
        section,
      );
    }
  }
  if (name === 'GS.DAT' && version === 103) {
    for (const d of rows(data.decks)) {
      const at = Number(d.offset),
        key = `deck.${d.index}.`;
      editor.group = `幻卡牌组 ${Number(d.index) + 1}`;
      editor.text(key + 'name', '牌组名称', at, 48);
      for (let j = 0; j < 5; j++)
        editor.number(
          key + `card${j}`,
          `卡牌 ${j + 1}`,
          at + 48 + j * 2,
          'u16',
          { reference: 'TripleTriadCard' },
        );
    }
    editor.group = '金碟 / 宠物热键栏';
    for (let j = 0; j < 23; j++)
      editor.number(`gs.minion${j}`, `槽位 ${j + 1}`, 580 + j * 2, 'u16', {
        reference: 'Companion',
      });
    editor.group = '金碟 / 未查看幻卡';
    for (let j = 0; j < 10; j++)
      editor.number(`gs.unseen${j}`, `槽位 ${j + 1}`, 628 + j * 2, 'u16', {
        reference: 'TripleTriadCard',
      });
  }
  if (name === 'LOGFLTR.DAT' && version === 3)
    for (const g of rows(data.groups)) {
      editor.group = `聊天标签页 ${Number(g.index) + 1}`;
      for (const f of rows(g.filters)) {
        const id = Number(f.filterId);
        if ((f.rawState === 0 || f.rawState === 1) && gameName('LogFilter', id))
          editor.boolean(
            `log.${g.index}.${id}`,
            gameName('LogFilter', id)!,
            Number(g.offset) + 16 + id,
          );
      }
    }
  if (name === 'ITEMODR.DAT' && version === 104)
    for (const c of [...rows(data.containers), ...rows(data.retainers)]) {
      editor.group = `物品排序 / ${c.name}${c.retainerId ? ` ${c.retainerId}` : ''}`;
      for (const s of rows(c.slots)) {
        const at = Number(s.offset) + 2,
          key = `order.${at}.`;
        editor.number(
          key + 'slot',
          `显示位置 ${Number(s.displayIndex) + 1} · 来源槽位（从 0 起）`,
          at,
          'u16',
        );
        editor.number(
          key + 'page',
          `显示位置 ${Number(s.displayIndex) + 1} · 来源页（从 0 起）`,
          at + 2,
          'u16',
        );
      }
    }
  if (name === 'ITEMFDR.DAT' && version === 203) {
    for (const [i, r] of rows(data.retainers).entries()) {
      if (!Array.isArray(r.itemIds)) continue;
      const at = Number(r.offset) + 3 + 8;
      editor.group = `物品缓存 / 雇员 ${i + 1} 装备`;
      for (let j = 0; j < 14; j++)
        editor.number(
          `finder.ret${i}.equip${j}`,
          `装备槽 ${j + 1}`,
          at + j * 4,
          'u32',
          { reference: 'Item' },
        );
      editor.group = `物品缓存 / 雇员 ${i + 1} 背包`;
      for (let j = 0; j < 175; j++) {
        editor.number(
          `finder.ret${i}.item${j}`,
          `槽位 ${j + 1} · 物品`,
          at + 0x38 + j * 4,
          'u32',
          { reference: 'Item' },
        );
        editor.number(
          `finder.ret${i}.count${j}`,
          `槽位 ${j + 1} · 数量`,
          at + 0x2f4 + j * 2,
          'u16',
        );
      }
      editor.group = `物品缓存 / 雇员 ${i + 1} 水晶`;
      for (let j = 0; j < 18; j++)
        editor.number(
          `finder.ret${i}.crystal${j}`,
          `缓存槽位 ${j + 1} · 数量`,
          at + 0x452 + j * 2,
          'u16',
        );
    }
    const bags = Number(obj(data.saddleBag).offset) + 3;
    for (let i = 0; i < 140; i++) {
      editor.group = `物品缓存 / ${i < 70 ? '陆行鸟鞍囊' : '额外陆行鸟鞍囊'}`;
      editor.number(
        `finder.bag.item${i}`,
        `槽位 ${(i % 70) + 1} · 物品`,
        bags + i * 4,
        'u32',
        { reference: 'Item' },
      );
      editor.number(
        `finder.bag.count${i}`,
        `槽位 ${(i % 70) + 1} · 数量`,
        bags + 560 + i * 2,
        'u16',
      );
    }
    const dresser = obj(data.glamourDresser);
    editor.group = '物品缓存 / 投影台';
    for (let i = 0; i < (dresser.itemIds as unknown[]).length; i++)
      editor.number(
        `finder.dresser${i}`,
        `槽位 ${i + 1}`,
        Number(dresser.offset) + 3 + i * 4,
        'u32',
        { reference: 'Item' },
      );
    editor.group = '物品缓存 / 收藏柜';
    const cabinet = obj(data.cabinet);
    for (let i = 0; i < Number(cabinet.bitCount); i++)
      if (gameName('CabinetItem', i)) {
        const item = Number(gameName('CabinetItem', i));
        editor.bits(
          `finder.cabinet${i}`,
          gameName('Item', item) ?? `条目 ${i}`,
          Number(cabinet.offset) + 3 + (i >> 3),
          1 << (i & 7),
        );
      }
  }
  if (name === 'ACQ.DAT' && version === 100) {
    const sections = readSections(editor.bytes);
    for (const [i, c] of rows(data.contacts).entries()) {
      editor.group = `最近密语缓存 / 联系人 ${i + 1}`;
      const at = sections.findIndex((s) => s.offset === c.offset);
      sectionString(editor, `contact.${i}.name`, '缓存昵称', sections[at]);
      sectionString(
        editor,
        `contact.${i}.world`,
        '缓存服务器名称',
        sections[at + 1],
      );
      sectionString(
        editor,
        `contact.${i}.worldId`,
        '缓存服务器编号（十六进制）',
        sections[at + 2],
      );
    }
  }
}
function wrap(decoded: DecodedDat, original: Buffer, payload: Buffer) {
  if (decoded.header.format === 'character-preset') {
    const output = Buffer.concat([original.subarray(0, 16), payload]);
    let checksum = 0;
    for (let i = 0; i < 32; i++) checksum ^= output[16 + i] << (i % 24);
    output.writeUInt32LE(checksum >>> 0, 8);
    return output;
  }
  if (decoded.header.format === 'utf8-text') return payload;
  if (decoded.header.format === 'config-copy')
    return Buffer.concat([
      original.subarray(0, 1),
      Buffer.from(payload.map((b) => b ^ 0x73)),
    ]);
  const offset = Number(decoded.header.contentOffset),
    valid = payload.length + offset - 16,
    capacity = Number(decoded.header.capacity);
  if (valid > capacity || 16 + valid > original.length)
    throw new Error('修改后的内容超过文件原有容量，请缩短文本。');
  const oldEnd = 16 + Number(decoded.header.validLength),
    newEnd = 16 + valid;
  if (newEnd > oldEnd && original.subarray(oldEnd, newEnd).some((b) => b !== 0))
    throw new Error('扩展内容会覆盖非零保留数据，已停止保存。');
  const output = Buffer.from(original);
  output.fill(0, offset, Math.max(oldEnd, newEnd));
  const mask = decoded.header.xor;
  Buffer.from(
    payload.map((b) => (typeof mask === 'number' ? b ^ mask : b)),
  ).copy(output, offset);
  output.writeUInt32LE(valid, 8);
  return output;
}
export function createEditPlan(original: Buffer, filename: string): EditPlan {
  const decoded = decodeDat(original, filename),
    name = path.basename(filename).toUpperCase();
  const notes = [
    '仅开放已确认的存储字段；未识别字节和身份标识保持原样。保存前请退出游戏，避免客户端覆盖修改。',
  ];
  if (decoded.members.length)
    return {
      fields: [],
      notes: ['请在文件列表中选择备份内的具体配置进行编辑。'],
      apply: () => {
        throw new Error('请选择备份内配置。');
      },
    };
  if (decoded.result.data.parseError || decoded.result.status === 'unsupported')
    return {
      fields: [],
      notes: ['此版本或结构尚未验证，暂不支持编辑。'],
      apply: () => {
        throw new Error('此文件不支持编辑。');
      },
    };
  const editor = new EditBuffer(decoded.payload);
  if (decoded.header.format === 'utf8-text') {
    const text = decoded.payload.toString('utf8');
    let offset = 0;
    for (const [i, line] of text.split(/(?<=\n)/).entries()) {
      const match = /^([^\t\r\n]+)\t([^\r\n\0]*)/.exec(line);
      if (match) {
        editor.group = '配置项';
        const at = offset + Buffer.byteLength(match[1]) + 1;
        editor.variableText(
          `config.${i}`,
          settingLabel(match[1]),
          match[2],
          at,
          Buffer.byteLength(match[2]),
          (v) => Buffer.from(v),
        );
      }
      offset += Buffer.byteLength(line);
    }
  } else if (
    decoded.header.format === 'character-preset' &&
    decoded.result.data.checksumMatches
  ) {
    editor.group = '角色外观预设';
    const names = [
      '种族',
      '性别',
      '体型',
      '身高',
      '部族',
      '面容',
      '发型',
      '挑染标志',
      '肤色',
      '右眼颜色',
      '发色',
      '挑染颜色',
      '面部特征标志',
      '面部特征颜色',
      '眉毛',
      '左眼颜色',
      '眼型与虹膜标志',
      '鼻型',
      '下颌',
      '嘴型与口红标志',
      '唇色/毛纹',
      '肌肉/尾/耳长度',
      '尾/耳样式',
      '胸围',
      '面纹与反转标志',
      '面纹颜色标志',
    ];
    names.forEach((label, i) => editor.number(`appearance.${i}`, label, i));
    editor.number('voice', '声音编号', 26);
    editor.number('timestamp', '保存时间（Unix 秒）', 28, 'u32');
    editor.text('comment', '预设备注', 32, 164);
  } else if (decoded.header.format === 'config-copy') {
    editor.group = '角色昵称缓存';
    const sections = readSections(editor.bytes);
    const n = sections.find((s) => s.tag === 'N');
    if (n) sectionString(editor, 'cachedName', '缓存昵称', n);
    notes.push('修改缓存昵称不会改变服务器上的角色名称。');
  } else populate(editor, decoded);
  if (name === 'ITEMFDR.DAT')
    notes.push('这里编辑的是本地搜索缓存，不会改变游戏服务器上的物品或数量。');
  if (name === 'GEARSET.DAT')
    notes.push('修改装备快照后，游戏可能要求重新更新关联肖像。');
  const children =
    name === 'UISAVE.DAT' &&
    decoded.header.version === 1 &&
    decoded.result.data.completeContainer
      ? uiEditBuffers(decoded)
      : [];
  const fields = [
    ...editor.fields,
    ...children.flatMap((c) => c.editor.fields),
  ];
  return {
    fields,
    notes,
    apply(changes) {
      validateEdits(fields, changes);
      if (!changes.length) return Buffer.from(original);
      let payload = editor.apply(changes);
      for (const child of [...children].reverse()) {
        const updated = child.editor.apply(changes);
        // A leading 0xff is the inner mask marker. Escape new occurrences so
        // a valid bitset value cannot accidentally change how the reader decodes it.
        const masked = child.masked || updated[0] === 0xff;
        const stored = masked
          ? Buffer.concat([
              Buffer.from([0xff]),
              Buffer.from(updated.map((b) => b ^ 0x73)),
            ])
          : updated;
        const start = child.segmentOffset;
        const header = Buffer.from(payload.subarray(start, start + 16));
        header.writeUInt32LE(
          Math.max(header.readUInt32LE(4), stored.length),
          4,
        );
        header.writeUInt32LE(stored.length, 8);
        payload = Buffer.concat([
          payload.subarray(0, start),
          header,
          stored,
          payload.subarray(
            start + 16 + child.length,
            start + 20 + child.length,
          ),
          payload.subarray(start + 20 + child.length),
        ]);
      }
      // Validate string formats with known client encodings rather than accepting arbitrary field text.
      for (const change of changes) {
        if (
          /^macro\.\d+\.icon/.test(change.id) &&
          !/^[0-9a-f]{1,8}$/i.test(String(change.value))
        )
          throw new Error('宏图标必须是 1–8 位十六进制编号。');
        if (
          change.id.startsWith('keybind.') &&
          !/^[0-9a-f]{2}\.[0-9a-f]{2},[0-9a-f]{2}\.[0-9a-f]{2},?$/i.test(
            String(change.value),
          )
        )
          throw new Error('按键格式应为 00.00,00.00（键码.修饰键）。');
        if (change.id.startsWith('keybind.'))
          for (const key of String(change.value).split(',').filter(Boolean)) {
            const [code, flags] = key
              .split('.')
              .map((part) => parseInt(part, 16));
            if (flags & ~(code >= 160 ? 0xcf : 7))
              throw new Error('按键包含尚未定义的修饰键标志。');
          }
        if (
          /^contact\.\d+\.worldId$/.test(change.id) &&
          !/^[0-9a-f]{1,4}$/i.test(String(change.value))
        )
          throw new Error('服务器编号必须是 1–4 位十六进制数。');
      }
      payload = wrap(decoded, original, payload);
      const check = decodeDat(payload, filename);
      if (check.result.data.parseError || check.result.status === 'unsupported')
        throw new Error('写回校验失败，未保存文件。');
      const after = createEditPlan(payload, filename).fields;
      const values = new Map(after.map((f) => [f.id, f.value]));
      for (const c of changes) {
        const value = values.get(c.id);
        if (
          typeof c.value === 'number' && typeof value === 'number'
            ? Math.abs(value - c.value) >
              Math.max(1e-6, Math.abs(c.value) * 0.001)
            : value !== c.value
        )
          throw new Error(`字段 ${c.id} 写回结果与修改不一致，未保存文件。`);
      }
      return payload;
    },
  };
}
