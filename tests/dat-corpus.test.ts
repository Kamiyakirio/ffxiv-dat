import type { BrowserNode } from '../src/renderer/components/browser-model.ts';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatWorkspace } from '../src/main/services/dat-workspace.ts';
import {
  changePortraitData,
  exportPortraitCode,
  readPortraitData,
} from '../src/main/services/portrait-data.ts';
import {
  buildFileNode,
  resolveNode,
  hasTarget,
} from '../src/renderer/components/browser-model.ts';
import {
  expectRecord,
  expectRecords,
  expectDefined,
} from './helpers/assertions.ts';

const corpusPath = path.join(os.homedir(), 'Downloads', 'My Games');

test(
  'real portraits export and overwrite in memory without changing a single UISAVE byte',
  {
    skip:
      !existsSync(corpusPath) && '真实 DAT 语料未提供；本地只读回归未执行。',
  },
  async (t) => {
    const workspace = new DatWorkspace();
    const directory = await workspace.locate(corpusPath);
    let portraits = 0;
    for (const character of directory.characters) {
      const filename = path.join(character.path, 'UISAVE.DAT');
      const bytes = await readFile(filename);
      const ids = readPortraitData(bytes).records.map((record) => record.id);
      if (!ids.length) continue;
      const code = exportPortraitCode(bytes, ids);
      assert(!code.includes(':'));
      const result = changePortraitData(bytes, {
        type: 'import',
        code,
        mode: 'overwrite',
        targetIds: ids,
      });
      assert.deepEqual(result, bytes);
      assert.deepEqual(await readFile(filename), bytes);
      portraits += ids.length;
    }
    t.diagnostic(
      `只读肖像回归：${directory.characters.length} 个角色，${portraits} 个肖像，分享码往返结果逐字节一致。`,
    );
  },
);

// Report file kinds only. Backup/config-copy filenames themselves contain IDs.
function fileKind(filename: string) {
  const name = path.basename(filename).toUpperCase();
  if (/^FFXIV_BKCHR/.test(name)) return 'FFXIV_BKCHR*.DAT';
  if (/^FFXIV_BKSYS/.test(name)) return 'FFXIV_BKSYS*.DAT';
  if (/^FFXIV_CFGCPY/.test(name)) return 'FFXIV_CFGCPY*.DAT';
  if (/^FFXIV_CHARA_/.test(name)) return 'FFXIV_CHARA_*.DAT';
  return name;
}
async function datFiles(directory: string): Promise<string[]> {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await datFiles(filename)));
    else if (entry.isFile() && /\.dat$/i.test(entry.name)) files.push(filename);
  }
  return files.sort();
}
async function digest(filename: string) {
  return createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
}
const placeholderKinds: [string, RegExp][] = [
  [
    'unresolved-name',
    /未收录名称|未关联(?:名称|参数)|名称待核对|未识别界面|未知(?:物品|技能|命令|职业|表情|坐骑|名称)/u,
  ],
  [
    'uncertain-meaning',
    /候选|待核对|待确认|待核实|尚未确认|业务含义|未定义保存值|未知(?:状态|类型|编号|枚举)/u,
  ],
  [
    'numeric-reference-fallback',
    /^(?:职业|物品|技能|表情|坐骑|染色|眼镜|动作|界面项)\s*#?\s*\d+$/u,
  ],
];

// This is a structural/readability regression against user-provided local data,
// not a claim that diagnostic semantic gaps have been resolved. No files or
// private sample data are written, copied into the repository, or logged.
test(
  'real DAT corpus is read without structural loss, broken navigation identities or source mutation',
  {
    skip:
      !existsSync(corpusPath) && '真实 DAT 语料未提供；本地只读回归未执行。',
  },
  async (t) => {
    const workspace = new DatWorkspace();
    const directory = await workspace.locate(corpusPath);
    const sources = await datFiles(directory.path);
    assert(sources.length > 0, '真实语料目录中没有 DAT 文件。');
    const before = new Map(
      await Promise.all(
        sources.map(async (filename): Promise<[string, string]> => [
          filename,
          await digest(filename),
        ]),
      ),
    );
    const diagnostics = new Map<
      string,
      {
        files: number;
        meaning: number;
        reference: number;
        candidate: number;
        placeholders: Record<string, number>;
        readOnlyCategories: number;
        unmatchedEditTargets: number;
      }
    >();
    let recordCount = 0,
      listCount = 0;
    const countsFor = (kind: string) => {
      if (!diagnostics.has(kind))
        diagnostics.set(kind, {
          files: 0,
          meaning: 0,
          reference: 0,
          candidate: 0,
          placeholders: {},
          readOnlyCategories: 0,
          unmatchedEditTargets: 0,
        });
      return expectDefined(diagnostics.get(kind));
    };
    try {
      const report = await workspace.decode(
        directory.path,
        new AbortController().signal,
        () => {},
      );
      assert.equal(report.cancelled, false, '真实语料解码不应被取消。');
      assert.equal(
        report.processed,
        sources.length,
        '源 DAT 文件存在未被工作区读取的条目。',
      );
      const sourceSet = new Set(
        sources.map((filename) => path.relative(directory.path, filename)),
      );
      const sourceResults = report.files.filter((file) => !file.parentId);
      assert.equal(
        sourceResults.length,
        sourceSet.size,
        '源 DAT 文件结果数量不完整。',
      );
      for (const file of sourceResults)
        assert(
          sourceSet.has(file.relativePath),
          `${fileKind(file.name)}：源文件结果身份不匹配。`,
        );
      const resultCount = report.files.length;
      for (const file of report.files) {
        const kind = fileKind(file.name),
          counts = countsFor(kind);
        counts.files++;
        assert(
          !file.error && file.status !== 'error',
          `${kind}：文件或备份成员解码报错。`,
        );
        assert.notEqual(
          file.status,
          'unsupported',
          `${kind}：文件或备份成员尚不支持。`,
        );
        const detail = workspace.getResult(file.id),
          seen = new WeakSet();
        function checkParsed(value: unknown) {
          if (!value || typeof value !== 'object' || seen.has(value)) return;
          seen.add(value);
          const parsed: Record<string, unknown> = Array.isArray(value)
            ? {}
            : expectRecord(value);
          assert(!parsed.parseError, `${kind}：存在内部解析错误。`);
          assert(
            !['error', 'unsupported'].some(
              (status) => status === parsed.status,
            ),
            `${kind}：存在内部不支持或错误的解析对象。`,
          );
          assert.notEqual(
            parsed.completeContainer,
            false,
            `${kind}：存在未完整读取的容器。`,
          );
          for (const child of Object.values(value)) checkParsed(child);
        }
        checkParsed(detail.data);
        const coverage = detail.coverage;
        counts.candidate += coverage?.candidateFields.length ?? 0;
        for (const unknown of coverage?.unknownFields ?? []) {
          if (unknown.kind === 'meaning') counts.meaning++;
          if (unknown.kind === 'reference') counts.reference++;
        }
        for (const section of detail.readable ?? []) {
          if (section.sourceKeys) {
            assert.equal(
              section.sourceKeys.length,
              section.rows.length,
              `${kind}：可读行与原始身份索引数量不一致。`,
            );
            assert(
              section.sourceKeys.every(
                (key) =>
                  typeof key === 'string' &&
                  key.length > 0 &&
                  !/undefined|NaN/.test(key),
              ),
              `${kind}：存在缺失的原始行身份。`,
            );
          }
          if (section.sourceId !== undefined)
            assert(
              expectRecords(detail.data.segments ?? []).some(
                (segment) => String(segment.id) === section.sourceId,
              ),
              `${kind}：可读子类别缺少原始子段。`,
            );
        }
        const root = buildFileNode(detail);
        const editableNodes: BrowserNode[] = [];
        function inspectText(value: unknown) {
          if (typeof value !== 'string') return;
          for (const [category, pattern] of placeholderKinds)
            if (pattern.test(value))
              counts.placeholders[category] =
                (counts.placeholders[category] ?? 0) + 1;
        }
        function visit(node: BrowserNode, route: string[]) {
          assert(
            typeof node.key === 'string' &&
              node.key.length > 0 &&
              !/undefined|NaN/.test(node.key),
            `${kind}：存在不可用的导航身份。`,
          );
          inspectText(node.title);
          inspectText(node.description);
          for (const section of node.sections ?? [])
            for (const row of section.rows)
              for (const value of Object.values(row)) inspectText(value);
          if (node.readOnlyData) counts.readOnlyCategories++;
          if (
            hasTarget(node.editTarget) &&
            (node.kind === 'record' || !node.children?.length)
          )
            editableNodes.push(node);
          if (node.kind === 'record') {
            recordCount++;
            assert(
              node.raw !== undefined || hasTarget(node.editTarget),
              `${kind}：可读记录缺少原始数据或编辑身份。`,
            );
            assert.equal(
              resolveNode(root, route).node,
              node,
              `${kind}：记录无法通过其原始导航身份定位。`,
            );
          }
          const children = node.children ?? [];
          if (children.length) listCount++;
          assert.equal(
            new Set(children.map((child) => child.key)).size,
            children.length,
            `${kind}：导航树同级记录身份重复。`,
          );
          for (const child of children) visit(child, [...route, child.key]);
        }
        visit(root, []);
        if (editableNodes.length) {
          const model = await workspace.edit(file.id);
          const fieldIds = model.fields.map((field) => field.id).sort(),
            exact = new Set(fieldIds);
          const hasPrefix = (prefix: string) => {
            let start = 0,
              end = fieldIds.length;
            while (start < end) {
              const middle = (start + end) >>> 1;
              if (fieldIds[middle] < prefix) start = middle + 1;
              else end = middle;
            }
            return fieldIds[start]?.startsWith(prefix) ?? false;
          };
          for (const node of editableNodes) {
            const target = expectDefined(node.editTarget);
            const matched =
              target.ids?.some((id) => exact.has(id)) ||
              target.prefixes?.some(hasPrefix);
            if (!matched) counts.unmatchedEditTargets++;
          }
        }
      }
      t.diagnostic(
        `实际语料：源文件 ${sources.length}，含备份成员结果 ${resultCount}，导航列表 ${listCount}，可读记录 ${recordCount}。`,
      );
      t.diagnostic(
        '以下仅为未解决缺口的计数诊断；测试通过不表示这些字段含义或名称已经补全。',
      );
      for (const [kind, counts] of [...diagnostics].sort(([a], [b]) =>
        a.localeCompare(b),
      ))
        t.diagnostic(JSON.stringify({ file: kind, ...counts }));
      assert(
        [...diagnostics.values()].every(
          (counts) => counts.unmatchedEditTargets === 0,
        ),
        '存在可读编辑入口没有对应原始可写字段；详见按文件种类汇总的身份缺口计数。',
      );
    } finally {
      const after = await datFiles(directory.path);
      assert.equal(
        after.length,
        before.size,
        '只读检查期间源 DAT 文件数量改变。',
      );
      for (const filename of after)
        assert(
          before.has(filename) &&
            before.get(filename) === (await digest(filename)),
          `${fileKind(filename)}：只读检查期间源文件内容改变。`,
        );
    }
  },
);
