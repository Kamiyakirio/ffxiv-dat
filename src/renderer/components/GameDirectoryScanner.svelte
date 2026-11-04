<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    GameDirectory,
    DecodeReport,
    DecodeProgress,
    DecodedFileDetail,
    DecodedFileSummary,
  } from '../../shared/types';
  import DecodedContent from './DecodedContent.svelte';

  let directories = $state<GameDirectory[]>([]);
  let selectedPath = $state('');
  let scanning = $state(true);
  let choosing = $state(false);
  let decoding = $state(false);
  let cancelling = $state(false);
  let error = $state('');
  let progress = $state<DecodeProgress>({ current: 0, total: 0, filename: '' });
  let report = $state<DecodeReport | null>(null);
  let scope = $state('all');
  let query = $state('');
  let selectedId = $state('');
  let detail = $state<DecodedFileDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state('');
  let copied = $state(false);
  let requestSerial = 0;
  const directory = $derived(
    directories.find((entry) => entry.path === selectedPath),
  );
  const busy = $derived(scanning || choosing || decoding);
  const stage = $derived(report ? 3 : decoding ? 2 : directory ? 1 : 0);
  const visibleFiles = $derived(
    (report?.files ?? []).filter(
      (file) =>
        (scope === 'all' ||
          (scope === 'backup' && file.category === 'backup') ||
          (scope === 'shared' &&
            ['shared', 'config-copy'].includes(file.category)) ||
          file.characterId === scope) &&
        `${file.name} ${file.relativePath}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  );
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
  function clearResults() {
    requestSerial++;
    report = null;
    detail = null;
    selectedId = '';
    detailError = '';
    query = '';
  }
  function chooseDirectory(path: string) {
    selectedPath = path;
    clearResults();
  }
  async function scan() {
    scanning = true;
    error = '';
    clearResults();
    try {
      directories = await window.gameDirectory.scan();
      selectedPath = directories[0]?.path ?? '';
    } catch (reason) {
      error =
        message(reason).includes('abort') || message(reason).includes('Abort')
          ? '扫描已停止，可以手动选择文件夹。'
          : `扫描失败：${message(reason)}。也可以手动选择文件夹。`;
    } finally {
      scanning = false;
    }
  }
  async function choose() {
    choosing = true;
    error = '';
    try {
      const selected = await window.gameDirectory.choose();
      if (selected) {
        if (!directories.some((entry) => entry.path === selected.path))
          directories = [...directories, selected];
        else
          directories = directories.map((entry) =>
            entry.path === selected.path ? selected : entry,
          );
        chooseDirectory(selected.path);
      }
    } catch (reason) {
      error = message(reason);
    } finally {
      choosing = false;
    }
  }
  async function reveal(path: string) {
    try {
      await window.gameDirectory.reveal(path);
    } catch (reason) {
      error = message(reason);
    }
  }
  async function selectFile(file: DecodedFileSummary) {
    const serial = ++requestSerial;
    selectedId = file.id;
    detail = null;
    detailError = '';
    detailLoading = true;
    copied = false;
    try {
      const value = await window.gameDirectory.result(file.id);
      if (serial === requestSerial) detail = value;
    } catch (reason) {
      if (serial === requestSerial) detailError = message(reason);
    } finally {
      if (serial === requestSerial) detailLoading = false;
    }
  }
  function changeFilter() {
    const files = visibleFiles;
    if (!files.some((file) => file.id === selectedId)) {
      if (files[0]) void selectFile(files[0]);
      else {
        requestSerial++;
        selectedId = '';
        detail = null;
        detailLoading = false;
      }
    }
  }
  $effect(() => {
    if (report) changeFilter();
  });

  async function decode() {
    if (!directory) return;
    decoding = true;
    cancelling = false;
    error = '';
    clearResults();
    progress = { current: 0, total: directory.fileCount, filename: '' };
    try {
      report = await window.gameDirectory.decode(directory.path);
      scope = directory.characters[0]?.contentId ?? 'all';
      const first =
        report.files.find((file) => file.characterId === scope) ??
        report.files[0];
      if (first) await selectFile(first);
    } catch (reason) {
      error = `解码未完成：${message(reason)}`;
    } finally {
      decoding = false;
      cancelling = false;
    }
  }
  async function cancel() {
    cancelling = true;
    try {
      await window.gameDirectory.cancel();
    } catch (reason) {
      error = message(reason);
      cancelling = false;
    }
  }
  async function copyResult() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.data, null, 2));
      copied = true;
    } catch {
      detailError = '复制失败，请检查剪贴板权限后重试。';
    }
  }
  onMount(() => {
    if (!window.gameDirectory) {
      scanning = false;
      error = '请在 Electron 桌面应用中打开此页面。';
      return;
    }
    const unsubscribe = window.gameDirectory.onProgress(
      (value) => (progress = value),
    );
    void scan();
    return unsubscribe;
  });
</script>

<section class="workspace">
  <header class="app-header">
    <div>
      <h1>FFXIV DAT Manager</h1>
    </div>
  </header>
  <!-- <ol class="steps" aria-label="解码流程">
    {#each ['扫描目录', '定位文件夹', '解码 DAT', '查看结果'] as label, index (label)}<li
        class:current={stage === index}
        class:complete={stage > index}
        aria-current={stage === index ? 'step' : undefined}
      >
        <span>{index + 1}</span>{label}
      </li>{/each}
  </ol> -->

  <section
    class="directory-panel"
    aria-labelledby="directory-title"
    aria-busy={scanning || choosing}
  >
    <div class="section-heading">
      <div>
        <h2 id="directory-title">游戏配置目录</h2>
        <p class="muted">
          自动查找 Documents、Downloads 等位置中的 My Games 文件夹。
        </p>
      </div>
      <div class="button-group">
        {#if scanning}<button onclick={() => window.gameDirectory.cancel()}
            >停止扫描</button
          >{/if}
        <button onclick={scan} disabled={busy}
          >{scanning
            ? '正在扫描…'
            : directories.length
              ? '重新扫描'
              : '扫描游戏目录'}</button
        ><button onclick={choose} disabled={busy}
          >{choosing ? '正在选择…' : '选择文件夹'}</button
        >
      </div>
    </div>
    {#if error}<div class="error-message" role="alert">{error}</div>{/if}
    {#if scanning}<div class="locating" role="status">
        <span class="spinner"></span>正在查找游戏配置，请稍候…
      </div>
    {:else if directory}
      {#if directories.length > 1}<label class="directory-choice field-label"
          >找到 {directories.length} 个配置目录<select
            value={selectedPath}
            onchange={(event) => chooseDirectory(event.currentTarget.value)}
            disabled={busy}
            >{#each directories as entry (entry.path)}<option value={entry.path}
                >{entry.path}</option
              >{/each}</select
          ></label
        >{/if}
      <div class="directory-location">
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z" /></svg
        >
        <div>
          <p class="path-value">{directory.path}</p>
          <p class="muted">
            {directory.characters.length} 个角色 · {directory.fileCount} 个 DAT 文件
          </p>
        </div>
        <button class="text-button" onclick={() => reveal(directory.path)}
          >打开文件夹</button
        >
      </div>
      <div class="character-preview">
        {#each directory.characters as character (character.contentId)}<button
            class="character-preview-item"
            onclick={() => reveal(character.path)}
            title="打开角色文件夹"
            ><span class="character-monogram"
              >{character.names[0]?.slice(0, 1) ?? '角'}</span
            ><span
              ><strong>{character.names.join(' / ') || '未记录昵称'}</strong
              ><small
                >{character.contentId} · {character.fileCount} 个文件</small
              ></span
            ></button
          >{/each}
      </div>
      <div class="decode-action">
        <button
          class="primary-button"
          onclick={decode}
          disabled={busy || !directory.fileCount}
          >{decoding ? '正在解码…' : report ? '重新解码' : '开始解码'}<svg
            viewBox="0 0 20 20"
            aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg
          ></button
        >
      </div>
    {:else}<div class="directory-empty">
        <h3>尚未找到角色配置</h3>
        <p class="muted">
          请选择包含 FFXIV_CHR 文件夹的目录，例如 My Games / FINAL FANTASY XIV -
          A Realm Reborn。
        </p>
        <button onclick={choose} disabled={busy}>手动选择文件夹</button>
      </div>{/if}
    {#if decoding}<div class="decode-progress" role="status">
        <div>
          <span
            >{cancelling ? '正在停止…' : '正在解码'}
            {progress.current} / {progress.total}</span
          ><button class="text-button" onclick={cancel} disabled={cancelling}
            >{cancelling ? '正在停止' : '停止解码'}</button
          >
        </div>
        <progress max={progress.total || 1} value={progress.current}></progress>
        <p class="path-value muted">{progress.filename || '准备读取文件…'}</p>
      </div>{/if}
  </section>

  {#if report}
    <section class="results-section" aria-labelledby="results-title">
      <div class="section-heading results-heading">
        <div>
          <h2 id="results-title">
            {report.cancelled ? '已停止，保留已完成结果' : '解码结果'}
          </h2>
          <p class="muted">
            已处理 {report.processed} / {report.total} 个文件{#if report.files.some((file) => file.parentId)}，另展开
              {report.files.filter((file) => file.parentId).length} 份备份内配置{/if}。含未确认字段的内容会单独标注。
          </p>
        </div>
      </div>
      <div class="results-layout">
        <aside class="file-sidebar" aria-label="文件列表">
          <label class="field-label"
            >查看范围<select bind:value={scope}
              ><option value="all">全部文件</option
              >{#each directory?.characters ?? [] as character (character.contentId)}<option
                  value={character.contentId}
                  >{character.names.join(' / ') || '角色'} · {character.contentId.slice(
                    -6,
                  )}</option
                >{/each}<option value="shared">共享与配置记录</option><option
                value="backup">历史备份</option
              ></select
            ></label
          ><label class="search-field"
            ><svg viewBox="0 0 20 20" aria-hidden="true"
              ><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg
            ><input
              aria-label="搜索文件"
              placeholder="搜索文件名"
              bind:value={query}
            /></label
          >
          <div class="file-list">
            {#each visibleFiles as file (file.id)}<button
                class="file-item"
                class:selected={selectedId === file.id}
                class:backup-member={file.parentId !== null}
                aria-pressed={selectedId === file.id}
                onclick={() => selectFile(file)}
                ><span class="file-name">{file.name}</span><span
                  class="file-item-meta"
                  ><span class={`status-dot ${file.status}`}
                  ></span>{statusNames[file.status]}{file.parentId
                    ? ' · 备份内'
                    : ''}<span
                    >{file.byteLength < 1024
                      ? `${file.byteLength} B`
                      : `${(file.byteLength / 1024).toFixed(1)} KB`}</span
                  ></span
                ></button
              >{/each}{#if !visibleFiles.length}<p class="empty-message">
                没有匹配的文件
              </p>{/if}
          </div>
        </aside>
        <div class="file-viewer" aria-busy={detailLoading}>
          {#if detailLoading}<div class="viewer-empty" role="status">
              <span class="spinner"></span>
              <p>正在读取解码结果…</p>
            </div>
          {:else if detail}
            <header class="file-heading">
              <div>
                <div class="file-title">
                  <h2>{detail.summary.name}</h2>
                  <span class={`status-badge ${detail.summary.status}`}
                    >{statusNames[detail.summary.status]}</span
                  >
                </div>
                <p class="muted">
                  {fileDescriptions[detail.summary.name.toUpperCase()] ??
                    '本地配置记录'}
                </p>
              </div>
              <button onclick={copyResult}
                >{copied ? '已复制' : '复制 JSON'}</button
              >
            </header>
            <p class="source-path path-value muted">
              {detail.summary.relativePath}
            </p>
            {#if detail.summary.error}<div class="error-message" role="alert">
                此文件未能解析：{detail.summary.error}
              </div>{:else}{#if detail.summary.status === 'partial'}<p
                  class="partial-note"
                >
                  已读取记录；部分字段含义尚未确认，候选解释与原始值已保留。
                </p>{:else if detail.summary.status === 'unsupported'}<p
                  class="partial-note"
                >
                  暂不支持此文件版本，可在文件信息中查看版本。
                </p>{/if}{#key detail.summary.id}<DecodedContent
                  {detail}
                />{/key}{/if}
            <details class="technical-details">
              <summary
                >文件信息与解析说明{detail.warnings.length
                  ? `（${detail.warnings.length}）`
                  : ''}</summary
              >
              <dl class="file-metadata">
                <dt>SHA-256</dt>
                <dd class="code-value">{detail.sha256 || '未读取'}</dd>
                <dt>文件大小</dt>
                <dd>{detail.summary.byteLength.toLocaleString()} 字节</dd>
                <dt>文件版本</dt>
                <dd>{String(detail.header.version ?? '不适用')}</dd>
              </dl>
              {#each detail.warnings as warning, index (index)}<p
                  class="diagnostic-note"
                >
                  {warning}
                </p>{/each}
            </details>
          {:else}<div class="viewer-empty">
              <h3>选择一个 DAT 文件</h3>
              <p class="muted">在左侧查看文件的解码内容。</p>
            </div>{/if}
          {#if detailError}<div class="error-message" role="alert">
              {detailError}
            </div>{/if}
        </div>
      </div>
    </section>
  {/if}
</section>
