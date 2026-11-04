import { useState } from 'react';
import type { ReadableSection } from '../../shared/types';

export default function ReadableContent({
  sections,
}: {
  sections: ReadableSection[];
}) {
  const [selected, setSelected] = useState(sections[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const section =
    sections.find((entry) => entry.id === selected) ?? sections[0];
  if (!section)
    return (
      <p className="empty-message">
        此类别尚无已确认的可读字段。完整记录可在“结构数据”中查看。
      </p>
    );
  const filtered = section.rows.filter(
    (row) =>
      !query ||
      Object.values(row).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const current = Math.min(page, pages - 1);
  return (
    <>
      <div className="viewer-toolbar">
        {sections.length > 1 && (
          <label className="field-label">
            查看内容
            <select
              aria-label="查看内容"
              value={section.id}
              onChange={(event) => {
                setSelected(event.currentTarget.value);
                setQuery('');
                setPage(0);
              }}
            >
              {sections.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}（{entry.rows.length}）
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="search-field">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            aria-label="搜索可读内容"
            placeholder="搜索名称或内容"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <h3>{section.title}</h3>
      {section.note && <p className="partial-note">{section.note}</p>}
      <p className="record-count">{filtered.length.toLocaleString()} 条记录</p>
      {filtered.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {section.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice(current * 40, (current + 1) * 40)
                .map((row, index) => (
                  <tr key={index}>
                    {section.columns.map((column) => (
                      <td key={column.key}>{row[column.key] ?? '未记录'}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-message">
          {query
            ? '没有匹配的记录。'
            : '没有可展示的记录；未解释的字段仍保留在结构数据中。'}
        </p>
      )}
      {pages > 1 && (
        <div className="pagination">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            上一页
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
