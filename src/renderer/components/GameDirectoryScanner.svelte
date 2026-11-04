<script lang="ts">
  import { onMount } from 'svelte';

  let scanning = $state(true);
  let directory = $state<string | null>(null);
  let error = $state('');

  async function scan() {
    scanning = true;
    directory = null;
    error = '';

    try {
      directory = await window.gameDirectory.scan();
    } catch {
      error = '扫描失败，请重试';
    } finally {
      scanning = false;
    }
  }

  onMount(() => {
    void scan();
  });
</script>

<section class="scanner" aria-labelledby="scanner-title" aria-busy={scanning}>
  <header>
    <div>
      <p class="eyebrow">本机目录</p>
      <h1 id="scanner-title">FFXIV 文件夹</h1>
    </div>
    <button type="button" onclick={scan} disabled={scanning}>
      {scanning ? '扫描中…' : '重新扫描'}
    </button>
  </header>

  <p class="description">自动扫描磁盘，查找以下目录结构。</p>
  <p class="pattern">game / My Games / FINAL FANTASY XIV - A Realm Reborn</p>

  <div class="result" role="status" aria-live="polite">
    {#if scanning}
      <span class="indicator scanning" aria-hidden="true"></span>
      <div>
        <p class="result-title">正在扫描磁盘…</p>
        <p class="hint">首次扫描可能需要一些时间。</p>
      </div>
    {:else if error}
      <span class="indicator missing" aria-hidden="true"></span>
      <p class="result-title">{error}</p>
    {:else if directory}
      <span class="indicator found" aria-hidden="true"></span>
      <div>
        <p class="result-title">已找到</p>
        <code class="path">{directory}</code>
      </div>
    {:else}
      <span class="indicator missing" aria-hidden="true"></span>
      <div>
        <p class="result-title">找不到</p>
        <p class="hint">未在可访问的磁盘目录中找到匹配的文件夹。</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .scanner {
    padding: 28px;
    background: #fff;
    border: 1px solid #e4e7ec;
    border-radius: 16px;
    box-shadow: 0 4px 24px #10182805;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  p {
    margin: 0;
  }

  .eyebrow {
    color: #667085;
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  h1 {
    margin: 6px 0 0;
    font-size: 22px;
    font-weight: 600;
  }

  button {
    flex-shrink: 0;
    padding: 9px 15px;
    border: 1px solid #d0d5dd;
    border-radius: 8px;
    background: #fff;
    color: #344054;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:hover:enabled {
    background: #f2f4f7;
  }

  button:focus-visible {
    outline: 3px solid #a4bcfd;
    outline-offset: 3px;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .description {
    margin-top: 24px;
    color: #667085;
    font-size: 14px;
  }

  .pattern {
    margin-top: 8px;
    color: #475467;
    font-size: 12px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .result {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 72px;
    margin-top: 24px;
    padding: 18px;
    border-radius: 10px;
    background: #f8fafc;
  }

  .result > div {
    min-width: 0;
  }

  .indicator {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 7px;
    border-radius: 50%;
  }

  .scanning {
    background: #6172f3;
    box-shadow: 0 0 0 4px #eef2ff;
  }

  .found {
    background: #12b76a;
  }

  .missing {
    background: #98a2b3;
  }

  .result-title {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
  }

  .hint,
  .path {
    display: block;
    margin-top: 6px;
    color: #667085;
    font-size: 12px;
    line-height: 1.8;
  }

  .path {
    color: #344054;
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
