import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUiSave } from '../src/main/services/dat/uisave.ts';
import {
  gameName,
  enrichDecodedData,
  hotbarTypes,
  strategyObjectName,
} from '../src/main/services/dat/game-data.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';

function fixture(segments) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16);
  header.writeUInt32LE(segments.length, 4);
  return Buffer.concat([
    header,
    ...segments.map(({ id, version, body }) => {
      const h = Buffer.alloc(16);
      h.writeUInt16LE(id);
      h.writeUInt16LE(version, 2);
      h.writeUInt32LE(body.length, 4);
      h.writeUInt32LE(body.length, 8);
      return Buffer.concat([h, body, Buffer.alloc(4)]);
    }),
  ]);
}

test('reference chains resolve portrait timelines, expressions, recipes, destinations and beastmaster pets', () => {
  assert.equal(gameName('BannerTimeline', 129), '绅士风度');
  assert.equal(gameName('BannerFacial', 1), '表情：平常');
  assert.equal(gameName('Recipe', 1), '青铜锭');
  assert.equal(gameName('Aetheryte', 2), '格里达尼亚新街');
  assert.equal(gameName('XBMPet', 1), '库西');
  assert.equal(gameName('Stain', 1), '素雪白');
  assert.equal(hotbarTypes.length, 36);
  assert.equal(hotbarTypes[31], 'Ornament');
  assert.equal(hotbarTypes[33], 'Glasses');
  assert.equal(strategyObjectName(9), '圆形范围');
  assert.equal(strategyObjectName(27), '骑士');
});

test('zero-valued storage fields do not downgrade the interpreted mount lists', () => {
  const body = Buffer.alloc(84);
  body.writeUInt16LE(6, 2);
  body.writeUInt16LE(8, 22);
  const encoded = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(body.map((b) => b ^ 0x73)),
  ]);
  const result = decodeUiSave(
    fixture([{ id: 10, version: 102, body: encoded }]),
    1,
  );
  const segment = result.data.segments[0];
  assert.equal(segment.status, 'decoded');
  assert.equal(segment.coverage.structureComplete, true);
  assert.ok(
    segment.coverage.unknownFields.every((field) => field.kind === 'storage'),
  );
  assert.equal(segment.data.unseen[0], 6);
});

test('saved materia grades use zero-based item columns and resolve custom weapon attributes', () => {
  assert.equal(gameName('MateriaGrade', '1:0'), '惰性魔晶石壹型');
  assert.equal(gameName('MateriaGrade', '1:1'), '惰性魔晶石贰型');
  assert.equal(gameName('MateriaGrade', '1411:7'), null);
  assert.equal(gameName('MateriaEffect', '1411:7'), '直击 +447');
  assert.equal(gameName('MateriaEffect', '1410:7'), '暴击 +447');
  assert.equal(gameName('MateriaEffect', '1412:2'), '信念 +108');
});

test('mahjong candidate settings appear in readable output with their uncertainty retained', () => {
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    data: {
      segments: [
        {
          id: 11,
          name: 'EMJ',
          data: {
            chunks: [
              {
                key: 2,
                data: {
                  settingsCandidate: {
                    hideHints: true,
                    emjCostumeId: 4,
                  },
                },
              },
            ],
          },
        },
      ],
    },
    header: {},
  });
  const setting = sections.find((section) =>
    section.title.includes('麻将设置'),
  );
  assert.ok(setting);
  assert.deepEqual(setting.rows, [
    { field: '隐藏提示（候选）', value: '是' },
    { field: '服装编号（候选）', value: 4 },
  ]);
});

test('one malformed tagged segment preserves its raw bytes and does not discard the following segment', () => {
  const malformed = Buffer.from([77, 48, 255]);
  const result = decodeUiSave(
    fixture([
      { id: 41, version: 1, body: malformed },
      { id: 32, version: 0, body: Buffer.from([12]) },
    ]),
    1,
  );
  assert.equal(result.data.segments.length, 2);
  assert.equal(result.data.segments[0].decodedHex, malformed.toString('hex'));
  assert.equal(result.data.segments[0].coverage.structureComplete, false);
  assert.match(result.data.segments[0].data.parseError, /Truncated/);
  assert.equal(result.data.segments[1].data.countdownLength, 12);
  assert.equal(result.data.completeContainer, true);
});

test('typed screen names and strategic object colors are derived without overwriting original identifiers', () => {
  const data = {
    segments: [
      {
        id: 23,
        data: {
          chunks: [
            { records: [{ bannerBg: 7, bannerTimeline: 129, expression: 1 }] },
          ],
        },
      },
      {
        id: 41,
        data: { panels: [{ slots: [{ commandType: 10, commandId: 3 }] }] },
      },
      {
        id: 28,
        data: {
          chunks: [
            {
              data: {
                records: [
                  { objects: [{ objectType: 9, rgba: [255, 0, 16, 25] }] },
                ],
              },
            },
          ],
        },
      },
    ],
  };
  enrichDecodedData(data, 'UISAVE.DAT');
  const portrait = data.segments[0].data.chunks[0].records[0];
  assert.equal(portrait.bannerTimeline, 129);
  assert.equal(portrait.timelineName, '绅士风度');
  assert.equal(portrait.expressionName, '表情：平常');
  const command = data.segments[1].data.panels[0].slots[0];
  assert.equal(command.commandId, 3);
  assert.equal(command.commandName, '极限技');
  const object = data.segments[2].data.chunks[0].data.records[0].objects[0];
  assert.equal(object.objectName, '圆形范围');
  assert.equal(object.colorHex, '#ff0010');
  assert.equal(object.transparencyPercent, 25);
});

test('portrait readable output groups all portraits into five business tables rather than hundreds of field trees', () => {
  const data = {
    segments: [
      {
        id: 23,
        name: 'BANNER',
        data: {
          chunks: [
            {
              records: [
                {
                  recordIndex: 0,
                  bannerBg: 7,
                  bannerTimeline: 129,
                  expression: 1,
                  customize: { race: 3, sex: 1, height: 45, tribe: 6 },
                  cameraZoom: 120,
                  checksum: 123,
                },
              ],
            },
          ],
        },
      },
    ],
  };
  enrichDecodedData(data, 'UISAVE.DAT');
  const sections = readableSections({
    summary: { name: 'UISAVE.DAT' },
    data,
    header: {},
  });
  assert.equal(sections.length, 5);
  assert.equal(sections[0].rows.length, 1);
  assert.equal(sections[0].rows[0].timelineName, '绅士风度');
  assert.equal(sections[1].rows[0].cameraZoom, 120);
  assert.equal(sections[3].rows[0].sex, '女');
  assert.equal(sections[4].rows[0].checksumValue, '0x0000007b');
  assert.ok(sections.every((section) => section.sourceId === '23'));
});
