import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeUiSegment } from '../src/main/services/dat/uisave-native.ts';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';
import { decodeUiRecords } from '../src/main/services/dat/uisave-records.ts';
import { buildFileNode } from '../src/renderer/components/browser-model.ts';
import { decodeNativeAoz } from '../src/main/services/dat/uisave-aoz.ts';
import { decodeNativeGroupPose } from '../src/main/services/dat/uisave-pose.ts';
import { decodeNativeSocial } from '../src/main/services/dat/uisave-social.ts';

function file(segments) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16);
  header.writeUInt32LE(segments.length, 4);
  const payload = Buffer.concat([
    header,
    ...segments.map(({ id, version, data }) => {
      const part = Buffer.alloc(16);
      part.writeUInt16LE(id);
      part.writeUInt16LE(version, 2);
      part.writeUInt32LE(data.length, 4);
      part.writeUInt32LE(data.length, 8);
      return Buffer.concat([part, data, Buffer.alloc(4)]);
    }),
  ]);
  const result = Buffer.alloc(32 + payload.length);
  result.writeUInt16LE(9);
  result.writeUInt16LE(1, 2);
  result.writeUInt32LE(payload.length, 4);
  result.writeUInt32LE(payload.length, 8);
  payload.forEach((byte, index) => {
    result[16 + index] = byte ^ 0x31;
  });
  return result;
}

test('market favorites use all 100 slots and the client zero terminator', () => {
  const data = Buffer.alloc(400);
  for (let i = 0; i < 100; i++) data.writeUInt32LE(4650 + i, i * 4);
  const full = decodeNativeUiSegment(34, 0, data);
  assert.equal(full.itemCount, 100);
  assert.equal(full.wishlist[99].offset, 396);
  assert.equal(full.wishlist[99].itemId, 4749);
  assert.equal(full.coverage.unknownFields.length, 0);
  data.writeUInt32LE(0, 8);
  const terminated = decodeNativeUiSegment(34, 0, data);
  assert.equal(terminated.itemCount, 2);
  assert.equal(terminated.wishlist.length, 2);
  assert.equal(terminated.wishlistItemIds[99], 4749);
  assert(
    terminated.coverage.unknownFields.some((field) => field.kind === 'meaning'),
  );
});

test('item menu tiers preserve their full backing arrays and the final bitmap bit', () => {
  const data = Buffer.alloc(288);
  data.set([3, 5, 0, 9]);
  data[255] = 69;
  data[287] = 0x80;
  const decoded = decodeNativeUiSegment(6, 90, data);
  assert.equal(decoded.tiers[0].count, 2);
  assert.deepEqual(
    decoded.tiers[0].entries.map((row) => row.menuEntryId),
    [3, 5],
  );
  assert.equal(decoded.tiers[0].values[3], 9);
  assert.equal(decoded.tiers[1].values[127], 69);
  assert.deepEqual(decoded.customizedEntryIndices, [255]);
});

test('PvP keeps 46 choice bytes separate from untouched trailing bytes', () => {
  const data = Buffer.alloc(66);
  data.writeUInt16LE(400, 2);
  data.writeUInt32LE(15, 4);
  data[16] = 3;
  data[61] = 255;
  data[65] = 0xa5;
  const decoded = decodeNativeUiSegment(7, 400, data);
  assert.equal(decoded.formatVersion, 400);
  assert.equal(decoded.recordType, 15);
  assert.equal(decoded.stateEntries.length, 46);
  assert.equal(decoded.stateEntries[0].selectedIndex, 2);
  assert.equal(decoded.stateEntries[0].jobIndex, 1);
  assert.equal(decoded.stateEntries[0].classJobId, 19);
  assert.equal(decoded.stateEntries[0].classJobName, '骑士');
  assert.equal(decoded.stateEntries[1].selectedIndex, null);
  assert.equal(decoded.stateEntries[45].offset, 61);
  assert.equal(decoded.stateEntries[45].selectedIndex, 254);
  assert.equal(decoded.stateEntries[45].classJobId, null);
  assert.equal(decoded.unknownTailHex, '000000a5');
  assert.equal(decoded.byteValues[49].value, 0xa5);
  const table = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: { segments: [{ id: 7, name: 'PVPSET', data: decoded }] },
  })[0];
  assert.match(
    table.columns.find((column) => column.key === 'selectedActionNameCandidate')
      .label,
    /公开表关联/,
  );
  assert.match(table.note, /同版本资源/);
});

test('glasses separate both equipment slots and translate style zero without using colored variant IDs', () => {
  const data = Buffer.alloc(42);
  data[0] = 1;
  data.writeUInt16LE(1, 2);
  data.writeUInt16LE(2, 4);
  data.writeUInt16LE(0xffff, 40);
  const decoded = decodeNativeUiSegment(42, 100, data);
  assert.equal(decoded.groups[0].entries[0].styleId, 0);
  assert.equal(decoded.groups[0].entries[0].name, '椭圆眼镜');
  assert.equal(decoded.groups[0].entries[1].styleId, 1);
  assert.equal(decoded.groups[0].entries[1].name, '金边墨镜');
  assert.equal(decoded.groups[0].entries[2].styleId, null);
  assert.equal(decoded.groups[1].entries[9].offset, 40);
  assert.equal(decoded.groups[1].entries[9].styleId, 65534);
  assert.match(decoded.groups[1].entries[9].name, /未收录/);
  assert(decoded.coverage.candidateFields.length > 0);
});

test('native layouts reject unknown versions and off-by-one lengths', () => {
  for (const [id, version, length] of [
    [6, 90, 288],
    [7, 400, 66],
    [34, 0, 400],
    [42, 100, 42],
  ]) {
    assert.equal(
      decodeNativeUiSegment(id, version + 1, Buffer.alloc(length)),
      null,
    );
    assert.equal(
      decodeNativeUiSegment(id, version, Buffer.alloc(length - 1)),
      null,
    );
    assert.equal(
      decodeNativeUiSegment(id, version, Buffer.alloc(length + 1)),
      null,
    );
  }
});

test('complete DAT decoding routes native market and CWLS values into readable tables', () => {
  const market = Buffer.alloc(400);
  market.writeUInt32LE(4650);
  const cwls = Buffer.alloc(1456);
  cwls.writeBigUInt64LE(0xfffffffffffffff1n, 8 + 31 * 8);
  cwls.writeBigUInt64LE(0xfffffffffffffff1n, 264 + 3 * 8);
  const bytes = file([
    { id: 34, version: 0, data: market },
    { id: 13, version: 4, data: cwls },
  ]);
  const before = Buffer.from(bytes);
  const decoded = decodeDat(bytes, 'UISAVE.DAT');
  assert.deepEqual(bytes, before);
  assert.equal(decoded.result.data.segments[0].status, 'decoded');
  assert.equal(decoded.result.data.segments[1].status, 'partial');
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    data: decoded.result.data,
    header: decoded.header,
  });
  assert.equal(
    sections.find((section) => section.id === 'market-wishlist').rows[0].itemId,
    '水煮蛋',
  );
  const linkshell = sections.find((section) => section.id === 'cwls-group-3')
    .rows[0];
  assert.equal(linkshell.linkshellId, '18446744073709551601');
  assert.equal(linkshell.selected, '是');
  const browser = buildFileNode({
    summary: { name: 'UISAVE.DAT' },
    data: decoded.result.data,
    header: decoded.header,
    readable: sections,
  });
  assert.equal(browser.children[0].children[0].title, '水煮蛋');
});

test('lost-action and stamp readable views expose recovered names, quantities and final text slots', () => {
  const field = (tag, bytes) => {
    const header = Buffer.alloc(3);
    header.write(tag);
    header.writeUInt16LE(bytes.length, 1);
    return Buffer.concat([header, bytes]);
  };
  const presetName = Buffer.alloc(61);
  presetName.write('非空技能预设');
  const lost = decodeUiRecords(
    20,
    1,
    Buffer.concat([
      field('A', Buffer.alloc(13)),
      field('S', Buffer.from([1])),
      field('n', presetName),
      field('l', Buffer.from([2])),
      field('i', Buffer.from([3, 1])),
      field('s', Buffer.from([5, 9])),
    ]),
  );
  const stamps = Buffer.alloc(65556);
  stamps.fill(0xff, 54928, 59128);
  stamps.write('最后配置', 5 + 4 * 64);
  stamps.write('最后文字', 59148 + 49 * 128);
  const decodedStamps = decodeDat(
    file([{ id: 21, version: 103, data: stamps }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        { id: 20, name: 'MYCITEM', data: lost },
        ...decodedStamps.result.data.segments,
      ],
    },
  });
  const preset = sections.find((section) => section.id === 'lost-action-set-0');
  assert.match(preset.title, /非空技能预设/);
  assert.equal(preset.rows[0].mycItemId, '失传坚壁（3）');
  assert.equal(preset.rows[0].quantity, 5);
  assert.equal(preset.rows[1].mycItemId, '失传强麻痹（1）');
  assert.equal(
    sections.find((section) => section.id === 'stamp-groups-4-texts').rows[0]
      .text,
    '最后文字',
  );
  assert.equal(
    sections.find((section) => section.id === 'stamp-groups').rows[4].name,
    '最后配置',
  );
});

test('readable stamp groups omit default record allocations and preserve meaningful disabled records and raw ordering', () => {
  const stamps = Buffer.alloc(65556);
  stamps.fill(0xff, 54928, 59128);
  for (let index = 0; index < 1050; index++) {
    const at = 328 + index * 52;
    stamps.writeUInt32LE(3, at);
    stamps.writeUInt32LE(0xffffffff, at + 8);
    stamps.writeFloatLE(1, at + 16);
    stamps.writeUInt32LE(28, at + 40);
  }
  // Catalog ID zero is a valid reference, not an empty sentinel.
  stamps.writeUInt32LE(0, 328 + 52 + 8);
  stamps.writeUInt32LE(45, 328 + 17 * 52 + 8);
  stamps.writeUInt32LE(4650, 328 + 17 * 52 + 36);
  const textIndex = 4 * 210 + 205;
  const at = 328 + textIndex * 52;
  stamps.writeUInt32LE(4, at);
  stamps[at + 4] = 1;
  stamps.writeFloatLE(1.5, at + 16);
  stamps.writeFloatLE(0.125, at + 20);
  stamps.writeFloatLE(0.75, at + 24);
  stamps.writeFloatLE(45, at + 28);
  stamps.writeUInt32LE(36, at + 40);
  stamps.writeUInt32LE(12, at + 44);
  stamps.writeUInt32LE(2, at + 48);
  stamps[4] = 1;
  stamps[65548 + 4] = 1;
  stamps.write('时刻', 59148 + (4 * 10 + 5) * 128);
  stamps.writeUInt32LE(7, 54928 + 4 * 210 * 4);
  const decoded = decodeDat(
    file([{ id: 21, version: 103, data: stamps }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  const groups = sections.find((section) => section.id === 'stamp-groups');
  assert.equal(groups.rows[0].recordCount, 2);
  assert.equal(groups.rows[1].recordCount, 0);
  assert.equal(groups.rows[4].recordCount, 1);
  assert.equal(groups.rows[4].hasSavedData, '是');
  assert.equal(groups.rows[4].timeFormatNameCandidate, '12 小时制');
  assert.match(
    groups.columns.find((column) => column.key === 'timeFormatNameCandidate')
      .label,
    /候选/,
  );
  const all = sections
    .filter((section) => /^stamp-groups-\d+-records$/.test(section.id))
    .flatMap((section) => section.rows);
  assert.equal(all.length, 3);
  const image = sections
    .find((section) => section.id === 'stamp-groups-0-records')
    .rows.find((row) => row.index === 17);
  assert.equal(image.iconId, 4650);
  assert.equal(image.enabled, '否');
  assert.equal(image.fontSize, '不适用');
  const text = sections.find(
    (section) => section.id === 'stamp-groups-4-records',
  ).rows[0];
  assert.equal(text.index, textIndex);
  assert.equal(text.slot, 206);
  assert.equal(text.fontSize, 36);
  assert.equal(text.textAlignmentName, '靠右');
  assert.equal(text.savedText, '时刻');
  const order = sections.find(
    (section) => section.id === 'stamp-groups-4-order',
  );
  assert.equal(order.rows[0].storedIndex, 7);
  assert.match(order.note, /组内还是全局/);
  assert.equal(decoded.result.data.segments[0].data.records.length, 1050);
});

test('readable CWLS settings expose online priority and the target-client data center mapping', () => {
  const cwls = Buffer.alloc(1456);
  cwls.writeBigUInt64LE(0xfffffffffffffff1n, 8 + 3 * 64);
  cwls[1448] = 1;
  const decoded = decodeDat(
    file([{ id: 13, version: 4, data: cwls }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  assert.equal(
    sections.find((section) => section.id === 'cwls-settings').rows[0].value,
    '是',
  );
  const group = sections.find((section) => section.id === 'cwls-group-3');
  assert.match(group.title, /豆豆柴/);
  assert.match(group.note, /目标中国客户端/);
  assert.equal(group.rows[0].linkshellId, '18446744073709551601');
});

test('readable retainer tasks show confirmed completion time without duplicate candidate columns', () => {
  const tasks = Buffer.alloc(168);
  tasks.writeUInt32LE(1);
  tasks.writeBigUInt64LE(0xfffffffffffffff1n, 8 + 9 * 16);
  tasks.writeUInt32LE(1700000000, 8 + 9 * 16 + 8);
  const decoded = decodeDat(
    file([{ id: 1, version: 101, data: tasks }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  const table = sections.find((section) => section.id === 'retainer-tasks');
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].index, 10);
  assert.equal(table.rows[0].retainerId, '18446744073709551601');
  assert.equal(
    table.rows[0].completionUnix,
    new Date(1700000000000).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    }),
  );
  assert.ok(
    !table.columns.some((column) => column.key === 'completionUnixCandidate'),
  );
});

test('readable portraits use physical and runtime identities, real flags and native lighting names', () => {
  const word = (value) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
  };
  const scalar = (tag, value) => Buffer.concat([word(tag), word(value)]);
  const record = Buffer.concat([
    scalar(0, 7),
    word(14),
    Buffer.from([1, 2, 3, 0]),
    scalar(15, 187),
    word(16),
    Buffer.from([9, 8, 7, 0]),
    scalar(17, 54),
    word(24),
    word(2),
    word(3),
  ]);
  const chunk = Buffer.alloc(16);
  chunk.writeUInt32LE(record.length, 4);
  const decoded = decodeDat(
    file([{ id: 23, version: 0, data: Buffer.concat([chunk, record]) }]),
    'UISAVE.DAT',
  );
  const portrait = decoded.result.data.segments[0].data.chunks[0].records[0];
  portrait.equipmentChecksumStatus = '未找到一致的本地装备快照';
  portrait.matchedGearsetNames = '';
  portrait.directionalLightingColourHex = '#090807';
  portrait.ambientLightingColourHex = '#010203';
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  const links = sections.find((section) => section.id === 'portrait-links');
  assert.equal(links.rows[0].bannerIndex, 7);
  assert.equal(links.rows[0].bannerId, 0);
  assert.equal(links.rows[0].checksumValue, null);
  assert.equal(links.rows[0].useDefaultPreset, '是');
  assert.equal(links.rows[0].flagsRaw, 3);
  assert.equal(
    links.rows[0].equipmentChecksumStatus,
    '未找到一致的本地装备快照',
  );
  assert.ok(
    !links.columns.some((column) =>
      ['unknownTag24', 'bannerIdCandidate'].includes(column.key),
    ),
  );
  assert.match(links.note, /CRC 算法已还原/);
  assert.match(links.note, /不等于.*校验失败/);
  const light = sections.find((section) => section.id === 'portrait-light')
    .rows[0];
  assert.equal(light.directionalLightingColourHex, '#090807');
  assert.equal(light.directionalLightingBrightness, 54);
  assert.equal(light.ambientLightingColourHex, '#010203');
  assert.equal(light.ambientLightingBrightness, 187);
});

test('readable action settings replace anonymous flags and emote states omit unused entries', () => {
  const field = (tag, bytes) => {
    const h = Buffer.alloc(3);
    h.write(tag);
    h.writeUInt16LE(bytes.length, 1);
    return Buffer.concat([h, bytes]);
  };
  const actionId = Buffer.alloc(4);
  actionId.writeUInt32LE(92);
  const action = Buffer.concat([
    field('A', actionId),
    field('0', Buffer.from([1])),
    field('1', Buffer.from([0])),
  ]);
  const emotes = Buffer.alloc(310);
  emotes[54] = 2 | (3 << 2) | (1 << 4);
  const decoded = decodeDat(
    file([
      { id: 30, version: 1, data: action },
      { id: 8, version: 102, data: emotes },
    ]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  const actions = sections.find((section) => section.id === '30-actions');
  assert.equal(actions.rows[0].actionChangeEnabled, '是');
  assert.equal(actions.rows[0].antiMisactivationEnabled, '否');
  assert.ok(
    !actions.columns.some((column) => ['flag0', 'flag1'].includes(column.key)),
  );
  const states = sections.find((section) => section.id === '8-states');
  assert.equal(states.rows.length, 3);
  assert.deepEqual(
    states.rows.map((row) => row.emoteId),
    [1, 2, 3],
  );
  assert.equal(states.rows[0].isUnseen, '是');
  assert.equal(states.rows[1].isSeen, '是');
  assert.ok(!String(states.rows[0].name).includes('未收录'));
});

test('readable item menu entries show native-linked text and confirmed display permissions', () => {
  const menu = Buffer.alloc(288);
  menu.set([3, 5]);
  const decoded = decodeDat(
    file([{ id: 6, version: 90, data: menu }]),
    'UISAVE.DAT',
  );
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  const tier = sections.find((section) => section.id === 'item-menu-tier-0');
  const raw = decoded.result.data.segments[0].data.tiers[0].entries[0];
  assert.equal(typeof tier.rows[0].name, 'string');
  assert.equal(tier.rows[0].name, raw.name);
  assert.equal(tier.rows[0].addonRowId, raw.addonRowId);
  assert.match(tier.note, /位图.*显示许可/);
  assert.ok(!tier.note.includes('具体菜单文字的对应尚未确认'));
});

test('confirmed mahjong settings hide the legacy alias while statistics remain candidates', () => {
  const settings = { tileSet: 2, hideHints: true, emjCostumeId: 4 };
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        {
          id: 11,
          name: 'EMJ',
          data: {
            chunks: [
              { key: 2, data: { settings, settingsCandidate: settings } },
              {
                key: 0,
                data: {
                  statisticsCandidate: {
                    timestampCandidate: 1700000000,
                    historyValues: [1, 2],
                  },
                },
              },
            ],
          },
        },
      ],
    },
  });
  const tables = sections.filter((section) =>
    section.title.includes('麻将设置'),
  );
  assert.equal(tables.length, 1);
  assert.ok(!tables[0].title.includes('待验证'));
  assert.equal(
    tables[0].rows.find((row) => row.field === '隐藏提示').value,
    '是',
  );
  assert.ok(!tables[0].rows.some((row) => String(row.field).includes('候选')));
  assert.ok(
    sections.some((section) => /历史数值.*业务含义待核对/.test(section.title)),
  );
});

test('unrecognized action settings retain the saved value instead of becoming an absent boolean', () => {
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        {
          id: 30,
          name: 'ACTION',
          data: {
            actions: [
              {
                actionId: 92,
                flag0: 7,
                flag1: 0,
                actionChangeEnabled: null,
                antiMisactivationEnabled: false,
              },
            ],
          },
        },
      ],
    },
  });
  const action = sections.find((section) => section.id === '30-actions')
    .rows[0];
  assert.equal(action.actionChangeEnabled, '未定义保存值（7）');
  assert.equal(action.antiMisactivationEnabled, '否');
});

test('formal UI flags hide their compatibility alias and mahjong seen IDs keep independent namespaces', () => {
  const namedFlags = {
    hidePortraitUpdatePreview: true,
    actionsAndTraitsCompactView: false,
  };
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        {
          id: 2,
          name: 'FLAGS',
          data: {
            namedFlags,
            namedFlagsCandidate: { hidePortraitUpdatePreviewRaw: 1 },
          },
        },
        {
          id: 11,
          name: 'EMJ',
          data: {
            chunks: [
              { key: 3, data: { seenVoiceNpcIds: [1, 14] } },
              { key: 4, data: { seenCostumeIds: [2, 21] } },
            ],
          },
        },
      ],
    },
  });
  const flags = sections.filter((section) => section.sourceId === '2');
  assert.equal(flags.length, 1);
  assert.ok(!flags[0].title.includes('候选'));
  assert.equal(
    flags[0].rows.find((row) => row.field === '隐藏肖像更新预览').value,
    '是',
  );
  assert.deepEqual(
    sections
      .find((section) => section.id.endsWith('seenVoiceNpcIds'))
      .rows.map((row) => row.value),
    [1, 14],
  );
  assert.deepEqual(
    sections
      .find((section) => section.id.endsWith('seenCostumeIds'))
      .rows.map((row) => row.value),
    [2, 21],
  );
});

test('item menu native descriptors map text and display permissions separately from default fallback', () => {
  const source = Buffer.alloc(288);
  source[0] = 1;
  source[1] = 2;
  source[256] = 1 << 1;
  const data = decodeNativeUiSegment(6, 90, source);
  assert.equal(data.tiers[0].entries[0].addonRowId, 1748);
  assert.equal(data.tiers[0].entries[0].name, '出售／出让');
  assert.equal(data.tiers[0].entries[0].allowedInMenu, true);
  assert.equal(data.tiers[0].entries[1].allowedInMenu, false);
  assert.deepEqual(data.visibleMenuEntryIds, [1]);
  assert.equal(data.usesDefaultMenu, false);
  const defaults = decodeNativeUiSegment(6, 90, Buffer.alloc(288));
  assert.equal(defaults.usesDefaultMenu, true);
  assert.equal(defaults.defaultMenuEntries.length, 58);
  assert.equal(
    defaults.defaultMenuEntries.find((entry) => entry.menuEntryId === 50)
      .allowedInMenu,
    false,
  );
  assert.equal(defaults.tiers[0].count, 0);
  assert.equal(defaults.coverage.unknownFields.length, 0);
});

test('PvP role-action meanings keep public-name references explicitly candidate and unknown slots unguessed', () => {
  const source = Buffer.alloc(66);
  source[16] = 3;
  source[61] = 255;
  const data = decodeNativeUiSegment(7, 400, source);
  assert.equal(data.stateEntries[0].selectionKind, 'role-action');
  assert.equal(data.stateEntries[0].selectedActionIdCandidate, 43245);
  assert.equal(data.stateEntries[0].selectedActionNameCandidate, '全力挥打');
  assert.equal(data.stateEntries[45].selectedActionNameCandidate, null);
  assert(
    data.coverage.candidateFields.includes(
      'stateEntries.selectedActionNameCandidate',
    ),
  );
});

test('readable AOZ keeps all five presets and stable sparse action/hotbar slots with macro and preserve labels', () => {
  const bytes = Buffer.alloc(1825);
  bytes.write('末组', 0x78 + 4 * 60);
  bytes[4 * 24 + 7] = 3;
  const hotbars = 0x1a4 + 4 * 248,
    flags = 0x67c + 4 * 31;
  bytes[hotbars + 3] = 199;
  bytes[flags] = 1 << 3;
  bytes[hotbars + 7] = 255;
  bytes[hotbars + 8] = 3;
  bytes[hotbars + 247] = 0;
  bytes[flags + 30] = 0x80;
  bytes[0x720] = 3;
  const value = decodeNativeAoz(3, bytes),
    detail = {
      summary: { name: 'UISAVE.DAT' },
      header: {},
      data: { segments: [{ id: 12, name: 'AOZNOTE', data: value }] },
    },
    sections = readableSections(detail);
  detail.readable = sections;
  const sets = sections.find((section) => section.id === 'aoz-sets');
  assert.equal(sets.rows.length, 5);
  assert.equal(sets.rows[4].slot, 5);
  assert.equal(sets.rows[4].name, '末组');
  assert.equal(sets.rows[0].actionCount, 0);
  const actions = sections.find(
    (section) => section.id === 'aoz-sets-4-actions',
  );
  assert.equal(actions.rows.length, 1);
  assert.equal(actions.rows[0].slot, 8);
  assert.equal(actions.rows[0].storedId, 3);
  assert.equal(actions.rows[0].actionIdRaw, 11385);
  assert.notEqual(actions.rows[0].name, '未收录青魔技能 3');
  const normal = sections.find(
    (section) => section.id === 'aoz-sets-4-standardHotbars-0-slots',
  );
  assert.deepEqual(
    normal.rows.map((row) => row.slot),
    [4, 8, 9],
  );
  assert.equal(normal.rows[0].name, '公用宏 100');
  assert.equal(normal.rows[1].name, '保留原快捷栏内容');
  assert.equal(normal.rows[1].storedValue, 255);
  assert.equal(normal.rows[2].name, actions.rows[0].name);
  const cross = sections.find(
    (section) => section.id === 'aoz-sets-4-crossHotbars-7-slots',
  );
  assert.equal(cross.rows[0].slot, 16);
  assert.equal(cross.rows[0].name, '个人宏 1');
  assert.equal(
    sections.find((section) => section.id === 'aoz-recent').rows[0].slot,
    10,
  );
  const browser = buildFileNode(detail),
    all = (node) => [node, ...(node.children ?? []).flatMap(all)],
    preset = all(browser).find((node) => node.title === '末组');
  assert(preset);
  assert(
    preset.sections.some((section) =>
      section.rows.some((row) => row.slot === 8 && row.storedId === 3),
    ),
  );
  const crossNode = all(preset).find(
    (node) =>
      node.title === '槽位 8' &&
      node.sections?.some((section) =>
        section.rows.some((row) => row.name === '个人宏 1'),
      ),
  );
  // Child table IDs bind to physical preset and bar indices despite sparse rows.
  assert(crossNode);
  assert.equal(
    sections.filter(
      (section) =>
        section.id.startsWith('aoz-sets-4-standardHotbars-') &&
        section.id.endsWith('-slots'),
    ).length,
    10,
  );
});

test('readable GRPPOS shows relative camera XYZ and confirmed directions without promoting raw parameters or vector padding', () => {
  const bytes = Buffer.alloc(240);
  bytes[0] = 1;
  bytes[1] = 2;
  for (const [offset, value] of [
    [4, 4.5],
    [8, 0.75],
    [12, 123],
    [16, 1.25],
    [20, -0.5],
    [32, 321],
    [48, 10],
    [52, 20],
    [56, 30],
    [60, 987],
    [84, 0.25],
    [88, 0.5],
    [92, 0.75],
    [112, 1],
    [116, 2],
    [120, 3],
    [124, 456],
    [228, 1.5],
  ])
    bytes.writeFloatLE(value, offset);
  bytes[64] = 1;
  bytes[80] = 1;
  bytes[224] = 1;
  bytes[225] = 1;
  bytes[232] = 2;
  const data = decodeNativeGroupPose(100, bytes),
    sections = readableSections({
      summary: { name: 'UISAVE.DAT' },
      header: {},
      data: { segments: [{ id: 15, name: 'GRPPOS', data }] },
    });
  assert.equal(sections.length, 3);
  const camera = sections.find((section) => section.id === 'group-pose-camera'),
    values = Object.fromEntries(
      camera.rows.map((row) => [row.field, row.value]),
    );
  assert.equal(values['相对镜头位置'], 'X 10 · Y 20 · Z 30');
  assert.equal(values['镜头位置坐标系'], '相对目标位置与朝向');
  assert.equal(values['镜头距离'], 4.5);
  assert.equal(values['镜头视野'], 0.75);
  assert.equal(values['水平方向（弧度）'], 1.25);
  assert.equal(values['垂直方向（弧度）'], -0.5);
  const light = sections.find((section) => section.id === 'group-pose-lights')
    .rows[0];
  assert.equal(light.enabled, '是');
  assert.equal(light.positionText, 'X 1 · Y 2 · Z 3');
  assert.equal(light.red, 0.25);
  assert.ok(
    !JSON.stringify(sections).match(/987|456|321|123|镜头角度|镜头旋转/),
  );
  bytes[64] = 0;
  const plain = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: {},
    data: {
      segments: [
        { id: 15, name: 'GRPPOS', data: decodeNativeGroupPose(100, bytes) },
      ],
    },
  });
  assert.equal(
    plain[0].rows.find((row) => row.field === '镜头位置坐标系').value,
    '相对目标位置',
  );
});

test('complete DAT routing preserves native AOZNOTE, GRPPOS and framed UIDATA interpretations', () => {
  const aoz = Buffer.alloc(1825);
  aoz[4 * 24 + 23] = 124;
  aoz.write('第五组', 0x78 + 4 * 60);
  aoz[0x1a4 + 4 * 248 + 247] = 199;
  aoz[0x67c + 4 * 31 + 30] = 0x80;
  aoz[0x720] = 3;
  const pose = Buffer.alloc(240);
  pose.writeFloatLE(8.5, 4);
  pose.writeFloatLE(0.75, 8);
  pose.writeFloatLE(1.25, 16);
  pose.writeFloatLE(-0.5, 20);
  pose.writeFloatLE(12, 48);
  pose.writeFloatLE(34, 52);
  pose.writeFloatLE(56, 56);
  pose.writeUInt32LE(0xdeadbeef, 60);
  pose[64] = 1;
  const u16 = (value) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
  };
  const tagged = (tag, body) =>
    Buffer.concat([Buffer.from(tag), u16(body.length), body]);
  const listBody = (id) => {
    const count = Buffer.alloc(4),
      ids = Buffer.alloc(1600),
      worlds = Buffer.alloc(400),
      names = Buffer.alloc(6400),
      comments = Buffer.alloc(6400);
    count.writeUInt32LE(1);
    ids.writeBigUInt64LE(0xfffffffffffffff1n);
    worlds.writeUInt16LE(1177);
    names.write('名单昵称');
    comments.write('备注');
    const bytes = Buffer.concat([
      tagged('N', count),
      ...(id === 4
        ? [
            tagged('D', Buffer.from([28])),
            tagged('F', Buffer.alloc(28)),
            tagged('R', Buffer.alloc(400)),
          ]
        : []),
      tagged('I', ids),
      tagged('W', worlds),
      tagged('C', names),
      tagged('B', u16(32)),
      tagged('M', comments),
    ]);
    return Buffer.concat([bytes, Buffer.alloc(-bytes.length & 3)]);
  };
  const labels = Buffer.alloc(448),
    contacts = Buffer.alloc(3200),
    b5 = Buffer.alloc(392),
    b6 = Buffer.alloc(9608);
  labels.write('分组');
  contacts.write('联系人昵称');
  contacts.writeBigUInt64LE(0xfffffffffffffff2n, 32);
  contacts.writeUInt16LE(1177, 48);
  b5.writeUInt32LE(8);
  b6.writeUInt32LE(200);
  const social = Buffer.concat([
    Buffer.from([6, 0, 0, 0]),
    ...[
      [0, 0, labels],
      [3, 5, contacts],
      [4, 3, listBody(4)],
      [5, 0, b5],
      [6, 0, b6],
      [11, 2, listBody(11)],
    ].map(([id, version, body]) => {
      const header = Buffer.alloc(16);
      header.writeUInt16LE(id);
      header.writeUInt16LE(version, 2);
      header.writeUInt32LE(body.length, 8);
      return Buffer.concat([header, body, Buffer.alloc(4)]);
    }),
    Buffer.alloc(29),
  ]);
  // Mask all three inner records as the game does, in addition to outer XOR31.
  const masked = (body) =>
    Buffer.concat([
      Buffer.from([255]),
      Buffer.from(body.map((byte) => byte ^ 0x73)),
    ]);
  const source = file([
      { id: 12, version: 3, data: masked(aoz) },
      { id: 15, version: 100, data: masked(pose) },
      { id: 4, version: 106, data: masked(social) },
    ]),
    before = Buffer.from(source),
    decoded = decodeDat(source, 'UISAVE.DAT'),
    segments = decoded.result.data.segments;
  assert.deepEqual(source, before);
  assert.equal(decoded.result.data.completeContainer, true);
  assert.deepEqual(
    segments.map((segment) => segment.id),
    [12, 15, 4],
  );
  for (const [index, bytes, native] of [
    [0, aoz, decodeNativeAoz(3, aoz)],
    [1, pose, decodeNativeGroupPose(100, pose)],
    [2, social, decodeNativeSocial(106, social)],
  ]) {
    assert.equal(segments[index].decodedHex, bytes.toString('hex'));
    assert.deepEqual(segments[index].data, native);
    assert.equal(segments[index].coverage.structureComplete, true);
    assert.equal(segments[index].warnings.length, 0);
  }
  assert.equal(
    segments[0].data.activeSets[4].activeActions[23].actionId,
    34582,
  );
  assert.equal(
    segments[0].data.activeSets[4].crossHotbars[7].slots[15].macroCommandId,
    0x163,
  );
  assert.deepEqual(segments[1].data.cameraPositionOffset, {
    x: 12,
    y: 34,
    z: 56,
  });
  assert.equal(segments[1].data.cameraPositionOffset.w, undefined);
  assert.equal(segments[2].data.parsedBlockCount, 6);
  assert.equal(segments[2].data.groupLabels[0].name, '分组');
  assert.equal(
    segments[2].data.contactRecords[0].identityIdRaw,
    '18446744073709551602',
  );
  assert.equal(
    segments[2].data.muteList.entries[0].accountId,
    '18446744073709551601',
  );
  assert.equal(segments[2].data.capacityPaddingByteLength, 29);
  const readable = readableSections({
    summary: { name: 'UISAVE.DAT' },
    header: decoded.header,
    data: decoded.result.data,
  });
  assert(readable.some((section) => section.id === 'aoz-sets-4-actions'));
  assert(readable.some((section) => section.id === 'group-pose-camera'));
  assert(
    readable.some(
      (section) =>
        section.sourceId === '4' &&
        section.rows.some((row) => row.name === '联系人昵称'),
    ),
  );
});
