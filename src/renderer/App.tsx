import { useCallback, useRef, useState } from 'react';
import GameDirectoryScanner from './components/GameDirectoryScanner';
import ManagementWorkspace from './components/ManagementWorkspace';
import { Icon } from './components/management-ui';

export default function App() {
  const [mode, setMode] = useState<'portraits' | 'backups' | 'advanced'>(
    'portraits',
  );
  const [advancedOpened, setAdvancedOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const advancedGuard = useRef<(() => boolean) | null>(null);
  const registerGuard = useCallback((guard: (() => boolean) | null) => {
    advancedGuard.current = guard;
  }, []);
  const changed = useCallback(
    () => setRevision((previous) => previous + 1),
    [],
  );
  function navigate(next: typeof mode) {
    if (busy || next === mode) return;
    if (
      mode === 'advanced' &&
      advancedGuard.current &&
      !advancedGuard.current()
    )
      return;
    if (next === 'advanced') setAdvancedOpened(true);
    setMode(next);
  }
  return (
    <main className="application">
      <header className="app-header manager-app-header">
        <div>
          <h1>FFXIV DAT Manager</h1>
        </div>
      </header>
      <nav className="app-navigation" aria-label="功能导航">
        <button
          aria-current={mode === 'portraits' ? 'page' : undefined}
          disabled={busy}
          onClick={() => navigate('portraits')}
        >
          <Icon name="portrait" />
          肖像管理
        </button>
        <button
          aria-current={mode === 'backups' ? 'page' : undefined}
          disabled={busy}
          onClick={() => navigate('backups')}
        >
          <Icon name="backup" />
          资料夹备份
        </button>
        <button
          aria-current={mode === 'advanced' ? 'page' : undefined}
          disabled={busy}
          onClick={() => navigate('advanced')}
        >
          <Icon name="advanced" />
          高级解析
        </button>
      </nav>
      <ManagementWorkspace
        active={mode !== 'advanced'}
        mode={mode === 'backups' ? 'backups' : 'portraits'}
        onBusy={setBusy}
        onChanged={changed}
      />
      {advancedOpened && (
        <div hidden={mode !== 'advanced'} className="advanced-workspace">
          <header className="manager-heading">
            <div>
              <h2>高级解析</h2>
            </div>
          </header>
          <GameDirectoryScanner
            key={revision}
            embedded
            onNavigationGuard={registerGuard}
          />
        </div>
      )}
    </main>
  );
}
