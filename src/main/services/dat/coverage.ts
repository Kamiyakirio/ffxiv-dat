import type { DecodeCoverage } from '../../../shared/types.ts';

const known: Record<number, string[]> = {
  0: ['收件人', '金币', '寄信时间', '附件物品及数量'],
  1: ['雇员任务记录边界'],
  2: ['版本标记数组', '界面状态数组'],
  3: ['8 个制作职业', '每职业 10 个收藏槽', '配方编号', '收藏状态'],
  4: ['社交分组字符串', '联系人记录边界'],
  5: ['20 条传送记录', '以太之光编号', '非空记录标志', '住宅小区/地块/子编号'],
  6: ['两组物品菜单优先级数组', '256 位设置位图'],
  7: ['内部版本', '46 个职业选择槽', '选择值加一编码'],
  8: ['最近使用的表情', '收藏表情', '已查看表情位图'],
  9: ['未查看宠物', '收藏宠物'],
  10: ['未查看坐骑', '收藏坐骑', 'Mount.Order + 1 编号规则'],
  11: ['麻将内部块的边界与字节'],
  12: ['5 组青魔法预设的记录边界'],
  13: ['四组各八个通讯贝槽', '每组当前选中的通讯贝 ID'],
  14: ['30 个成就关注槽'],
  15: ['镜头角度/旋转', '3 个灯光的颜色、类型和位置', '亮度设置'],
  16: ['制作设置的字段流'],
  17: ['30 份标点预设', '8 个标点坐标', '启用标记', '副本编号', '保存时间'],
  18: ['两组笔记标志数组'],
  19: ['未查看时尚配饰', 'Ornament.Order + 1 编号规则'],
  20: ['失传技能预设字段流', '10 个预设名称'],
  21: ['五组贴纸配置', '每组名称、210 条记录及顺序', '每组十条文字'],
  22: ['10 个雇员备注槽的边界'],
  23: ['肖像记录边界', '背景/边框/装饰/动作编号', '镜头与灯光数值'],
  24: ['自动显示笔记状态', '未读探索条目编号'],
  25: ['80 条条目已读状态'],
  26: ['4 组笔记已读数组'],
  27: ['两个任务技能槽'],
  28: ['5 个战术板数据块', '文件夹与板面', '对象类型/文字/位置/角度/缩放/颜色'],
  29: ['未查看鱼种编号', '条目计数'],
  30: ['技能编号与两个保存状态字节'],
  31: ['10 条屏蔽词', '频道标志', '启用设置'],
  32: ['倒计时秒数'],
  33: ['防护/治疗/进攻职业排序'],
  34: ['100 个市场收藏槽', '零终止规则'],
  35: ['说明已读位图'],
  36: ['10 组海岛预设，每组 6 个对象编号'],
  37: ['每分钟拍数', '每小节拍数', '键盘/手柄模式', '节拍器和预备拍设置'],
  38: ['辅助职业字段流'],
  39: ['已查看传说条目计数与编号'],
  40: ['已查看笔记计数与编号'],
  41: ['4 个面板', '每面板 25 个类型及命令编号'],
  42: ['按眼镜样式分类的两组各十个列表槽', '样式编号加一编码'],
  43: ['宠物笔记字段流'],
  44: [],
};
const candidates: Record<number, string[]> = {
  0: ['有效邮件条数'],
  1: ['任务时间值的具体用途'],
  2: ['界面状态数组与命名旗标的对应'],
  4: ['社交分组与联系人区域的业务分类'],
  6: ['菜单项编号及位图与具体界面的对应'],
  7: ['各职业选择项与界面的对应'],
  11: ['麻将内部块的业务分类'],
  12: ['青魔法技能槽与宏位图的完整对应'],
  15: ['镜头位置向量的对应'],
  18: ['两组笔记数组的具体用途'],
  21: ['贴纸记录内各数值的业务用途'],
  22: ['雇员身份和备注的业务对应（样本均为空）'],
  42: ['列表为未查看样式的行为推定'],
};
const labels: Record<string, string> = {
  unknownPrefixHex: '子段前置字节',
  unknownSuffixHex: '子段尾部字节',
  unknownPrefixByte: '子段前置字节',
  unknownPrefix: '子段前缀',
  unknownHeaderHex: '记录头中的未定义字节',
  unknownRemainderHex: '尚未映射的数据区域',
  unknownTailHex: '记录尾部字节',
  headerHex: '块头保留字节',
  trailerHex: '块尾保留字节',
  unusedRecordBytesHex: '备注记录中的未定义字节',
  unknownBpmBits: '节拍设置的未定义高位',
  unknownSettings2Bits: '演奏设置的未定义位',
  unknownU32: '候选记录中的整数值',
  recordKeyRaw: '肖像记录键',
  unknownTag24: '肖像标签 24',
};
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
function normalize(value: unknown): DecodeCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.structureComplete !== 'boolean') return null;
  return {
    structureComplete: data.structureComplete,
    knownFields: strings(data.knownFields),
    candidateFields: strings(data.candidateFields),
    unknownFields: Array.isArray(data.unknownFields)
      ? (data.unknownFields as DecodeCoverage['unknownFields'])
      : [],
  };
}

export function segmentCoverage(
  id: number,
  version: number,
  data: Record<string, unknown>,
  length: number,
): DecodeCoverage {
  const supplied = normalize(data.coverage);
  if (supplied) return supplied;
  if (data.empty)
    return {
      structureComplete: true,
      knownFields: ['子段为空'],
      candidateFields: [],
      unknownFields: [],
    };
  if (data.decodedByteLength !== undefined)
    return {
      structureComplete: false,
      knownFields: [],
      candidateFields: [],
      unknownFields: [
        {
          field: `子段 ${id} / 版本 ${version}`,
          reason: data.parseError
            ? `已读取 ${length} 字节，记录校验未通过：${data.parseError}`
            : `已读取 ${length} 字节，但此版本尚无已验证的内部记录布局。`,
          kind: 'meaning',
        },
      ],
    };
  const unresolved = new Map<string, DecodeCoverage['unknownFields'][number]>();
  function visit(value: unknown, path: string, depth: number) {
    if (depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        [
          'coverage',
          'fields',
          'rawHex',
          'decodedHex',
          'interpretation',
          'note',
        ].includes(key)
      )
        continue;
      const field = path ? `${path}.${key}` : key;
      const unknown = /^unknown|^unusedRecord|^headerHex$|^trailerHex$/.test(
        key,
      );
      if (unknown) {
        // Zero reserved flag bits contain no active information to interpret.
        if (typeof child === 'number' && child === 0 && /Bits$/.test(key))
          continue;
        const region = key === 'unknownRemainderHex' || key === 'unknownU32';
        const title = labels[key] ?? '未定义保存字段';
        unresolved.set(field, {
          field: `${title}（${field}）`,
          reason: region
            ? '记录范围已保留，但此区域各值的业务含义尚无对应定义。'
            : '已保存原值；现有结构未定义此存储字段的用途，不影响其他已解释字段的读取。',
          kind: region ? 'meaning' : 'storage',
        });
        continue;
      }
      visit(child, field, depth + 1);
    }
  }
  visit(data, '', 0);
  if (id === 30)
    unresolved.set('action-flags', {
      field: 'actions[].flag0 / flag1',
      reason:
        '技能编号与两列状态已完整读取；公开 ActionModule 只定义两个未命名集合，状态值对应的具体业务用途尚未定义。',
      kind: 'meaning',
    });
  if (id === 8)
    unresolved.set('emote-bits', {
      field: 'seenEmotesBitmaskHex 的索引对应',
      reason:
        '位图字节已读取，但直接按 Emote 行号匹配无法覆盖全部历史/收藏记录，索引转换尚需进一步证据。',
      kind: 'reference',
    });
  if (id === 31) {
    if (Number(data.setting) > 1)
      unresolved.set('term-setting', {
        field: 'setting',
        reason: '过滤方式超出源码定义的显示编号/隐藏整条消息枚举。',
        kind: 'meaning',
      });
    if (
      Array.isArray(data.termFilters) &&
      data.termFilters.some((entry) => Number(entry.unknownChannelBits) !== 0)
    )
      unresolved.set('term-channels', {
        field: 'termFilters[].unknownChannelBits',
        reason: '出现已定义五类频道之外的位。',
        kind: 'meaning',
      });
  }
  return {
    structureComplete: true,
    knownFields: known[id] ?? [],
    candidateFields: candidates[id] ?? [],
    unknownFields: [...unresolved.values()],
  };
}

export function coverageStatus(
  coverage: DecodeCoverage,
): 'decoded' | 'partial' {
  return !coverage.structureComplete ||
    coverage.candidateFields.length ||
    coverage.unknownFields.some((field) => field.kind !== 'storage')
    ? 'partial'
    : 'decoded';
}
