import { useState } from 'react';
import type { DecodedFileDetail } from '../../shared/types';
import JsonTree from './JsonTree';

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Row => entry !== null && typeof entry === 'object',
      )
    : [];
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function keyLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return '未设置';
  const key = value as Row;
  if (key.unbound) return '未设置';
  const names = Array.isArray(key.modifierNames)
    ? key.modifierNames.map(String)
    : [];
  return [...names, String(key.keyName ?? key.keyCode ?? key.raw)]
    .join(' + ')
    .replaceAll('NUMPAD', '小键盘 ');
}

const segmentNames: Record<string, string> = {
  LETTER: '邮件记录',
  RETTASK: '雇员任务',
  FLAGS: '界面旗标',
  RCFAV: '制作收藏',
  UIDATA: '社交数据',
  TLPH: '传送历史',
  ITCC: '物品菜单',
  PVPSET: 'PvP 设置',
  EMTH: '表情历史',
  MNONLST: '宠物收藏',
  MUNTLST: '坐骑收藏',
  EMJ: '多玛方城战',
  AOZNOTE: '青魔法预设',
  CWLS: '跨服通讯贝',
  ARCHVLST: '成就关注',
  GRPPOS: '集体动作设置',
  CRAFT: '制作记录',
  FMARKER: '场地标点',
  MYCNOT: '战果笔记',
  ORNMLST: '时尚配饰',
  MYCITEM: '失传技能',
  GRPSTAMP: '集体动作贴纸',
  RTNR: '雇员备注',
  BANNER: '肖像',
  ADVNOTE: '探索笔记',
  TOFU: '战术板',
  FISHING: '捕鱼记录',
  ACTION: '技能记录',
  TFILTER: '屏蔽词',
  READYC: '倒计时',
  PTRLST: '小队职业排序',
  CATSBM: '市场收藏',
  DESCRI: '说明已读记录',
  MJICWSP: '海岛预设',
  PERFORM: '乐器演奏',
  QPNL: '快捷面板',
  GLASSES: '眼镜',
};

export default function DecodedContent({
  detail,
}: {
  detail: DecodedFileDetail;
}) {
  const [query, setQuery] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [page, setPage] = useState(0);
  const [group, setGroup] = useState('0');
  const [segmentId, setSegmentId] = useState('0');
  const [raw, setRaw] = useState(false);
  const data = detail.data;
  const filename = detail.summary.name.toUpperCase();
  const mode =
    filename === 'MACRO.DAT' || filename === 'MACROSYS.DAT'
      ? 'macros'
      : filename === 'KEYBIND.DAT'
        ? 'keys'
        : filename === 'HOTBAR.DAT'
          ? 'hotbar'
          : filename === 'GEARSET.DAT'
            ? 'gearsets'
            : filename === 'UISAVE.DAT'
              ? 'segments'
              : ['COMMON.DAT', 'CONTROL0.DAT', 'CONTROL1.DAT'].includes(
                    filename,
                  )
                ? 'settings'
                : 'tree';
  const segments = rows(data.segments);
  const pageSize = mode === 'macros' ? 10 : 40;
  const segment =
    segments.find((entry) => String(entry.id) === segmentId) ?? segments[0];
  const baseRows = (() => {
    if (mode === 'macros')
      return rows(data.macros).filter(
        (row) =>
          showEmpty ||
          row.name ||
          (Array.isArray(row.lines) && row.lines.some(Boolean)),
      );
    if (mode === 'keys') return rows(data.bindings);
    if (mode === 'settings') return rows(data.entries);
    if (mode === 'gearsets')
      return rows(data.records).filter((row) => showEmpty || row.exists);
    if (mode === 'hotbar')
      return rows(data.slots).filter(
        (row) =>
          String(row.groupId) === group && (showEmpty || row.commandType !== 0),
      );
    return [];
  })();
  const filtered = baseRows.filter(
    (row) =>
      !query ||
      Object.values(row).some((value) =>
        (Array.isArray(value)
          ? value.join(' ')
          : typeof value === 'object'
            ? ''
            : String(value)
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const tableMode = ['keys', 'settings', 'hotbar'].includes(mode);

  return (
    <>
      <div className="content-tabs" role="group" aria-label="结果视图">
        <button
          className={!raw ? 'active' : undefined}
          aria-pressed={!raw}
          onClick={() => setRaw(false)}
        >
          可读内容
        </button>
        <button
          className={raw ? 'active' : undefined}
          aria-pressed={raw}
          onClick={() => setRaw(true)}
        >
          结构数据
        </button>
      </div>
      {raw ? (
        <JsonTree value={data} />
      ) : mode === 'segments' ? (
        <>
          <div className="viewer-toolbar">
            <label className="field-label">
              配置类别
              <select
                value={segment ? String(segment.id) : ''}
                onChange={(event) => setSegmentId(event.currentTarget.value)}
              >
                {segments.map((item, index) => (
                  <option key={index} value={String(item.id)}>
                    {text(segmentNames[String(item.name)] ?? item.name)} ·{' '}
                    {text(item.name)}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">{segments.length} 个子段</span>
          </div>
          {segment ? (
            <>
              <div className="segment-heading">
                <h3>
                  {text(segmentNames[String(segment.name)] ?? segment.name)}
                </h3>
                <span className="status-badge partial">
                  {segment.status === 'decoded' ? '已解析' : '含未确认字段'}
                </span>
              </div>
              <JsonTree
                key={String(segment.id)}
                value={segment.data}
                presentation
              />
              <details className="technical-details">
                <summary>子段版本与原始字节</summary>
                <JsonTree
                  value={{
                    version: segment.version,
                    offset: segment.offset,
                    warnings: segment.warnings,
                    rawHex: segment.rawHex,
                    decodedHex: segment.decodedHex,
                  }}
                />
              </details>
            </>
          ) : (
            <p className="empty-message">
              未能识别配置子段，请查看结构数据和解析说明。
            </p>
          )}
        </>
      ) : mode === 'tree' ? (
        <JsonTree value={data} presentation />
      ) : (
        <>
          <div className="viewer-toolbar">
            <label className="search-field">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m13 13 4 4" />
              </svg>
              <input
                aria-label="搜索解码内容"
                placeholder={
                  mode === 'macros' ? '搜索宏名称或正文' : '搜索内容'
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setPage(0);
                }}
              />
            </label>
            {mode === 'hotbar' && (
              <label className="field-label">
                存储组
                <select
                  value={group}
                  onChange={(event) => {
                    setGroup(event.currentTarget.value);
                    setPage(0);
                  }}
                >
                  {((data.groupIds as number[]) ?? []).map((id) => (
                    <option key={id} value={String(id)}>
                      {id === 0
                        ? '共享'
                        : id >= 64
                          ? `PvP 候选组 ${id}`
                          : `职业候选组 ${id}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {['macros', 'gearsets', 'hotbar'].includes(mode) && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(event) => {
                    setShowEmpty(event.currentTarget.checked);
                    setPage(0);
                  }}
                />
                显示空槽
              </label>
            )}
          </div>
          <p className="record-count">
            {filtered.length.toLocaleString()} 条
            {mode === 'hotbar'
              ? showEmpty
                ? '槽位（含空槽）'
                : '非空槽位'
              : '记录'}
            {query && <> · 搜索「{query}」</>}
          </p>
          {!visible.length && (
            <p className="empty-message">
              {query
                ? '没有匹配的内容，请尝试其他关键词。'
                : '暂无非空记录，可勾选“显示空槽”查看全部槽位。'}
            </p>
          )}
          {tableMode && visible.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {mode === 'keys' ? (
                      <>
                        <th>操作</th>
                        <th>第一按键</th>
                        <th>第二按键</th>
                      </>
                    ) : mode === 'hotbar' ? (
                      <>
                        <th>热键栏 / 槽位</th>
                        <th>内容类型</th>
                        <th>内容 ID</th>
                      </>
                    ) : (
                      <>
                        <th>配置项</th>
                        <th>值</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => (
                    <tr key={currentPage * pageSize + index}>
                      {mode === 'keys' ? (
                        <>
                          <td className="code-value">{text(row.command)}</td>
                          <td>{keyLabel((row.keys as unknown[])?.[0])}</td>
                          <td>{keyLabel((row.keys as unknown[])?.[1])}</td>
                        </>
                      ) : mode === 'hotbar' ? (
                        <>
                          <td>
                            {Number(row.barIndex) + 1} /{' '}
                            {Number(row.slotIndex) + 1}
                          </td>
                          <td>{text(row.commandTypeName)}</td>
                          <td className="code-value">{text(row.commandId)}</td>
                        </>
                      ) : (
                        <>
                          <td>
                            <span className="code-value">{text(row.name)}</span>
                            {!!row.section && (
                              <small className="cell-note">
                                {text(row.section)}
                              </small>
                            )}
                          </td>
                          <td className="code-value">{text(row.value)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : mode === 'macros' ? (
            visible.map((row, index) => (
              <details
                key={text(row.index)}
                className="macro-record"
                open={index === 0}
              >
                <summary>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m6 3 5 5-5 5" />
                  </svg>
                  <h3>{text(row.name || '未命名宏')}</h3>
                  <span className="muted">
                    槽位 {String(row.index).padStart(2, '0')} · 图标{' '}
                    {text(row.iconId ?? row.iconHex)}
                  </span>
                </summary>
                <pre>
                  <code>
                    {(row.lines as string[]).join('\n').trimEnd() || '（空宏）'}
                  </code>
                </pre>
              </details>
            ))
          ) : mode === 'gearsets' ? (
            visible.map((row) => (
              <details key={text(row.recordIndex)} className="gear-record">
                <summary>
                  <span>
                    <strong>{text(row.name || '未命名套装')}</strong>
                    <small>
                      槽位 {text(row.recordIndex)} · 职业 ID{' '}
                      {text(row.classJobId)}
                    </small>
                  </span>
                  <span>装等 {text(row.itemLevel)}</span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>装备槽</th>
                        <th>物品 ID</th>
                        <th>幻化 ID</th>
                        <th>染色 ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows(row.items).map((item, index) => (
                        <tr key={index}>
                          <td>{text(item.slot)}</td>
                          <td>
                            {text(item.baseItemId)}
                            {item.highQuality ? ' · HQ' : ''}
                          </td>
                          <td>{text(item.glamourId)}</td>
                          <td>{(item.stainIds as number[]).join(' / ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))
          ) : null}
          {filtered.length > pageSize && (
            <div className="pagination">
              <button
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
              >
                上一页
              </button>
              <span>
                {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                onClick={() => setPage(Math.min(lastPage, currentPage + 1))}
                disabled={currentPage >= lastPage}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
