import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';

function decode(id, version, body) {
  const container = Buffer.alloc(16);
  container.writeUInt32LE(16);
  container.writeUInt32LE(1, 4);
  const segment = Buffer.alloc(16);
  segment.writeUInt16LE(id);
  segment.writeUInt16LE(version, 2);
  segment.writeUInt32LE(body.length, 4);
  segment.writeUInt32LE(body.length, 8);
  const payload = Buffer.concat([container, segment, body, Buffer.alloc(4)]);
  const header = Buffer.alloc(16);
  header.writeUInt16LE(9);
  header.writeUInt16LE(1, 2);
  header.writeUInt32LE(payload.length, 4);
  header.writeUInt32LE(payload.length, 8);
  const decoded = decodeDat(
    Buffer.concat([header, Buffer.from(payload.map((byte) => byte ^ 0x31))]),
    'UISAVE.DAT',
  );
  return {
    decoded,
    sections: readableSections({
      summary: { name: 'UISAVE.DAT' },
      data: decoded.result.data,
      header: decoded.header,
    }),
  };
}

function field(tag, bytes) {
  const header = Buffer.alloc(4);
  header.write(tag);
  header.writeUInt16LE(bytes.length, 2);
  return Buffer.concat([header, Buffer.from(bytes)]);
}
function uint(value, width) {
  const bytes = Buffer.alloc(width);
  bytes.writeUIntLE(value, 0, width);
  return bytes;
}

test('RTNR readable uses the routed native records, skips empty defaults and preserves raw task IDs and pin state', () => {
  const bytes = Buffer.alloc(1376);
  const offset = 8 + 136;
  bytes.writeBigUInt64LE(0xfffffffffffffff0n, offset);
  bytes.write('保存备注', offset + 8);
  bytes.writeUInt16LE(123, offset + 100);
  bytes[offset + 120] = 1;
  bytes.writeUInt16LE(77, offset + 100 + 9 * 2);
  bytes[offset + 120 + 9] = 2;
  // A missing identity does not hide a nonempty saved history.
  bytes.writeUInt16LE(9, 8 + 2 * 136 + 100);
  const { decoded, sections } = decode(22, 102, bytes);
  const value = decoded.result.data.segments[0].data;
  assert.equal(value.retainers[1].id, '18446744073709551600');
  assert.equal(value.retainers[1].savedTaskEntries[0].isPinned, true);
  assert.equal(value.retainers[1].savedTaskEntries[9].isPinned, null);
  assert.equal(
    value.coverage.unknownFields[0].field,
    'retainers.savedTaskEntries.taskIdRaw',
  );
  assert.equal(sections.length, 4);
  assert(sections.every((section) => section.sourceId === '22'));
  assert.equal(
    sections.some((section) => section.id === 'retainer-0-comment'),
    false,
  );
  const comments = sections.find(
    (section) => section.id === 'retainer-1-comment',
  );
  assert.deepEqual(comments.rows, [
    { retainerId: '18446744073709551600', comment: '保存备注' },
  ]);
  const history = sections.find(
    (section) => section.id === 'retainer-1-task-history',
  );
  assert.deepEqual(history.rows, [
    { slot: 1, taskIdRaw: 123, isPinned: '是' },
    { slot: 10, taskIdRaw: 77, isPinned: '未定义保存值（2）' },
  ]);
  assert(history.columns.some((column) => column.label === '固定到历史'));
  assert.equal(JSON.stringify(sections).includes('收藏'), false);
  assert.equal(JSON.stringify(sections).includes('retainersCandidate'), false);
});

test('RTNR readable has one empty state and retains unsupported versions as unresolved data', () => {
  const empty = decode(22, 102, Buffer.alloc(1376));
  assert.equal(empty.sections.length, 1);
  assert.deepEqual(empty.sections[0].rows, []);
  assert.match(empty.sections[0].note, /没有保存/);
  const unsupported = decode(22, 103, Buffer.alloc(1376));
  assert.equal(
    unsupported.decoded.result.data.segments[0].coverage.structureComplete,
    false,
  );
  assert.match(unsupported.sections[0].note, /未确认/);
});

test('QPNL readable resolves panel icon source namespaces, defaults and slot names without compatibility duplicates', () => {
  const records = [
    field('M0', [4]),
    field('M1', [25]),
    field('F0', uint(2, 4)),
    field('F1', uint(1, 2)),
    field('V0', [10]),
    field('V1', [255]),
  ];
  const iconTypes = [0, 10, 1, 255];
  for (let index = 0; index < 4; index++) {
    const types = Buffer.alloc(25);
    const ids = Buffer.alloc(100);
    if (index === 1) {
      types[24] = 10;
      ids.writeUInt32LE(3, 96);
    }
    records.push(
      field('P0', [iconTypes[index]]),
      field('P1', uint(index === 3 ? 777 : 3, 4)),
      field('S0', types),
      field('S1', ids),
    );
  }
  const { sections } = decode(41, 1, Buffer.concat(records));
  assert(sections.every((section) => section.sourceId === '41'));
  const settings = sections.find(
    (section) => section.id === 'quick-panel-settings',
  );
  assert(
    settings.rows.some(
      (row) => row.field === '开启时显示' && row.value === '最近使用的分页',
    ),
  );
  assert(
    settings.rows.some(
      (row) => row.field === '执行后关闭面板' && row.value === '否',
    ),
  );
  const icons = sections.find((section) => section.id === 'quick-panel-icons');
  assert.equal(icons.rows.length, 4);
  assert.equal(icons.rows[0].typeLabel, '默认图标');
  assert.equal(icons.rows[0].defaultIconId, 695);
  assert.equal(icons.rows[1].typeLabel, '通用技能');
  assert.equal(icons.rows[1].name, '极限技');
  assert.equal(icons.rows[1].defaultIconId, '不适用');
  assert.equal(icons.rows[2].name, '冲刺');
  assert.match(icons.rows[3].typeLabel, /未确认类型/);
  assert.match(icons.rows[3].name, /类型 255 \/ 编号 777/);
  assert.deepEqual(
    sections.find((section) => section.id === 'quick-panel-1-slots').rows,
    [
      {
        slot: 25,
        typeLabel: '通用技能',
        name: '极限技',
        commandType: 10,
        commandId: 3,
      },
    ],
  );
  assert.equal(JSON.stringify(sections).includes('unknownP0'), false);
  assert.equal(JSON.stringify(sections).includes('unknownP1'), false);
});
