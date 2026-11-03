import { readdir } from 'node:fs/promises';
import path from 'node:path';

const targetFolders = [
  'game',
  'my games',
  'final fantasy xiv - a realm reborn',
];
const concurrency = 16;

function getDiskRoots(): string[] {
  if (process.platform !== 'win32') return ['/'];

  return Array.from(
    { length: 26 },
    (_, index) => `${String.fromCharCode(65 + index)}:\\`,
  );
}

function matchesTarget(directory: string): boolean {
  let current = directory;

  for (const folder of targetFolders.toReversed()) {
    if (path.basename(current).toLowerCase() !== folder) return false;
    current = path.dirname(current);
  }

  return true;
}

async function readDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    // Protected folders, absent drives and directories removed during a scan
    // should not prevent the remaining disks from being searched.
    if (
      [
        'EACCES',
        'EPERM',
        'ENOENT',
        'ENOTDIR',
        'EBUSY',
        'EIO',
        'ENODEV',
      ].includes(code ?? '')
    ) {
      return [];
    }

    throw error;
  }
}

export async function findGameDirectory(
  roots: string[] = getDiskRoots(),
  signal?: AbortSignal,
): Promise<string | null> {
  let pending = [...roots];
  let cursor = 0;

  while (cursor < pending.length) {
    signal?.throwIfAborted();

    const batch = pending.slice(cursor, cursor + concurrency);
    cursor += batch.length;

    const directories = (await Promise.all(batch.map(readDirectories))).flat();
    signal?.throwIfAborted();
    const match = directories.find(matchesTarget);

    if (match) return match;

    for (const directory of directories) pending.push(directory);

    // Release visited paths instead of retaining the entire disk inventory.
    if (cursor >= 4096) {
      pending = pending.slice(cursor);
      cursor = 0;
    }
  }

  return null;
}
