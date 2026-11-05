import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameDirectory,
  DecodeReport,
  DecodeProgress,
  DecodedFileDetail,
  DecodedFileSummary,
  DatEditModel,
  DatSaveResult,
  EditTarget,
} from '../../shared/types';
import DecodedContent from './DecodedContent';
import type { BrowserViewState } from './DecodedContent';
import { fileDescriptions } from './browser-model';
import { useWorkspaceNavigation } from './workspace-navigation';
import DatEditor from './DatEditor';
import { targetMatches } from './edit-target';

const statusNames = {
  decoded: '可查看',
  partial: '含待确认字段',
  unsupported: '未支持',
  error: '失败',
};
function message(reason: unknown) {
  return reason instanceof Error
    ? reason.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : String(reason);
}

function filterFiles(
  files: DecodedFileSummary[],
  scope: string,
  query: string,
) {
  return files.filter(
    (file) =>
      (scope === 'all' ||
        (scope === 'backup' && file.category === 'backup') ||
        (scope === 'shared' &&
          ['shared', 'config-copy'].includes(file.category)) ||
        file.characterId === scope) &&
      `${file.name} ${file.relativePath} ${fileDescriptions[file.name.toUpperCase()] ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
}

function FileViewer({
  file,
  files,
  path,
  onNavigate,
  onBackToFiles,
  onOpenFile,
  onSaved,
  onDirty,
  onSaving,
  onEditorState,
  canLeave,
  views,
  onViewChange,
}: {
  file: DecodedFileSummary;
  files: DecodedFileSummary[];
  path: string[];
  onNavigate: (path: string[]) => boolean;
  onBackToFiles: () => void;
  onOpenFile: (file: DecodedFileSummary) => void;
  onSaved: (result: DatSaveResult) => void;
  onDirty: (dirty: boolean) => void;
  onSaving: (saving: boolean) => void;
  onEditorState: (editing: boolean) => void;
  canLeave: (preserveView?: boolean) => boolean;
  views: Record<string, BrowserViewState>;
  onViewChange: (key: string, value: BrowserViewState) => void;
}) {
  const [detail, setDetail] = useState<DecodedFileDetail | null>(null),
    [error, setError] = useState('');
  const [loadError, setLoadError] = useState(''),
    [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditing] = useState<DatEditModel | null>(null),
    [editingTarget, setEditingTarget] = useState<EditTarget | null>(null),
    [openingEditor, setOpeningEditor] = useState(false);
  const serial = useRef({ value: 0 });
  useEffect(() => {
    let active = true;
    const generation = serial.current;
    window.gameDirectory.result(file.id).then(
      (value) => {
        if (active) setDetail(value);
      },
      (reason) => {
        if (active) setLoadError(message(reason));
      },
    );
    return () => {
      active = false;
      generation.value++;
    };
  }, [file.id, loadAttempt]);
  async function edit(target: EditTarget) {
    const request = ++serial.current.value;
    setOpeningEditor(true);
    setError('');
    try {
      const model = await window.gameDirectory.edit(file.id);
      if (request !== serial.current.value) return;
      const fields = model.fields.filter((field) =>
        targetMatches(field.id, target),
      );
      if (!fields.length) {
        setError('当前记录没有已验证的可编辑字段，可在技术数据中查看原值。');
        return;
      }
      setEditing({
        ...model,
        fields: fields.map((field) => {
          const match = /\.banner\.\d+\.\d+\.(\d+)/.exec(field.id);
          if (!match) return field;
          const tag = Number(match[1]);
          return {
            ...field,
            group: [1, 2, 3, 4, 5, 7].includes(tag)
              ? '外观与动作'
              : [14, 15, 16, 17, 18].includes(tag)
                ? '灯光'
                : tag === 22
                  ? '人物摘要'
                  : tag === 21
                    ? '保存信息'
                    : '镜头与视线',
          };
        }),
      });
      setEditingTarget(target);
      onEditorState(true);
    } catch (reason) {
      if (request === serial.current.value) setError(message(reason));
    } finally {
      if (request === serial.current.value) setOpeningEditor(false);
    }
  }
  function navigate(next: string[]) {
    if (openingEditor) return false;
    const accepted = onNavigate(next);
    if (accepted) {
      serial.current.value++;
      setEditing(null);
      setError('');
      onEditorState(false);
    }
    return accepted;
  }
  return (
    <div
      className="file-viewer page-frame"
      aria-busy={!detail || openingEditor}
    >
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {loadError ? (
        <div className="page-empty">
          <h2>配置读取失败</h2>
          <p>{loadError}</p>
          <div className="button-group">
            <button
              onClick={() => {
                setLoadError('');
                setLoadAttempt((value) => value + 1);
              }}
            >
              重新读取
            </button>
            <button onClick={onBackToFiles}>返回配置文件</button>
          </div>
        </div>
      ) : !detail ? (
        <div className="loading-page" role="status" aria-label="正在读取配置">
          <span />
          <span />
          <span />
          <p>正在读取配置…</p>
          <button onClick={onBackToFiles}>返回配置文件</button>
        </div>
      ) : detail.summary.error ? (
        <div className="page-empty">
          <h2>文件读取失败</h2>
          <p>{detail.summary.error}</p>
          <button onClick={onBackToFiles}>返回配置文件</button>
        </div>
      ) : (
        <DecodedContent
          detail={detail}
          files={files}
          path={path}
          onNavigate={navigate}
          onBackToFiles={onBackToFiles}
          onOpenFile={onOpenFile}
          onEdit={edit}
          openingEditor={openingEditor}
          editing={!!editing}
          views={views}
          onViewChange={onViewChange}
          editor={
            editing ? (
              <DatEditor
                model={editing}
                contextLabel={editingTarget?.label}
                showContextHeading={false}
                onDirty={onDirty}
                onSaving={onSaving}
                onSaved={(result) => {
                  setEditing(null);
                  setEditingTarget(null);
                  onEditorState(false);
                  onSaved(result);
                }}
                onCancel={() => {
                  if (canLeave(true)) {
                    onDirty(false);
                    setEditing(null);
                    onEditorState(false);
                  }
                }}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

export default function GameDirectoryScanner() {
  const [directories, setDirectories] = useState<GameDirectory[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [scanning, setScanning] = useState(!!window.gameDirectory);
  const [choosing, setChoosing] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(
    window.gameDirectory ? '' : '请在 Electron 桌面应用中打开此页面。',
  );
  const [progress, setProgress] = useState<DecodeProgress>({
    current: 0,
    total: 0,
    filename: '',
  });
  const [report, setReport] = useState<DecodeReport | null>(null);
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [editingActive, setEditingActive] = useState(false);
  const [viewStates, setViewStates] = useState<
    Record<string, Record<string, BrowserViewState>>
  >({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [viewEpoch, setViewEpoch] = useState(0);
  const scanSerial = useRef(0);
  const directory = directories.find((entry) => entry.path === selectedPath);
  const busy =
    scanning || choosing || decoding || saving || !window.gameDirectory;
  const { route, navigate } = useWorkspaceNavigation(() => canLeave());
  const visibleFiles = filterFiles(
    (report?.files ?? []).filter((file) => !file.parentId),
    scope,
    query,
  );
  const selectedFile = report?.files.find(
    (file) => file.relativePath === route.file,
  );

  const clearResults = useCallback(() => {
    setReport(null);
    setSaveMessage('');
    setEditingActive(false);
    setQuery('');
  }, []);

  function chooseDirectory(path: string) {
    setSelectedPath(path);
    clearResults();
  }

  function canLeave(preserveView = false) {
    if (saving) return false;
    if (dirty && !window.confirm('有未保存的修改，确定放弃这些修改吗？'))
      return false;
    if (dirty) setDirty(false);
    if (!preserveView && (dirty || editingActive)) {
      setViewEpoch((value) => value + 1);
      setEditingActive(false);
    }
    return true;
  }
  function saved(result: DatSaveResult) {
    setReport(result.report);
    setDirty(false);
    setSaveMessage('保存成功，已备份原文件。');
    setBackupPath(result.backupPath);
  }

  const invalidateScan = useCallback(() => {
    scanSerial.current++;
  }, []);

  const loadDirectories = useCallback(() => {
    const serial = ++scanSerial.current;
    return window.gameDirectory
      .scan()
      .then(
        (found) => {
          if (serial !== scanSerial.current) return;
          setDirectories(found);
          setSelectedPath(found[0]?.path ?? '');
        },
        (reason: unknown) => {
          if (serial !== scanSerial.current) return;
          const description = message(reason);
          setError(
            /abort/i.test(description)
              ? '扫描已停止，可以手动选择文件夹。'
              : `扫描失败：${description}。也可以手动选择文件夹。`,
          );
        },
      )
      .finally(() => {
        if (serial === scanSerial.current) setScanning(false);
      });
  }, []);

  async function scan() {
    if (!canLeave()) return;
    setScanning(true);
    setError('');
    clearResults();
    await loadDirectories();
  }

  useEffect(() => {
    if (!window.gameDirectory) return;
    const unsubscribe = window.gameDirectory.onProgress(setProgress);
    void loadDirectories();
    return () => {
      invalidateScan();
      unsubscribe();
    };
  }, [loadDirectories, invalidateScan]);

  async function choose() {
    if (!canLeave()) return;
    setChoosing(true);
    setError('');
    try {
      const selected = await window.gameDirectory.choose();
      if (selected) {
        setDirectories((entries) =>
          entries.some((entry) => entry.path === selected.path)
            ? entries.map((entry) =>
                entry.path === selected.path ? selected : entry,
              )
            : [...entries, selected],
        );
        chooseDirectory(selected.path);
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setChoosing(false);
    }
  }

  async function reveal(path: string) {
    try {
      await window.gameDirectory.reveal(path);
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function decode() {
    if (!directory) return;
    if (!canLeave()) return;
    setDecoding(true);
    setCancelling(false);
    setError('');
    clearResults();
    setProgress({ current: 0, total: directory.fileCount, filename: '' });
    try {
      const result = await window.gameDirectory.decode(directory.path);
      setScope(directory.characters[0]?.contentId ?? 'all');
      setReport(result);
      navigate({ file: null, path: [] }, true);
    } catch (reason) {
      setError(`解码未完成：${message(reason)}`);
    } finally {
      setDecoding(false);
      setCancelling(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await window.gameDirectory.cancel();
    } catch (reason) {
      setError(message(reason));
      setCancelling(false);
    }
  }

  async function stopScan() {
    try {
      await window.gameDirectory.cancel();
    } catch (reason) {
      setError(message(reason));
    }
  }

  function changeFilters(nextScope: string, nextQuery: string) {
    if (!canLeave()) return;
    setScope(nextScope);
    setQuery(nextQuery);
  }

  return (
    <section className="workspace">
      <header className="app-header">
        <div>
          <h1>FFXIV DAT Manager</h1>
        </div>
      </header>
      {report && (
        <div className="workspace-status">
          <span>
            {directory?.characters.length ?? 0} 个角色 · {report.processed}{' '}
            个源文件已读取
          </span>
          <span className="muted">{directory?.path}</span>
        </div>
      )}
      <details className="directory-disclosure" open={!report}>
        <summary hidden={!report}>管理目录与重新解码</summary>
        <section
          className="directory-panel"
          aria-labelledby="directory-title"
          aria-busy={scanning || choosing}
        >
          <div className="section-heading">
            <div>
              <h2 id="directory-title">游戏配置目录</h2>
              <p className="muted">
                扫描本机游戏配置，或手动选择包含 FFXIV_CHR 文件夹的目录。
              </p>
            </div>
            <div className="button-group">
              {scanning && <button onClick={stopScan}>停止扫描</button>}
              <button onClick={scan} disabled={busy}>
                {scanning
                  ? '正在扫描…'
                  : directories.length
                    ? '重新扫描'
                    : '扫描游戏目录'}
              </button>
              <button onClick={choose} disabled={busy}>
                {choosing ? '正在选择…' : '选择文件夹'}
              </button>
            </div>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          {scanning ? (
            <div className="locating" role="status">
              <span className="spinner" />
              正在查找游戏配置，请稍候…
            </div>
          ) : directory ? (
            <>
              {directories.length > 1 && (
                <label className="directory-choice field-label">
                  找到 {directories.length} 个配置目录
                  <select
                    value={selectedPath}
                    onChange={(event) =>
                      canLeave() && chooseDirectory(event.currentTarget.value)
                    }
                    disabled={busy}
                  >
                    {directories.map((entry) => (
                      <option key={entry.path} value={entry.path}>
                        {entry.path}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="directory-location">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z" />
                </svg>
                <div>
                  <p className="path-value">{directory.path}</p>
                  <p className="muted">
                    {directory.characters.length} 个角色 · {directory.fileCount}{' '}
                    个 DAT 文件
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => reveal(directory.path)}
                >
                  打开文件夹
                </button>
              </div>
              <div className="character-preview">
                {directory.characters.map((character) => (
                  <div
                    key={character.contentId}
                    className="character-preview-item"
                  >
                    <span className="character-monogram">
                      {character.names[0]?.slice(0, 1) ?? '角'}
                    </span>
                    <span>
                      <strong>
                        {character.names.join(' / ') || '未记录昵称'}
                      </strong>
                      <small>
                        {character.contentId} · {character.fileCount} 个文件
                      </small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() => reveal(character.path)}
                      aria-label={`打开${character.names[0] || '角色'}文件夹`}
                    >
                      打开文件夹
                    </button>
                  </div>
                ))}
              </div>
              <div className="decode-action">
                <button
                  className="primary-button"
                  onClick={decode}
                  disabled={busy || !directory.fileCount}
                >
                  {decoding ? '正在解码…' : report ? '重新解码' : '开始解码'}
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h12m-5-5 5 5-5 5" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <div className="directory-empty">
              <h3>尚未找到角色配置</h3>
              <p className="muted">
                请选择包含 FFXIV_CHR 文件夹的目录，例如 My Games / FINAL FANTASY
                XIV - A Realm Reborn。
              </p>
              <button onClick={choose} disabled={busy}>
                手动选择文件夹
              </button>
            </div>
          )}
          {decoding && (
            <div className="decode-progress" role="status">
              <div>
                <span>
                  {cancelling ? '正在停止…' : '正在解码'} {progress.current} /{' '}
                  {progress.total}
                </span>
                <button
                  className="text-button"
                  onClick={cancel}
                  disabled={cancelling}
                >
                  {cancelling ? '正在停止' : '停止解码'}
                </button>
              </div>
              <progress max={progress.total || 1} value={progress.current} />
              <p className="path-value muted">
                {progress.filename || '准备读取文件…'}
              </p>
            </div>
          )}
        </section>
      </details>
      {report && error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {report && (
        <section className="results-section" aria-label="配置浏览">
          {saveMessage && (
            <div className="save-success">
              <div className="section-heading">
                <span role="status">{saveMessage}</span>
                <button
                  className="text-button"
                  onClick={() => setSaveMessage('')}
                >
                  关闭提示
                </button>
              </div>
              <details>
                <summary>查看备份位置</summary>
                <p className="path-value">{backupPath}</p>
              </details>
            </div>
          )}
          {report.cancelled && (
            <p className="inline-notice" role="status">
              已停止，保留已完成结果（{report.processed} / {report.total}{' '}
              个源文件）。
            </p>
          )}
          {selectedFile ? (
            <FileViewer
              key={`${selectedFile.relativePath}:${viewEpoch}`}
              file={selectedFile}
              files={report.files}
              path={route.path}
              onNavigate={(path) =>
                navigate({ file: selectedFile.relativePath, path })
              }
              onBackToFiles={() => navigate({ file: null, path: [] })}
              onOpenFile={(file) =>
                navigate({ file: file.relativePath, path: [] })
              }
              onSaved={saved}
              onDirty={setDirty}
              onSaving={setSaving}
              onEditorState={setEditingActive}
              canLeave={canLeave}
              views={viewStates[selectedFile.relativePath] ?? {}}
              onViewChange={(key, value) =>
                setViewStates((previous) => ({
                  ...previous,
                  [selectedFile.relativePath]: {
                    ...previous[selectedFile.relativePath],
                    [key]: value,
                  },
                }))
              }
            />
          ) : (
            <div className="file-catalog page-frame">
              <nav className="breadcrumbs" aria-label="当前位置">
                <ol>
                  <li>
                    <span aria-current="page">配置文件</span>
                  </li>
                </ol>
              </nav>
              <header className="page-heading">
                <div>
                  <h2>配置文件</h2>
                  <p className="page-description">
                    选择角色和文件，逐层查看或编辑配置。
                  </p>
                </div>
              </header>
              <div className="list-toolbar">
                <label className="field-label">
                  角色与来源
                  <select
                    aria-label="角色与来源"
                    value={scope}
                    onChange={(event) =>
                      changeFilters(event.currentTarget.value, query)
                    }
                  >
                    <option value="all">全部文件</option>
                    {(directory?.characters ?? []).map((character) => (
                      <option
                        key={character.contentId}
                        value={character.contentId}
                      >
                        {character.names.join(' / ') || '角色'} ·{' '}
                        {character.contentId.slice(-6)}
                      </option>
                    ))}
                    <option value="shared">共享与外观预设</option>
                    <option value="backup">历史备份</option>
                  </select>
                </label>
                <label className="search-field">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="8.5" cy="8.5" r="5.5" />
                    <path d="m13 13 4 4" />
                  </svg>
                  <input
                    aria-label="搜索文件"
                    placeholder="搜索文件名或用途"
                    value={query}
                    onChange={(event) =>
                      changeFilters(scope, event.currentTarget.value)
                    }
                  />
                </label>
                <span className="record-count">
                  {visibleFiles.length} 个文件
                </span>
              </div>
              <div className="navigation-list compact-records file-records">
                {visibleFiles.map((file) => {
                  const character = directory?.characters.find(
                    (c) => c.contentId === file.characterId,
                  );
                  return (
                    <button
                      key={file.id}
                      className="record-link file-link"
                      onClick={() =>
                        navigate({ file: file.relativePath, path: [] })
                      }
                      disabled={saving}
                    >
                      <span className="record-link-text">
                        <strong>{file.name}</strong>
                        <small>
                          {fileDescriptions[file.name.toUpperCase()] ??
                            (file.category === 'backup'
                              ? '历史备份，打开后选择内嵌配置'
                              : '本地游戏配置')}
                        </small>
                      </span>
                      <span className="file-owner">
                        {character?.names.join(' / ') ||
                          file.characterId?.slice(-6) ||
                          (file.category === 'backup' ? '历史备份' : '共享')}
                      </span>
                      <span className={`status-badge ${file.status}`}>
                        {statusNames[file.status]}
                      </span>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m7 4 6 6-6 6" />
                      </svg>
                    </button>
                  );
                })}
              </div>
              {!visibleFiles.length && (
                <div className="page-empty">
                  <h3>没有匹配的文件</h3>
                  <p>尝试其他角色或清除搜索条件。</p>
                  <button onClick={() => changeFilters('all', '')}>
                    显示全部文件
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
