<script lang="ts">
  import type { DecodedFileDetail } from '../../shared/types';
  import JsonTree from './JsonTree.svelte';

  let { detail }: { detail: DecodedFileDetail } = $props();
  let query = $state('');
  let showEmpty = $state(false);
  let page = $state(0);
  let group = $state('0');
  let segmentId = $state('0');
  let raw = $state(false);
  type Row = Record<string, unknown>;
  function rows(value: unknown): Row[] {
    return Array.isArray(value)
      ? value.filter((entry) => entry && typeof entry === 'object')
      : [];
  }
  const data = $derived(detail.data);
  const filename = $derived(detail.summary.name.toUpperCase());
  const mode = $derived(
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
                : 'tree',
  );
  const segments = $derived(rows(data.segments));
  const pageSize = $derived(mode === 'macros' ? 10 : 40);
  const segment = $derived(
    segments.find((entry) => String(entry.id) === segmentId) ?? segments[0],
  );
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
  const baseRows = $derived.by(() => {
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
  });
  const filtered = $derived(
    baseRows.filter(
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
    ),
  );
  const lastPage = $derived(
    Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
  );
  const visible = $derived(
    filtered.slice(
      Math.min(page, lastPage) * pageSize,
      (Math.min(page, lastPage) + 1) * pageSize,
    ),
  );
  const tableMode = $derived(['keys', 'settings', 'hotbar'].includes(mode));
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
</script>

<div class="content-tabs" role="group" aria-label="结果视图">
  <button class:active={!raw} aria-pressed={!raw} onclick={() => (raw = false)}
    >可读内容</button
  >
  <button class:active={raw} aria-pressed={raw} onclick={() => (raw = true)}
    >结构数据</button
  >
</div>

{#if raw}
  <JsonTree value={data} />
{:else if mode === 'segments'}
  <div class="viewer-toolbar">
    <label class="field-label"
      >配置类别<select bind:value={segmentId}
        >{#each segments as item, index (index)}<option value={String(item.id)}
            >{segmentNames[String(item.name)] ?? item.name} · {item.name}</option
          >{/each}</select
      ></label
    ><span class="muted">{segments.length} 个子段</span>
  </div>
  {#if segment}
    <div class="segment-heading">
      <h3>{segmentNames[String(segment.name)] ?? segment.name}</h3>
      <span class="status-badge partial"
        >{segment.status === 'decoded' ? '已解析' : '含未确认字段'}</span
      >
    </div>
    {#key segmentId}<JsonTree value={segment.data} presentation />{/key}
    <details class="technical-details">
      <summary>子段版本与原始字节</summary><JsonTree
        value={{
          version: segment.version,
          offset: segment.offset,
          warnings: segment.warnings,
          rawHex: segment.rawHex,
          decodedHex: segment.decodedHex,
        }}
      />
    </details>
  {:else}<p class="empty-message">
      未能识别配置子段，请查看结构数据和解析说明。
    </p>{/if}
{:else if mode === 'tree'}
  <JsonTree value={data} presentation />
{:else}
  <div class="viewer-toolbar">
    <label class="search-field"
      ><svg viewBox="0 0 20 20" aria-hidden="true"
        ><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg
      ><input
        aria-label="搜索解码内容"
        placeholder={mode === 'macros' ? '搜索宏名称或正文' : '搜索内容'}
        bind:value={query}
        oninput={() => (page = 0)}
      /></label
    >
    {#if mode === 'hotbar'}<label class="field-label"
        >存储组<select bind:value={group} onchange={() => (page = 0)}
          >{#each (data.groupIds as number[]) ?? [] as id (id)}<option
              value={String(id)}
              >{id === 0
                ? '共享'
                : id >= 64
                  ? `PvP 候选组 ${id}`
                  : `职业候选组 ${id}`}</option
            >{/each}</select
        ></label
      >{/if}
    {#if ['macros', 'gearsets', 'hotbar'].includes(mode)}<label
        class="checkbox-field"
        ><input
          type="checkbox"
          bind:checked={showEmpty}
          onchange={() => (page = 0)}
        />显示空槽</label
      >{/if}
  </div>
  <p class="record-count">
    {filtered.length.toLocaleString()} 条{mode === 'hotbar'
      ? showEmpty
        ? '槽位（含空槽）'
        : '非空槽位'
      : '记录'}{#if query}
      · 搜索「{query}」{/if}
  </p>
  {#if !visible.length}<p class="empty-message">
      {query
        ? '没有匹配的内容，请尝试其他关键词。'
        : '暂无非空记录，可勾选“显示空槽”查看全部槽位。'}
    </p>{/if}
  {#if tableMode && visible.length}
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            >{#if mode === 'keys'}<th>操作</th><th>第一按键</th><th>第二按键</th
              >{:else if mode === 'hotbar'}<th>热键栏 / 槽位</th><th
                >内容类型</th
              ><th>内容 ID</th>{:else}<th>配置项</th><th>值</th>{/if}</tr
          ></thead
        >
        <tbody
          >{#each visible as row (row)}<tr
              >{#if mode === 'keys'}<td class="code-value">{row.command}</td><td
                  >{keyLabel((row.keys as unknown[])?.[0])}</td
                ><td>{keyLabel((row.keys as unknown[])?.[1])}</td
                >{:else if mode === 'hotbar'}<td
                  >{Number(row.barIndex) + 1} / {Number(row.slotIndex) + 1}</td
                ><td>{row.commandTypeName}</td><td class="code-value"
                  >{row.commandId}</td
                >{:else}<td
                  ><span class="code-value">{row.name}</span
                  >{#if row.section}<small class="cell-note"
                      >{row.section}</small
                    >{/if}</td
                ><td class="code-value">{row.value}</td>{/if}</tr
            >{/each}</tbody
        >
      </table>
    </div>
  {:else if mode === 'macros'}
    {#each visible as row (row)}<details
        class="macro-record"
        open={row === visible[0]}
      >
        <summary>
          <svg viewBox="0 0 16 16" aria-hidden="true"
            ><path d="m6 3 5 5-5 5" /></svg
          >
          <h3>{row.name || '未命名宏'}</h3>
          <span class="muted"
            >槽位 {String(row.index).padStart(2, '0')} · 图标 {row.iconId ??
              row.iconHex}</span
          >
        </summary>
        <pre><code
            >{(row.lines as string[]).join('\n').trimEnd() || '（空宏）'}</code
          ></pre>
      </details>{/each}
  {:else if mode === 'gearsets'}
    {#each visible as row (row)}<details class="gear-record">
        <summary
          ><span
            ><strong>{row.name || '未命名套装'}</strong><small
              >槽位 {row.recordIndex} · 职业 ID {row.classJobId}</small
            ></span
          ><span>装等 {row.itemLevel}</span></summary
        >
        <div class="table-scroll">
          <table>
            <thead
              ><tr
                ><th>装备槽</th><th>物品 ID</th><th>幻化 ID</th><th>染色 ID</th
                ></tr
              ></thead
            ><tbody
              >{#each rows(row.items) as item (item)}<tr
                  ><td>{item.slot}</td><td
                    >{item.baseItemId}{item.highQuality ? ' · HQ' : ''}</td
                  ><td>{item.glamourId}</td><td
                    >{(item.stainIds as number[]).join(' / ')}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
      </details>{/each}
  {/if}
  {#if filtered.length > pageSize}<div class="pagination">
      <button
        onclick={() => (page = Math.max(0, page - 1))}
        disabled={page === 0}>上一页</button
      ><span>{Math.min(page, lastPage) + 1} / {lastPage + 1}</span><button
        onclick={() => (page = Math.min(lastPage, page + 1))}
        disabled={page >= lastPage}>下一页</button
      >
    </div>{/if}
{/if}
