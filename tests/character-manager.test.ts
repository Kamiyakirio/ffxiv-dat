import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterManager } from '../src/main/services/character-manager.ts';
import { DatWorkspace } from '../src/main/services/dat-workspace.ts';
import { decodeDat } from '../src/main/services/dat/decoder.ts';
import { gearset, uiSave } from './helpers/portrait-fixtures.ts';

async function fixture(t: TestContext) {
  const temp = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'ffxiv-manager-')),
  );
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(
    temp,
    'My Games',
    'FINAL FANTASY XIV - A Realm Reborn',
  );
  const a = path.join(root, 'FFXIV_CHR0000000000000001'),
    b = path.join(root, 'FFXIV_CHR0000000000000002');
  for (const [index, c] of [a, b].entries()) {
    await mkdir(path.join(c, 'log'), { recursive: true });
    await mkdir(path.join(c, 'empty'));
    await writeFile(
      path.join(c, 'UISAVE.DAT'),
      uiSave(`000000000000000${index + 1}`),
    );
    await writeFile(path.join(c, 'GEARSET.DAT'), gearset());
    await writeFile(
      path.join(c, 'log', '中文.log'),
      Buffer.from([0, 1, 255, 128, 99]),
    );
  }
  const workspace = new DatWorkspace();
  await workspace.locate(root);
  const settings = path.join(temp, 'settings', 'backups.json');
  const manager = new CharacterManager(workspace, settings);
  return { root, a, b, temp, workspace, manager, settings };
}

test('copy/paste between characters and deleting linked portraits create browsable full-folder safety backups', async (t) => {
  const { a, b, root, manager } = await fixture(t);
  const aBytes = await readFile(path.join(a, 'UISAVE.DAT'));
  const source = await manager.portraits(a),
    target = await manager.portraits(b);
  assert.deepEqual(source.portraits[0].linkedGearsets, ['测试套装']);
  const code = await manager.exportPortraits(a, source.revision, [7]);
  const pasted = await manager.writePortraits({
    characterPath: b,
    revision: target.revision,
    change: { type: 'import', code, mode: 'create' },
  });
  assert.deepEqual(
    pasted.portraits.map((p) => p.id),
    [7, 0],
  );
  assert.deepEqual(await readFile(path.join(a, 'UISAVE.DAT')), aBytes);
  assert.equal(await manager.exportPortraits(b, pasted.revision, [0]), code);
  const deleted = await manager.writePortraits({
    characterPath: b,
    revision: pasted.revision,
    change: { type: 'delete', ids: [7] },
  });
  assert.deepEqual(
    deleted.portraits.map((p) => p.id),
    [0],
  );
  const gear = decodeDat(
    await readFile(path.join(b, 'GEARSET.DAT')),
    'GEARSET.DAT',
  );
  assert.equal(
    (gear.result.data.records as Record<string, unknown>[])[0].bannerIndex,
    null,
  );
  const library = await manager.backups(root);
  assert.equal(
    library.path,
    path.join(path.dirname(root), 'FFXIV DAT Backups'),
  );
  assert.equal(library.backups.length, 2);
  assert(
    library.backups.every(
      (backup) => backup.reason === 'portrait-change' && backup.fileCount === 3,
    ),
  );
  assert.equal(library.custom, false);
});

test('stale revisions, unregistered paths, wrong content IDs and file symlinks cannot modify character data', async (t) => {
  const { a, b, root, manager } = await fixture(t);
  const before = await manager.portraits(a);
  await writeFile(path.join(a, 'UISAVE.DAT'), uiSave('0000000000000001', []));
  await assert.rejects(
    manager.writePortraits({
      characterPath: a,
      revision: before.revision,
      change: { type: 'delete', ids: [7] },
    }),
    /修改/,
  );
  await assert.rejects(
    manager.exportPortraits(a, before.revision, [7]),
    /修改/,
  );
  await assert.rejects(manager.portraits(path.dirname(root)), /请先/);
  await writeFile(path.join(a, 'UISAVE.DAT'), uiSave('0000000000000002'));
  await assert.rejects(manager.portraits(a), /标识/);
  await rm(path.join(a, 'UISAVE.DAT'));
  await symlink(path.join(b, 'UISAVE.DAT'), path.join(a, 'UISAVE.DAT'));
  await assert.rejects(manager.portraits(a), /位置|符号/);
  assert.equal((await manager.backups(root)).backups.length, 0);
});

test('folder restore is exact, keeps empty directories and binary logs, removes later files and saves a restorable copy of the previous state', async (t) => {
  const { a, root, manager } = await fixture(t);
  const originals = new Map(
    await Promise.all(
      ['UISAVE.DAT', 'GEARSET.DAT', 'log/中文.log'].map(
        async (name) => [name, await readFile(path.join(a, name))] as const,
      ),
    ),
  );
  const [backup] = await manager.createBackups([a]);
  await writeFile(path.join(a, 'UISAVE.DAT'), uiSave('0000000000000001', []));
  await writeFile(path.join(a, 'new-file.cfg'), 'later file');
  await rm(path.join(a, 'empty'), { recursive: true });
  await manager.restore(root, backup.id);
  for (const [name, bytes] of originals)
    assert.deepEqual(await readFile(path.join(a, name)), bytes);
  assert((await readdir(a)).includes('empty'));
  assert(!(await readdir(a)).includes('new-file.cfg'));
  const safety = (await manager.backups(root)).backups.find(
    (b) => b.reason === 'before-restore',
  )!;
  assert(safety);
  await manager.restore(root, safety.id);
  assert.equal((await manager.portraits(a)).portraits.length, 0);
  assert.equal(
    await readFile(path.join(a, 'new-file.cfg'), 'utf8'),
    'later file',
  );
  await manager.deleteBackups(root, [backup.id, safety.id]);
  assert.equal((await manager.backups(root)).backups.length, 1);
});

test('custom backup directories persist across application restarts and location changes preserve each old library', async (t) => {
  const { a, root, manager, temp, workspace, settings } = await fixture(t);
  await manager.createBackups([a]);
  const selected = path.join(temp, 'custom-backups');
  await mkdir(selected);
  const changed = await manager.setLocation(root, selected);
  assert.equal(changed.path, selected);
  assert.equal(changed.backups.length, 0);
  assert(changed.custom);
  await manager.createBackups([a]);
  const restarted = new CharacterManager(workspace, settings);
  assert.equal((await restarted.backups(root)).backups.length, 1);
  assert.equal((await restarted.backups(root)).path, selected);
  await assert.rejects(restarted.setLocation(root, a), /独立/);
  const previous = await restarted.setLocation(root, null);
  assert.equal(previous.backups.length, 1);
  assert(!previous.custom);
  assert.equal((await readdir(selected)).length, 1);
});

test('corrupt backup payloads, traversal in manifests, linked directories and invalid delete batches fail without changing live files', async (t) => {
  const { a, root, manager, temp } = await fixture(t);
  const [backup] = await manager.createBackups([a]);
  const library = await manager.backups(root),
    folder = path.join(library.path, backup.id);
  const before = await readFile(path.join(a, 'UISAVE.DAT'));
  await writeFile(path.join(folder, 'data', 'UISAVE.DAT'), 'corrupt');
  await assert.rejects(manager.restore(root, backup.id), /校验/);
  assert.deepEqual(await readFile(path.join(a, 'UISAVE.DAT')), before);
  const manifestFile = path.join(folder, 'manifest.json'),
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.files[0].path = '../../outside';
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(manager.restore(root, backup.id), /清单/);
  assert.equal((await manager.backups(root)).warnings.length, 1);
  await symlink(temp, path.join(a, 'linked-folder'));
  await assert.rejects(manager.createBackups([a]), /符号链接/);
  await assert.rejects(
    manager.deleteBackups(root, [backup.id, '../outside']),
    /清单|编号/,
  );
  assert((await readdir(library.path)).includes(backup.id));
});
