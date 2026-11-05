import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameDirectory } from '../../shared/types';
import PortraitManager from './PortraitManager';
import BackupManager from './BackupManager';
import { Icon, errorMessage } from './management-ui';

export interface CopiedPortraits {
  code: string;
  count: number;
  source: string;
}

export default function ManagementWorkspace({
  mode,
  active,
  onBusy,
  onChanged,
}: {
  mode: 'portraits' | 'backups';
  active: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const [directories, setDirectories] = useState<GameDirectory[]>([]);
  const [selected, setSelected] = useState('');
  const [scanning, setScanning] = useState(!!window.gameDirectory);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<CopiedPortraits | null>(null);
  const serial = useRef({ value: 0 });
  const busyRef = useRef(false);
  const directory = directories.find((d) => d.path === selected);
  const native = !!window.gameDirectory && !!window.characterManager;
  const busy = !!working;

  const reportError = useCallback(
    (reason: unknown) => setError(errorMessage(reason)),
    [],
  );
  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setWorking(label);
      setError('');
      setNotice('');
      onBusy(true);
      try {
        await action();
      } catch (reason) {
        reportError(reason);
      } finally {
        busyRef.current = false;
        setWorking('');
        onBusy(false);
      }
    },
    [onBusy, reportError],
  );

  const scan = useCallback(() => {
    if (!window.gameDirectory) return Promise.resolve();
    const request = ++serial.current.value;
    return window.gameDirectory
      .scan()
      .then(
        (found) => {
          if (request !== serial.current.value) return;
          setDirectories((previous) => [
            ...found,
            ...previous.filter((d) => !found.some((f) => f.path === d.path)),
          ]);
          setSelected((previous) => previous || found[0]?.path || '');
        },
        (reason) => {
          if (request === serial.current.value) reportError(reason);
        },
      )
      .finally(() => {
        if (request === serial.current.value) setScanning(false);
      });
  }, [reportError]);
  useEffect(() => {
    const generation = serial.current;
    void scan();
    return () => {
      generation.value++;
    };
  }, [scan]);

  async function choose() {
    await run('正在选择资料夹…', async () => {
      const chosen = await window.gameDirectory.choose();
      if (!chosen) return;
      // A late scan must never replace a user's manual selection.
      serial.current.value++;
      setScanning(false);
      setDirectories((previous) => [
        ...previous.filter((d) => d.path !== chosen.path),
        chosen,
      ]);
      setSelected(chosen.path);
    });
  }

  return (
    <section hidden={!active} className="management-workspace">
      <section className="manager-location" aria-label="游戏配置目录">
        <Icon name="folder" />
        <div className="location-current">
          <span className="field-caption">游戏配置目录</span>
          {directories.length > 1 ? (
            <select
              aria-label="游戏配置目录"
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setError('');
                setNotice('');
              }}
            >
              {directories.map((d) => (
                <option key={d.path} value={d.path}>
                  {d.path}
                </option>
              ))}
            </select>
          ) : (
            <span className="path-value">
              {directory?.path ??
                (scanning ? '正在查找游戏配置…' : '未选择资料夹')}
            </span>
          )}
        </div>
        {directory && (
          <span className="location-count">
            {directory.characters.length} 个角色
          </span>
        )}
        <div className="button-group">
          {scanning ? (
            <button
              disabled={busy || !window.gameDirectory}
              onClick={() =>
                void run('正在停止扫描…', async () => {
                  await window.gameDirectory.cancel();
                  serial.current.value++;
                  setScanning(false);
                })
              }
            >
              停止扫描
            </button>
          ) : (
            <button
              disabled={busy || !window.gameDirectory}
              onClick={() => {
                setScanning(true);
                setError('');
                void scan();
              }}
            >
              重新扫描
            </button>
          )}
          <button disabled={busy || !window.gameDirectory} onClick={choose}>
            选择文件夹
          </button>
        </div>
      </section>
      {!native && (
        <p className="error-message" role="alert">
          请在 Electron 桌面应用中打开此页面。
        </p>
      )}
      {error && (
        <div className="error-message manager-message" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => setError('')}>
            关闭提示
          </button>
        </div>
      )}
      {notice && (
        <div className="save-success manager-message">
          <span role="status">{notice}</span>
          <button className="text-button" onClick={() => setNotice('')}>
            关闭提示
          </button>
        </div>
      )}
      {working && (
        <p className="operation-progress" role="status">
          <span className="spinner" />
          {working}
        </p>
      )}
      {directory && native ? (
        mode === 'portraits' ? (
          <PortraitManager
            key={directory.path}
            active={active}
            directory={directory}
            busy={busy}
            run={run}
            onError={reportError}
            notify={setNotice}
            copied={copied}
            onCopy={setCopied}
            onChanged={onChanged}
          />
        ) : (
          <BackupManager
            key={directory.path}
            active={active}
            directory={directory}
            busy={busy}
            run={run}
            onError={reportError}
            notify={setNotice}
            onChanged={onChanged}
          />
        )
      ) : (
        <div className="manager-empty" aria-busy={scanning}>
          <Icon name={mode === 'portraits' ? 'portrait' : 'backup'} />
          <h2>{scanning ? '正在查找角色资料夹' : '未选择游戏配置目录'}</h2>
          <p>
            {scanning
              ? '可手动选择资料夹。'
              : '选择 My Games / FINAL FANTASY XIV - A Realm Reborn，或其中一个 FFXIV_CHR 角色资料夹。'}
          </p>
          <button
            className="primary-button"
            disabled={busy || !window.gameDirectory}
            onClick={choose}
          >
            选择文件夹
          </button>
        </div>
      )}
    </section>
  );
}
