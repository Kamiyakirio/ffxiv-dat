import type { DecodedDat } from './decoder.ts';
import { EditBuffer } from './edit-buffer.ts';
import { hotbarEditChoices, hotbarReferenceSheets } from './game-data.ts';
import { segmentNames } from '../../../shared/dat-labels.ts';
import { decodeUtf8 } from './sections.ts';

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
function framedText(
  e: EditBuffer,
  key: string,
  label: string,
  start: number,
  hex: string,
  aligned = false,
) {
  const original = Buffer.from(hex, 'hex'),
    end = original.indexOf(0);
  const value = decodeUtf8(
    original.subarray(0, end < 0 ? original.length : end),
  );
  if (value === null) return;
  const tail = end < 0 ? Buffer.alloc(0) : original.subarray(end + 1);
  const padding =
    aligned && original.length % 2
      ? e.bytes.subarray(
          start + 4 + original.length,
          start + 5 + original.length,
        )
      : Buffer.alloc(0);
  e.variableText(
    key,
    label,
    value,
    start,
    4 + original.length + padding.length,
    (text) => {
      let bytes = Buffer.concat([Buffer.from(text + '\0'), tail]);
      // Keep the field parity, so its original alignment byte remains in place.
      if (aligned && bytes.length % 2 !== original.length % 2)
        bytes = Buffer.concat([bytes, Buffer.alloc(1)]);
      const header = Buffer.from(e.bytes.subarray(start, start + 4));
      header.writeUInt16LE(bytes.length, 2);
      return Buffer.concat([header, bytes, padding]);
    },
    Math.max(0, 65533 - tail.length),
  );
}

function bannerName(e: EditBuffer, key: string, start: number, hex: string) {
  const original = Buffer.from(hex, 'hex'),
    end = original.indexOf(0);
  if (end < 0 || end > 63) return;
  const value = decodeUtf8(original.subarray(0, end));
  if (value === null) return;
  // CN target 958b78e2... writer 0x1408276ec..736: pad strlen+NUL
  // to a multiple of four and clear every byte from the NUL to that boundary.
  // Unlike TOFU strings, old trailing/alignment bytes are not copied forward.
  e.variableText(
    key,
    '动作自定义名称',
    value,
    start,
    4 + original.length,
    (text) => {
      const encoded = Buffer.from(text),
        bytes = Buffer.alloc((encoded.length + 4) & ~3);
      encoded.copy(bytes);
      const header = Buffer.from(e.bytes.subarray(start, start + 4));
      header.writeUInt16LE(bytes.length, 2);
      return Buffer.concat([header, bytes]);
    },
    63,
  );
}
function array(
  editor: EditBuffer,
  key: string,
  label: string,
  offset: number,
  count: number,
  width: 1 | 2 | 4,
  reference?: string,
) {
  for (let i = 0; i < count; i++)
    editor.number(
      `${key}.${i}`,
      `${label} ${i + 1}`,
      offset + i * width,
      `u${width * 8}` as 'u8' | 'u16' | 'u32',
      { reference },
    );
}
function banners(e: EditBuffer, data: Row) {
  const labels: Record<number, string> = {
    2: '背景',
    3: '边框',
    4: '装饰',
    5: '动作',
    7: '表情',
    10: '镜头缩放',
    11: '画面旋转',
    15: '环境光亮度',
    17: '定向光亮度',
    21: '保存时间',
  };
  const sheets: Record<number, string> = {
    2: 'BannerBg',
    3: 'BannerFrame',
    4: 'BannerDecoration',
    5: 'BannerTimeline',
    7: 'BannerFacial',
  };
  for (const c of rows(data.chunks))
    e.container(
      Number(c.offset) + 4,
      4,
      Number(c.offset) + 16,
      Number(c.length),
    );
  for (const [ci, c] of rows(data.chunks).entries())
    for (const r of rows(c.records)) {
      e.group = `肖像 ${Number(r.recordIndex) + 1}`;
      for (const f of rows(r.fields)) {
        const tag = Number(f.tag),
          start = Number(c.offset) + 16 + Number(f.offset),
          at = start + ([1, 22, 24].includes(tag) ? 4 : 2),
          k = `banner.${ci}.${r.recordIndex}.${tag}`;
        if (labels[tag])
          e.number(
            k,
            labels[tag],
            at,
            tag === 11
              ? 'i16'
              : tag === 21
                ? 'i32'
                : [7, 10, 15, 17].includes(tag)
                  ? 'u8'
                  : 'u16',
            { reference: sheets[tag] },
          );
        if (tag === 1) bannerName(e, k, start, String(f.valueHex));
        if (tag === 6) e.number(k, '动作进度', at, 'f32');
        if ([8, 9, 19, 20].includes(tag)) {
          const count = tag < 10 ? 3 : 2,
            label = {
              8: '镜头位置',
              9: '镜头目标',
              19: '头部方向',
              20: '视线方向',
            }[tag];
          for (let i = 0; i < count; i++)
            e.number(
              `${k}.${i}`,
              `${label} ${['X', 'Y', 'Z'][i]}`,
              at + i * 2,
              'f16',
            );
        }
        if (tag === 14 || tag === 16)
          for (let i = 0; i < 3; i++)
            e.number(
              `${k}.${i}`,
              `${tag === 16 ? '定向光' : '环境光'} ${['红', '绿', '蓝'][i]}`,
              at + i,
            );
        if (tag === 18) {
          e.number(k + '.v', '定向光垂直角', at, 'i16');
          e.number(k + '.h', '定向光水平角', at + 2, 'i16');
        }
        if (tag === 22 && Buffer.from(String(f.valueHex), 'hex').length === 4)
          for (const [i, label] of [
            '种族摘要',
            '性别摘要',
            '身高摘要',
            '部族摘要',
          ].entries())
            e.number(`${k}.${i}`, label, at + i);
        if (tag === 24 && Buffer.from(String(f.valueHex), 'hex').length === 2)
          e.bits(k + '.useDefaultPreset', '使用默认肖像预设', at, 1, 2);
      }
    }
}
function tofu(e: EditBuffer, data: Row) {
  for (const [ci, c] of rows(data.chunks).entries()) {
    if (Number(c.id) < 1 || Number(c.id) > 4) continue;
    e.container(
      Number(c.offset) + 4,
      4,
      Number(c.offset) + 16,
      Number(c.length),
    );
    for (const a of rows(obj(c.data).arrays)) {
      if (
        (Number(c.id) === 2 || Number(c.id) === 4) &&
        a.tag === 3 &&
        a.dataType === 1 &&
        Number(a.count) === rows(obj(c.data).records).length
      )
        for (let i = 0; i < Number(a.count); i++) {
          e.group = `战术板 / ${rows(obj(c.data).records)[i].title || `记录 ${i + 1}`}`;
          e.number(
            `board.${ci}.${i}.background`,
            '背景编号',
            Number(c.offset) + 16 + Number(a.offset) + 6 + i * 2,
            'u16',
          );
        }
    }
    for (const [ri, r] of rows(obj(c.data).records).entries()) {
      const base = Number(c.offset) + 16 + Number(r.offset) + 4,
        k = `board.${ci}.${ri}.`;
      e.container(base - 2, 2, base, Number(r.length));
      e.group = `战术板 / ${r.title || `记录 ${ri + 1}`}`;
      let objectIndex = -1;
      for (const f of rows(r.fields)) {
        const tag = Number(f.tag),
          at = base + Number(f.offset) + 2;
        if (tag === 2) {
          objectIndex++;
          e.number(
            k + `object${objectIndex}.type`,
            `对象 ${objectIndex + 1} · 类型`,
            at,
            'u16',
          );
        }
        if (tag === 1 || tag === 3)
          framedText(
            e,
            k + (tag === 1 ? 'title' : `object${objectIndex}.text`),
            tag === 1 ? '标题' : `对象 ${objectIndex + 1} · 文字`,
            at - 2,
            String(f.valueHex),
            true,
          );
        if (tag >= 4 && tag <= 8)
          for (let i = 0; i < Number(f.count); i++) {
            const id = k + `object${i}.tag${tag}.`,
              label = `对象 ${i + 1} · `,
              p = at + 4;
            if (tag === 4)
              for (const [bit, name] of [
                [1, '可见'],
                [2, '水平翻转'],
                [4, '垂直翻转'],
                [8, '锁定'],
              ] as const)
                e.bits(id + bit, label + name, p + i * 2, bit, 2);
            if (tag === 5) {
              e.number(id + 'x', label + '横坐标', p + i * 4, 'u16');
              e.number(id + 'y', label + '纵坐标', p + i * 4 + 2, 'u16');
            }
            if (tag === 6)
              e.number(id + 'angle', label + '角度', p + i * 2, 'i16');
            if (tag === 7) e.number(id + 'scale', label + '缩放', p + i);
            if (tag === 8)
              for (let j = 0; j < 4; j++)
                e.number(
                  id + j,
                  label + ['红', '绿', '蓝', '透明度'][j],
                  p + i * 4 + j,
                  'u8',
                  j === 3 ? { max: 100 } : {},
                );
          }
      }
    }
  }
}
export function uiEditBuffers(decoded: DecodedDat) {
  const result: {
    editor: EditBuffer;
    offset: number;
    segmentOffset: number;
    length: number;
    masked: boolean;
  }[] = [];
  for (const [si, s] of rows(decoded.result.data.segments).entries()) {
    if (!obj(s.coverage).structureComplete || obj(s.data).empty) continue;
    const data = obj(s.data),
      id = Number(s.id),
      e = new EditBuffer(
        Buffer.from(String(s.decodedHex), 'hex'),
        `ui.${si}.`,
        segmentNames[String(s.name)] ?? String(s.name),
      );
    const num = (
      key: string,
      label: string,
      at: number,
      codec: 'u8' | 'u16' | 'u32' | 'i32' | 'f32' = 'u8',
      reference?: string,
    ) => e.number(key, label, at, codec, { reference });
    if (id === 0)
      for (const r of rows(data.records).filter((r) => r.recipientName)) {
        const at = Number(r.offset),
          k = `letter.${r.index}.`;
        e.group = `邮件缓存 ${Number(r.index) + 1}`;
        e.text(k + 'recipient', '收件人', at, 36);
        num(k + 'gil', '金币', at + 36, 'u32');
        num(k + 'time', '寄信时间（Unix 秒）', at + 40, 'u32');
        for (let i = 0; i < 5; i++) {
          num(
            k + `item${i}`,
            `附件 ${i + 1} · 物品`,
            at + 44 + i * 8,
            'u32',
            'Item',
          );
          num(
            k + `quantity${i}`,
            `附件 ${i + 1} · 数量`,
            at + 48 + i * 8,
            'u32',
          );
        }
      }
    if (id === 3)
      for (let c = 0; c < 8; c++) {
        e.group = `制作收藏 / 职业 ${c + 1}`;
        for (let i = 0; i < 10; i++) {
          const at = 2 + c * 40 + i * 4;
          num(`craft.${c}.${i}`, `槽位 ${i + 1} · 配方`, at, 'u16', 'Recipe');
          e.boolean(`craft.${c}.${i}.favorite`, `槽位 ${i + 1} · 收藏`, at + 2);
        }
      }
    if (id === 5)
      for (let i = 0; i < 20; i++) {
        const at = 2 + i * 6,
          k = `teleport.${i}.`;
        num(k + 'dest', `历史 ${i + 1} · 目的地`, at, 'u16', 'Aetheryte');
        e.bits(k + 'present', `历史 ${i + 1} · 有效`, at + 2, 1);
        for (const [j, label] of ['住宅区号', '地块', '子编号'].entries())
          num(k + j, `历史 ${i + 1} · ${label}`, at + 3 + j);
      }
    if (id === 8) {
      array(e, 'recent', '最近表情', 2, 6, 2, 'Emote');
      array(e, 'favorite', '收藏表情', 14, 20, 2, 'Emote');
    }
    if (id === 9 || id === 10) {
      const sheet = id === 9 ? 'Companion' : 'MountOrder';
      array(e, 'unseen', '未查看槽位', 2, 10, 2, sheet);
      array(e, 'favorite', '收藏槽位', 22, 30, 2, sheet);
    }
    if (id === 14) array(e, 'watch', '关注成就', 2, 30, 2, 'Achievement');
    if (id === 15) {
      num('cameraDistance', '镜头距离', 4, 'f32');
      num('cameraFieldOfView', '镜头视野', 8, 'f32');
      num('cameraDirectionHorizontal', '镜头水平方向', 16, 'f32');
      num('cameraDirectionVertical', '镜头垂直方向', 20, 'f32');
      for (let j = 0; j < 3; j++)
        num(
          `cameraPosition${j}`,
          `镜头相对位置 ${['X', 'Y', 'Z'][j]}`,
          48 + j * 4,
          'f32',
        );
      for (let i = 0; i < 3; i++) {
        const at = 80 + i * 48,
          k = `light.${i}.`;
        e.group = `集体动作 / 灯光 ${i + 1}`;
        e.boolean(k + 'enabled', '启用', at);
        for (let j = 0; j < 3; j++)
          num(k + `color${j}`, ['红', '绿', '蓝'][j], at + 4 + j * 4, 'f32');
        num(k + 'type', '类型', at + 16, 'u32');
        for (let j = 0; j < 3; j++)
          num(
            k + `position${j}`,
            `位置 ${['X', 'Y', 'Z', 'W'][j]}`,
            at + 32 + j * 4,
            'f32',
          );
      }
      e.group = '集体动作 / 光照';
      e.boolean('characterCamera', '以角色为基准设置镜头', 64);
      e.boolean('characterLight', '以角色为基准设置灯光', 224);
      e.boolean('manualEnabled', '手动亮度', 225);
      num('brightness', '亮度', 228, 'f32');
      num('characterLighting', '角色光照', 232);
    }
    if (id === 17)
      for (let i = 0; i < 30; i++) {
        const at = 16 + i * 104,
          k = `marker.${i}.`;
        e.group = `场地标点预设 ${i + 1}`;
        for (let j = 0; j < 8; j++) {
          const label = ['A', 'B', 'C', 'D', '1', '2', '3', '4'][j];
          e.bits(k + j + '.enabled', label + ' · 启用', at + 96, 1 << j);
          for (let axis = 0; axis < 3; axis++)
            e.number(
              k + j + '.' + axis,
              label + ' · ' + ['X', 'Y', 'Z'][axis],
              at + j * 12 + axis * 4,
              'i32',
              { factor: 0.001 },
            );
        }
        num(k + 'duty', '副本', at + 98, 'u16', 'ContentFinderCondition');
        num(k + 'time', '保存时间（Unix 秒）', at + 100, 'i32');
      }
    if (id === 19) array(e, 'unseen', '未查看配饰', 2, 10, 2, 'OrnamentOrder');
    if (id === 20)
      for (const [i, f] of rows(data.fields).entries())
        if (f.tag === 'n' && f.length === 61)
          e.text(`lostSet.${i}`, '预设名称', Number(f.offset) + 3, 61);
    if (id === 23) banners(e, data);
    if (id === 24) {
      e.boolean('auto', '自动显示笔记', 1);
      array(e, 'unseen', '未查看探索条目', 2, 10, 2);
    }
    if (id === 25)
      for (let i = 0; i < 80; i++) {
        num(`entry.${i}.count`, `条目 ${i + 1} · 已读子条目数`, i * 2);
        e.boolean(`entry.${i}.unseen`, `条目 ${i + 1} · 未读`, i * 2 + 1);
      }
    if (id === 26)
      for (let i = 0; i < 52; i++)
        num(
          `note.${i}`,
          `笔记组 ${Math.floor(i / 13) + 1} · 状态 ${(i % 13) + 1}`,
          i,
        );
    if (id === 27) {
      num('action1', '任务技能 1', 0);
      num('action2', '任务技能 2', 1);
    }
    if (id === 28) tofu(e, data);
    if (id === 29 && Array.isArray(data.unseenFishIds)) {
      const f = rows(data.fields)[1];
      array(
        e,
        'unseen',
        '未查看鱼种',
        Number(f.offset) + 3,
        (data.unseenFishIds as unknown[]).length,
        2,
        'FishParameter',
      );
    }
    if (id === 30 && Array.isArray(data.actions))
      for (const [i, f] of rows(data.fields).entries())
        if (i % 3 === 0)
          num(
            `action.${i / 3}`,
            `技能记录 ${i / 3 + 1}`,
            Number(f.offset) + 3,
            'u32',
            'Action',
          );
    if (id === 31) {
      e.number('filterMode', '过滤方式', 17, 'u8', {
        choices: [
          { value: 0, label: '显示过滤词编号' },
          { value: 1, label: '隐藏整条消息' },
        ],
      });
      e.boolean('enabled', '启用屏蔽词', 338);
      for (let i = 0; i < 10; i++) {
        const at = 18 + i * 32;
        e.group = `屏蔽词 ${i + 1}`;
        e.text(`term.${i}.text`, '屏蔽词', at, 31);
        for (const [j, label] of [
          '说话',
          '呼喊',
          '喊话',
          '悄悄话',
          '自定义情感动作',
        ].entries())
          e.bits(`term.${i}.channel${j}`, label, at + 31, 1 << j);
      }
    }
    if (id === 32) num('countdown', '倒计时秒数', 0);
    if (id === 33)
      for (let i = 0; i < 48; i++)
        num(
          `roleOrder.${i}`,
          `${['防护', '治疗', '进攻'][Math.floor(i / 16)]}排序 ${(i % 16) + 1}`,
          i * 2,
          'u16',
          'ClassJob',
        );
    if (id === 35)
      for (let i = 0; i < 128; i++)
        e.bits(`description.${i}`, `说明 ${i} · 已读`, i >> 3, 1 << (i & 7));
    if (id === 36)
      for (let i = 0; i < 60; i++)
        num(
          `workshop.${i}`,
          `预设 ${Math.floor(i / 6) + 1} · 工坊 ${(i % 6) + 1}`,
          i * 4,
          'u32',
          'MJICraftworksObject',
        );
    if (id === 37) {
      e.bits('bpm', '每分钟拍数', 0, 0x1ff, 2, false);
      e.bits('measure', '每小节拍数', 0, 0x1e00, 2, false);
      for (const [i, label] of [
        '所有音符分配到键盘',
        '静音其他演奏者',
        '全员播放',
        '显示操作指南',
        '键盘模式',
        '手柄模式',
        '每小节重音',
        '启用预备拍',
      ].entries())
        e.bits(`settings1.${i}`, label, 2, 1 << i);
      e.bits('countInOnly', '仅预备拍播放音效', 3, 1);
      e.bits('metronome', '显示节拍器', 3, 2);
    }
    if (id === 39 || id === 40) {
      const f = rows(data.fields)[1];
      if (f)
        array(
          e,
          'seen',
          '已查看条目',
          Number(f.offset) + 3,
          (data.seenIds as unknown[]).length,
          1,
          id === 39 ? 'MKDLore' : 'MKDSupportJob',
        );
    }
    if (id === 41) {
      const f = rows(data.fields);
      for (let i = 0; i < 4; i++) {
        e.group = `快捷面板 ${i + 1}`;
        const t = Number(f[6 + i * 4 + 2].offset) + 4,
          v = Number(f[6 + i * 4 + 3].offset) + 4;
        for (let j = 0; j < 25; j++) {
          e.number(
            `panel.${i}.${j}.type`,
            `槽位 ${j + 1} · 类型`,
            t + j,
            'u8',
            { choices: hotbarEditChoices },
          );
          num(
            `panel.${i}.${j}.command`,
            `槽位 ${j + 1} · 内容编号`,
            v + j * 4,
            'u32',
          );
          const command = e.fields.at(-1);
          if (command)
            command.referenceType = {
              fieldId: e.prefix + `panel.${i}.${j}.type`,
              sheets: hotbarReferenceSheets,
            };
        }
      }
    }
    if (id === 43) {
      const f = rows(data.fields);
      const sizes = f.find((f) => f.tag === 'S');
      if (sizes)
        for (const [i, pet] of rows(data.petSettings).entries())
          e.number(
            `pet.${i}.size`,
            `宠物 ${pet.petId} · 大小`,
            Number(sizes.offset) + 3 + i,
            'u8',
            {
              choices: [
                { value: 0, label: '小型' },
                { value: 1, label: '中型' },
                { value: 2, label: '大型' },
              ],
            },
          );
    }
    if (e.fields.length)
      result.push({
        editor: e,
        offset: Number(s.decodedContentOffset),
        segmentOffset: Number(s.offset),
        length: Number(s.length),
        masked: String(s.encoding).startsWith('0xff'),
      });
  }
  return result;
}
