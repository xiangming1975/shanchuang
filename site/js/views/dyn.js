// 页面：朝代
// #/d        → 朝代概览（7 个分组，按时代先后排）
// #/dy/<朝代> → 该朝代作品列表（id 分片懒加载，每片 2 万条）
import { app, topbar, rowLink, emptyHtml } from '../vcommon.js';
import { loadRowsByIds, dedupeRows } from './list.js';
import { getDynIndex, getDynChunk, prefetchPoems, clearNavCtx } from '../store.js';
import { pagedList } from './paged.js';
import { esc } from '../py.js';
import { zhShow } from '../fn.js';

const PAGE = 60;

async function dynIndexView() {
  clearNavCtx();   // 朝代页暂不入队（列表即物理集合顺序），进来先退出阅读队列（2026-11-01 navCtx）
  app.innerHTML = topbar('按朝代', { back: true }) + '<div class="loading"></div>';
  let data = null;
  try { data = await getDynIndex(); } catch { data = null; }
  if (!data || !Array.isArray(data.rows) || !data.rows.length) {
    app.innerHTML = topbar('按朝代', { back: true }) + emptyHtml('空', '朝代索引未就绪，请刷新重试');
    return;
  }
  const total = data.rows.reduce((s, r) => s + r.c, 0);
  app.innerHTML = topbar('按朝代', { back: true, extra: `<span class="act">${data.rows.length} 个时段</span>` }) + `
    <div class="card">
      <h2>朝代</h2>
      <div class="section-tip" style="margin:4px 0 0">共 ${total.toLocaleString()} 篇，按时代先后排</div>
    </div>
    <div class="list">
      ${data.rows.map(r => `<a class="row" href="#/dy/${encodeURIComponent(r.k)}">
        <span class="rt">${esc(zhShow(r.k))}</span><span class="ra">${r.c.toLocaleString()} 篇</span></a>`).join('')}
    </div>`;
}

async function dynView(seg) {
  clearNavCtx();   // 朝代页暂不入队（2026-11-01 navCtx）
  let key = '';
  try { key = decodeURIComponent(seg[0] || ''); } catch { key = seg[0] || ''; }
  app.innerHTML = topbar(zhShow(key) || '朝代', { back: true }) + '<div class="loading"></div>';
  let meta = null;
  try {
    const data = await getDynIndex();
    meta = (data.rows || []).find(r => r.k === key) || null;
  } catch { meta = null; }
  if (!meta) {
    app.innerHTML = topbar(zhShow(key) || '朝代', { back: true }) +
      emptyHtml('空', '没有这个朝代<br><a href="#/d" style="color:var(--accent)">按朝代浏览</a>');
    return;
  }

  app.innerHTML = topbar(zhShow(meta.k), { back: true, extra: `<span class="act">${meta.c.toLocaleString()} 篇</span>` }) + `
    <div class="card">
      <h2>${esc(zhShow(meta.k))}</h2>
      <div class="section-tip" style="margin:4px 0 0">共 ${meta.c.toLocaleString()} 篇 · 按收录顺序</div>
    </div>
    <div class="list" id="dyn-list"><div class="loading"></div></div>
    <div style="text-align:center;margin:14px 0"><button class="set-toggle hidden" id="dyn-more">加载更多</button></div>`;

  const listEl = document.getElementById('dyn-list');
  const moreBtn = document.getElementById('dyn-more');
  const ids = [];
  let chunkAt = 0;

  // 只为需要的条数取分片：宋辽金 35.5 万篇不会一次拉完
  const ensure = async (need) => {
    while (ids.length < need && chunkAt < meta.chunks.length) {
      const part = await getDynChunk(meta.chunks[chunkAt++]);
      for (const id of part) ids.push(id);
    }
  };

  const { more: loadMore } = pagedList({
    listEl, moreBtn,
    prepare: ensure,
    items: () => ids,
    total: () => meta.c,
    batchSize: PAGE,
    fetchBatch: async (batch) => {
      try { return await dedupeRows(await loadRowsByIds(batch)); } catch { return []; }
    },
    itemHtml: (r) => rowLink(r),
    firstEmptyHtml: emptyHtml('空', '作品数据加载失败'),
    countUnit: '篇',
    afterBatch: (batch) => prefetchPoems(batch.slice(0, 8)),
  });
  moreBtn.onclick = loadMore;
  await loadMore();
}

export { dynIndexView, dynView };
