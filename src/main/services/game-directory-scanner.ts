import { readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const targetFolders = ['my games', 'final fantasy xiv - a realm reborn'];
const concurrency = 16;

function getDiskRoots(): string[] {
  const home = os.homedir();
  const common = ['Documents', 'Downloads', 'OneDrive/Documents'].map(
    (folder) =>
      path.join(home, folder, 'My Games', 'FINAL FANTASY XIV - A Realm Reborn'),
  );
  if (process.platform !== 'win32')
    return [
      ...common,
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
    ];

  return [
    ...common,
    ...Array.from(
      { length: 26 },
      (_, index) => `${String.fromCharCode(65 + index)}:\\`,
    ),
  ];
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

export async function findGameDirectories(
  roots?: string[],
  signal?: AbortSignal,
  preferredLocations: string[] = [],
): Promise<string[]> {
  const locations = [...preferredLocations, ...(roots ?? getDiskRoots())];
  const found = new Set<string>();
  for (const directory of locations) {
    signal?.throwIfAborted();
    if (matchesTarget(directory)) {
      try {
        await readdir(directory);
        found.add(directory);
      } catch {
        /* Unavailable default locations are expected. */
      }
    }
  }
  signal?.throwIfAborted();
  if (found.size) return [...found];
  let pending = locations.map((directory) => ({ directory, depth: 0 }));
  let cursor = 0;

  while (cursor < pending.length) {
    signal?.throwIfAborted();

    const batch = pending.slice(cursor, cursor + concurrency);
    cursor += batch.length;

    const directories = (
      await Promise.all(
        batch.map(async ({ directory, depth }) => {
          if (roots === undefined && depth >= 5) return [];
          return (await readDirectories(directory))
            .filter((child) => {
              const name = path.basename(child);
              return (
                !name.startsWith('.') &&
                ![
                  'node_modules',
                  'Windows',
                  'Program Files',
                  'Library',
                ].includes(name)
              );
            })
            .map((child) => ({ directory: child, depth: depth + 1 }));
        }),
      )
    ).flat();
    signal?.throwIfAborted();
    for (const entry of directories) {
      if (matchesTarget(entry.directory)) found.add(entry.directory);
      else pending.push(entry);
    }

    // Release visited paths instead of retaining the entire disk inventory.
    if (cursor >= 4096) {
      pending = pending.slice(cursor);
      cursor = 0;
    }
  }

  return [...found];
}

export async function findGameDirectory(
  roots?: string[],
  signal?: AbortSignal,
): Promise<string | null> {
  return (await findGameDirectories(roots, signal))[0] ?? null;
}
