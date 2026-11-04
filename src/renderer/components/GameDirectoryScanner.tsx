import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameDirectory,
  DecodeReport,
  DecodeProgress,
  DecodedFileDetail,
  DecodedFileSummary,
} from '../../shared/types';
import DecodedContent from './DecodedContent';
import DecodeCoverage from './DecodeCoverage';

const statusNames = {
  decoded: '已解析',
  partial: '部分解析',
  unsupported: '未支持',
  error: '失败',
};
const fileDescriptions: Record<string, string> = {
  'MACRO.DAT': '角色宏的名称、图标和正文',
  'MACROSYS.DAT': '共享宏的名称、图标和正文',
  'KEYBIND.DAT': '游戏操作与按键绑定',
  'HOTBAR.DAT': '热键栏中保存的技能、物品与命令',
  'GEARSET.DAT': '装备套装、幻化、染色与魔晶石',
  'ADDON.DAT': '界面窗口与 HUD 布局',
  'COMMON.DAT': '角色通用设置',
  'CONTROL0.DAT': '键盘与鼠标设置',
  'CONTROL1.DAT': '手柄设置',
  'UISAVE.DAT': '收藏、社交、肖像、战术板等配置',
  'ITEMODR.DAT': '背包与兵装库排序',
  'ITEMFDR.DAT': '本地物品搜索缓存',
  'ACQ.DAT': '最近的密语联系人',
  'GS.DAT': '卡组与小游戏配置',
  'LOGFLTR.DAT': '聊天标签页的消息过滤状态',
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
      `${file.name} ${file.relativePath}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
}

// Keyed by file ID so each selection has its own request and view state.
function FileViewer({ file }: { file: DecodedFileSummary }) {
  const [detail, setDetail] = useState<DecodedFileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    window.gameDirectory
      .result(file.id)
      .then(
        (value) => {
          if (active) setDetail(value);
        },
        (reason: unknown) => {
          if (active) setError(message(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file.id]);

  async function copyResult() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.data, null, 2));
      setCopied(true);
    } catch {
      setError('复制失败，请检查剪贴板权限后重试。');
    }
  }

  return (
    <div className="file-viewer" aria-busy={loading}>
      {loading ? (
        <div className="viewer-empty" role="status">
          <span className="spinner" />
          <p>正在读取解码结果…</p>
        </div>
      ) : detail ? (
        <>
          <header className="file-heading">
            <div>
              <div className="file-title">
                <h2>{detail.summary.name}</h2>
                <span className={`status-badge ${detail.summary.status}`}>
                  {statusNames[detail.summary.status]}
                </span>
              </div>
              <p className="muted">
                {fileDescriptions[detail.summary.name.toUpperCase()] ??
                  '本地配置记录'}
              </p>
            </div>
            <button onClick={copyResult}>
              {copied ? '已复制' : '复制 JSON'}
            </button>
          </header>
          <p className="source-path path-value muted">
            {detail.summary.relativePath}
          </p>
          {detail.summary.error ? (
            <div className="error-message" role="alert">
              此文件未能解析：{detail.summary.error}
            </div>
          ) : (
            <>
              {detail.coverage ? (
                <DecodeCoverage coverage={detail.coverage} />
              ) : detail.summary.status === 'partial' ? (
                <p className="partial-note">
                  已读取记录；部分字段含义尚未确认，候选解释与原始值已保留。
                </p>
              ) : detail.summary.status === 'unsupported' ? (
                <p className="partial-note">
                  暂不支持此文件版本，可在文件信息中查看版本。
                </p>
              ) : null}
              <DecodedContent detail={detail} />
            </>
          )}
          <details className="technical-details">
            <summary>
              文件信息与解析说明
              {detail.warnings.length ? `（${detail.warnings.length}）` : ''}
            </summary>
            <dl className="file-metadata">
              <dt>SHA-256</dt>
              <dd className="code-value">{detail.sha256 || '未读取'}</dd>
              <dt>文件大小</dt>
              <dd>{detail.summary.byteLength.toLocaleString()} 字节</dd>
              <dt>文件版本</dt>
              <dd>{String(detail.header.version ?? '不适用')}</dd>
            </dl>
            {detail.warnings.map((warning, index) => (
              <p key={index} className="diagnostic-note">
                {warning}
              </p>
            ))}
          </details>
        </>
      ) : (
        <div className="viewer-empty">
          <h3>选择一个 DAT 文件</h3>
          <p className="muted">在左侧查看文件的解码内容。</p>
        </div>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
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
  const [selectedId, setSelectedId] = useState('');
  const scanSerial = useRef(0);
  const directory = directories.find((entry) => entry.path === selectedPath);
  const busy = scanning || choosing || decoding;
  const visibleFiles = filterFiles(report?.files ?? [], scope, query);
  const selectedFile =
    visibleFiles.find((file) => file.id === selectedId) ?? visibleFiles[0];

  const clearResults = useCallback(() => {
    setReport(null);
    setSelectedId('');
    setQuery('');
  }, []);

  function chooseDirectory(path: string) {
    setSelectedPath(path);
    clearResults();
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
    setDecoding(true);
    setCancelling(false);
    setError('');
    clearResults();
    setProgress({ current: 0, total: directory.fileCount, filename: '' });
    try {
      const result = await window.gameDirectory.decode(directory.path);
      setScope(directory.characters[0]?.contentId ?? 'all');
      setReport(result);
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
    const files = filterFiles(report?.files ?? [], nextScope, nextQuery);
    setScope(nextScope);
    setQuery(nextQuery);
    setSelectedId(
      files.find((file) => file.id === selectedFile?.id)?.id ??
        files[0]?.id ??
        '',
    );
  }

  return (
    <section className="workspace">
      <header className="app-header">
        <div>
          <h1>FFXIV DAT Manager</h1>
        </div>
      </header>
      <section
        className="directory-panel"
        aria-labelledby="directory-title"
        aria-busy={scanning || choosing}
      >
        <div className="section-heading">
          <div>
            <h2 id="directory-title">游戏配置目录</h2>
            <p className="muted">
              自动查找 Documents、Downloads 等位置中的 My Games 文件夹。
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
                    chooseDirectory(event.currentTarget.value)
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
                <button
                  key={character.contentId}
                  className="character-preview-item"
                  onClick={() => reveal(character.path)}
                  title="打开角色文件夹"
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
                </button>
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
      {report && (
        <section className="results-section" aria-labelledby="results-title">
          <div className="section-heading results-heading">
            <div>
              <h2 id="results-title">
                {report.cancelled ? '已停止，保留已完成结果' : '解码结果'}
              </h2>
              <p className="muted">
                已处理 {report.processed} / {report.total} 个文件
                {report.files.some((file) => file.parentId) && (
                  <>
                    ，另展开{' '}
                    {report.files.filter((file) => file.parentId).length}{' '}
                    份备份内配置
                  </>
                )}
                。含未确认字段的内容会单独标注。
              </p>
            </div>
          </div>
          <div className="results-layout">
            <aside className="file-sidebar" aria-label="文件列表">
              <label className="field-label">
                查看范围
                <select
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
                  <option value="shared">共享与配置记录</option>
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
                  placeholder="搜索文件名"
                  value={query}
                  onChange={(event) =>
                    changeFilters(scope, event.currentTarget.value)
                  }
                />
              </label>
              <div className="file-list">
                {visibleFiles.map((file) => (
                  <button
                    key={file.id}
                    className={`file-item${selectedFile?.id === file.id ? ' selected' : ''}${file.parentId !== null ? ' backup-member' : ''}`}
                    aria-pressed={selectedFile?.id === file.id}
                    onClick={() => setSelectedId(file.id)}
                  >
                    <span className="file-name">{file.name}</span>
                    <span className="file-item-meta">
                      <span className={`status-dot ${file.status}`} />
                      {statusNames[file.status]}
                      {file.parentId ? ' · 备份内' : ''}
                      <span>
                        {file.byteLength < 1024
                          ? `${file.byteLength} B`
                          : `${(file.byteLength / 1024).toFixed(1)} KB`}
                      </span>
                    </span>
                  </button>
                ))}
                {!visibleFiles.length && (
                  <p className="empty-message">没有匹配的文件</p>
                )}
              </div>
            </aside>
            {selectedFile ? (
              <FileViewer key={selectedFile.id} file={selectedFile} />
            ) : (
              <div className="file-viewer">
                <div className="viewer-empty">
                  <h3>选择一个 DAT 文件</h3>
                  <p className="muted">在左侧查看文件的解码内容。</p>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
