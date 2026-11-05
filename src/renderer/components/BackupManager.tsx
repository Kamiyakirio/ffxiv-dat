import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDirectory } from '../../shared/types';
import type { BackupLibrary } from '../../shared/management';
import {
  Icon,
  SelectAll,
  characterName,
  dateLabel,
  sizeLabel,
} from './management-ui';
import type { RunTask } from './management-ui';

const reasons = {
  manual: '手动备份',
  'portrait-change': '肖像修改前',
  'before-restore': '还原前备份',
};

export default function BackupManager({
  active,
  directory,
  busy,
  run,
  onError,
  notify,
  onChanged,
}: {
  active: boolean;
  directory: GameDirectory;
  busy: boolean;
  run: RunTask;
  onError: (error: unknown) => void;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [library, setLibrary] = useState<BackupLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [characterPaths, setCharacterPaths] = useState<string[]>([]);
  const [backupIds, setBackupIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const serial = useRef({ value: 0 });
  const blocked = busy || loading;
  const backups =
    library?.backups.filter(
      (b) =>
        (filter === 'all' || b.sourcePath === filter) &&
        (sourceFilter === 'all' || b.reason === sourceFilter),
    ) ?? [];
  const load = useCallback(() => {
    const request = ++serial.current.value;
    return window.characterManager
      .backups(directory.path)
      .then(
        (value) => {
          if (request !== serial.current.value) return;
          setLibrary(value);
          setFailed(false);
          setBackupIds([]);
        },
        (reason) => {
          if (request !== serial.current.value) return;
          onError(reason);
          setFailed(true);
        },
      )
      .finally(() => {
        if (request === serial.current.value) setLoading(false);
      });
  }, [directory.path, onError]);
  useEffect(() => {
    const generation = serial.current;
    if (active) void load();
    return () => {
      generation.value++;
    };
  }, [load, active]);

  function reload() {
    setLoading(true);
    setFailed(false);
    void load();
  }

  async function refresh() {
    setLibrary(await window.characterManager.backups(directory.path));
    setBackupIds([]);
  }
  const latest = (characterPath: string) =>
    library?.backups.find((b) => b.sourcePath === characterPath);

  return (
    <div className="manager-content">
      <header className="manager-heading">
        <div>
          <h2>资料夹备份</h2>
        </div>
        <button disabled={blocked} onClick={reload}>
          刷新备份
        </button>
      </header>
      <section className="backup-location" aria-label="备份存放位置">
        <Icon name="folder" />
        <div>
          <h3>
            备份存放位置{' '}
            <span className="muted">
              {library?.custom ? '自定义位置' : '默认位置'}
            </span>
          </h3>
          <p className="path-value">{library?.path ?? '正在读取备份位置…'}</p>
          <p className="muted">更改位置不会移动已有备份。</p>
        </div>
        <div className="button-group">
          <button
            disabled={blocked || !library}
            onClick={() =>
              void run('正在打开备份目录…', () =>
                window.characterManager.revealBackupLocation(directory.path),
              )
            }
          >
            打开目录
          </button>
          <button
            disabled={blocked}
            onClick={() =>
              void run('正在选择备份位置…', async () => {
                const result =
                  await window.characterManager.chooseBackupLocation(
                    directory.path,
                  );
                if (result) {
                  setLibrary(result);
                  setBackupIds([]);
                  notify('备份位置已更改。');
                }
              })
            }
          >
            更改位置
          </button>
          {library?.custom && (
            <button
              disabled={blocked}
              onClick={() =>
                void run('正在切换备份位置…', async () => {
                  setLibrary(
                    await window.characterManager.resetBackupLocation(
                      directory.path,
                    ),
                  );
                  setBackupIds([]);
                  notify('已恢复默认备份位置。');
                })
              }
            >
              使用默认位置
            </button>
          )}
        </div>
      </section>
      {library?.warnings.map((warning) => (
        <p className="inline-notice" key={warning}>
          {warning}
        </p>
      ))}
      <section className="backup-characters" aria-label="备份角色资料夹">
        <div className="section-heading">
          <h3>角色资料夹</h3>
          <button
            className="primary-button"
            disabled={blocked || !characterPaths.length || failed}
            onClick={() =>
              void run('正在备份资料夹…', async () => {
                try {
                  await window.characterManager.createBackups(characterPaths);
                } catch (error) {
                  await refresh();
                  throw error;
                }
                await refresh();
                notify(`已备份 ${characterPaths.length} 个角色资料夹。`);
                setCharacterPaths([]);
              })
            }
          >
            备份所选
            {characterPaths.length > 0 ? `（${characterPaths.length}）` : ''}
          </button>
        </div>
        <div className="manager-table-scroll">
          <table className="manager-table">
            <thead>
              <tr>
                <th className="check-column">
                  <SelectAll
                    label="全选角色资料夹"
                    checked={
                      characterPaths.length === directory.characters.length
                    }
                    partial={
                      characterPaths.length > 0 &&
                      characterPaths.length < directory.characters.length
                    }
                    disabled={blocked}
                    onChange={() =>
                      setCharacterPaths((previous) =>
                        previous.length === directory.characters.length
                          ? []
                          : directory.characters.map((c) => c.path),
                      )
                    }
                  />
                </th>
                <th>角色</th>
                <th>资料夹</th>
                <th>最近备份</th>
              </tr>
            </thead>
            <tbody>
              {directory.characters.map((c) => (
                <tr
                  key={c.path}
                  className={
                    characterPaths.includes(c.path) ? 'is-selected' : ''
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`备份${characterName(c)}`}
                      checked={characterPaths.includes(c.path)}
                      disabled={blocked}
                      onChange={() =>
                        setCharacterPaths((previous) =>
                          previous.includes(c.path)
                            ? previous.filter((p) => p !== c.path)
                            : [...previous, c.path],
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{characterName(c)}</strong>
                  </td>
                  <td className="path-value">FFXIV_CHR{c.contentId}</td>
                  <td className="time-cell">
                    {latest(c.path) ? (
                      dateLabel(latest(c.path)!.createdAt)
                    ) : (
                      <span className="muted">尚无备份</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="backup-history" aria-label="备份历史">
        <div className="section-heading">
          <div>
            <h3>
              备份历史{' '}
              <span className="muted">{library?.backups.length ?? 0} 份</span>
            </h3>
          </div>
          <button
            className="danger-text"
            disabled={blocked || !backupIds.length}
            onClick={() => {
              if (
                !window.confirm(
                  `删除所选的 ${backupIds.length} 份备份？删除后无法恢复。`,
                )
              )
                return;
              void run('正在删除备份…', async () => {
                const count = backupIds.length;
                try {
                  await window.characterManager.deleteBackups(
                    directory.path,
                    backupIds,
                  );
                } finally {
                  await refresh();
                }
                notify(`已删除 ${count} 份备份。`);
              });
            }}
          >
            删除所选备份{backupIds.length ? `（${backupIds.length}）` : ''}
          </button>
        </div>
        <div className="backup-filters">
          <label className="field-label">
            角色
            <select
              value={filter}
              disabled={blocked}
              onChange={(e) => {
                setFilter(e.target.value);
                setBackupIds([]);
              }}
            >
              <option value="all">全部角色</option>
              {[
                ...new Map([
                  ...(library?.backups ?? []).map(
                    (b) => [b.sourcePath, b.characterName] as const,
                  ),
                  ...directory.characters.map(
                    (c) => [c.path, characterName(c)] as const,
                  ),
                ]).entries(),
              ].map(([p, name]) => (
                <option key={p} value={p}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            备份来源
            <select
              value={sourceFilter}
              disabled={blocked}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setBackupIds([]);
              }}
            >
              <option value="all">全部来源</option>
              {Object.entries(reasons).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">已选 {backupIds.length} 份</span>
        </div>
        {loading ? (
          <div className="manager-empty compact" role="status">
            <span className="spinner" />
            <p>正在读取备份…</p>
          </div>
        ) : failed ? (
          <div className="manager-empty compact">
            <h3>备份读取失败</h3>
            <p>检查目录权限，或更改备份位置。</p>
            <button onClick={reload}>重新读取</button>
          </div>
        ) : backups.length ? (
          <div className="manager-table-scroll">
            <table className="manager-table">
              <thead>
                <tr>
                  <th className="check-column">
                    <SelectAll
                      label="全选当前备份"
                      checked={backups.every((b) => backupIds.includes(b.id))}
                      partial={
                        backups.some((b) => backupIds.includes(b.id)) &&
                        !backups.every((b) => backupIds.includes(b.id))
                      }
                      disabled={blocked}
                      onChange={() =>
                        setBackupIds((previous) =>
                          backups.every((b) => previous.includes(b.id))
                            ? []
                            : backups.map((b) => b.id),
                        )
                      }
                    />
                  </th>
                  <th>备份时间</th>
                  <th>角色与来源</th>
                  <th>文件 / 大小</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr
                    key={b.id}
                    className={backupIds.includes(b.id) ? 'is-selected' : ''}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择备份 ${b.id}`}
                        disabled={blocked}
                        checked={backupIds.includes(b.id)}
                        onChange={() =>
                          setBackupIds((previous) =>
                            previous.includes(b.id)
                              ? previous.filter((id) => id !== b.id)
                              : [...previous, b.id],
                          )
                        }
                      />
                    </td>
                    <td className="time-cell">
                      <strong>{dateLabel(b.createdAt)}</strong>
                      <small className="code-value">{b.id.slice(0, 8)}</small>
                    </td>
                    <td>
                      <span>
                        {directory.characters.find(
                          (c) => c.path === b.sourcePath,
                        )
                          ? characterName(
                              directory.characters.find(
                                (c) => c.path === b.sourcePath,
                              )!,
                            )
                          : b.characterName}
                      </span>
                      <small>{reasons[b.reason]}</small>
                    </td>
                    <td>
                      {b.fileCount} 个文件
                      <small>{sizeLabel(b.byteLength)}</small>
                    </td>
                    <td>
                      <button
                        disabled={
                          blocked ||
                          !directory.characters.some(
                            (c) => c.path === b.sourcePath,
                          )
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              `将 ${b.characterName} 的整个资料夹还原到 ${dateLabel(b.createdAt)}？当前资料夹会先备份。`,
                            )
                          )
                            return;
                          void run('正在还原资料夹…', async () => {
                            await window.characterManager.restoreBackup(
                              directory.path,
                              b.id,
                            );
                            await refresh();
                            onChanged();
                            notify('资料夹已还原。');
                          });
                        }}
                      >
                        还原
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="manager-empty compact">
            <Icon name="backup" />
            <h3>
              {library?.backups.length ? '没有符合条件的备份' : '没有备份'}
            </h3>
            <p>
              {library?.backups.length
                ? '更改筛选条件。'
                : '勾选角色后点击「备份所选」。'}
            </p>
          </div>
        )}
      </section>
      <p className="manager-footnote">
        备份包含配置和日志。备份或还原前请退出游戏。
      </p>
    </div>
  );
}
