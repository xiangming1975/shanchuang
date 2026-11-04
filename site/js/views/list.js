// 页面：list
import { app, topbar, rowLink } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { getManifest, getPoem, prefetchPoems, cachedText, colIndexOf, getChunkMap, chunkIndexOf, getDedupRemap, clearNavCtx } from '../store.js';
import { dedupeKey, zhShow } from '../fn.js';
import { esc } from '../py.js';

// 同一首作品常被多个集合收录（全唐诗 / 唐诗三百首 / 千家诗…），繁简也可能不同。
// 标签页、朝代页这类「按 id 聚合」的列表都要过一遍，否则《春晓》会出现两次。
export async function dedupeRows(rows) {
  const cols = (await getManifest()).collections;
  const best = new Map();
  for (const r of rows) {
    const key = dedupeKey(r.t, r.a, (r.p && r.p[0]) || '');
    const cur = best.get(key);
    if (!cur) { best.set(key, r); continue; }
    if (colIndexOf(r.i, cols) < colIndexOf(cur.i, cols)) best.set(key, r);   // 集合顺序靠前＝精选程度更高
  }
  return [...best.values()];
}

async function listView(seg, seq = currentRenderSeq()) {
  clearNavCtx();   // 从集合目录进入 = 该集合的物理导航（2026-11-01 navCtx）
  const [cid, pageRaw] = seg;
  const [pageStr, query] = String(pageRaw || '').split('?');
  const cur = +(new URLSearchParams(query || '').get('cur') || 0) || 0;
  const m = await getManifest();
  if (!isCurrent(seq)) return;
  const col = m.collections.find(c => c.id === cid);
  if (!col) { setAppHTML(seq, topbar('未找到') + '<div class="empty-state">集合不存在</div>'); return; }
  const page = Math.max(0, Math.min(col.chunks.length - 1, parseInt(pageStr || '0') || 0));
  const total = col.visible != null ? col.visible : col.count;
  // 分类列表是唯一"横条去掉后没标题"的二级页：页面内没有别的卡片能说明这是哪一本
  setAppHTML(seq, `<div class="card"><h2>${esc(zhShow(col.name))}</h2>
      <div class="section-tip" style="margin:4px 0 0">共 ${total.toLocaleString()} 篇${col.note ? ' · ' + esc(zhShow(col.note)) : ''}</div></div>` +
    `<div id="backcur"></div><div id="list-box"><div class="loading"></div></div>
    <div class="pager">
      <button id="pg-prev" ${page === 0 ? 'disabled' : ''}>上一页</button>
      <span class="pg">${page + 1} / ${col.chunks.length}</span>
      <button id="pg-next" ${page >= col.chunks.length - 1 ? 'disabled' : ''}>下一页</button>
    </div>`);
  const box = document.getElementById('list-box');
  try {
    const arr = JSON.parse(await cachedChunk(col.id, page));
    if (!isCurrent(seq)) return;
    const rows = arr.filter(r => !r.hide);
    // 课本页按册次分组（一年级上册 → 九年级下册），否则 168 篇平铺看不出年级
    box.innerHTML = `<div class="list">${col.id === 'keben' ? kebenGrouped(rows) : rows.map(r => rowLink(r)).join('')}</div>`;
    prefetchPoems(arr.slice(0, 20).map(r => r.i));
    if (cur) markCurrent(box, arr, cur);
  } catch (e) {
    box.innerHTML = '<div class="empty-state">加载失败，请重试</div>';
  }
  document.getElementById('pg-prev').onclick = () => { location.hash = `#/c/${cid}/${page - 1}`; };
  document.getElementById('pg-next').onclick = () => { location.hash = `#/c/${cid}/${page + 1}`; };
}

// 课本集合按「册次」分组：数据本身按年级册次排列，标签第一项就是册次
function kebenGrouped(rows) {
  const count = new Map();
  for (const r of rows) {
    const g = (r.tg && r.tg[0]) || '其他';
    count.set(g, (count.get(g) || 0) + 1);
  }
  let out = '', last = '';
  for (const r of rows) {
    const g = (r.tg && r.tg[0]) || '其他';
    if (g !== last) { out += `<div class="group-title">${esc(zhShow(g))} · ${count.get(g)} 篇</div>`; last = g; }
    out += rowLink(r);
  }
  return out;
}

// 从详情页点「诗集」进来时定位到刚才那一篇，并在顶部留一条回程路
function markCurrent(box, arr, cur) {
  const row = box.querySelector(`.row[href="#/p/${cur}"]`);
  if (!row) return;
  row.classList.add('cur');
  const rec = arr.find(r => r.i === cur);
  document.getElementById('backcur').innerHTML =
    `<a class="backcur" href="#/p/${cur}">返回《${esc(zhShow(rec ? rec.t : '刚才那篇'))}》</a>`;
  requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
}

function cachedChunk(cid, page) {
  return cachedText(`data/poems/${cid}-${String(page).padStart(4, '0')}.json`);
}

// 按 id 批量取记录：同一分块只请求一次。
// 标签下的作品常常分散在很多集合里，逐条 getPoem 会打出几十个请求，这里合并成「每块一次」。
// 2026-11-01（第七轮 P0-2 修复）：旧版有两个缺陷——
//   ① 直接拿 `off % 200` 当块内下标取记录，空洞左移后取到的是「隔壁那首」（标签页 43.2% 错行）；
//   ② `off >= col.count` 把集合尾区记录整批丢弃。
// 改为：先套 dedup-remap（被删重复项落到保留正文）、按目标 id 去重，
//   再用 span（id 跨度，旧 manifest 无 span 时退回 count）圈窗口，
//   块内先探测下标、失配再 find(r => r.i === rid)（与 getPoem 同口径）。
async function loadRowsByIds(ids) {
  if (!ids || !ids.length) return [];
  const m = await getManifest();
  const cols = m.collections;
  const remap = await getDedupRemap();
  // ① remap + 按目标 id 去重（同一首只取首次出现，保留首次请求序）
  const seen = new Map();   // rid -> 首次请求序
  for (let k = 0; k < ids.length; k++) {
    const rid = (remap && remap[ids[k]] != null) ? remap[ids[k]] : ids[k];
    if (!seen.has(rid)) seen.set(rid, k);
  }
  // ② 定位（span 窗口）并按分块分组：同一分块只请求一次
  // 2026-11-02：新集合分块不按 200 对齐，页码改走 chunkmap 二分（表缺失回退旧公式）
  const cm = await getChunkMap();
  const groups = new Map();   // url -> { col, rids:Set }
  for (const rid of seen.keys()) {
    const ci = colIndexOf(rid, cols);
    if (ci < 0) continue;
    const col = cols[ci];
    const off = rid - col.start;
    const span = col.span != null ? col.span : col.count;
    if (off < 0 || off >= span) continue;
    const fi = cm[col.id];
    const page = (Array.isArray(fi) && fi.length === col.chunks.length)
      ? chunkIndexOf(rid, fi) : Math.floor(off / 200);
    const url = `data/poems/${col.id}-${String(page).padStart(4, '0')}.json`;
    let g = groups.get(url);
    if (!g) { g = { col, rids: new Set() }; groups.set(url, g); }
    g.rids.add(rid);
  }
  const urls = [...groups.keys()];
  const packs = await Promise.all(urls.map(async (url) => {
    try { return [url, JSON.parse(await cachedText(url))]; } catch { return [url, null]; }
  }));
  const arrByUrl = new Map(packs);
  const out = [];
  for (const [url, g] of groups) {
    const arr = arrByUrl.get(url);
    if (!arr) continue;
    for (const rid of g.rids) {
      const probe = arr[(rid - g.col.start) % 200];
      const rec = (probe && probe.i === rid) ? probe : arr.find(r => r.i === rid);
      if (rec && rec.i != null) out.push({ ...rec, _col: g.col });
    }
  }
  out.sort((a, b) => seen.get(a.i) - seen.get(b.i));
  return out;
}

// ---------------- 标签聚合页 ----------------
// 书目标签：书名 / 篇目 / 体裁，做"主题推荐"时排除（详情页里仍可正常点开）

export { listView, cachedChunk, loadRowsByIds };
