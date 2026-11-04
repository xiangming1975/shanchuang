// 页面：search
import { app, topbar, hl, popupConfirm, cutTitle, displayTitle, titleMax, LE_PREFIX, snippetOf } from '../vcommon.js';
import { getSearchHist, pushSearchHist, clearSearchHist, getManifest, getNames, getNamesPart, getNamesIndex, getFulltext, getFtIndex, getFtShard, getMingju, getAuthor, getTagBuckets, cachedText, colIdOf, colIndexOf, setNavCtx, pref } from '../store.js';
import { esc } from '../py.js';
import { loadRowsByIds } from './list.js';
import { loadCharMap, queryVariants, normZh, dedupeKey, zhShow } from '../fn.js';
import { bestMatch, TITLE_W, AUTHOR_W, withBonus } from '../rank.js';

async function authorView(seg) {
  const name = decodeURIComponent(seg[0] || '');
  app.innerHTML = topbar(name, { back: true }) + '<div class="loading"></div>';
  const au = await getAuthor(name).catch(() => null);
  if (!au) { app.innerHTML = topbar(name, { back: true }) + `<div class="empty-state"><div class="big">人</div>暂未收录该作者的详细资料<br><a style="color:var(--accent)" href="#/s/${encodeURIComponent(name)}">在全部作品中搜索「${esc(name)}」</a></div>`; return; }
  const bio = au.bio ? zhShow(au.bio) : '暂无作者简介。';
  app.innerHTML = `
    ${topbar(au.d ? `${zhShow(au.d)} · ${zhShow(name)}` : zhShow(name), { back: true })}
    <div class="card">
      <div class="author-head">
        <div class="avatar">${esc(zhShow(name.slice(0, 1)))}</div>
        <div><div class="an">${esc(zhShow(name))}</div><div class="ad">${esc(zhShow(au.d || ''))} · 收录 ${au.n} 篇作品</div></div>
      </div>
      <div class="bio" id="bio">${esc(bio)}</div>
      <button class="bio-fold" id="bio-fold">展开全文</button>
    </div>
    <div class="group-title">作品选（前 ${au.p.length} 篇）</div>
    <div class="list">${au.p.map(p => `<a class="row" href="#/p/${p.i}" title="${esc(displayTitle(p))}"><span class="rt">${esc(cutTitle(displayTitle(p), titleMax(colIdOf(p.i))))}</span></a>`).join('')}</div>
    ${au.n > au.p.length ? `<a class="section-tip" style="display:block;text-align:center;color:var(--accent)" href="#/s/${encodeURIComponent(name)}">共有 ${au.n} 篇，查看全部请搜索作者名</a>` : ''}`;
  setNavCtx(au.p.map(p => p.i), '作者 · ' + name).catch(() => {});   // 阅读队列：作者作品选（2026-11-01）
  const bioEl = document.getElementById('bio');
  const fold = document.getElementById('bio-fold');
  if (bioEl.scrollHeight <= 302) fold.style.display = 'none';
  fold.onclick = () => {
    const open = bioEl.classList.toggle('open');
    fold.textContent = open ? '收起' : '展开全文';
  };
}

// ---------------- 搜索页 ----------------

let namesText = null, ftRows = null, cipaiData = null, firstLinesMap = null;
// 首句表（2026-11-03 分片）：原 firstlines.json 48.8MB 单文件超托管方 25MiB 上限，现按 id
// 每 20 万一片（data/idx/firstlines/{k}.json + index.json）。顺序加载、每片到手即并入
// firstLinesMap——与拆分前一样是「后台渐进可用」：先到的片立刻参与去重与首句显示。
// 拆分顺带清掉了 35 万条越界 id（key >= manifest.total，搜索永远落不到那里）。
let flLoading = null;
function loadFirstLines() {
  if (flLoading) return flLoading;
  flLoading = (async () => {
    let idx = null;
    try { idx = JSON.parse(await cachedText('data/idx/firstlines/index.json')); } catch { return; }
    const parts = (idx && Array.isArray(idx.parts)) ? idx.parts : [];
    for (const k of parts) {
      try { Object.assign(firstLinesMap, JSON.parse(await cachedText('data/idx/firstlines/' + k + '.json'))); } catch {}
    }
  })();
  return flLoading;
}
// 精选快道（2026-11-01）：fast.json = BONUS_COLLS 那些集合的标题 TSV（~125KB），
// 比 names 首片（1.9MB）小一个量级——首搜第一条结果从它来，冷启动快 3-5 倍。
// 行内容与 names 分片同源同序（构建期从同一批行挑出来），去重逻辑照常兜底。
let fastText = null;   // null=未加载，''=文件缺失（旧数据），非空=快道文本

// names 分片进度（模块级：跨页面导航持续，回访时才能接着补扫剩下的分片）
let namesPartsTotal = 0;   // 分片总数（0=未知；1=单文件或仅首片）
let namesMergedUpTo = 0;   // 已并入 namesText 的分片数
const namesPartPs = new Map(); // pi → Promise<text|null>，同一分片只取一次
function loadNamesPart(pi) {
  let p = namesPartPs.get(pi);
  if (!p) { p = getNamesPart(pi).catch(() => null); namesPartPs.set(pi, p); }
  return p;
}

let manifestCacheCols = null;
let manifestCacheTotal = 0;

// 搜索范围（2026-11-03）：全部/标题/作者/正文。词牌不单列——词牌已规范进标题
// （「浣溪沙·玄武湖」），搜标题即覆盖词牌，命中词牌名另有词牌介绍卡。
// 提速点不在扫描本身（整串 indexOf 已是 C++ 层，限定字段不减扫描量），而在关掉
// 无关通道：标题范围不下载/深扫正文分片（常见词可省几十 MB）；正文范围跳过
// names/快道/首句表（省 1.9MB+）。作者范围是新增能力：检索 authors.json 主表
// （42,424 位，345KB gzip）模糊列出候选——原先作者直达卡只在查询词与作者名
// 完全相等时出现，搜「李清」出不了「李清照」。
const SCOPES = ['all', 'title', 'author', 'content'];
const savedScope = pref('sc');
let scope = SCOPES.includes(savedScope) ? savedScope : 'all';
const SCOPE_PH = {
  all: '诗名 / 作者 / 词牌 / 正文关键字',
  title: '标题 / 词牌关键字',
  author: '作者名（支持单字、模糊）',
  content: '正文关键字'
};
const SCOPE_TIP = {
  all: '输入关键字即时搜索。支持标题、作者、词牌与正文。',
  title: '在作品标题（含词牌）中搜索。',
  author: '输入作者名，列出收录的作者（支持单字姓氏、模糊匹配）。',
  content: '在作品正文中搜索。'
};
let authorsIdxP = null;
function ensureAuthorsIdx() {
  if (!authorsIdxP) authorsIdxP = cachedText('data/idx/authors.json').then((t) => JSON.parse(t)).catch(() => null);
  return authorsIdxP;
}

let ftIndexPromise = null;   // 分片清单（小文件）
const ftShards = new Map();  // cid → Promise<rows>，同一分片只取一次

let ftLegacyPromise = null;  // 旧单文件兜底（数据未重新构建时）

let mingjuRows = null, mjPromise = null;

// 分片清单：{ v, total, order:[{id,n,b}] }；拿不到就返回 null，走旧单文件
function ensureFtIndex() {
  if (!ftIndexPromise) {
    ftIndexPromise = getFtIndex().then(v => (v && v.order && v.order.length ? v : null)).catch(() => null);
  }
  return ftIndexPromise;
}

function loadFtShard(cid) {
  let p = ftShards.get(cid);
  if (!p) { p = getFtShard(cid).catch(() => []); ftShards.set(cid, p); }
  return p;
}

function ensureFtLegacy() {
  if (!ftLegacyPromise) {
    ftLegacyPromise = (async () => {
      if (!ftRows) { try { ftRows = JSON.parse(await getFulltext()); } catch { ftRows = []; } }
      return ftRows;
    })();
  }
  return ftLegacyPromise;
}

// 正文检索：按集合分片顺序逐个扫，够 24 条就停。
// 顺序与旧单文件完全一致（构建时按 COLLECTIONS 顺序 push），所以命中结果不变，
// 但常见查询往往只加载前面几个小集合就够，省掉几十 MB 下载。
// 渐进落地（2026-11-01）：每扫完一片回调 onProgress(hits, done)，调用方先画已得的、
// 未完的挂「已 N 条，检索中…」——不再攒到最后一次性抖出。
// 并行预取：扫描仍严格按 order 顺序（结果不变），但后面 4 片的下载提前并发发起；
// loadFtShard 的 Promise 有记忆，预取只是把「等下载」从串行变并行。
// 代价：命中数提前够 24 条时，已预取未扫的分片（≤3 片）算白下载，换来深扫场景 ~4 倍提速。
const FT_AHEAD = 4;
async function ftSearch(vars, q, cap, onProgress, idsOut) {
  const hits = [];
  const seen = new Set();
  const scan = (rows) => {
    for (const row of rows) {
      if (!row) continue;   // 防御：分片里的 null 占位行（2026-11-01 第八轮 🟠-1，pdb_* 旧分片曾整片是 null）
      const fkey = dedupeKey(row[1], row[2], String(row[3]));
      if (seen.has(fkey)) continue;
      seen.add(fkey);
      const content = row[3];
      let pos = -1, qUsed = q;
      for (const vv of vars) {
        const p2 = content.indexOf(vv);
        if (p2 >= 0) { pos = p2; qUsed = vv; break; }
      }
      if (pos < 0) continue;
      if (idsOut) idsOut.push(row[0]);   // 阅读队列用：命中正文的作品 id（顺序 = 检索顺序）
      const s2 = Math.max(0, pos - 18);
      const snip = esc(zhShow(content.slice(s2, pos))) + '<b>' + esc(zhShow(qUsed)) + '</b>' + esc(zhShow(content.slice(pos + qUsed.length, pos + qUsed.length + 30)));
      hits.push(`<a class="row" href="#/p/${row[0]}" title="${esc(zhShow(row[1]))}"><span class="rt">${esc(zhShow(cutTitle(row[1])))} <span class="ra">${esc(zhShow(row[2]))}</span></span></a><div class="snippet">…${snip}…</div>`);
      if (hits.length >= cap) return true;
    }
    return false;
  };
  const idx = await ensureFtIndex();
  if (!idx) { scan(await ensureFtLegacy()); if (onProgress) onProgress(hits, true); return hits; }
  const order = idx.order;
  for (let i = 0; i < order.length; i++) {
    for (let j = i; j < Math.min(i + FT_AHEAD, order.length); j++) loadFtShard(order[j].id);
    scan(await loadFtShard(order[i].id));
    if (onProgress) onProgress(hits, false);
    if (hits.length >= cap) break;
  }
  if (onProgress) onProgress(hits, true);
  return hits;
}

function ensureMj() {
  if (!mjPromise) {
    mjPromise = (async () => {
      if (!mingjuRows) { try { mingjuRows = await getMingju(); } catch { mingjuRows = []; } }
      return mingjuRows;
    })();
  }
  return mjPromise;
}
// 启动预热：浏览首页时后台拉齐搜索索引

function preloadSearch() {
  // names 不再整表预载（实测首访首页就拉 6.8MB gzip）——渐进搜索只等首片即可出结果，
  // 剩余分片交给首搜的后台补扫；这里只取分片清单（KB 级），让首次搜索少一跳。
  cachedText('data/idx/names/index.json').catch(() => {});
  ensureFtIndex().catch(() => {});   // 只取分片清单（KB 级），正文等到真正搜索时按需加载
  ensureMj().catch(() => {});
  cachedText('data/idx/cipai.json').catch(() => {});
  cachedText('data/idx/t2s.json').catch(() => {});
  // 空闲预热（2026-11-01）：进站 5 秒后趁闲把首搜要用的几块悄悄拉进 IDB——
  // 快道 fast.json（125KB）+ names 首片（1.9MB）+ 清单里排在最前的精选小分片。
  // 用户真去搜时已是暖的，首条结果不用再等下载。只预热小件：大分片等真搜到再说。
  const idle = (fn) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn()); else setTimeout(fn, 2000); };
  setTimeout(() => idle(() => {
    cachedText('data/idx/fast.json').catch(() => {});
    loadNamesPart(0).catch(() => {});
    ensureFtIndex().then((idx) => {
      if (!idx || !Array.isArray(idx.order)) return;
      // order 前小后大（精选集在前）：一路预取到第一个大分片为止
      for (const p of idx.order) {
        if ((p.b || 0) > 100000) break;
        loadFtShard(p.id).catch(() => {});
      }
    }).catch(() => {});
  }), 5000);
}

async function searchView(seg) {
  let searchSeq = 0;
  if (!manifestCacheCols) { try { const m = await getManifest(); manifestCacheCols = m.collections; manifestCacheTotal = m.total || 0; } catch { manifestCacheCols = []; } }
  const q0 = seg.length ? decodeURIComponent(seg.join('/')) : '';
  app.innerHTML = `
    <div class="page-pad"></div>
    <div class="searchbar">
      <select id="scope-sel" aria-label="搜索范围">
        <option value="all">全部</option>
        <option value="title">标题</option>
        <option value="author">作者</option>
        <option value="content">正文</option>
      </select>
      <svg viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 1 1 0 15c-1.7 0-3.3-.6-4.6-1.6L3 19.3 4.7 21l2.9-2.9A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
      <input aria-label="搜索" id="q" placeholder="诗名 / 作者 / 词牌 / 正文关键字" value="${esc(q0)}" autocomplete="off">
      <button class="clear" id="q-clear">清空</button>
    </div>
    <div id="search-hist"></div>
    <div id="search-result"><div class="section-tip">支持搜索全部 ${Math.round(manifestCacheTotal / 10000)} 万篇作品的标题与作者，以及正文。</div></div>`;
  const input = document.getElementById('q');
  const box = document.getElementById('search-result');
  document.getElementById('q-clear').onclick = () => { input.value = ''; input.focus(); doSearch(''); };
  let timer = null, histTimer = null;
  const scopeSel = document.getElementById('scope-sel');
  scopeSel.value = scope;
  input.placeholder = SCOPE_PH[scope];
  scopeSel.addEventListener('change', () => {
    scope = scopeSel.value;
    pref('sc', scope);
    input.placeholder = SCOPE_PH[scope];
    clearTimeout(timer);
    const v = input.value.trim();
    if (v) doSearch(v); else doSearch('');
  });
  // 防抖 300ms（原 180ms 偏急，手机上打字慢时会连发几次搜索）；
  // 单字不搜：命中上千条、排名也没意义，纯属白扫一遍索引。
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value.trim();
    if (!v) { doSearch(''); return; }
    // 单字不搜：命中上千条、排名也没意义，纯属白扫一遍索引。
    // 例外：作者范围单字有效（搜「王」列出王姓作者），且作者表小、扫得起。
    if (v.length < 2 && scope !== 'author') {
      histBox.innerHTML = '';
      box.innerHTML = '<div class="section-tip">再输入一个字（共 2 个字以上）开始搜索。</div>';
      return;
    }
    timer = setTimeout(() => doSearch(v), 300);
  });
  // 回车＝提交：记入历史并收起键盘
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    const q = input.value.trim();
    doSearch(q, true);
    input.blur();
  });
  const histBox = document.getElementById('search-hist');
  function renderHist() {
    const h = getSearchHist();
    if (!h.length) { histBox.innerHTML = ''; return; }
    // 只放最近 12 个：搜索历史最多 1000 条，全渲染会把搜索页撑爆
    const CHIP_N = 12;
    const head = h.slice(0, CHIP_N);
    const moreChip = h.length > CHIP_N
      ? '<a class="hist-chip hist-more" href="#/h/s">全部 ' + h.length + ' 条</a>' : '';
    histBox.innerHTML = '<div class="group-title gt-row"><span>搜索历史</span><button id="hist-clear" style="font-size:0.72rem;color:var(--ink-3);white-space:nowrap">清空历史</button></div>' +
      '<div class="hist-chips">' + head.map(q => '<button class="hist-chip">' + esc(q) + '</button>').join('') + moreChip + '</div>';
    histBox.querySelectorAll('.hist-chip').forEach(c => {
      c.onclick = () => { input.value = c.textContent; doSearch(c.textContent, true); };
    });
    const cb = histBox.querySelector('#hist-clear');
    if (cb) cb.onclick = () => {
      // 一键清 15 条不可撤销，加一层确认（与设置页清空数据同口径）
      popupConfirm('清空搜索历史？', `共 ${h.length} 条，删除后不可恢复。`, '清空', () => {
        clearSearchHist(); renderHist(); input.focus();
      });
    };
  }
  renderHist();
  if (q0) { histBox.innerHTML = ''; doSearch(q0, true); } else { input.focus(); doSearch(''); }
  // 提示由 doSearch 各阶段自行渲染

  // 空态：给两条现成的入口，别让人对着一行提示发呆
  async function renderHot() {
    const el = document.getElementById('hot-box');
    if (!el) return;
    const AUTHORS = ['李白', '杜甫', '苏轼', '王维', '李清照', '辛弃疾'];
    let tags = [];
    try { const b = await getTagBuckets(); tags = (b.rows.theme || []).slice(0, 10).map(x => x[0]); } catch {}
    el.innerHTML = '<div class="group-title">热门诗人</div><div class="tagrow">' +
      AUTHORS.map(a => `<a href="#/a/${encodeURIComponent(a)}">${esc(zhShow(a))}</a>`).join('') + '</div>' +
      (tags.length ? '<div class="group-title">热门题材</div><div class="tagrow">' +
        tags.map(t => `<a href="#/t/${encodeURIComponent(t)}">${esc(zhShow(t))}</a>`).join('') + '</div>' : '');
  }

  // 作者范围：检索 authors.json 主表列出候选作者（不扫 names、不跑正文/名句）
  const renderAuthorResults = async (q, seq) => {
    box.innerHTML = '<div class="group-title">作者检索中…</div>';
    const idxP = ensureAuthorsIdx();
    const [qS, qT] = queryVariants(q);
    const vars = [...new Set([q.toLowerCase(), qS, qT])].filter(Boolean);
    const idx = await idxP;
    await loadCharMap().catch(() => {});
    if (seq !== searchSeq) return;   // 等表期间用户又输入了 → 本次作废
    if (!idx) { box.innerHTML = '<div class="empty-state"><div class="big">无</div>作者索引加载失败，请稍后重试</div>'; return; }
    // 精确 > 前缀 > 包含；同组内短名在前（「王维」排在「王维之友」前）
    const exact = [], prefix = [], contains = [];
    for (const name of Object.keys(idx)) {
      const nl = name.toLowerCase();
      let rank = -1;
      for (const v of vars) {
        if (nl === v) { rank = 0; break; }
        if (nl.startsWith(v)) { if (rank < 0 || rank > 1) rank = 1; }
        else if (rank < 0 && nl.includes(v)) rank = 2;
      }
      if (rank === 0) exact.push(name);
      else if (rank === 1) prefix.push(name);
      else if (rank === 2) contains.push(name);
    }
    const byName = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    exact.sort(byName); prefix.sort(byName); contains.sort(byName);
    const list = [...exact, ...prefix, ...contains];
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="big">人</div>没有找到相关作者<br><span style="font-size:0.85rem;color:var(--ink-3)">试试切换到「全部」或「正文」范围</span></div>';
      return;
    }
    const N = 60;
    box.innerHTML = `<div class="group-title">作者（${list.length > N ? N + '+' : list.length} 位）</div><div class="list">` +
      list.slice(0, N).map((n) => `<a class="row" href="#/a/${encodeURIComponent(n)}"><span class="rt">${hl(zhShow(n), q)}</span><span class="ra">作者页</span></a>`).join('') + '</div>' +
      (list.length > N ? '<div class="section-tip" style="text-align:center">仅显示前 ' + N + ' 位，请多输入几个字</div>' : '');
  };

  // 按 id 取记录补首句：只补前 20 条，未就绪时静默跳过
  async function fillFirstLines(ids, seq) {
    try {
      const rows = await loadRowsByIds(ids.slice(0, 40));
      if (seq !== searchSeq) return;
      for (const r of rows) {
        const el = document.querySelector('#title-list .row[data-i="' + r.i + '"]');
        if (!el) continue;
        const next = el.nextElementSibling;
        if (next && next.classList && next.classList.contains('snippet')) continue;
        const head = snippetOf(r.p && r.p[0]);
        if (!head) continue;
        el.insertAdjacentHTML('afterend', '<div class="snippet">' + esc(head) + '</div>');
      }
    } catch {}
  }

  async function ensureNames() {
    // 快道先行：fast.json 只有 ~125KB，先到先扫；拿不到（旧数据）就空串跳过
    if (fastText === null) {
      try { fastText = await cachedText('data/idx/fast.json'); } catch { fastText = ''; }
    }
    if (!namesText) {
      const first = await loadNamesPart(0);
      if (first !== null) {
        namesText = first;
        namesMergedUpTo = 1;
        const idx = await getNamesIndex().catch(() => null);
        namesPartsTotal = (idx && Array.isArray(idx.parts)) ? idx.parts.length : 1;
      } else {
        // 无分片索引（旧数据）→ 整表一次拉齐
        const raw = await getNames();
        namesText = raw;
        namesPartsTotal = 1;
        namesMergedUpTo = 1;
      }
      // 首句表后台分片加载（不阻塞首搜；未就绪时同名组暂不显示首句）
      firstLinesMap = {};
      loadFirstLines();
    }
    if (cipaiData === null) {
      try { cipaiData = JSON.parse(await cachedText('data/idx/cipai.json')); } catch { cipaiData = []; }
    }
    await loadCharMap();
  }

  // 搜索历史只在两种时机记：① 回车/点历史词（commit=true）② 停手 1.2 秒后的当次最终词。
  // 原来「结果里有命中就记」，而搜索是 180ms 防抖的即时搜索——
  // 打「静夜思」会把「静」「静夜」一并记进去，15 个格子很快被前缀填满，数字从此不动。
  async function doSearch(q, commit) {
    if (!q) {
      box.innerHTML = `<div class="section-tip">${SCOPE_TIP[scope]}</div><div id="hot-box"></div>`;
      renderHist();
      renderHot();
      return;
    }
    histBox.innerHTML = '';
    const seq = ++searchSeq;
    // ① 回车/点历史词：立刻记
    if (commit) pushSearchHist(q);
    // ② 手机上很多人在即时搜索里从不按回车，所以再加一道「停手 1.2 秒」的记录。
    //    前缀会被 pushSearchHist 顺手清掉，最终留下的仍是完整查询词。
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      if (seq === searchSeq && input.value.trim() === q) pushSearchHist(q);
    }, 1200);
    // 作者范围：单独通道，直接检索作者表
    if (scope === 'author') { renderAuthorResults(q, seq); return; }
    const authorCache = new Map();
    let authorHit = '';
    let lastDeduped = [], lastCipaiHtml = '';
    let ftHtmlDone = null, mjHtmlDone = null;   // null=未落地，字符串（可为空串）=已落地
    // 正文范围不加载 names/快道/首句表/词牌表（省 1.9MB+），只取简繁映射；
    // 其余范围照旧：快道先行、names 首片出结果、其余分片后台补扫。
    if (scope === 'content') await loadCharMap();
    else await ensureNames();
    if (seq !== searchSeq) return;   // 等索引期间用户又输入了 → 本次作废
    const [qS, qT] = queryVariants(q);
    const vars = [...new Set([q.toLowerCase(), qS, qT])].filter(Boolean);
    const qNorm = normZh(q);
    // 繁简互通：查询的简体/繁体形式都能命中原文（打分规则在 rank.js，单测覆盖）
    const collIdxOf = (id) => colIndexOf(id, manifestCacheCols);
    const scored = [];
    // 扫描策略：先在整块文本上 indexOf（V8 里走 C++ 层，1.9MB 约 1ms），
    // 命中后再回溯行首、只解析那一行。原先逐行 split + toLowerCase 要 130ms/片，慢 60 倍。
    // 精判（bestMatch / 精选加成 / 作者直达）逻辑一字未改，结果与逐行扫逐条一致。
    const scanText = (text) => {
      const seenLn = new Set();          // 同一行被多个变体命中时只算一次
      for (const v of vars) {
        let i = 0;
        while ((i = text.indexOf(v, i)) !== -1) {
          const ls = text.lastIndexOf('\n', i) + 1;
          let le = text.indexOf('\n', i);
          if (le < 0) le = text.length;
          i = le + 1;
          if (seenLn.has(ls)) continue;
          seenLn.add(ls);
          const line = text.slice(ls, le);
          const tab1 = line.indexOf('\t');
          const tab2 = line.indexOf('\t', tab1 + 1);
          if (tab2 < 0) continue;
          const id = line.slice(0, tab1);
          const t = line.slice(tab1 + 1, tab2);
          const a = line.slice(tab2 + 1);
          const tl = t.toLowerCase(), al = a.toLowerCase();
          // 标题范围：只按标题打分（作者字段不参与，也不触发作者直达卡）；
          // 其余范围照旧：标题/作者孰高取谁。
          const raw = scope === 'title'
            ? bestMatch(tl, vars, TITLE_W)
            : Math.max(bestMatch(tl, vars, TITLE_W), bestMatch(al, vars, AUTHOR_W));
          if (raw) {
            // 精选集加成必须在去重之前算：同一首既在《全唐诗》又在《唐诗三百首》时，
            // 去重保留集合序靠前的（全集），加成就会丢——「春江花月夜」正是这么被同名《春江》压住的。
            const c = manifestCacheCols[collIdxOf(+id)];
            const sc = withBonus(raw, c ? c.id : '');
            // 首句不在此固化：firstLinesMap 异步加载，扫描时刻拿到的可能是空表，
            // 同一首诗跨分片早扫（first=''）晚扫（真首句）会生成两个不同的去重键 → 计数虚高。
            // 只存 id，去重时（renderResults）用「当前」map 现算，表到齐后计数自动收敛。
            scored.push([sc, +id, t, a]);
          }
          if (scope !== 'title' && !authorHit && a && normZh(a) === qNorm) authorHit = a;
        }
      }
    };

    // 渐进渲染：每扫完一片就重排去重重画一次（seq 防串台）。
    // 名句/正文的落地结果也在这里一并重画，避免补扫重渲染把它们冲掉。
    const renderResults = async () => {
      scored.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      // 同作品去重（多集合收录同一首）：键=标题|作者|首句前12字。
      // 分数已含精选加成，所以「分数高者胜」＝留下更能代表这首的那一版；同分再看集合序。
      const bestByKey = new Map();
      const firstOf = (id) => (firstLinesMap || {})[id] || '';
      for (const row of scored) {
        const key = dedupeKey(row[2], row[3], firstOf(row[1]));
        const cur = bestByKey.get(key);
        if (!cur) { bestByKey.set(key, row); continue; }
        if (row[0] > cur[0] || (row[0] === cur[0] && collIdxOf(row[1]) < collIdxOf(cur[1]))) bestByKey.set(key, row);
      }
      const deduped = [...bestByKey.values()].sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      lastDeduped = deduped;
      // 补上当前可用的首句（titleHits 的展示与 fillFirstLines 判断都要用）
      const titleHits = deduped.slice(0, 60).map(r => [r[0], r[1], r[2], r[3], firstOf(r[1])]);

      // 作者直达：查询词正好是某位作者的名字
      let authorHtml = '';
      if (authorHit) {
        let au = authorCache.get(authorHit);
        if (au === undefined) { au = await getAuthor(authorHit).catch(() => null); authorCache.set(authorHit, au); }
        if (au) {
          authorHtml = `<a class="card author-hit" href="#/a/${encodeURIComponent(authorHit)}"><div class="ah-av">${esc(zhShow(authorHit.slice(0, 1)))}</div><div class="ah-body"><div class="ah-n">${esc(zhShow(authorHit))}</div><div class="ah-d">${au.d ? esc(zhShow(au.d)) + ' · ' : ''}收录 ${au.n} 篇作品</div><div class="ah-go">作者页</div></div></a>`;
        }
      }

      // 词牌介绍（命中词牌名时置顶展示，繁简互通）
      let cipaiHtml = '';
      if (cipaiData && cipaiData.length) {
        const strip = s => String(s).replace(/[·・\s]/g, '');
        const qvs = vars.map(strip);
        const cp = cipaiData.find(c => qvs.includes(strip(c.n)));
        if (cp) {
          cipaiHtml = `<div class="card cipai-card" data-fold><h2 class="fold-head">词牌 · ${esc(zhShow(cp.n))}<span class="fold-btn">+</span></h2><div class="fold-body">`
            + (cp.d ? `<div class="section-tip" style="margin:0 0 6px">${esc(zhShow(cp.d))}</div>` : '')
            + `<div class="annotate">${esc(zhShow(cp.i || '暂无介绍。'))}</div>`
            + (cp.g ? `<div class="section-tip">格律：${esc(zhShow(cp.g))}</div>` : '')
            + `</div></div>`;
        }
      }
      lastCipaiHtml = cipaiHtml;

      // 全唐诗把乐府分类写进标题（「鼓吹曲辭 將進酒」），列表里只显示后半，链接不变
      const showTitle = (t) => t.replace(LE_PREFIX, '');

      // 同名标题（词牌/无题/绝句等）在条目下显示首句区分
      const titleCount = {};
      for (const [, , t] of titleHits) titleCount[showTitle(t)] = (titleCount[showTitle(t)] || 0) + 1;
      const rowParts = titleHits.map(([, id, t, a, first]) =>
        (() => {
          // 词补首句：names 索引里只存词牌（「浣溪沙」），同名太多分不清。
          // first 是索引里带的正文首句，借它拼出「浣溪沙·一曲新词酒一杯」。
          const cid = colIdOf(id);
          const full = displayTitle({ i: id, t, p: first ? [first] : [] }, cid);
          const shown = hl(cutTitle(full, titleMax(cid)), q);
          const dup = titleCount[showTitle(t)] > 1 && first && full === showTitle(t);
          return `<a class="row" data-i="${id}" href="#/p/${id}" title="${esc(full)}"><span class="rt">${shown}</span><span class="ra">${esc(zhShow(a))}</span></a>` +
            (dup ? '<div class="snippet">' + esc(zhShow(first)) + '</div>' : '');
        })());
      // 标题组先露 20 条：60 条铺满两屏，会把后面的名句与正文结果全压到底下
      const HEAD_N = 20;
      const rowsHtml = rowParts.slice(0, HEAD_N).join('');
      const emptyShort = (q.length < 2 || scope === 'title') && !deduped.length && !cipaiHtml && !authorHtml;
      box.innerHTML = `
        ${authorHtml}
        ${cipaiHtml}
        ${deduped.length ? `<div class="group-title">${scope === 'title' ? '标题' : '标题 / 作者'}（${deduped.length} 条）</div><div class="list" id="title-list">${rowsHtml}</div>
          ${rowParts.length > HEAD_N ? `<div style="text-align:center;margin:10px 0"><button class="set-toggle" id="title-more">展开其余 ${rowParts.length - HEAD_N} 条</button></div>` : ''}
          ${deduped.length > 60 ? '<div class="section-tip" style="text-align:center">仅显示前 60 条，请细化关键字</div>' : ''}` : ''}
        ${q.length >= 2 ? (mjHtmlDone !== null ? mjHtmlDone : '<div id="mj-lazy"></div>') : ''}
        ${q.length >= 2 ? (ftHtmlDone !== null ? ftHtmlDone : '<div class="group-title" id="ft-lazy">正文检索中…</div>') : ''}
        ${emptyShort ? '<div class="empty-state"><div class="big">无</div>没有找到相关内容</div>' : ''}`;

      const titleMore = document.getElementById('title-more');
      if (titleMore) titleMore.onclick = () => {
        const list = document.getElementById('title-list');
        list.insertAdjacentHTML('beforeend', rowParts.slice(HEAD_N).join(''));
        titleMore.remove();
        // 展开的这批同样缺首句，按需补一次
        const more = titleHits.slice(HEAD_N).filter(([, id, t, , first]) => !first && titleCount[showTitle(t)] > 1).map(([, id]) => id);
        if (more.length) fillFirstLines(more, seq);
      };
      // 同名多首（如「水龙吟」326 条）光看题名分不清，给前 20 条补首句。
      // firstlines.json 只覆盖 23%，这里对缺的那些按需取记录（一次请求）。
      try {
        const need = titleHits.slice(0, HEAD_N).filter(([, id, t, , first]) => !first && titleCount[showTitle(t)] > 1).map(([, id]) => id);
        if (need.length) fillFirstLines(need, seq);
      } catch {}
    };

    // 阅读队列（2026-11-01）：主列表全量去重 + 名句 + 全文命中，按结果页顺序拼接。
    // 定义前置（第九轮 🟠-1）：names 补扫 IIFE 在本块之后启动、之后还会持续增长 lastDeduped，
    // 队列若只挂一次会漏掉补扫命中（实测「贺新郎」首片 82 条、补扫还有 1,119 条）——
    // 补扫循环里检测到 ft/mj 已落地就重挂，setNavCtx 覆盖式幂等。
    let ftDone = scope === 'title', mjDone = scope === 'title', lastFtRender = 0;
    const ftIds = [], mjIds = [];
    const tryQueue = () => {
      if (seq !== searchSeq || !ftDone || !mjDone) return;
      const ids = [...lastDeduped.map(r => r[1]), ...mjIds, ...ftIds];
      if (!ids.length) return;   // 零结果（手滑的验证词之类）不清队——保留正在进行的阅读会话
      setNavCtx(ids, '搜索结果 · ' + q).catch(() => {});
    };
    // 首片到齐即出结果：快道（精选 125KB）与现有内容先扫先渲染，
    // 其余分片后台补扫（不等全部 19.6MB）。快道行是 names 分片的子集，
    // 重复命中由 bestByKey 去重兜住（同分同键留先到者），结果不变。
    if (scope !== 'content') {
      if (fastText) scanText(fastText);
      scanText(namesText);
    }
    await renderResults().catch(() => {});
    if (scope === 'title') tryQueue();   // 标题范围没有 ft/mj 回调，队列在此挂上
    if (scope !== 'content' && namesPartsTotal > namesMergedUpTo) {
      (async () => {
        for (let pi = namesMergedUpTo; pi < namesPartsTotal; pi++) {
          const part = await loadNamesPart(pi);
          if (!part) { namesMergedUpTo = pi + 1; continue; }   // 缺片跳过，别卡住后面的
          if (pi >= namesMergedUpTo) { namesText += part; namesMergedUpTo = pi + 1; }
          if (seq !== searchSeq) continue;
          scanText(part);
          await renderResults().catch(() => {});
          tryQueue();   // 补扫有新命中且 ft/mj 已落地 → 用增长后的列表重挂队列
        }
      })();
    }

    if (q.length >= 2 && scope !== 'title') {
      // 正文与名句各自独立落地（2026-11-01）：原先 mjP 嵌在 ftSearch.then 里，
      // 名句表只有 276KB、明明先到也要等正文扫完才画——白等。现在谁先到谁先渲染。
      // 空态判定等两边都完成（都异步，单独判会误报“没有找到”）。
      const checkEmpty = () => {
        if (seq !== searchSeq || !ftDone || !mjDone) return;
        if (!scored.length && ftHtmlDone === '' && mjHtmlDone === '' && !lastCipaiHtml) {
          box.innerHTML = '<div class="empty-state"><div class="big">无</div>没有找到相关内容</div>';
        }
      };
      // 名句检索（JoyDraw 名句表，命中直达全诗）
      const mjP = ensureMj().then(() => {
        if (seq !== searchSeq) return [];
        const hits = [];
        for (const row of mingjuRows) {
          let pos = -1, qUsed = q;
          for (const vv of vars) {
            const p2 = row[0].indexOf(vv);
            if (p2 >= 0) { pos = p2; qUsed = vv; break; }
          }
          if (pos < 0) {
            for (const vv of vars) {
              const p2 = row[2].indexOf(vv);
              if (p2 >= 0) { pos = p2; qUsed = vv; break; }
            }
          }
          if (pos < 0) continue;
          mjIds.push(row[3]);   // 阅读队列：名句对应的整首
          // 名句单独占一行、出处另起一行：挤在同一行时，出处（作者 + 《题》）是 nowrap，
          // 会把名句压成一个省略号，手机/窄屏直接看不见句子。
          hits.push(`<a class="row" href="#/p/${row[3]}?v=${encodeURIComponent(row[0])}"><span class="rt mj-t">“${hl(zhShow(row[0]), qUsed)}”</span></a>` +
            `<div class="snippet">${esc(zhShow(row[1] || '佚名'))} · 《${esc(zhShow(row[2]))}》</div>`);
          if (hits.length >= 20) break;
        }
        return hits;
      }).catch(() => []);
      mjP.then((mjHits) => {
        if (seq !== searchSeq) return;
        mjDone = true;
        mjHtmlDone = mjHits.length ? `<div class="group-title">名句（${mjHits.length >= 20 ? '20+' : mjHits.length} 条）</div><div class="list">${mjHits.join('')}</div>` : '';
        renderResults().catch(() => {});
        tryQueue();
        checkEmpty();
      });
      // 正文：逐片渐进落地。中间进度 150ms 节流（57 片全画会闪，最终帧不节流）；
      // 0 命中且未完时保持 ftHtmlDone=null，让「正文检索中…」占位继续顶着。
      const onFt = (hits, done) => {
        if (seq !== searchSeq) return;
        if (done || hits.length) {
          const now = Date.now();
          if (!done && now - lastFtRender < 150) return;
          lastFtRender = now;
          ftHtmlDone = hits.length
            ? `<div class="group-title">正文中匹配${done ? '' : '（已 ' + hits.length + ' 条，检索中…）'}</div><div class="list">${hits.join('')}</div>`
            : '';
          renderResults().catch(() => {});
        }
        if (done) { ftDone = true; tryQueue(); checkEmpty(); }
      };
      ftSearch(vars, q, 24, onFt, ftIds).catch(() => {
        // 正文检索整体失败（清单缺失/旧兜底也没有）：占位收掉，别让「检索中…」永远挂着
        if (seq !== searchSeq) return;
        if (ftHtmlDone === null) ftHtmlDone = '';
        ftDone = true;
        checkEmpty();
      });
    }
  }
}

export { authorView, namesText, manifestCacheCols, ftIndexPromise, mingjuRows, ensureFtIndex, ensureMj, preloadSearch, searchView };
