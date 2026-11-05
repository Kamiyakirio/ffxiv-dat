import { constants } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  lstat,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatWorkspace } from './dat-workspace.ts';
import { decodeDat } from './dat/decoder.ts';
import { createEditPlan } from './dat/editor.ts';
import {
  changePortraitData,
  decodePortraitCode,
  digest,
  exportPortraitCode,
  readPortraitData,
} from './portrait-data.ts';
import type {
  BackupLibrary,
  FolderBackup,
  PortraitCollection,
  PortraitWriteRequest,
} from '../../shared/management.ts';

type SnapshotFile = { path: string; sha256: string; byteLength: number };
type Manifest = FolderBackup & {
  format: 'ffxiv-folder-backup';
  version: 1;
  files: SnapshotFile[];
  directories: string[];
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const inside = (parent: string, child: string) =>
  child === parent ||
  (!path.relative(parent, child).startsWith(`..${path.sep}`) &&
    path.relative(parent, child) !== '..' &&
    !path.isAbsolute(path.relative(parent, child)));
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

async function regularFile(filename: string): Promise<Buffer> {
  if (
    (await lstat(filename)).isSymbolicLink() ||
    (await realpath(filename)) !== filename
  )
    throw new Error('文件位置已改变或是符号链接，已停止操作。');
  const handle = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new Error('配置路径不是普通文件。');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function writeNew(filename: string, bytes: Buffer, mode = 0o600) {
  const handle = await open(filename, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function inventory(directory: string) {
  const files: SnapshotFile[] = [],
    directories: string[] = [];
  async function walk(current: string) {
    if (
      (await realpath(current)) !== current ||
      (await lstat(current)).isSymbolicLink()
    )
      throw new Error('资料夹含符号链接，无法备份或还原。');
    for (const entry of (await readdir(current, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const filename = path.join(current, entry.name);
      const relative = path
        .relative(directory, filename)
        .split(path.sep)
        .join('/');
      if (entry.isSymbolicLink())
        throw new Error('资料夹含符号链接，请移除链接后重试。');
      if (entry.isDirectory()) {
        directories.push(relative);
        await walk(filename);
      } else if (entry.isFile()) {
        const bytes = await regularFile(filename);
        files.push({
          path: relative,
          sha256: digest(bytes),
          byteLength: bytes.length,
        });
      } else throw new Error('资料夹含不支持的特殊文件。');
    }
  }
  await walk(directory);
  return { files, directories };
}

function equalInventory(
  a: Awaited<ReturnType<typeof inventory>>,
  b: Awaited<ReturnType<typeof inventory>>,
) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeRelative(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !/[:]/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..') &&
    !path.isAbsolute(value)
  );
}

export class CharacterManager {
  private busy = false;
  private locations: Record<string, string> | null = null;
  constructor(
    private workspace: DatWorkspace,
    private settingsFile: string,
  ) {}

  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('正在保存或管理备份，请等待当前操作完成。');
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }

  private async settings() {
    if (!this.locations) {
      try {
        const data: unknown = JSON.parse(
          await readFile(this.settingsFile, 'utf8'),
        );
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('备份位置设置损坏，请检查设置文件。');
        this.locations = Object.fromEntries(
          Object.entries(data).filter(
            ([key, value]) =>
              path.isAbsolute(key) &&
              typeof value === 'string' &&
              path.isAbsolute(value),
          ),
        );
      } catch (error) {
        if (!absent(error)) throw error;
        this.locations = {};
      }
    }
    return this.locations;
  }

  private async location(gamePath: string) {
    await this.workspace.gameDirectory(gamePath);
    const locations = await this.settings();
    const library =
      locations[gamePath] ??
      path.join(path.dirname(gamePath), 'FFXIV DAT Backups');
    if (inside(gamePath, library) || inside(library, gamePath))
      throw new Error(
        '备份目录不能与游戏配置目录重叠，请选择独立的备份文件夹。',
      );
    return { path: library, custom: !!locations[gamePath] };
  }

  private async ensureLibrary(gamePath: string) {
    const library = await this.location(gamePath);
    await mkdir(library.path, { recursive: true });
    if ((await realpath(library.path)) !== library.path)
      throw new Error('备份目录位置已改变，请重新选择备份位置。');
    return library;
  }

  async setLocation(gamePath: string, selected: string | null) {
    await this.workspace.gameDirectory(gamePath);
    const locations = await this.settings();
    const next = { ...locations };
    if (selected) {
      const canonical = await realpath(selected);
      if (inside(gamePath, canonical) || inside(canonical, gamePath))
        throw new Error('请在游戏配置目录之外选择一个独立的备份文件夹。');
      next[gamePath] = canonical;
    } else delete next[gamePath];
    await mkdir(path.dirname(this.settingsFile), { recursive: true });
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    try {
      await writeNew(temporary, Buffer.from(JSON.stringify(next)));
      await rename(temporary, this.settingsFile);
      this.locations = next;
    } finally {
      await rm(temporary, { force: true });
    }
    return this.backups(gamePath);
  }

  private async readManifest(library: string, id: string): Promise<Manifest> {
    if (typeof id !== 'string' || !uuid.test(id))
      throw new Error('无效的备份编号。');
    const folder = path.join(library, id);
    if ((await realpath(folder)) !== folder)
      throw new Error('备份位置已改变。');
    const m = JSON.parse(
      (await regularFile(path.join(folder, 'manifest.json'))).toString('utf8'),
    ) as Manifest;
    if (
      m.format !== 'ffxiv-folder-backup' ||
      m.version !== 1 ||
      m.id !== id ||
      !/^[0-9A-F]{16}$/.test(m.characterId) ||
      typeof m.characterName !== 'string' ||
      typeof m.sourcePath !== 'string' ||
      !path.isAbsolute(m.sourcePath) ||
      path.basename(m.sourcePath).toUpperCase() !==
        `FFXIV_CHR${m.characterId}` ||
      !['manual', 'portrait-change', 'before-restore'].includes(m.reason) ||
      typeof m.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(m.createdAt)) ||
      !Array.isArray(m.files) ||
      !Array.isArray(m.directories) ||
      m.files.length !== m.fileCount ||
      !m.directories.every(safeRelative) ||
      !m.files.every(
        (f) =>
          safeRelative(f.path) &&
          /^[a-f0-9]{64}$/.test(f.sha256) &&
          Number.isSafeInteger(f.byteLength) &&
          f.byteLength >= 0,
      ) ||
      new Set([...m.directories, ...m.files.map((f) => f.path)]).size !==
        m.directories.length + m.files.length ||
      m.files.reduce((sum, f) => sum + f.byteLength, 0) !== m.byteLength
    )
      throw new Error('备份清单无效或不完整。');
    return m;
  }

  async backups(gamePath: string): Promise<BackupLibrary> {
    const library = await this.location(gamePath);
    const backups: FolderBackup[] = [],
      warnings: string[] = [];
    let entries;
    try {
      if ((await realpath(library.path)) !== library.path)
        throw new Error('备份目录位置已改变，请重新选择。');
      entries = await readdir(library.path, { withFileTypes: true });
    } catch (error) {
      if (absent(error)) return { ...library, backups, warnings };
      throw error;
    }
    for (const entry of entries) {
      if (!uuid.test(entry.name)) continue;
      try {
        const manifest = await this.readManifest(library.path, entry.name);
        if (path.dirname(manifest.sourcePath) !== gamePath) continue;
        const {
          files: _files,
          directories: _directories,
          format: _format,
          version: _version,
          ...summary
        } = manifest;
        void _files;
        void _directories;
        void _format;
        void _version;
        backups.push(summary);
      } catch {
        warnings.push(
          `备份 ${entry.name.slice(0, 8)} 无法读取，请检查备份文件。`,
        );
      }
    }
    return {
      ...library,
      backups: backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      warnings,
    };
  }

  private async copySnapshot(
    source: string,
    destination: string,
    snapshot: Awaited<ReturnType<typeof inventory>>,
  ) {
    await mkdir(destination);
    for (const directory of snapshot.directories)
      await mkdir(path.join(destination, directory), { recursive: true });
    for (const file of snapshot.files) {
      const bytes = await regularFile(path.join(source, file.path));
      if (bytes.length !== file.byteLength || digest(bytes) !== file.sha256)
        throw new Error('文件在操作期间被修改或备份已损坏，请关闭游戏后重试。');
      const output = path.join(destination, file.path);
      await mkdir(path.dirname(output), { recursive: true });
      await writeNew(output, bytes);
    }
  }

  private async backup(
    characterPath: string,
    reason: FolderBackup['reason'],
  ): Promise<Manifest> {
    const character = await this.workspace.characterDirectory(characterPath);
    const library = await this.ensureLibrary(path.dirname(characterPath));
    const id = randomUUID(),
      pending = path.join(library.path, `.pending-${id}`);
    const snapshot = await inventory(characterPath);
    const manifest: Manifest = {
      format: 'ffxiv-folder-backup',
      version: 1,
      id,
      characterId: character.contentId,
      characterName: character.names[0] ?? character.contentId,
      sourcePath: characterPath,
      createdAt: new Date().toISOString(),
      fileCount: snapshot.files.length,
      byteLength: snapshot.files.reduce((sum, f) => sum + f.byteLength, 0),
      reason,
      ...snapshot,
    };
    await mkdir(pending);
    try {
      await this.copySnapshot(
        characterPath,
        path.join(pending, 'data'),
        snapshot,
      );
      if (!equalInventory(snapshot, await inventory(characterPath)))
        throw new Error('角色资料夹在备份期间发生变化，请关闭游戏后重试。');
      await writeNew(
        path.join(pending, 'manifest.json'),
        Buffer.from(JSON.stringify(manifest, null, 2)),
      );
      await this.ensureLibrary(path.dirname(characterPath));
      await rename(pending, path.join(library.path, id));
      return manifest;
    } finally {
      await rm(pending, { recursive: true, force: true });
    }
  }

  async createBackups(characterPaths: string[]): Promise<FolderBackup[]> {
    if (
      !Array.isArray(characterPaths) ||
      !characterPaths.length ||
      characterPaths.length > 1000 ||
      new Set(characterPaths).size !== characterPaths.length
    )
      throw new Error('请选择需要备份的角色。');
    for (const p of characterPaths) await this.workspace.characterDirectory(p);
    const completed: FolderBackup[] = [];
    try {
      for (const p of characterPaths)
        completed.push(await this.backup(p, 'manual'));
    } catch (error) {
      throw new Error(
        `已完成 ${completed.length} 个资料夹备份；${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return completed;
  }

  async restore(gamePath: string, id: string) {
    const library = await this.ensureLibrary(gamePath);
    const manifest = await this.readManifest(library.path, id);
    if (path.dirname(manifest.sourcePath) !== gamePath)
      throw new Error('备份不属于当前配置目录。');
    const character = await this.workspace.characterDirectory(
      manifest.sourcePath,
    );
    if (character.contentId !== manifest.characterId)
      throw new Error('备份与角色不匹配。');
    const data = path.join(library.path, id, 'data');
    const snapshot = {
      files: manifest.files,
      directories: manifest.directories,
    };
    if (!equalInventory(snapshot, await inventory(data)))
      throw new Error('备份校验失败，文件缺失、被修改或含额外内容。');
    const token = randomUUID(),
      temporary = path.join(gamePath, `.ffxiv-restore-${token}`),
      previous = path.join(gamePath, `.ffxiv-previous-${token}`);
    let moved = false,
      installed = false;
    try {
      await this.copySnapshot(data, temporary, snapshot);
      const safety = await this.backup(character.path, 'before-restore');
      if (
        !equalInventory(
          { files: safety.files, directories: safety.directories },
          await inventory(character.path),
        )
      )
        throw new Error('角色资料夹已被修改，请关闭游戏后重新还原。');
      await this.workspace.characterDirectory(character.path);
      await rename(character.path, previous);
      moved = true;
      await rename(temporary, character.path);
      installed = true;
    } catch (error) {
      if (moved && !installed) {
        try {
          await rename(previous, character.path);
        } catch {
          throw new Error(`还原失败，原资料夹保留在 ${previous}，请手动恢复。`);
        }
      }
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
      if (installed)
        await rm(previous, { recursive: true, force: true }).catch(() => {});
    }
  }

  async deleteBackups(gamePath: string, ids: string[]) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 1000 ||
      new Set(ids).size !== ids.length
    )
      throw new Error('请选择有效的备份。');
    const library = await this.ensureLibrary(gamePath);
    for (const id of ids) {
      const m = await this.readManifest(library.path, id);
      if (path.dirname(m.sourcePath) !== gamePath)
        throw new Error('备份不属于当前配置目录。');
    }
    for (const id of ids) {
      await this.ensureLibrary(gamePath);
      const deleted = path.join(library.path, `.deleted-${id}`);
      await rename(path.join(library.path, id), deleted);
      await rm(deleted, { recursive: true, force: true });
    }
  }

  async backupLocation(gamePath: string) {
    return (await this.ensureLibrary(gamePath)).path;
  }

  private async source(characterPath: string) {
    const character = await this.workspace.characterDirectory(characterPath);
    const names = await readdir(character.path);
    const ui = names.find((n) => n.toUpperCase() === 'UISAVE.DAT');
    const gear = names.find((n) => n.toUpperCase() === 'GEARSET.DAT');
    const bytes = ui ? await regularFile(path.join(character.path, ui)) : null;
    const gearBytes = gear
      ? await regularFile(path.join(character.path, gear))
      : null;
    return {
      character,
      ui,
      gear,
      bytes,
      gearBytes,
      revision: digest(
        Buffer.concat([
          Buffer.from(ui ?? ''),
          Buffer.from([0]),
          bytes ?? Buffer.alloc(0),
          Buffer.from(gear ?? ''),
          Buffer.from([0]),
          gearBytes ?? Buffer.alloc(0),
        ]),
      ),
    };
  }

  async portraits(characterPath: string): Promise<PortraitCollection> {
    const source = await this.source(characterPath);
    const base = { characterPath, revision: source.revision, capacity: 110 };
    if (!source.bytes)
      return {
        ...base,
        available: false,
        portraits: [],
        warnings: ['在游戏中保存配置后刷新。'],
      };
    const data = readPortraitData(source.bytes);
    if (
      data.decoded.result.data.contentId !==
      BigInt(`0x${source.character.contentId}`).toString()
    )
      throw new Error(
        'UISAVE.DAT 的角色标识与资料夹不匹配，请在高级解析中检查。',
      );
    const gearData = source.gearBytes
      ? decodeDat(source.gearBytes, 'GEARSET.DAT')
      : null;
    const gears = Array.isArray(gearData?.result.data.records)
      ? (gearData.result.data.records as Record<string, unknown>[])
      : [];
    return {
      ...base,
      available: true,
      warnings: [],
      portraits: data.records.map((r) => ({
        ...r.summary,
        linkedGearsets: gears
          .filter(
            (g) =>
              g.exists &&
              g.isSavedGearsetSlot !== false &&
              g.bannerIndex === r.id,
          )
          .map((g) => String(g.name || `套装 ${Number(g.recordIndex) + 1}`)),
      })),
    };
  }

  async exportPortraits(
    characterPath: string,
    revision: string,
    ids: number[],
  ) {
    const current = await this.source(characterPath);
    if (!current.bytes || revision !== current.revision)
      throw new Error('文件已被修改，请刷新肖像列表后重试。');
    await this.portraits(characterPath);
    return exportPortraitCode(current.bytes, ids);
  }

  previewImport(code: string) {
    return {
      version: 1,
      portraits: decodePortraitCode(code).map((r) => r.summary),
    };
  }

  async writePortraits(
    request: PortraitWriteRequest,
  ): Promise<PortraitCollection> {
    if (
      !request ||
      typeof request.characterPath !== 'string' ||
      typeof request.revision !== 'string'
    )
      throw new Error('无效的肖像保存请求。');
    const source = await this.source(request.characterPath);
    if (!source.bytes || !source.ui || source.revision !== request.revision)
      throw new Error('文件已被游戏或其他程序修改，请刷新肖像列表后重试。');
    await this.portraits(request.characterPath);
    const updated = changePortraitData(source.bytes, request.change);
    const updates = [
      { name: source.ui, bytes: updated, original: source.bytes },
    ];
    if (request.change.type === 'delete' && source.gearBytes && source.gear) {
      const change = request.change;
      const gear = decodeDat(source.gearBytes, 'GEARSET.DAT');
      if (
        gear.header.version !== 110 ||
        gear.result.data.parseError ||
        !Array.isArray(gear.result.data.records)
      )
        throw new Error(
          '无法验证套装关联，暂不能删除肖像，请在高级解析中检查 GEARSET.DAT。',
        );
      const linked = (
        gear.result.data.records as Record<string, unknown>[]
      ).filter(
        (r) =>
          r.isSavedGearsetSlot && change.ids.includes(Number(r.bannerIndex)),
      );
      if (linked.length)
        updates.push({
          name: source.gear,
          original: source.gearBytes,
          bytes: createEditPlan(source.gearBytes, source.gear).apply(
            linked.map((r) => ({
              id: `gear.${r.recordIndex}.banner`,
              value: 0,
            })),
          ),
        });
    }
    if (updates.every((u) => u.bytes.equals(u.original)))
      return this.portraits(request.characterPath);
    const safety = await this.backup(request.characterPath, 'portrait-change');
    const staged: {
      filename: string;
      temporary: string;
      original: Buffer;
      installed: boolean;
    }[] = [];
    try {
      for (const update of updates) {
        const filename = path.join(source.character.path, update.name),
          temporary = `${filename}.tmp-${randomUUID()}`;
        staged.push({
          filename,
          temporary,
          original: update.original,
          installed: false,
        });
        await writeNew(
          temporary,
          update.bytes,
          (await lstat(filename)).mode & 0o777,
        );
      }
      if (
        (await this.source(request.characterPath)).revision !== request.revision
      )
        throw new Error('文件在保存期间被修改，请关闭游戏并刷新后重试。');
      for (const update of staged) {
        await rename(update.temporary, update.filename);
        update.installed = true;
      }
    } catch (error) {
      // Roll back earlier files if a later rename failed. The full snapshot remains available.
      for (const update of staged.filter((u) => u.installed)) {
        const rollback = `${update.filename}.rollback-${randomUUID()}`;
        try {
          await writeNew(rollback, update.original);
          await rename(rollback, update.filename);
        } catch {
          throw new Error(
            `保存未完成，请从资料夹备份恢复 ${safety.createdAt} 的自动备份。`,
          );
        } finally {
          await rm(rollback, { force: true });
        }
      }
      throw error;
    } finally {
      for (const update of staged) await rm(update.temporary, { force: true });
    }
    return this.portraits(request.characterPath);
  }
}
