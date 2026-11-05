import { decodedDetail } from './helpers/decoded-detail.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatGameId } from '../src/shared/character-label.ts';
import { readableSections } from '../src/main/services/dat/readable.ts';

test('game IDs share one name@world format and never duplicate an existing suffix', () => {
  assert.equal(formatGameId('忏', '神意之地'), '忏@神意之地');
  assert.equal(formatGameId('悔', '晨曦王座'), '悔@晨曦王座');
  assert.equal(formatGameId('角色', null), '角色@未知服务器');
  assert.equal(formatGameId('角色@已保存世界', null), '角色@已保存世界');
  assert.equal(formatGameId('角色@已保存世界', '新世界'), '角色@新世界');
  assert.equal(formatGameId(null, null), '未记录昵称@未知服务器');
});

test('cached profile and contact displays use matching world metadata while keeping raw IDs intact', () => {
  const cached = {
    name: '忏',
    worldId: 1081,
    contentIdHex: '00438D8134FA7E0B',
    recordUpdatedAtUnix: 1700000000,
  };
  const profile = readableSections(
    decodedDetail({
      summary: { name: 'FFXIV_CFGCPY.dat' },
      header: { format: 'config-copy' },
      data: cached,
    }),
  );
  assert.equal(profile[0].rows[0].name, '忏@神意之地');
  assert.equal(profile[0].rows[0].contentIdHex, cached.contentIdHex);
  assert.equal(cached.name, '忏');
  const contacts = readableSections(
    decodedDetail({
      summary: { name: 'ACQ.DAT' },
      data: {
        contacts: [
          { name: '同名角色', worldId: 1175, contentIdHex: '123' },
          { name: '同名角色', worldId: 1081, contentIdHex: '456' },
          { name: '无服务器记录', worldId: 0 },
        ],
      },
    }),
  );
  assert.deepEqual(
    contacts[0].rows.map((row) => row.name),
    ['同名角色@晨曦王座', '同名角色@神意之地', '无服务器记录@未知服务器'],
  );
});
