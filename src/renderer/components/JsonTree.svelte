<script lang="ts">
  import JsonTree from './JsonTree.svelte';

  let {
    value,
    label = '数据',
    depth = 0,
    presentation = false,
  }: {
    value: unknown;
    label?: string;
    depth?: number;
    presentation?: boolean;
  } = $props();
  let expanded = $state(false);
  let limit = $state(40);
  let textLimit = $state(300);
  const names: Record<string, string> = {
    records: '记录',
    entries: '配置项',
    slots: '槽位',
    items: '装备',
    header: '文件头',
    metadataHex: '未知元数据',
    fields: '字段',
    recordCount: '记录数',
    count: '数量',
    name: '名称',
    offset: '数据偏移',
    itemIds: '物品 ID',
    itemCounts: '物品数量',
    retainers: '雇员',
    presets: '预设',
    markers: '标点',
    history: '历史记录',
    favorites: '收藏',
    chunks: '数据块',
    objects: '对象',
    title: '标题',
    text: '文字',
    position: '位置',
    angle: '角度',
    scale: '缩放',
    rgba: '颜色',
    rawHex: '原始字节',
    decodedHex: '解码字节',
    note: '说明',
    contentId: '角色 ID',
    characterContentId: '角色 ID',
    version: '版本',
    contactCount: '联系人数量',
    contacts: '联系人',
    groups: '分组',
    decks: '卡组',
    cardIds: '卡牌 ID',
    containers: '物品排序',
    completeContainer: '容器边界完整',
    segmentCount: '子段数量',
    data: '内容',
    warnings: '解析说明',
    status: '状态',
  };
  const isContainer = $derived(value !== null && typeof value === 'object');
  const technicalKeys = new Set([
    'interpretation',
    'layoutBasis',
    'offsetBasis',
    'note',
    'offset',
    'contentOffset',
    'decodedContentOffset',
    'capacity',
    'reserved',
    'completeFieldStream',
    'completeChunkStream',
    'completePartition',
    'dataType',
    'itemWidth',
  ]);
  const entries = $derived(
    isContainer
      ? Object.entries(value as Record<string, unknown>).filter(
          ([key]) =>
            !presentation ||
            (!technicalKeys.has(key) &&
              (!key.endsWith('Hex') || key === 'contentIdHex')),
        )
      : [],
  );
  const shown = $derived(entries.slice(0, limit));
  const scalar = $derived(
    value === null
      ? '无'
      : typeof value === 'boolean'
        ? value
          ? '是'
          : '否'
        : String(value),
  );
</script>

<div class="data-node" class:root-node={depth === 0}>
  {#if isContainer}
    {#if depth > 0}
      <button
        class="tree-toggle"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <svg viewBox="0 0 16 16" class:expanded aria-hidden="true"
          ><path d="m6 3 5 5-5 5" /></svg
        >
        <span>{names[label] ?? label}</span><small
          >{entries.length} {Array.isArray(value) ? '项' : '字段'}</small
        >
      </button>
    {/if}
    {#if depth === 0 || expanded}
      <div class="tree-children" class:nested={depth > 0}>
        {#if !entries.length}<p class="muted tree-empty">暂无记录</p>{/if}
        {#each shown as [key, child] (key)}
          <JsonTree
            value={child}
            label={Array.isArray(value) ? `[${key}]` : key}
            depth={depth + 1}
            {presentation}
          />
        {/each}
        {#if entries.length > limit}
          <button class="text-button tree-more" onclick={() => (limit += 40)}
            >继续显示 40 项 · 剩余 {entries.length - limit} 项</button
          >
        {/if}
      </div>
    {/if}
  {:else}
    <div class="tree-scalar">
      <span class="tree-label">{names[label] ?? label}</span><span
        class="tree-value"
        >{scalar.slice(0, textLimit)}{#if scalar.length > textLimit}<span
            class="muted">…</span
          ><button class="text-button" onclick={() => (textLimit += 2000)}
            >展开文本（{scalar.length.toLocaleString()} 字符）</button
          >{/if}</span
      >
    </div>
  {/if}
</div>
