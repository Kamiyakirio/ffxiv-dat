import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
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
import type {
  GameDirectory,
  CharacterDirectory,
  DecodedFileSummary,
  DecodedFileDetail,
  DecodeProgress,
  DecodeReport,
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
