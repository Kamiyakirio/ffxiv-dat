import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUiSave } from '../src/main/services/dat/uisave.ts';

function decodeSegment(id, version, body) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16);
  header.writeUInt32LE(1, 4);
  const segment = Buffer.alloc(16);
  segment.writeUInt16LE(id);
  segment.writeUInt16LE(version, 2);
  segment.writeUInt32LE(body.length, 4);
  segment.writeUInt32LE(body.length, 8);
  return decodeUiSave(
    Buffer.concat([header, segment, body, Buffer.alloc(4)]),
    1,
  ).data.segments[0];
}

function actionRecords(entries) {
  return Buffer.concat(
    entries.flatMap(([id, flag0, flag1]) => {
      const action = Buffer.alloc(7);
      action[0] = 'A'.charCodeAt(0);
      action.writeUInt16LE(4, 1);
      action.writeUInt32LE(id, 3);
      return [
        action,
        Buffer.from(['0'.charCodeAt(0), 1, 0, flag0]),
        Buffer.from(['1'.charCodeAt(0), 1, 0, flag1]),
      ];
    }),
  );
}

test('EMTH indexes four two-bit states per byte from Emote ID one through 1024', () => {
  const body = Buffer.alloc(310);
  body.writeUInt16LE(1000, 2);
  body.writeUInt16LE(1024, 14);
  body[54] = 0xe4; // IDs 1..4 => states 0, 1, 2, 3.
  body[55] = 2; // ID 5; starts the next byte.
  body[309] = 3 << 6; // ID 1024; final two bits of the bitmap.
  const segment = decodeSegment(8, 102, body);
  const data = segment.data;
  assert.equal(segment.status, 'decoded');
  assert.equal(data.emoteStates.length, 1024);
  assert.deepEqual(
    data.emoteStates.slice(0, 5).map(({ emoteId, state, stateName }) => ({
      emoteId,
      state,
      stateName,
    })),
    [
      { emoteId: 1, state: 0, stateName: '未初始化/未参与显示' },
      { emoteId: 2, state: 1, stateName: '上次刷新时未解锁' },
      { emoteId: 3, state: 2, stateName: '已解锁未查看' },
      { emoteId: 4, state: 3, stateName: '已查看' },
      { emoteId: 5, state: 2, stateName: '已解锁未查看' },
    ],
  );
  assert.deepEqual(data.unseenEmoteIds, [3, 5]);
  assert.deepEqual(data.seenEmoteIds, [4, 1024]);
  assert.equal(data.emoteStates[0].isSeen, false);
  assert.equal(data.emoteStates[1].isUnseen, false);
  assert.equal(data.emoteStates[1023].emoteId, 1024);
  assert.equal(data.emoteStates[1023].isSeen, true);
  assert.equal(data.seenEmotesBitmaskHex, body.subarray(54).toString('hex'));
  assert.equal(data.history[0], 1000);
  assert.equal(data.favorites[0], 1024);
  assert(
    segment.coverage.unknownFields.every((entry) => entry.kind === 'storage'),
  );
});

test('EMTH keeps zero state capacity separate from actual unlocked or seen records', () => {
  const { data } = decodeSegment(8, 102, Buffer.alloc(310));
  assert.equal(data.emoteStates.length, 1024);
  assert(data.emoteStates.every((entry) => entry.state === 0));
  assert.deepEqual(data.unseenEmoteIds, []);
  assert.deepEqual(data.seenEmoteIds, []);
});

test('ACTION names independent saved booleans and identifies public support/default references', () => {
  const segment = decodeSegment(
    30,
    1,
    actionRecords([
      [92, 1, 0],
      [16480, 0, 1],
      [16478, 0, 0], // Runtime alias: stored flags do not resolve its base settings.
    ]),
  );
  const { actions, actionSettingReferenceSource: source } = segment.data;
  assert.equal(segment.status, 'decoded');
  assert.equal(actions[0].flag0, 1);
  assert.equal(actions[0].flag1, 0);
  assert.equal(actions[0].actionChangeEnabled, true);
  assert.equal(actions[0].antiMisactivationEnabled, false);
  assert.equal(actions[0].settingReference.replacementActionId, 7399);
  assert.equal(actions[0].settingReference.supportsActionChange, true);
  assert.equal(actions[0].settingReference.defaultActionChange, true);
  assert.equal(actions[0].settingReference.supportsAntiMisactivation, true);
  assert.equal(
    actions[0].settingReference.antiMisactivationDelayMilliseconds,
    1000,
  );
  assert.equal(actions[1].actionChangeEnabled, false);
  assert.equal(actions[1].antiMisactivationEnabled, true);
  assert.equal(
    actions[1].settingReference.antiMisactivationDelayMilliseconds,
    1500,
  );
  assert.equal(actions[2].settingReference, null);
  assert.equal(source.sheet, 'ActionSetting');
  assert.equal(source.repository, 'thewakingsands/ffxiv-datamining-cn');
  assert.equal(source.revision, '2c6741cffe3cfe70f093c54c463791364e515d8d');
  assert.equal(segment.coverage.unknownFields.length, 0);
});

test('ACTION preserves out-of-range raw booleans and reports specific unresolved values', () => {
  const segment = decodeSegment(
    30,
    1,
    actionRecords([
      [36942, 2, 255],
      [36943, 1, 1],
    ]),
  );
  const [invalid, valid] = segment.data.actions;
  assert.equal(segment.status, 'partial');
  assert.equal(invalid.flag0, 2);
  assert.equal(invalid.flag1, 255);
  assert.equal(invalid.actionChangeEnabled, null);
  assert.equal(invalid.antiMisactivationEnabled, null);
  assert.equal(invalid.settingReference, null);
  assert.equal(valid.actionChangeEnabled, true);
  assert.equal(valid.antiMisactivationEnabled, true);
  assert.deepEqual(
    segment.coverage.unknownFields.map((entry) => entry.field),
    ['actions[].flag0', 'actions[].flag1'],
  );
  assert.equal(segment.data.fields[1].valueHex, '02');
  assert.equal(segment.data.fields[2].valueHex, 'ff');
});

test('ACTION preserves unfamiliar field streams without declaring their meaning decoded', () => {
  const body = actionRecords([[92, 1, 0]]).subarray(0, 7);
  const segment = decodeSegment(30, 1, body);
  assert.equal(segment.status, 'partial');
  assert.equal(segment.data.actions, undefined);
  assert.equal(segment.data.fields[0].tag, 'A');
  assert.equal(segment.data.fields[0].valueHex, '5c000000');
  assert.equal(segment.coverage.unknownFields[0].field, 'actions');
});
