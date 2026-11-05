import {
  readdir,
  readFile,
  realpath,
  open,
  rename,
  unlink,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { randomUUID, createHash } from 'node:crypto';
import { decodeDat } from './dat/decoder.ts';
import type { DecodedDat } from './dat/decoder.ts';
import {
  equipmentSlotName,
  gameName,
  itemName,
  linkHotbarReferences,
  enrichDecodedData,
} from './dat/game-data.ts';
import { readableSections } from './dat/readable.ts';
import { coverageStatus } from './dat/coverage.ts';
import { createEditPlan } from './dat/editor.ts';
import { linkBannerEquipment } from './dat/banner-equipment.ts';
import type {
  GameDirectory,
  CharacterDirectory,
  DecodedFileSummary,
  DecodedFileDetail,
  DecodeProgress,
  DecodeReport,
  DatEditModel,
  DatEditRequest,
  DatSaveResult,
} from '../../shared/types.ts';

const characterPattern = /^FFXIV_CHR([0-9a-f]{16})$/i;

async function datFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.dat$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (characterPattern.test(entry.name) ||
        ['backup', 'cfgcopy'].includes(entry.name.toLowerCase()))
    ) {
      files.push(...(await datFiles(path.join(directory, entry.name))));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export class DatWorkspace {
  private directories = new Map<string, GameDirectory>();
  private results = new Map<string, DecodedFileDetail>();
  private sourceFiles = new Map<string, { file: string; directory: string }>();
  private saving = false;

  private target(id: string) {
    const detail = this.getResult(id);
    const members: string[] = [];
    let root = detail;
    while (root.summary.parentId) {
      members.unshift(root.summary.name);
      root = this.getResult(root.summary.parentId);
    }
    const source = this.sourceFiles.get(root.summary.id);
    if (!source) throw new Error('文件结果已失效，请重新解码。');
    return { detail, root, members, ...source };
  }

  private async currentSource(id: string) {
    const target = this.target(id);
    if (
      (await realpath(target.file)) !== target.file ||
      (await realpath(target.directory)) !== target.directory
    )
      throw new Error('文件位置已改变，请重新选择目录。');
    const bytes = await readFile(target.file);
    if (createHash('sha256').update(bytes).digest('hex') !== target.root.sha256)
      throw new Error('文件已被游戏或其他程序修改，请重新解码后再编辑。');
    return { ...target, bytes };
  }

  async edit(id: string): Promise<DatEditModel> {
    const target = await this.currentSource(id);
    let decoded = decodeDat(target.bytes, target.file);
    let bytes = target.bytes;
    for (const name of target.members) {
      const member = decoded.members.find((member) => member.name === name);
      if (!member) throw new Error('备份成员已改变，请重新解码。');
      bytes = bytes.subarray(member.offset, member.offset + member.length);
      decoded = member.decoded;
    }
    const plan = createEditPlan(bytes, target.detail.summary.name);
    return {
      id,
      sha256: target.detail.sha256,
      fields: plan.fields,
      notes: plan.notes,
    };
  }

  async save(request: DatEditRequest): Promise<DatSaveResult> {
    if (this.saving) throw new Error('正在保存，请等待完成。');
    this.saving = true;
    let temporary: string | undefined;
    try {
      const target = await this.currentSource(request.id);
      if (request.sha256 !== target.detail.sha256)
        throw new Error('编辑结果已失效，请重新打开编辑器。');
      if (!Array.isArray(request.changes) || !request.changes.length)
        throw new Error('没有需要保存的修改。');
      const rewrite = (
        bytes: Buffer,
        filename: string,
        members: string[],
      ): Buffer => {
        if (!members.length)
          return createEditPlan(bytes, filename).apply(request.changes);
        const decoded = decodeDat(bytes, filename);
        const member = decoded.members.find((m) => m.name === members[0]);
        if (!member) throw new Error('备份成员不存在。');
        const updated = rewrite(
          bytes.subarray(member.offset, member.offset + member.length),
          member.name,
          members.slice(1),
        );
        const output = Buffer.concat([
          bytes.subarray(0, member.offset),
          updated,
          bytes.subarray(member.offset + member.length),
        ]);
        const system = decoded.header.format === 'system-backup';
        const index = system
          ? 0
          : [
              'COMMON.DAT',
              'CONTROL0.DAT',
              'CONTROL1.DAT',
              'MACRO.DAT',
              'ADDON.DAT',
              'UISAVE.DAT',
              'GEARSET.DAT',
              'KEYBIND.DAT',
              'HOTBAR.DAT',
              'LOGFLTR.DAT',
              'GS.DAT',
              'ACQ.DAT',
              'ITEMFDR.DAT',
              'ITEMODR.DAT',
            ].indexOf(member.name);
        if (index < 0) throw new Error('未验证的备份成员。');
        output.writeUInt32LE(updated.length, (system ? 40 : 48) + index * 4);
        output.writeUInt32LE(
          output.length - Number(decoded.header.headerLength),
          system ? 36 : 44,
        );
        const check = decodeDat(output, filename);
        if (
          check.result.data.parseError ||
          check.members.length !== decoded.members.length
        )
          throw new Error('备份容器写回校验失败。');
        return output;
      };
      const updated = rewrite(target.bytes, target.file, target.members);
      if (updated.equals(target.bytes))
        throw new Error('修改后的文件与原文件相同，无需保存。');
      const metadata = await stat(target.file);
      const backupPath = `${target.file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      const backup = await open(backupPath, 'wx', 0o600);
      try {
        await backup.writeFile(target.bytes);
        await backup.sync();
      } finally {
        await backup.close();
      }
      temporary = `${target.file}.tmp-${randomUUID()}`;
      const handle = await open(temporary, 'wx', metadata.mode & 0o777);
      try {
        await handle.writeFile(updated);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Recheck immediately before replacing the original; never save over an external update.
      await this.currentSource(request.id);
      await rename(temporary, target.file);
      temporary = undefined;
      const relativePath = target.detail.summary.relativePath;
      const report = await this.decode(
        target.directory,
        new AbortController().signal,
        () => {},
      );
      const selectedId =
        report.files.find((f) => f.relativePath === relativePath)?.id ?? '';
      return { report, selectedId, backupPath };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      this.saving = false;
    }
  }

  async locate(selected: string): Promise<GameDirectory> {
    let directory = await realpath(selected);
    if (characterPattern.test(path.basename(directory)))
      directory = path.dirname(directory);
    let entries = await readdir(directory, { withFileTypes: true });
    if (
      !entries.some(
        (entry) => entry.isDirectory() && characterPattern.test(entry.name),
      )
    ) {
      const gameFolder = entries.find(
        (entry) =>
          entry.isDirectory() &&
          entry.name.toLowerCase() === 'final fantasy xiv - a realm reborn',
      );
      if (gameFolder) {
        directory = await realpath(path.join(directory, gameFolder.name));
        entries = await readdir(directory, { withFileTypes: true });
      }
    }
    const characters: CharacterDirectory[] = [];
    for (const entry of entries) {
      const match = characterPattern.exec(entry.name);
      if (!entry.isDirectory() || !match) continue;
      const characterPath = path.join(directory, entry.name);
      characters.push({
        path: characterPath,
        contentId: match[1].toUpperCase(),
        names: [],
        fileCount: (await datFiles(characterPath)).length,
      });
    }
    if (!characters.length)
      throw new Error(
        '未找到角色配置。请选择包含 FFXIV_CHR 文件夹的目录，或直接选择角色文件夹。',
      );
    const files = await datFiles(directory);
    for (const file of files.filter(
      (file) => path.basename(path.dirname(file)).toLowerCase() === 'cfgcopy',
    )) {
      try {
        const result = decodeDat(await readFile(file), path.basename(file))
          .result.data;
        const character = characters.find(
          (character) =>
            character.contentId === String(result.contentIdHex).toUpperCase(),
        );
        if (
          character &&
          typeof result.name === 'string' &&
          result.name &&
          !character.names.includes(result.name)
        )
          character.names.push(result.name);
      } catch {
        /* A damaged nickname cache must not hide the character. */
      }
    }
    const result = {
      path: directory,
      characters: characters.sort((a, b) =>
        a.contentId.localeCompare(b.contentId),
      ),
      fileCount: files.length,
    };
    this.directories.set(directory, result);
    return result;
  }

  canReveal(directory: string): boolean {
    return (
      this.directories.has(directory) ||
      [...this.directories.values()].some((root) =>
        root.characters.some((character) => character.path === directory),
      )
    );
  }

  getResult(id: string): DecodedFileDetail {
    const result = this.results.get(id);
    if (!result) throw new Error('这份结果已失效，请重新开始解码。');
    result.readable ??= readableSections(result);
    return result;
  }

  async decode(
    directory: string,
    signal: AbortSignal,
    onProgress: (progress: DecodeProgress) => void,
  ): Promise<DecodeReport> {
    if (!this.directories.has(directory))
      throw new Error('请先扫描或选择游戏配置目录。');
    // Re-resolve the selected directory before opening files, including symlink changes.
    if ((await realpath(directory)) !== directory)
      throw new Error('目录位置已改变，请重新选择。');
    const sources = await datFiles(directory);
    this.results.clear();
    this.sourceFiles.clear();
    const files: DecodedFileSummary[] = [];
    const runId = randomUUID();
    let processed = 0;
    const add = (
      decoded: DecodedDat,
      relativePath: string,
      parentId: string | null,
      category: DecodedFileSummary['category'],
      characterId: string | null,
    ) => {
      const id = `${runId}:${files.length}`;
      const error =
        typeof decoded.result.data.parseError === 'string'
          ? decoded.result.data.parseError
          : null;
      const summary: DecodedFileSummary = {
        id,
        name: path.basename(decoded.filename),
        relativePath,
        characterId,
        category,
        parentId,
        byteLength: decoded.byteLength,
        status: error
          ? 'error'
          : decoded.result.status === 'unsupported'
            ? 'unsupported'
            : decoded.result.coverage
              ? coverageStatus(decoded.result.coverage)
              : decoded.result.status,
        warningCount: decoded.result.warnings.length,
        error,
      };
      files.push(summary);
      this.results.set(id, {
        summary,
        header: decoded.header,
        data: decoded.result.data,
        checks: decoded.checks,
        warnings: decoded.result.warnings,
        sha256: decoded.sha256,
        coverage: decoded.result.coverage,
      });
      if (!parentId)
        this.sourceFiles.set(id, {
          file: path.join(directory, relativePath),
          directory,
        });
      for (const member of decoded.members)
        add(
          member.decoded,
          `${relativePath} / ${member.name}`,
          id,
          'backup',
          characterId,
        );
    };
    for (const file of sources) {
      if (signal.aborted) break;
      const relativePath = path.relative(directory, file);
      onProgress({
        current: processed,
        total: sources.length,
        filename: relativePath,
      });
      await setImmediate();
      if (signal.aborted) break;
      const characterId =
        characterPattern
          .exec(relativePath.split(path.sep)[0])?.[1]
          .toUpperCase() ?? null;
      const category = characterId
        ? 'character'
        : relativePath.toLowerCase().startsWith(`backup${path.sep}`)
          ? 'backup'
          : relativePath.toLowerCase().startsWith(`cfgcopy${path.sep}`)
            ? 'config-copy'
            : 'shared';
      try {
        const bytes = await readFile(file);
        add(
          decodeDat(bytes, relativePath),
          relativePath,
          null,
          category,
          characterId,
        );
      } catch (error) {
        const id = `${runId}:${files.length}`;
        const message = error instanceof Error ? error.message : String(error);
        const summary: DecodedFileSummary = {
          id,
          name: path.basename(file),
          relativePath,
          characterId,
          category,
          parentId: null,
          byteLength: 0,
          status: 'error',
          warningCount: 0,
          error: message,
        };
        files.push(summary);
        this.results.set(id, {
          summary,
          header: {},
          data: {},
          checks: [],
          warnings: [],
          sha256: '',
        });
      }
      processed++;
      onProgress({
        current: processed,
        total: sources.length,
        filename: relativePath,
      });
    }
    for (const file of files) {
      const detail = this.results.get(file.id);
      if (!detail) continue;
      enrichDecodedData(detail.data, file.name);
      if (
        file.name.toUpperCase() === 'GEARSET.DAT' &&
        Array.isArray(detail.data.records)
      ) {
        for (const record of detail.data.records) {
          record.classJobName = gameName('ClassJob', record.classJobId);
          record.glassesNames = (record.glassesIds ?? []).map((id: number) =>
            id ? (gameName('Glasses', id) ?? `眼镜 ${id}`) : '无',
          );
          for (const item of record.items ?? []) {
            item.slotLabel = equipmentSlotName(item.slot);
            item.stainNames = (item.stainIds ?? []).map((id: number) =>
              id === 0 ? '无染色' : (gameName('Stain', id) ?? `染色 ${id}`),
            );
            item.materiaDetails = (item.materia ?? [])
              .filter((value: { id: number }) => value.id !== 0)
              .map((value: { id: number; grade: number }) => ({
                ...value,
                name:
                  gameName('MateriaGrade', `${value.id}:${value.grade}`) ??
                  gameName('MateriaEffect', `${value.id}:${value.grade}`) ??
                  `未关联参数 ${value.id} / 保存等级 ${value.grade}`,
                effect: gameName('MateriaEffect', `${value.id}:${value.grade}`),
              }));
            item.itemName = itemName(item.itemId);
            item.glamourName = item.glamourId
              ? itemName(item.glamourId)
              : '未投影';
          }
        }
      }
      const related = (name: string, field: string) => {
        const summary = files.find(
          (entry) =>
            entry.name.toUpperCase() === name &&
            entry.parentId === file.parentId &&
            entry.characterId === file.characterId,
        );
        const value = summary
          ? this.results.get(summary.id)?.data[field]
          : null;
        return Array.isArray(value) ? value : [];
      };
      if (
        file.name.toUpperCase() === 'HOTBAR.DAT' &&
        Array.isArray(detail.data.slots)
      ) {
        linkHotbarReferences(
          detail.data.slots,
          related('MACRO.DAT', 'macros'),
          related('GEARSET.DAT', 'records'),
        );
      }
      if (
        file.name.toUpperCase() === 'UISAVE.DAT' &&
        Array.isArray(detail.data.segments)
      ) {
        linkBannerEquipment(
          detail.data.segments,
          related('GEARSET.DAT', 'records'),
        );
        for (const segment of detail.data.segments) {
          if (segment.id !== 41 || !Array.isArray(segment.data.panels))
            continue;
          for (const panel of segment.data.panels)
            linkHotbarReferences(
              panel.slots,
              related('MACRO.DAT', 'macros'),
              related('GEARSET.DAT', 'records'),
            );
        }
      }
    }
    return {
      files,
      processed,
      total: sources.length,
      cancelled: signal.aborted && processed < sources.length,
    };
  }
}
