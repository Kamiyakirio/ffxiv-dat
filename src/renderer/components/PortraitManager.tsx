import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDirectory } from '../../shared/types';
import type {
  PortraitCollection,
  PortraitImportPreview,
  PortraitSummary,
} from '../../shared/management';
import type { CopiedPortraits } from './ManagementWorkspace';
import { Icon, SelectAll, characterName, dateLabel } from './management-ui';
import type { RunTask } from './management-ui';

export default function PortraitManager({
  active,
  directory,
  busy,
  run,
  onError,
  notify,
  copied,
  onCopy,
  onChanged,
}: {
  active: boolean;
  directory: GameDirectory;
  busy: boolean;
  run: RunTask;
  onError: (error: unknown) => void;
  notify: (message: string) => void;
  copied: CopiedPortraits | null;
  onCopy: (value: CopiedPortraits) => void;
  onChanged: () => void;
}) {
  const [characterPath, setCharacterPath] = useState(
    directory.characters[0]?.path ?? '',
  );
  const [data, setData] = useState<PortraitCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ids, setIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [panel, setPanel] = useState<'import' | 'export' | null>(null);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<PortraitImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'create' | 'overwrite'>(
    'create',
  );
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const serial = useRef({ value: 0 });
  const sharePanel = useRef<HTMLElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const character = directory.characters.find((c) => c.path === characterPath)!;
  const focused = data?.portraits.find((p) => p.id === focusedId);
  const visible =
    data?.portraits.filter((p) =>
      `${p.name} ${p.timeline} ${p.background} ${p.linkedGearsets.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const blocked = busy || loading;

  const load = useCallback(() => {
    const request = ++serial.current.value;
    return window.characterManager
      .portraits(characterPath)
      .then(
        (value) => {
          if (request !== serial.current.value) return;
          setData(value);
          setLoadFailed(false);
          setIds([]);
          setFocusedId(null);
          setPanel(null);
          setPreview(null);
        },
        (reason) => {
          if (request !== serial.current.value) return;
          onError(reason);
          setLoadFailed(true);
          setData(null);
        },
      )
      .finally(() => {
        if (request === serial.current.value) setLoading(false);
      });
  }, [characterPath, onError]);
  useEffect(() => {
    const generation = serial.current;
    if (active) void load();
    return () => {
      generation.value++;
    };
  }, [load, active]);

  useEffect(() => {
    const target = panel
      ? sharePanel.current
      : focusedId !== null
        ? detailPanel.current
        : null;
    target?.scrollIntoView?.({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [panel, focusedId]);

  function reload() {
    setLoading(true);
    setLoadFailed(false);
    void load();
  }

  function select(id: number) {
    setIds((previous) =>
      previous.includes(id)
        ? previous.filter((n) => n !== id)
        : [...previous, id],
    );
  }
  function inspect(p: PortraitSummary) {
    setFocusedId(p.id);
    setName(p.name === `肖像 ${p.id + 1}` ? '' : p.name);
    setPanel(null);
  }
  function openImport(value = '', count = 0) {
    setPanel('import');
    setFocusedId(null);
    setCode(value);
    setPreview(null);
    setImportMode('create');
    setTargetIds(ids);
    if (value)
      void run('正在读取肖像数据…', async () => {
        const result = await window.characterManager.previewImport(value);
        setPreview(result);
        if (count && result.portraits.length !== count)
          throw new Error('复制的数据数量发生变化，请重新复制。');
      });
  }

  async function exportSelection(share: boolean) {
    if (!data) return;
    await run('正在复制肖像…', async () => {
      const value = await window.characterManager.exportPortraits(
        characterPath,
        data.revision,
        ids,
      );
      onCopy({
        code: value,
        count: ids.length,
        source: characterName(character),
      });
      if (share) {
        setCode(value);
        setPanel('export');
        setFocusedId(null);
      }
      try {
        await navigator.clipboard.writeText(value);
        notify(`已复制 ${ids.length} 个肖像${share ? '的分享码' : ''}。`);
      } catch {
        setCode(value);
        setPanel('export');
        setFocusedId(null);
        notify('无法写入剪贴板。可在应用内粘贴，或手动复制下方分享码。');
      }
    });
  }

  async function apply(
    change: Parameters<
      typeof window.characterManager.writePortraits
    >[0]['change'],
    success: string,
  ) {
    if (!data) return;
    await run('正在备份并保存肖像…', async () => {
      const value = await window.characterManager.writePortraits({
        characterPath,
        revision: data.revision,
        change,
      });
      setData(value);
      setIds([]);
      setFocusedId(null);
      setPanel(null);
      setPreview(null);
      onChanged();
      notify(success);
    });
  }

  function remove() {
    if (
      !ids.length ||
      !window.confirm(
        `删除 ${characterName(character)} 的 ${ids.length} 个肖像？同时解除套装关联。删除前会自动备份。`,
      )
    )
      return;
    void apply({ type: 'delete', ids }, `已删除 ${ids.length} 个肖像。`);
  }

  const toggleTargets = (id: number) =>
    setTargetIds((previous) =>
      previous.includes(id)
        ? previous.filter((n) => n !== id)
        : [...previous, id],
    );
  return (
    <div className="manager-content">
      <header className="manager-heading">
        <div>
          <h2>肖像管理</h2>
        </div>
        <button
          className="primary-button"
          disabled={blocked || !data?.available}
          onClick={() => openImport()}
        >
          导入分享码
        </button>
      </header>
      <div className="portrait-layout">
        <aside className="character-sidebar" aria-label="选择角色">
          <h3>
            角色资料夹 <span>{directory.characters.length}</span>
          </h3>
          {directory.characters.map((c) => (
            <button
              key={c.path}
              className={`character-choice${c.path === characterPath ? ' is-selected' : ''}`}
              disabled={busy}
              aria-pressed={c.path === characterPath}
              onClick={() => {
                if (c.path === characterPath) return;
                setLoading(true);
                setData(null);
                setIds([]);
                setPanel(null);
                setFocusedId(null);
                setCharacterPath(c.path);
                setQuery('');
              }}
            >
              <span className="character-monogram">
                {c.names[0]?.slice(0, 1) || '角'}
              </span>
              <span>
                <strong>{characterName(c)}</strong>
                <small>{c.contentId}</small>
              </span>
            </button>
          ))}
          <button
            className="text-button"
            disabled={blocked}
            onClick={() =>
              void run('正在打开资料夹…', () =>
                window.gameDirectory.reveal(characterPath),
              )
            }
          >
            打开角色资料夹
          </button>
        </aside>
        <section
          className="portrait-main"
          aria-label={`${characterName(character)}的肖像`}
          aria-busy={loading}
        >
          <div className="portrait-list-heading">
            <div>
              <h3>{characterName(character)}</h3>
              <p className="muted">
                {data
                  ? `${data.portraits.length} / ${data.capacity} 个肖像`
                  : '正在读取…'}
              </p>
            </div>
            <button disabled={blocked} onClick={reload}>
              刷新
            </button>
          </div>
          {copied && (
            <div className="copy-buffer">
              <Icon name="copy" />
              <span>
                已复制 <strong>{copied.count}</strong> 个肖像{' '}
                <small>来自 {copied.source}</small>
              </span>
              <button
                disabled={blocked || !data?.available}
                onClick={() => openImport(copied.code, copied.count)}
              >
                粘贴到此角色
              </button>
            </div>
          )}
          {data?.available &&
            data.warnings.map((warning) => (
              <p className="inline-notice" key={warning}>
                {warning}
              </p>
            ))}
          <div className="portrait-tools">
            <label className="portrait-search">
              <span className="sr-only">搜索肖像</span>
              <input
                type="search"
                placeholder="搜索名称、动作或背景"
                value={query}
                disabled={blocked}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <span className="selection-count">已选 {ids.length} 个</span>
          </div>
          <div className="selection-toolbar" aria-label="肖像批量操作">
            <button
              disabled={blocked || !ids.length}
              onClick={() => void exportSelection(false)}
            >
              复制肖像
            </button>
            <button
              disabled={blocked || !ids.length}
              onClick={() => void exportSelection(true)}
            >
              导出分享码
            </button>
            <button
              className="danger-text"
              disabled={blocked || !ids.length}
              onClick={remove}
            >
              删除所选
            </button>
            {ids.length > 0 && (
              <button
                className="text-button"
                disabled={blocked}
                onClick={() => setIds([])}
              >
                取消选择
              </button>
            )}
          </div>
          {loading ? (
            <div className="manager-empty compact" role="status">
              <span className="spinner" />
              <p>正在读取肖像…</p>
            </div>
          ) : loadFailed ? (
            <div className="manager-empty compact">
              <h3>肖像读取失败</h3>
              <p>可在高级解析中检查 UISAVE.DAT。</p>
              <button onClick={reload}>重新读取</button>
            </div>
          ) : data?.portraits.length ? (
            <div className="manager-table-scroll">
              <table className="manager-table portrait-table">
                <thead>
                  <tr>
                    <th className="check-column">
                      <SelectAll
                        label="全选当前肖像"
                        checked={
                          visible.length > 0 &&
                          visible.every((p) => ids.includes(p.id))
                        }
                        partial={
                          visible.some((p) => ids.includes(p.id)) &&
                          !visible.every((p) => ids.includes(p.id))
                        }
                        disabled={blocked || !visible.length}
                        onChange={() =>
                          setIds((previous) =>
                            visible.every((p) => previous.includes(p.id))
                              ? previous.filter(
                                  (id) => !visible.some((p) => p.id === id),
                                )
                              : [
                                  ...new Set([
                                    ...previous,
                                    ...visible.map((p) => p.id),
                                  ]),
                                ],
                          )
                        }
                      />
                    </th>
                    <th>肖像</th>
                    <th>动作与背景</th>
                    <th>关联套装</th>
                    <th>保存时间</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr
                      key={p.id}
                      className={ids.includes(p.id) ? 'is-selected' : ''}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择${p.name}（槽位 ${p.id + 1}）`}
                          checked={ids.includes(p.id)}
                          disabled={blocked}
                          onChange={() => select(p.id)}
                        />
                      </td>
                      <td>
                        <button
                          className="portrait-name"
                          disabled={blocked}
                          onClick={() => inspect(p)}
                        >
                          <span className="slot-index">
                            {String(p.id + 1).padStart(2, '0')}
                          </span>
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.usesDefault ? '使用默认预设' : p.frame}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span>{p.timeline}</span>
                        <small>{p.background}</small>
                      </td>
                      <td>
                        {p.linkedGearsets.join('、') || (
                          <span className="muted">未关联</span>
                        )}
                      </td>
                      <td className="time-cell">{dateLabel(p.updatedAt)}</td>
                      <td>
                        <button
                          className="text-button"
                          disabled={blocked}
                          aria-label={`查看${p.name}（槽位 ${p.id + 1}）`}
                          onClick={() => inspect(p)}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && <p className="table-empty">没有匹配的肖像</p>}
            </div>
          ) : (
            <div className="manager-empty compact">
              <Icon name="portrait" />
              <h3>
                {data?.available ? '没有保存的肖像' : '未找到 UISAVE.DAT'}
              </h3>
              <p>
                {data?.available
                  ? '从其他角色粘贴，或导入分享码。'
                  : data?.warnings.join(' ') || '在游戏中保存配置后刷新。'}
              </p>
              {data?.available && (
                <button disabled={blocked} onClick={() => openImport()}>
                  导入分享码
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      {focused && (
        <section
          ref={detailPanel}
          tabIndex={-1}
          className="portrait-detail management-panel"
          aria-label="肖像详情"
        >
          <div className="section-heading">
            <div>
              <h3>
                {focused.name}{' '}
                <span className="muted">· 槽位 {focused.id + 1}</span>
              </h3>
            </div>
            <button disabled={busy} onClick={() => setFocusedId(null)}>
              关闭详情
            </button>
          </div>
          <dl className="portrait-facts">
            {Object.entries({
              动作: focused.timeline,
              表情: focused.expression,
              背景: focused.background,
              边框: focused.frame,
              装饰: focused.decoration,
              ...focused.fields,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <form
            className="rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(
                { type: 'rename', id: focused.id, name },
                '名称已保存。',
              );
            }}
          >
            <label className="field-label">
              动作自定义名称
              <input
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder="留空使用游戏默认名称"
              />
            </label>
            <button disabled={busy}>保存名称</button>
          </form>
        </section>
      )}
      {panel && (
        <section
          ref={sharePanel}
          tabIndex={-1}
          className="management-panel share-panel"
          aria-label={panel === 'import' ? '导入肖像' : '导出肖像'}
        >
          <div className="section-heading">
            <div>
              <h3>{panel === 'import' ? '导入肖像' : '导出肖像'}</h3>
              <p>
                {panel === 'import'
                  ? `目标角色：${characterName(character)}`
                  : `来源角色：${characterName(character)}`}
              </p>
            </div>
            <button disabled={busy} onClick={() => setPanel(null)}>
              关闭{panel === 'import' ? '导入' : '导出'}
            </button>
          </div>
          <label className="field-label">
            肖像分享码
            <textarea
              aria-label="肖像分享码"
              rows={4}
              readOnly={panel === 'export'}
              disabled={busy}
              value={code}
              placeholder="粘贴分享码"
              onChange={(e) => {
                setCode(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          {panel === 'export' ? (
            <button
              disabled={busy}
              onClick={() =>
                void run('正在复制分享码…', async () => {
                  await navigator.clipboard.writeText(code);
                  notify('分享码已复制。');
                })
              }
            >
              复制分享码
            </button>
          ) : (
            <>
              <button
                disabled={busy || !code.trim()}
                onClick={() =>
                  void run('正在校验分享码…', async () => {
                    setPreview(null);
                    setPreview(
                      await window.characterManager.previewImport(code),
                    );
                  })
                }
              >
                读取分享码
              </button>
              {preview && (
                <div className="import-preview">
                  <p>
                    <strong>已读取 {preview.portraits.length} 个肖像</strong>：
                    {preview.portraits.map((p) => p.name).join('、')}
                  </p>
                  <fieldset disabled={busy} className="import-mode">
                    <legend>导入方式</legend>
                    <label>
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === 'create'}
                        onChange={() => setImportMode('create')}
                      />
                      新建肖像 <small>使用空闲槽位</small>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === 'overwrite'}
                        onChange={() => setImportMode('overwrite')}
                      />
                      覆盖已有肖像
                    </label>
                  </fieldset>
                  {importMode === 'overwrite' && (
                    <fieldset disabled={busy} className="overwrite-targets">
                      <legend>
                        选择 {preview.portraits.length}{' '}
                        个要覆盖的肖像，顺序与导入列表一致。
                      </legend>
                      {data?.portraits.map((p) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={targetIds.includes(p.id)}
                            onChange={() => toggleTargets(p.id)}
                          />
                          {targetIds.includes(p.id) && (
                            <span className="target-order">
                              {targetIds.indexOf(p.id) + 1}.
                            </span>
                          )}
                          槽位 {p.id + 1} · {p.name}
                        </label>
                      ))}
                      {!data?.portraits.length && (
                        <p>没有可覆盖的肖像，请选择新建。</p>
                      )}
                    </fieldset>
                  )}
                  <p className="muted">
                    {importMode === 'create'
                      ? `${(data?.capacity ?? 0) - (data?.portraits.length ?? 0)} 个可用槽位`
                      : `已选 ${targetIds.length} 个覆盖目标`}
                  </p>
                  <p className="muted">
                    导入不会改变角色外观、装备或解锁内容。
                  </p>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      (importMode === 'overwrite'
                        ? targetIds.length !== preview.portraits.length
                        : preview.portraits.length >
                          (data?.capacity ?? 0) - (data?.portraits.length ?? 0))
                    }
                    onClick={() => {
                      if (
                        importMode === 'overwrite' &&
                        !window.confirm(
                          `覆盖 ${characterName(character)} 的 ${targetIds.length} 个肖像？保存前会自动备份。`,
                        )
                      )
                        return;
                      void apply(
                        { type: 'import', code, mode: importMode, targetIds },
                        `已${importMode === 'create' ? '新建' : '覆盖'} ${preview.portraits.length} 个肖像。`,
                      );
                    }}
                  >
                    {importMode === 'create'
                      ? `新建 ${preview.portraits.length} 个肖像`
                      : `覆盖 ${preview.portraits.length} 个肖像`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <p className="manager-footnote">保存前请退出游戏，原资料夹会自动备份。</p>
    </div>
  );
}
