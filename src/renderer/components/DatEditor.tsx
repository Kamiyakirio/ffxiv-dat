import { Fragment, useEffect, useMemo, useState } from 'react';
import KeybindingInput from './KeybindingInput';
import type {
  DatEditModel,
  DatSaveResult,
  EditableField,
  EditValue,
} from '../../shared/types';

function ReferencePicker({
  field,
  disabled,
  onChange,
}: {
  field: EditableField;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ value: number; label: string }[]>(
    [],
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (!query.trim() || !field.reference) return;
    let active = true;
    const timer = window.setTimeout(() => {
      window.gameDirectory.names(field.reference!, query).then(
        (values) => {
          if (active) {
            setOptions(values);
            setError('');
          }
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [field.reference, query]);
  return (
    <div className="reference-picker">
      <button
        className="text-button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '收起名称查找' : '按名称查找'}
      </button>
      {open && (
        <>
          <input
            aria-label={`${field.label}名称查找`}
            placeholder="输入名称或编号"
            value={query}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setOptions([]);
            }}
          />
          {!!options.length && (
            <div className="reference-options">
              {options
                .filter((option) => option.value <= field.max!)
                .map((option) => (
                  <button
                    key={option.value}
                    disabled={disabled}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label} · {option.value}
                  </button>
                ))}
            </div>
          )}
          {error && <small role="alert">{error}</small>}
        </>
      )}
    </div>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : String(reason);
}
function valueLabel(value: EditValue) {
  return typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
}
function invalid(field: EditableField, value: EditValue) {
  if (field.type === 'number') {
    const n = Number(value);
    if (
      value === '' ||
      !Number.isFinite(n) ||
      n < field.min! ||
      n > field.max! ||
      (field.step === 1 && !Number.isInteger(n))
    )
      return `请输入 ${field.min} 至 ${field.max} 范围内的${field.step === 1 ? '整数' : '数值'}`;
  }
  if (
    field.type === 'text' &&
    (/[\0\r\n]/.test(String(value)) ||
      new TextEncoder().encode(String(value)).length > field.maxBytes!)
  )
    return `最多 ${field.maxBytes} 个 UTF-8 字节，不允许换行或空字符`;
  return '';
}
export default function DatEditor({
  model,
  onSaved,
  onCancel,
  onDirty,
  onSaving,
  contextLabel,
  showContextHeading = true,
}: {
  model: DatEditModel;
  onSaved: (result: DatSaveResult) => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  onSaving: (saving: boolean) => void;
  contextLabel?: string;
  showContextHeading?: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, EditValue>>({});
  const [group, setGroup] = useState(
    contextLabel ? '' : (model.fields[0]?.group ?? ''),
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(
    () => [...new Set(model.fields.map((f) => f.group))],
    [model],
  );
  const compact = !!contextLabel && model.fields.length <= 40;
  const orderedFields = compact
    ? [...model.fields].sort(
        (a, b) => groups.indexOf(a.group) - groups.indexOf(b.group),
      )
    : model.fields;
  const changes = model.fields.filter((f) => f.id in drafts);
  const invalidFields = changes.filter((f) => invalid(f, drafts[f.id]));
  const filtered = orderedFields.filter(
    (f) =>
      (!group || f.group === group) &&
      `${f.group} ${f.label} ${f.displayValue ?? ''} ${f.value}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const visible = filtered.slice(
    Math.min(page, pages - 1) * 40,
    (Math.min(page, pages - 1) + 1) * 40,
  );
  useEffect(() => {
    if (!changes.length) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [changes.length]);
  function change(field: EditableField, value: EditValue) {
    const next = { ...drafts };
    const normalized =
      field.type === 'number' && value !== '' ? Number(value) : value;
    if (normalized === field.value) delete next[field.id];
    else next[field.id] = value;
    setDrafts(next);
    onDirty(Object.keys(next).length > 0);
    setError('');
  }
  async function save() {
    if (!changes.length || invalidFields.length) return;
    setSaving(true);
    onSaving(true);
    setError('');
    try {
      const result = await window.gameDirectory.save({
        id: model.id,
        sha256: model.sha256,
        changes: changes.map((f) => ({
          id: f.id,
          value: f.type === 'number' ? Number(drafts[f.id]) : drafts[f.id],
        })),
      });
      onDirty(false);
      onSaved(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }
  return (
    <section className="dat-editor" aria-label="DAT 编辑器" aria-busy={saving}>
      {contextLabel && showContextHeading && <h3>正在编辑：{contextLabel}</h3>}
      <div className="editor-notes">
        <p>保存前请退出游戏。保存时会自动备份，并检查文件是否被外部修改。</p>
        {model.notes
          .filter((note) => !note.startsWith('仅开放已确认的存储字段'))
          .map((note) => (
            <p key={note}>{note}</p>
          ))}
      </div>
      {!model.fields.length ? (
        <p>
          {contextLabel
            ? '当前项目没有已验证的可编辑字段。'
            : '此文件没有已验证的可编辑字段。'}
        </p>
      ) : (
        <>
          {!compact && (
            <div className="editor-controls">
              {groups.length > 1 && (
                <label className="field-label">
                  编辑类别
                  <select
                    aria-label="编辑类别"
                    value={group}
                    disabled={saving}
                    onChange={(event) => {
                      setGroup(event.currentTarget.value);
                      setPage(0);
                    }}
                  >
                    <option value="">全部类别</option>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field-label">
                搜索字段
                <input
                  aria-label="搜索可编辑字段"
                  value={query}
                  disabled={saving}
                  placeholder="名称、编号或当前内容"
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                    setGroup('');
                    setPage(0);
                  }}
                />
              </label>
            </div>
          )}
          {!compact && (
            <p className="muted">
              {model.fields.length.toLocaleString()} 个可编辑字段 · 当前匹配{' '}
              {filtered.length.toLocaleString()} 个
            </p>
          )}
          <div className="editor-fields">
            {visible.map((storedField, fieldIndex) => {
              const referenceType = storedField.referenceType;
              const field = {
                ...storedField,
                reference: referenceType
                  ? referenceType.sheets[
                      String(
                        drafts[referenceType.fieldId] ??
                          model.fields.find(
                            (f) => f.id === referenceType.fieldId,
                          )?.value,
                      )
                    ]
                  : storedField.reference,
              };
              const value = drafts[field.id] ?? field.value,
                issue = invalid(field, value),
                changed = field.id in drafts;
              return (
                <Fragment key={field.id}>
                  {compact &&
                    groups.length > 1 &&
                    (fieldIndex === 0 ||
                      visible[fieldIndex - 1].group !== field.group) && (
                      <h3 className="editor-group-heading">{field.group}</h3>
                    )}
                  <div
                    className={`editor-field${changed ? ' changed' : ''}`}
                    key={field.id}
                  >
                    <label htmlFor={`edit-${field.id}`}>
                      <strong>{field.label}</strong>
                      {!contextLabel && <small>{field.group}</small>}
                    </label>
                    <div>
                      {field.id.startsWith('keybind.') ? (
                        <KeybindingInput
                          id={`edit-${field.id}`}
                          value={value}
                          disabled={saving}
                          onChange={(value) => change(field, value)}
                        />
                      ) : field.type === 'boolean' ? (
                        <input
                          id={`edit-${field.id}`}
                          type="checkbox"
                          checked={!!value}
                          disabled={saving}
                          onChange={(event) =>
                            change(field, event.currentTarget.checked)
                          }
                        />
                      ) : field.choices ? (
                        <select
                          id={`edit-${field.id}`}
                          value={String(value)}
                          disabled={saving}
                          onChange={(event) =>
                            change(field, event.currentTarget.value)
                          }
                        >
                          {!field.choices.some(
                            (c) => c.value === Number(value),
                          ) && (
                            <option value={String(value)}>
                              原值 {String(value)}
                            </option>
                          )}
                          {field.choices.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label} · {choice.value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`edit-${field.id}`}
                          type={field.type === 'number' ? 'number' : 'text'}
                          step={field.step ?? 'any'}
                          min={field.min}
                          max={field.max}
                          value={String(value)}
                          disabled={saving}
                          aria-invalid={!!issue}
                          onChange={(event) =>
                            change(field, event.currentTarget.value)
                          }
                        />
                      )}
                      {field.displayValue && (
                        <small className="muted">
                          原值：{field.displayValue}
                        </small>
                      )}
                      {field.reference && (
                        <ReferencePicker
                          field={field}
                          disabled={saving}
                          onChange={(value) => change(field, value)}
                        />
                      )}
                      {field.type === 'text' && (
                        <small className="muted">
                          {new TextEncoder().encode(String(value)).length} /{' '}
                          {field.maxBytes} 字节
                        </small>
                      )}
                      {issue && (
                        <small className="editor-error" role="alert">
                          {issue}
                        </small>
                      )}
                      {changed && (
                        <small className="muted">
                          修改前：{valueLabel(field.value)}{' '}
                          <button
                            className="text-button"
                            disabled={saving}
                            onClick={() => change(field, field.value)}
                          >
                            还原此项
                          </button>
                        </small>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
          {!visible.length && <p className="muted">没有匹配的字段。</p>}
          {pages > 1 && (
            <div className="editor-pagination">
              <button
                disabled={!page || saving}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>
                {Math.min(page, pages - 1) + 1} / {pages}
              </span>
              <button
                disabled={page >= pages - 1 || saving}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
          {!!changes.length && (
            <details className="editor-review">
              <summary>
                待保存的 {changes.length} 项修改
                {invalidFields.length
                  ? `（${invalidFields.length} 项需要修正）`
                  : ''}
              </summary>
              <ul>
                {changes.map((f) => (
                  <li key={f.id}>
                    {f.group} / {f.label}：{valueLabel(f.value)} →{' '}
                    {valueLabel(drafts[f.id])}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <footer className="editor-actions">
        <span role="status">
          {saving ? '正在备份、校验并保存…' : `${changes.length} 项未保存修改`}
        </span>
        <div className="button-group">
          <button disabled={saving} onClick={onCancel}>
            取消编辑
          </button>
          <button
            className="primary-button"
            disabled={saving || !changes.length || !!invalidFields.length}
            onClick={save}
          >
            {saving ? '正在保存…' : '保存并备份'}
          </button>
        </div>
      </footer>
    </section>
  );
}
