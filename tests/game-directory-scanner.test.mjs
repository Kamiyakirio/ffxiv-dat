import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findGameDirectory } from '../src/main/services/game-directory-scanner.ts';

const folderName = 'FINAL FANTASY XIV - A Realm Reborn';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dat-scanner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('finds the exact three-folder structure on a later disk', async (t) => {
  const firstDisk = await fixture(t);
  const secondDisk = await fixture(t);
  const target = path.join(
    secondDisk,
    'nested',
    'Games',
    'My Games',
    folderName,
  );
  await mkdir(target, { recursive: true });

  assert.equal(await findGameDirectory([firstDisk, secondDisk]), target);
});

test('does not match missing, partial or noncontiguous My Games folders', async (t) => {
  const root = await fixture(t);
  for (const directories of [
    ['Games', folderName],
    ['My Games backup', folderName],
    ['game', 'My Games', folderName],
    ['Games', 'My Games', 'extra', folderName],
    ['Games', 'My Games', `${folderName} backup`],
  ]) {
    await mkdir(path.join(root, ...directories), { recursive: true });
  }

  assert.equal(await findGameDirectory([root]), null);
});

test('does not match Downloads/My Games without the required Games parent', async (t) => {
  const root = await fixture(t);
  const target = path.join(root, 'Downloads', 'My Games', folderName);
  await mkdir(target, { recursive: true });
  assert.equal(await findGameDirectory([root]), null);
  assert.equal(await findGameDirectory([target]), null);
});

test('matches Windows folder names regardless of case', async (t) => {
  const root = await fixture(t);
  const target = path.join(root, 'GAMES', 'my games', folderName.toLowerCase());
  await mkdir(target, { recursive: true });

  assert.equal(await findGameDirectory([root]), target);
});

test('ignores matching file names and unavailable disks', async (t) => {
  const root = await fixture(t);
  const parent = path.join(root, 'Games', 'My Games');
  await mkdir(parent, { recursive: true });
  await writeFile(path.join(parent, folderName), 'not a directory');

  assert.equal(
    await findGameDirectory([path.join(root, 'missing'), root]),
    null,
  );
});

test('does not follow directory links or junction loops', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(path.join(outside, 'My Games', folderName), { recursive: true });
  await symlink(outside, path.join(root, 'Games'), 'junction');
  await symlink(root, path.join(root, 'loop'), 'junction');

  assert.equal(await findGameDirectory([root]), null);
});

test('supports cancelling a scan when the app quits', async (t) => {
  const root = await fixture(t);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(findGameDirectory([root], controller.signal), {
    name: 'AbortError',
  });
});
