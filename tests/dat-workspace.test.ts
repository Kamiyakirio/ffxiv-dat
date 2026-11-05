import type { DecodeProgress } from '../src/shared/types.ts';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatWorkspace } from '../src/main/services/dat-workspace.ts';
import { expectRecords, expectDefined } from './helpers/assertions.ts';

const id = '00438D8134B183CE';
async function fixture(t: TestContext) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dat-workspace-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(
    temporary,
    'My Games',
    'FINAL FANTASY XIV - A Realm Reborn',
  );
  const character = path.join(root, `FFXIV_CHR${id}`);
  await mkdir(character, { recursive: true });
  await writeFile(
    path.join(character, 'COMMON.DAT'),
    'BattleEffectSelf\t1\r\n\0',
  );
  return { root, character, temporary };
}
function field(tag: string, value: string) {
  const bytes = Buffer.from(`${value}\0`);
  const header = Buffer.alloc(3);
  header[0] = tag.charCodeAt(0);
  header.writeUInt16LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

test('directory discovery links cached names by full Content ID and accepts My Games or a character folder', async (t) => {
  const { root, character } = await fixture(t);
  await mkdir(path.join(root, 'cfgcopy'));
  const fields = Buffer.concat([
    field('N', '合成昵称'),
    field('I', id.slice(0, 4)),
    field('I', id.slice(4, 10)),
    field('I', id.slice(10)),
  ]);
  const cache = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from(fields.map((byte) => byte ^ 0x73)),
  ]);
  await writeFile(path.join(root, 'cfgcopy', 'FFXIV_CFGCPY1234.dat'), cache);
  const workspace = new DatWorkspace();
  const located = await workspace.locate(path.dirname(root));
  assert.equal(located.characters.length, 1);
  assert.deepEqual(located.characters[0].names, ['合成昵称']);
  assert.equal(located.characters[0].contentId, id);
  assert.equal(located.fileCount, 2);
  assert.equal((await workspace.locate(character)).path, located.path);
  assert(workspace.canReveal(located.characters[0].path));
  assert(!workspace.canReveal(os.homedir()));
});

test('decoding is limited to selected directories, preserves files, and exposes serializable results', async (t) => {
  const { root, character, temporary } = await fixture(t);
  const workspace = new DatWorkspace();
  const controller = new AbortController();
  await assert.rejects(
    workspace.decode(temporary, controller.signal, () => {}),
    /请先/,
  );
  const selected = await workspace.locate(root);
  const source = await readFile(path.join(character, 'COMMON.DAT'));
  const progress: DecodeProgress[] = [];
  const report = await workspace.decode(
    selected.path,
    controller.signal,
    (value) => progress.push(value),
  );
  assert.equal(report.processed, 1);
  assert.equal(report.files[0].characterId, id);
  assert.equal(expectDefined(progress.at(-1)).current, 1);
  const result = workspace.getResult(report.files[0].id);
  assert.equal(expectRecords(result.data.entries)[0].name, 'BattleEffectSelf');
  assert.equal(expectRecords(result.data.entries)[0].numericValue, 1);
  assert.equal('payload' in result, false);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(await readFile(path.join(character, 'COMMON.DAT')), source);
  await workspace.decode(selected.path, controller.signal, () => {});
  assert.throws(() => workspace.getResult(report.files[0].id), /已失效/);
});

test('cancellation keeps completed files, skips chat logs and directory symlinks, and surfaces bad DAT separately', async (t) => {
  const { root, character, temporary } = await fixture(t);
  await writeFile(path.join(character, 'HOTBAR.DAT'), 'invalid');
  await mkdir(path.join(character, 'log'));
  await writeFile(path.join(character, 'log', 'private.dat'), 'ignore');
  await mkdir(path.join(temporary, 'outside'));
  await writeFile(path.join(temporary, 'outside', 'OTHER.DAT'), 'ignore');
  await symlink(path.join(temporary, 'outside'), path.join(root, 'backup'));
  const workspace = new DatWorkspace();
  const selected = await workspace.locate(root);
  assert.equal(selected.fileCount, 2);
  const controller = new AbortController();
  const cancelled = await workspace.decode(
    selected.path,
    controller.signal,
    (value) => {
      if (value.current === 1) controller.abort();
    },
  );
  assert.equal(cancelled.processed, 1);
  assert.equal(cancelled.cancelled, true);
  const report = await workspace.decode(
    selected.path,
    new AbortController().signal,
    () => {},
  );
  assert.equal(
    expectDefined(report.files.find((file) => file.name === 'HOTBAR.DAT'))
      .status,
    'error',
  );
});

test('backup members are visible separately and keep their parent relationship', async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, 'backup'));
  const member = Buffer.from('Setting\t3\r\n');
  const header = Buffer.alloc(104);
  header.write('FFXIV_BKCHR_RESTORE_DATA');
  header.writeUInt32LE(member.length, 44);
  header.writeUInt32LE(member.length, 48);
  await writeFile(
    path.join(root, 'backup', 'FFXIV_BKCHR_synthetic.dat'),
    Buffer.concat([header, member]),
  );
  const workspace = new DatWorkspace();
  const selected = await workspace.locate(root);
  const result = await workspace.decode(
    selected.path,
    new AbortController().signal,
    () => {},
  );
  assert.equal(result.total, 2);
  assert.equal(result.files.length, 3);
  const child = expectDefined(result.files.find((file) => file.parentId));
  assert.equal(child.category, 'backup');
  assert.equal(
    expectRecords(workspace.getResult(child.id).data.entries)[0].numericValue,
    3,
  );
  assert(result.files.some((file) => file.id === child.parentId));
});

test('character home worlds come from the newest matching full Content ID cache, never another character', async (t) => {
  const { root } = await fixture(t);
  const second = '00438D8134FA7E0B';
  await mkdir(path.join(root, `FFXIV_CHR${second}`));
  await mkdir(path.join(root, 'cfgcopy'));
  async function cache(
    filename: string,
    contentId: string,
    worldId: number,
    updatedAt: number,
  ) {
    const world = Buffer.alloc(5);
    world.write('W');
    world.writeUInt16LE(2, 1);
    world.writeUInt16LE(worldId, 3);
    const time = updatedAt.toString(16).padStart(16, '0');
    const payload = Buffer.concat([
      field('N', '相同昵称'),
      world,
      ...[
        contentId.slice(0, 4),
        contentId.slice(4, 10),
        contentId.slice(10),
      ].map((x) => field('I', x)),
      ...[time.slice(0, 4), time.slice(4, 10), time.slice(10)].map((x) =>
        field('T', x),
      ),
    ]);
    await writeFile(
      path.join(root, 'cfgcopy', filename),
      Buffer.concat([
        Buffer.from([255]),
        Buffer.from(payload.map((x) => x ^ 0x73)),
      ]),
    );
  }
  await cache('FFXIV_CFGCPY01.dat', id, 1081, 1700000000);
  await cache('FFXIV_CFGCPY02.dat', id, 1175, 1700000100);
  await cache('FFXIV_CFGCPY03.dat', second, 1081, 1700000200);
  // Later file ordering cannot override a newer cache with an old snapshot.
  await cache('FFXIV_CFGCPY99.dat', id, 1081, 1699999999);
  const directory = await new DatWorkspace().locate(root);
  const first = expectDefined(
    directory.characters.find((c) => c.contentId === id),
  );
  const other = expectDefined(
    directory.characters.find((c) => c.contentId === second),
  );
  assert.equal(first.homeWorldId, 1175);
  assert.equal(first.homeWorldName, '晨曦王座');
  assert.equal(first.profileUpdatedAtUnix, 1700000100);
  assert.equal(other.homeWorldId, 1081);
  assert.equal(other.homeWorldName, '神意之地');
});
