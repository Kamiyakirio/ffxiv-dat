import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DecodedFileDetail,
  DecodedFileSummary,
  EditTarget,
} from '../../shared/types';
import {
  buildFileNode,
  hasTarget,
  recordCount,
  resolveNode,
} from './browser-model';
import type { BrowserNode } from './browser-model';
import DetailSections from './DetailSections';
import DecodeCoverage from './DecodeCoverage';
import JsonTree from './JsonTree';

export interface BrowserViewState {
  query: string;
  page: number;
  pageSize?: number;
  showEmpty: boolean;
  scroll: number;
}
const defaultList: BrowserViewState = {
  query: '',
  page: 0,
  showEmpty: false,
  scroll: 0,
};
const Chevron = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="m7 4 6 6-6 6" />
  </svg>
);
export default function DecodedContent({
  detail,
  onEdit,
  editor,
  editing = false,
  openingEditor = false,
  path: controlledPath,
  onNavigate,
  onBackToFiles,
  onOpenFile,
  files = [],
  canNavigate = () => true,
  onTargetChange,
  views,
  onViewChange,
}: {
  detail: DecodedFileDetail;
  onEdit?: (target: EditTarget) => void;
  editor?: ReactNode;
  editing?: boolean;
  openingEditor?: boolean;
  path?: string[];
  onNavigate?: (path: string[]) => boolean;
  onBackToFiles?: () => void;
  onOpenFile?: (file: DecodedFileSummary) => void;
  files?: DecodedFileSummary[];
  canNavigate?: () => boolean;
  onTargetChange?: (target: EditTarget) => void;
  views?: Record<string, BrowserViewState>;
  onViewChange?: (key: string, value: BrowserViewState) => void;
}) {
  const root = useMemo(() => buildFileNode(detail), [detail]);
  const [localPath, setLocalPath] = useState<string[]>([]),
    [lists, setLists] = useState<Record<string, BrowserViewState>>({});
  const path = controlledPath ?? localPath,
    { node, trail, validPath } = resolveNode(root, path),
    routeKey = validPath.join('/');
  const state = views?.[routeKey] ?? lists[routeKey] ?? defaultList;
  const [technical, setTechnical] = useState<string | null>(null),
    [copied, setCopied] = useState(''),
    [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null),
    inspector = useRef<HTMLDetailsElement>(null);
  const children = node.children ?? [],
    filtered = children.filter(
      (child) =>
        ((node === root &&
          detail.summary.name.toUpperCase() === 'UISAVE.DAT') ||
          state.showEmpty ||
          !child.empty) &&
        (!state.query ||
          `${child.title} ${child.description ?? ''} ${child.searchText ?? ''}`
            .toLowerCase()
            .includes(state.query.toLowerCase())),
    );
  const grouped =
    node === root && detail.summary.name.toUpperCase() === 'UISAVE.DAT';
  // List entries have the same navigation role regardless of how many
  // fields or child pages their details contain.
  const compact = !grouped;
  const pageSize = [20, 60, 120].includes(state.pageSize ?? 0)
    ? state.pageSize!
    : 60;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    page = Math.min(state.page, pages - 1);
  const displayed = grouped
    ? filtered
    : filtered.slice(page * pageSize, (page + 1) * pageSize);
  const groups = [
    ...new Set(
      displayed.map((child) => (grouped ? (child.group ?? '其他配置') : '')),
    ),
  ];
  const technicalOpen = technical === routeKey;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: editing ? 0 : state.scroll, behavior: 'instant' });
  }, [routeKey, editing, state.scroll]);
  useEffect(() => {
    if (node.editTarget) onTargetChange?.(node.editTarget);
  }, [node, onTargetChange]);
  function update(values: Partial<BrowserViewState>) {
    if (onViewChange) {
      onViewChange(routeKey, { ...state, ...values });
      return;
    }
    setLists((previous) => ({
      ...previous,
      [routeKey]: { ...(previous[routeKey] ?? defaultList), ...values },
    }));
  }
  function navigate(next: string[]) {
    if (!canNavigate()) return;
    update({ scroll: window.scrollY });
    setError('');
    if (onNavigate) {
      onNavigate(next);
      return;
    }
    setLocalPath(next);
  }
  function open(child: BrowserNode) {
    const member = Array.isArray(detail.data.members)
      ? files.find(
          (f) => f.parentId === detail.summary.id && f.name === child.title,
        )
      : undefined;
    if (member && onOpenFile) {
      onOpenFile(member);
      return;
    }
    navigate([...validPath, child.key]);
  }
  async function copy(value: unknown, kind: string) {
    try {
      await navigator.clipboard.writeText(
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      );
      setCopied(routeKey + kind);
      setError('');
    } catch {
      setError('复制失败，请检查剪贴板权限后重试。');
    }
  }
  function showTechnical() {
    setTechnical(routeKey);
    window.requestAnimationFrame(() =>
      inspector.current?.scrollIntoView?.({
        block: 'start',
        behavior: 'smooth',
      }),
    );
  }
  const parent = trail.at(-2);
  return (
    <div className="browser-page">
      <nav className="breadcrumbs" aria-label="当前位置">
        <ol>
          <li>
            {onBackToFiles ? (
              <button onClick={onBackToFiles}>配置文件</button>
            ) : (
              <span>配置文件</span>
            )}
          </li>
          {detail.summary.parentId &&
            files
              .filter((f) => f.id === detail.summary.parentId)
              .map((file) => (
                <li key={file.id}>
                  <button onClick={() => onOpenFile?.(file)}>
                    {file.name}
                  </button>
                </li>
              ))}
          {trail.map((item, index) => (
            <li key={item.key}>
              {index < trail.length - 1 ? (
                <button
                  disabled={openingEditor}
                  onClick={() => navigate(validPath.slice(0, index))}
                >
                  {item.title}
                </button>
              ) : (
                <span aria-current="page">{item.title}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <header className="page-heading">
        <div>
          {parent && (
            <button
              className="back-link"
              disabled={openingEditor}
              onClick={() => navigate(validPath.slice(0, -1))}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m12 4-6 6 6 6" />
              </svg>
              返回{parent.title}
            </button>
          )}
          <h2 ref={heading} tabIndex={-1}>
            {editing ? '编辑 · ' : ''}
            {node.title}
          </h2>
          {node.description && !editing && (
            <p className="page-description">{node.description}</p>
          )}
        </div>
        <div className="button-group">
          {!editor &&
            onEdit &&
            hasTarget(node.editTarget) &&
            (node.kind === 'record' || !children.length) && (
              <button
                className="primary-button"
                disabled={openingEditor}
                onClick={() => onEdit(node.editTarget!)}
              >
                {openingEditor ? '正在准备…' : '编辑'}
              </button>
            )}
          {!editor && <button onClick={showTechnical}>技术数据</button>}
        </div>
      </header>
      {path.length !== validPath.length && (
        <p className="inline-notice" role="status">
          原记录已不在当前列表中，已返回上一级。
        </p>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <div hidden={!!editor}>
        <DetailSections sections={node.sections ?? []} />
        {node.code !== undefined && (
          <section className="detail-section macro-body">
            <div className="section-heading">
              <h3>宏正文</h3>
              <button onClick={() => copy(node.code, 'code')}>
                {copied === routeKey + 'code' ? '已复制' : '复制宏正文'}
              </button>
            </div>
            <pre>
              <code>{node.code || '（空宏）'}</code>
            </pre>
          </section>
        )}
        {!!children.length && (
          <section
            className="browser-list"
            aria-label={node.kind === 'record' ? '子记录' : '内容列表'}
          >
            <div className="list-toolbar">
              <label className="search-field">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="m13 13 4 4" />
                </svg>
                <input
                  aria-label={grouped ? '搜索配置类别' : '搜索当前列表'}
                  placeholder={
                    grouped
                      ? '搜索类别，如肖像、邮件、收藏'
                      : '搜索当前列表中的名称或内容'
                  }
                  value={state.query}
                  onChange={(event) =>
                    update({ query: event.currentTarget.value, page: 0 })
                  }
                />
              </label>
              {!grouped && children.some((c) => c.empty) && (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={state.showEmpty}
                    onChange={(event) =>
                      update({
                        showEmpty: event.currentTarget.checked,
                        page: 0,
                      })
                    }
                  />
                  显示空槽
                </label>
              )}
              <span className="record-count">
                {!grouped &&
                  filtered.length > pageSize &&
                  `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} / `}
                {filtered.length} {grouped ? '个类别' : '项'}
                {state.query ? '匹配' : ''}
              </span>
              {!grouped && children.length > 20 && (
                <label className="page-size">
                  每页
                  <select
                    aria-label="每页条数"
                    value={pageSize}
                    onChange={(event) =>
                      update({
                        pageSize: Number(event.currentTarget.value),
                        page: 0,
                      })
                    }
                  >
                    {[20, 60, 120].map((size) => (
                      <option key={size} value={size}>
                        {size} 项
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className={grouped ? 'category-groups' : 'record-groups'}>
              {groups.map((group) => (
                <section key={group} className="navigation-group">
                  {group && <h3>{group}</h3>}
                  <div
                    className={`navigation-list${compact ? ' compact-records' : ''}`}
                  >
                    {displayed
                      .filter(
                        (child) =>
                          (grouped ? (child.group ?? '其他配置') : '') ===
                          group,
                      )
                      .map((child) => (
                        <button
                          key={child.key}
                          className="record-link"
                          onClick={() => open(child)}
                        >
                          <span
                            className={`record-link-text${compact && (child.description?.length ?? 0) <= 24 ? ' inline-record-text' : ''}`}
                          >
                            <strong>{child.title}</strong>
                            {!grouped && child.description && (
                              <small>{child.description}</small>
                            )}
                          </span>
                          {child.children && (
                            <span className="record-link-count">
                              {child.readOnlyData
                                ? '原始数据'
                                : child.kind === 'record'
                                  ? `${child.children.filter((c) => !c.empty).length} 项`
                                  : recordCount(child) > 0
                                    ? `${recordCount(child)} 条记录`
                                    : child.sections?.some((s) => s.rows.length)
                                      ? '设置'
                                      : child.empty
                                        ? '无记录'
                                        : '查看'}
                            </span>
                          )}
                          {!child.children && child.empty && (
                            <span className="record-link-count">空槽</span>
                          )}
                          <Chevron />
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            </div>
            {!filtered.length && (
              <div className="page-empty">
                <h3>{state.query ? '没有匹配的内容' : '当前没有非空记录'}</h3>
                <p>
                  {state.query
                    ? '更换关键词，或清除搜索条件。'
                    : '可勾选“显示空槽”查看空记录。'}
                </p>
                {state.query && (
                  <button onClick={() => update({ query: '', page: 0 })}>
                    清除搜索
                  </button>
                )}
              </div>
            )}
            {!grouped && pages > 1 && (
              <div className="pagination">
                <button
                  disabled={page === 0}
                  onClick={() => update({ page: page - 1 })}
                >
                  上一页
                </button>
                <span>
                  {page + 1} / {pages}
                </span>
                <button
                  disabled={page === pages - 1}
                  onClick={() => update({ page: page + 1 })}
                >
                  下一页
                </button>
              </div>
            )}
          </section>
        )}
        {!children.length &&
          !node.sections?.some((s) => s.rows.length) &&
          node.code === undefined && (
            <div className="page-empty">
              <h3>{node.empty ? '没有保存的记录' : '暂时没有可读内容'}</h3>
              <p>
                {node.empty
                  ? '此类别在当前文件中为空。'
                  : '此类别已保留原始数据，尚未确认的字段可在技术数据中查看。'}
              </p>
              <button onClick={showTechnical}>查看技术数据</button>
            </div>
          )}
      </div>
      {editor}
      <details
        ref={inspector}
        className="technical-inspector"
        open={technicalOpen}
        onToggle={(event) => {
          if (event.currentTarget.open) setTechnical(routeKey);
          else if (technicalOpen) setTechnical(null);
        }}
      >
        <summary>解析说明与原始数据</summary>
        {technicalOpen && (
          <>
            <DecodeCoverage
              coverage={
                node.coverage ?? (node === root ? detail.coverage : undefined)
              }
            />
            <dl className="file-metadata">
              <dt>源文件</dt>
              <dd className="path-value">{detail.summary.relativePath}</dd>
              <dt>SHA-256</dt>
              <dd className="code-value">{detail.sha256 || '未读取'}</dd>
              <dt>文件大小</dt>
              <dd>{detail.summary.byteLength.toLocaleString()} 字节</dd>
              <dt>版本</dt>
              <dd>{String(detail.header.version ?? '不适用')}</dd>
            </dl>
            <button onClick={() => copy(node.raw ?? detail.data, 'json')}>
              {copied === routeKey + 'json' ? '已复制' : '复制 JSON'}
            </button>
            {node === root &&
              detail.warnings.map((warning, i) => (
                <p className="diagnostic-note" key={i}>
                  {warning}
                </p>
              ))}
            <JsonTree value={node.raw ?? detail.data} />
          </>
        )}
      </details>
    </div>
  );
}
