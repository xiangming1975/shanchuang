// 数据层：manifest 定位 + IndexedDB 缓存
const DB_NAME = 'shici-db', STORE = 'kv';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // 多标签页：升级时释放旧连接
      // 自愈：库存在但缺仓库（异常状态）→ 升版本重建
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        const req2 = indexedDB.open(DB_NAME, (db ? db.version : 1) + 1);
        req2.onupgradeneeded = () => { const db2 = req2.result; if (!db2.objectStoreNames.contains(STORE)) db2.createObjectStore(STORE); };
        req2.onsuccess = () => { req2.result.onversionchange = () => req2.result.close(); res(req2.result); };
        req2.onerror = () => rej(req2.error);
        return;
      }
      res(db);
    };
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

// IndexedDB 可能整块卡住（实测 Edge 某些配置下 indexedDB.open 既不 success 也不 error，
// Promise 永远 pending）——那样 await 会把整个取数链路挂死，首页「晨读」就永远停在加载中。
// 这里给打开与读写都加超时：超时当作「没有缓存」，走网络，功能不受影响。
function withTimeout(p, ms, fallback) {
  return Promise.race([p, new Promise(res => setTimeout(() => res(fallback), ms))]);
}
async function idbGet(key) {
  try {
    const db = await withTimeout(openDB(), 3000, null);
    if (!db) return undefined;
    return await withTimeout(new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }), 3000, undefined);
  } catch { return undefined; }
}
async function idbSet(key, val) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
}

const inflight = new Map();
let DATAV = ''; // 数据版本号（来自 manifest.v），重建后自动失效旧缓存
export function setDataVer(v) { DATAV = v ? 'v' + v + ':' : ''; }
export function getDataVer() { return DATAV; }
async function cleanupStale() {
  if (!DATAV) return;
  try {
    const db = await openDB();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const k = cur.key;
        if (typeof k === 'string' && k.startsWith('txt:') && !k.startsWith('txt:' + DATAV)) store.delete(k);
        cur.continue();
      };
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {}
}
// gzip 透明解压（2026-11-03）：站点数据目录已整体压成 `.json.gz`（5.87GB → 2.7GB），
// 这里优先取 .gz 并就地解压，取不到才回退明文 .json（manifest.json 仍是明文，走单独路径）。
// 注意 Cloudflare Pages 的 SPA 回退：缺失路径会回 index.html + 200，所以必须靠
// Content-Type 判真假，不能只看 resp.ok —— 否则会把首页 HTML 当数据去 JSON.parse。
// 测试垫片 / 极简 fetch 实现可能没有 headers，取不到就当作「不是 HTML」
const ctOf = (r) => (r.headers && typeof r.headers.get === 'function') ? (r.headers.get('content-type') || '') : '';
const GZ_OK = typeof DecompressionStream !== 'undefined';
async function gzToText(buf) {
  if (GZ_OK) {
    const ds = new DecompressionStream('gzip');
    return await new Response(new Response(buf).body.pipeThrough(ds)).text();
  }
  // 老浏览器（Safari <16.4）回退本地 vendor pako（第十轮 🟠-5，2026-11-04）：
  // 原先依赖 jsdelivr CDN——离线断网解不开全部 gzip 数据、向 CDN 暴露访问、
  // 供应链投毒三重风险。现 vendor 化（site/vendor/pako.esm.mjs，226KB）并进 SW SHELL。
  const pako = await import('../vendor/pako.esm.mjs');
  return pako.ungzip(new Uint8Array(buf), { to: 'string' });
}
export async function cachedText(url, noCache) {
  // DATAV 未就绪（离线首访 manifest 拉不到）时完全不读写 IDB：
  // 无版本键会与正常版本键并存，白占缓存空间还永不清理（评审 N8）。
  if (!noCache && DATAV) {
    const hit = await idbGet('txt:' + DATAV + url);
    // 防御：曾经把 SPA 回退返回的 index.html 也缓存进去了（首字符 '<'），
    // 这类污染条目一律当未命中，否则修好网络层也会被旧缓存继续坑。
    if (hit !== undefined && !(typeof hit === 'string' && hit.charCodeAt(0) === 60)) return hit;
  }
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    // 数据文件带版本参数：重建后 URL 变化，HTTP 缓存自然失效
    const q = DATAV ? (url.indexOf('?') < 0 ? '?v=' + DATAV : '&v=' + DATAV) : '';
    let text;
    try {
      const gzUrl = url.replace(/(\?|$)/, '.gz$1');
      const resp = await fetch(gzUrl + q);
      const ct = ctOf(resp);
      if (!resp.ok || /^text\/html/i.test(ct)) throw new Error('no gz: ' + resp.status + ' ' + ct);
      text = await gzToText(await resp.arrayBuffer());
    } catch (gzErr) {
      // 回退未压缩原文（过渡期 / 少数保留明文的表）
      const resp = await fetch(url + q);
      const ct = ctOf(resp);
      if (!resp.ok || /^text\/html/i.test(ct)) throw gzErr;
      text = await resp.text();
    }
    // 落库不等待（2026-10-31）：几 MB 的句库/全文分片 fetch 完就先交给页面，
    // 写缓存在后台走完（idbSet 内部全吞错，不会冒未处理拒绝）。
    // noCache（getPingze/getCitpl/getGenre）只绕读也绕写：原先只绕读，
    // 写进去的键永不再读，白占 IDB 配额（第十轮 🟡-1，2026-11-04）。
    if (DATAV && !noCache) idbSet('txt:' + DATAV + url, text);
    return text;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
async function cachedJSON(url) { return JSON.parse(await cachedText(url)); }

// ---------- manifest（每次启动直连网络取最新版本号，不再走 IDB 缓存） ----------
let manifestCache = null;
export async function getManifest() {
  if (!manifestCache) {
    const resp = await fetch('data/manifest.json?_=' + Date.now());
    if (!resp.ok) throw new Error('manifest 加载失败');
    const m = await resp.json();
    if (m.v && getDataVer() !== 'v' + m.v + ':') {
      setDataVer(m.v);
      cleanupStale();
    }
    manifestCache = m;
  }
  return manifestCache;
}

// 集合二分：collections 按 start 升序，返回最后一个 start <= id 的下标（无则 -1）。
// colIdOf / locate / 列表去重 / 批量取行共用这一份实现（2026-10-29 复用收敛，原先 4 处重复）。
export function colIndexOf(id, cols) {
  let lo = 0, hi = cols.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= cols[mid].start) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// 按 id 反查集合 id（同步版，给列表行判断「是不是词/曲」用；manifest 未加载时返回 ''）
export function colIdOf(id) {
  const m = manifestCache;
  if (!m) return '';
  const i = colIndexOf(id, m.collections);
  return i < 0 ? '' : m.collections[i].id;
}

// 分块表（2026-11-02）：外部管线新增的 12 个集合（guyishi/wudaici/songbu 等）分块
// 不按 200 行对齐——按源文件边界切，块内 2~200 行不等，floor((id-start)/200) 会取错块
//（全库 21.6 万 id 错位、最大偏 53 块）。idx/chunkmap.json 记每集合各块首行 id，二分定位；
// 表缺失或长度与 manifest 不符时退回旧公式（老集合仍是均匀 200，行为不变）。
let _chunkMap = null, _chunkMapPromise = null;
export function getChunkMap() {
  if (_chunkMap) return Promise.resolve(_chunkMap);
  if (!_chunkMapPromise) {
    _chunkMapPromise = cachedJSON('data/idx/chunkmap.json')
      .then(j => { _chunkMap = j || {}; return _chunkMap; })
      .catch(() => { _chunkMap = {}; return _chunkMap; });
  }
  return _chunkMapPromise;
}
export function chunkIndexOf(id, firstIds) {
  let lo = 0, hi = firstIds.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= firstIds[mid]) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// 按 id 定位所在集合与分块
export async function locate(id) {
  const m = await getManifest();
  const i = colIndexOf(id, m.collections);
  if (i < 0) return null;
  const col = m.collections[i];
  const cm = await getChunkMap();
  const firstIds = cm[col.id];
  if (Array.isArray(firstIds) && firstIds.length === col.chunks.length) {
    const k = chunkIndexOf(id, firstIds);
    return { col, chunk: k, idxInChunk: id - firstIds[k] };
  }
  const off = id - col.start;
  return { col, chunk: Math.floor(off / 200), idxInChunk: off % 200 };
}

// 分块内存 LRU（同会话二次点击零开销）
const chunkMem = new Map(); // url -> arr
function memGet(url) {
  const v = chunkMem.get(url);
  if (v) { chunkMem.delete(url); chunkMem.set(url, v); }
  return v;
}
function memPut(url, arr) {
  chunkMem.set(url, arr);
  if (chunkMem.size > 30) chunkMem.delete(chunkMem.keys().next().value);
}

export function chunkUrl(loc) {
  return `data/poems/${loc.col.id}-${String(loc.chunk).padStart(4, '0')}.json`;
}

// 去重重定向：被删重复项 i → 保留正文 i（平行构建生成的 data/dedup-remap.json）。
// 作用：删除重复正文后，idx/ 派生索引与用户数据（收藏/眉批…）里指向旧 i 的引用，
// 经此重定向自动落到保留正文，无需重建索引。
let _remap = null, _remapLoading = null;
export async function getDedupRemap() {
  if (_remap) return _remap;
  if (_remapLoading) return _remapLoading;
  _remapLoading = cachedJSON('data/dedup-remap.json')
    .then(j => { _remap = (j && j.map) ? j.map : {}; return _remap; })
    .catch(() => { _remap = {}; return _remap; });
  return _remapLoading;
}

export async function getPoem(id) {
  const remap = await getDedupRemap();
  const rid = (remap && remap[id] != null) ? remap[id] : id;
  const loc = await locate(rid);
  if (!loc) return null;
  const url = chunkUrl(loc);
  const pick = (arr) => {
    const rec = arr[loc.idxInChunk] && arr[loc.idxInChunk].i === rid ? arr[loc.idxInChunk] : arr.find(r => r.i === rid);
    return rec ? { ...rec, _col: loc.col } : null;
  };
  const mem = memGet(url);
  if (mem) { const r = pick(mem); if (r) return r; }
  try {
    const arr = JSON.parse(await cachedText(url));
    memPut(url, arr);
    const rec = pick(arr);
    if (rec) return rec;
  } catch {}
  // 自愈：缓存数据可能过期，绕过 IDB/内存直取网络重试。
  // 第十轮 🟠-3（2026-11-04）：明文 .json 已随 gzip 化移出生产（只剩 .json.gz），
  // 原先裸 fetch 明文在 Pages 上拿到的是 SPA 回退的 index.html+200，
  // JSON.parse 抛错被吞 → 一律误报「作品不存在」。现直拉 .gz（带版本参数）
  // 并绕过 HTTP 缓存（cache: 'reload'），HTML 响应（SPA 回退）当失败处理。
  try {
    const q = DATAV ? (url.indexOf('?') < 0 ? '?v=' + DATAV : '&v=' + DATAV) : '';
    const gzUrl = url.replace(/(\?|$)/, '.gz$1') + q;
    const resp = await fetch(gzUrl, { cache: 'reload' });
    const ct = ctOf(resp);
    if (!resp.ok || /^text\/html/i.test(ct)) return null;
    const arr = JSON.parse(await gzToText(await resp.arrayBuffer()));
    memPut(url, arr);
    return pick(arr);
  } catch { return null; }
}

// 去重后用户数据落地迁移：把指向被删重复项 i 的收藏/眉批/摘抄/背诵/历史，
// 改写为指向保留正文 i（与 getPoem 运行时重定向互补，这里把存储本身改干净）。
let _dedupMigrated = false;
export async function migrateDedupRemap() {
  if (_dedupMigrated) return;
  _dedupMigrated = true;
  let remap;
  try { remap = await cachedJSON('data/dedup-remap.json'); } catch { return; }
  if (!remap || !remap.map) return;
  const v = remap.v;
  if (lsGet('shici-dedup-migrated') === String(v)) return;
  const map = remap.map;
  const r = i => (map[i] != null ? map[i] : i);
  // 收藏 / 历史：数组 of i
  for (const key of [FAV_KEY, HIS_KEY]) {
    const list = lsGet(key, []);
    if (Array.isArray(list) && list.length) {
      const seen = new Set(); const out = [];
      for (const i of list) { const j = r(i); if (!seen.has(j)) { seen.add(j); out.push(j); } }
      lsSet(key, out);
    }
  }
  // 眉批：{ [poemId]: [notes] }，按 note.id 去重合并
  const notes = getAllNotes();
  if (notes && typeof notes === 'object') {
    const out = {};
    for (const k of Object.keys(notes)) {
      const j = r(Number(k));
      out[j] = (out[j] || []).concat(notes[k] || []);
    }
    for (const k of Object.keys(out)) {
      const seen = new Set(); const uniq = [];
      for (const n of out[k]) { if (n && !seen.has(n.id)) { seen.add(n.id); uniq.push(n); } }
      out[k] = uniq;
    }
    lsSet(NOTE_KEY, out);
  }
  // 摘抄：[{ id, i, t, ts }]
  const exc = getExcerpts();
  if (Array.isArray(exc) && exc.length) {
    const seen = new Set(); const out = [];
    for (const e of exc) {
      const ne = Object.assign({}, e, { i: r(e.i) });
      if (!seen.has(ne.id)) { seen.add(ne.id); out.push(ne); }
    }
    lsSet(EXC_KEY, out);
  }
  // 背诵：{ [id]: {t,n,last} } + 日志 [{i,t}]
  const rec = getRecites();
  if (rec && typeof rec === 'object') {
    const out = {};
    for (const k of Object.keys(rec)) {
      const j = r(Number(k));
      if (!out[j]) out[j] = rec[k];
      else {
        out[j].n = (out[j].n || 0) + (rec[k].n || 0);
        out[j].t = Math.max(out[j].t || 0, rec[k].t || 0);
        out[j].last = Math.max(out[j].last || 0, rec[k].last || 0);
      }
    }
    lsSet(REC_KEY, out);
  }
  const rlog = getReciteLog();
  if (Array.isArray(rlog) && rlog.length) {
    lsSet(REC_LOG, rlog.map(e => Object.assign({}, e, { i: r(e.i) })));
  }
  lsSet('shici-dedup-migrated', String(v));
}

// 详情页格律链要用的三张小表（pingze 156KB / citpl 94KB / genre）：
// 列表页预取诗作时顺带拉齐（三个 getter 会话内有 memo，重复调用零开销），
// 用户点进详情时不再连发 3 个隐性请求。这三张表不进 IDB（独立脚本生成、不随
// build 升版本），所以预热的价值在 HTTP 缓存与模块 memo，不在 IDB。
let detailHelpersWarm = false;
function warmDetailHelpers() {
  if (detailHelpersWarm) return;
  detailHelpersWarm = true;
  getPingze().catch(() => {});
  getCitpl().catch(() => {});
  getGenre().catch(() => {});
}

// 预取：把 id 所在分块拉进 IDB + 内存（不阻塞）
export function prefetchPoems(ids) {
  warmDetailHelpers();
  (async () => {
    for (const id of (ids || [])) {
      try {
        const loc = await locate(id);
        if (!loc) continue;
        const url = chunkUrl(loc);
        if (memGet(url)) continue;
        const arr = JSON.parse(await cachedText(url));
        memPut(url, arr);
      } catch {}
    }
  })();
}

// ---------- 大索引 ----------
// 标题/作者索引：分片存放（idx/names/index.json + p00..pNN），按清单并行取、按序拼回纯文本；
// 清单缺失时退回旧的单文件，兼容没重新构建的数据。
let namesIdxPromise = null;
function ensureNamesIdx() {
  if (!namesIdxPromise) {
    namesIdxPromise = cachedJSON('data/idx/names/index.json')
      .then(v => (v && Array.isArray(v.parts) && v.parts.length ? v : null))
      .catch(() => null);
  }
  return namesIdxPromise;
}
// 分片清单单独导出：调用方需要 parts.length 来定补扫范围
export function getNamesIndex() { return ensureNamesIdx(); }
// names 渐进加载：按分片逐片返回（首片到齐即可开始搜索，不等全部 19.6MB）
export async function getNamesPart(pi) {
  const idx = await ensureNamesIdx();
  if (!idx) return null; // 无分片索引（旧数据）→ 调用方走 getNames 兜底
  return cachedText(`data/idx/names/${idx.parts[pi].id}.json`);
}
export async function getNames() {
  const idx = await ensureNamesIdx();
  if (!idx) return cachedText('data/idx/names.json');
  const parts = await Promise.all(idx.parts.map(p => cachedText(`data/idx/names/${p.id}.json`)));
  return parts.join('');
}
// 全文索引：按集合分包（idx/ft/index.json 是清单，idx/ft/<cid>.json 是分片）
// 旧的 48MB 单文件已废弃，保留这个函数仅供旧缓存/旧数据兜底
export async function getFulltext() { return cachedText('data/idx/fulltext.json'); }
export async function getFtIndex() { return cachedJSON('data/idx/ft/index.json'); }
export async function getFtShard(id) { return cachedJSON(`data/idx/ft/${id}.json`); }
export async function getHot() { return cachedJSON('data/idx/hot.json'); }
export async function getMingju() { return cachedJSON('data/idx/mingju.json'); }
// 标签索引：{ v, a:{原始写法→归一键}, k:{ 键:[主要tab, [id...]] } }
export async function getTags() { return cachedJSON('data/idx/tags.json'); }
// 标签分桶：{ v, rows:{ textbook:[[标签,篇数]...], genre, dynasty, theme } }
export async function getTagBuckets() { return cachedJSON('data/idx/tagbuckets.json'); }
// 体裁索引：{ m:{ '五绝':{n, top:[id]} } }
export async function getGenre() {
  if (!gnMemo) gnMemo = cachedText('data/idx/genre.json', true).then(t => JSON.parse(t).m || {}).catch(() => ({}));
  return gnMemo;
}
let gnMemo = null;
// 词谱模板：{ v, m:{ '词牌|字数': [平仄模板, 样本数] } }，从同调作品反推
export async function getCitpl() {
  // 这两张表由独立脚本生成（不参与 build 的版本号），所以绕过 IDB，只留模块内缓存：
  // 一次会话请求一次，HTTP 仍是 no-cache 协商，改完脚本刷新即可生效。
  if (!ctMemo) ctMemo = cachedText('data/idx/citpl.json', true).then(t => JSON.parse(t).m || {}).catch(() => ({}));
  return ctMemo;
}
let ctMemo = null;
// 字音表：{ m:{ 字:主音 }, d:[多音字] }
export async function getPingze() {
  if (!pzMemo) pzMemo = cachedText('data/idx/pingze.json', true)
    .then(t => { const d = JSON.parse(t); return { m: d.m || {}, d: d.d || [] }; })
    .catch(() => ({ m: {}, d: [] }));
  return pzMemo;
}
let pzMemo = null;
// 朝代索引：{ v, rows:[{k:朝代, c:篇数, chunks:[分片路径]}] }，分片按需取
export async function getDynIndex() { return cachedJSON('data/idx/dyn.json'); }
export async function getDynChunk(p) { return JSON.parse(await cachedText('data/idx/' + p)); }

// ---------- 作者 ----------
export async function getAuthor(name) {
  const idx = await cachedJSON('data/idx/authors.json');
  const pos = idx[name];
  if (!pos) return null;
  const arr = await cachedJSON(`data/authors/a-${String(pos[0]).padStart(3, '0')}.json`);
  return arr[pos[1]] || null;
}

// ---------- 收藏 ----------
const FAV_KEY = 'shici-favs';
export function getFavs() { return lsGet(FAV_KEY, []).slice(); }   // 拷贝防调用方误改内存缓存
export function isFav(id) { return getFavs().includes(id); }
export function toggleFav(id) {
  const list = getFavs();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  let capped = false;
  if (list.length > 2000) { list.length = 2000; capped = true; }   // 上限：静默截断改为一次性提醒（评审 N7）
  lsSet(FAV_KEY, list);
  if (capped) noteStorageFail('favs-cap', new Error('收藏达 2000 上限'),
    '收藏已达 2000 篇上限，最旧的收藏会被移出。建议先导出备份，再清理一部分。');
  return i < 0;
}

// ---------- 阅读历史 ----------
// 上限只影响「列表长度」，设置页显示的也是这个长度。
// 历史：原来是 50，几天就顶满、数字从此不动；现在给到 10000（约 70KB，占配额 1.4%）。
// 到顶后旧的自动滚出——这是设计内的滚动，不提示。
export const HIS_MAX = 10000;   // 浏览历史最多存 10000 条（去重后的不同作品数；历史页的提示文案也读它）
const SHIST_MAX = 1000;   // 搜索历史最多存 1000 条
const HIS_KEY = 'shici-history';
export function pushHistory(id) {
  const list = getHistory();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  list.unshift(id);
  if (list.length > HIS_MAX) list.length = HIS_MAX;
  lsSet(HIS_KEY, list);
}
// 配额写失败：只提示一次（会话内），交给 UI 去弹（msg 可带具体文案，见 app.js 监听）
let __storageWarned = false;
function noteStorageFail(where, err, msg) {
  try { console.warn('[storage] ' + where + ' 写入失败：', err && err.message); } catch {}
  if (__storageWarned) return;
  __storageWarned = true;
  try { window.dispatchEvent(new CustomEvent('shici:storage-full', { detail: { msg } })); } catch {}
}

export function removeHistory(id) {
  lsSet(HIS_KEY, getHistory().filter(x => x !== id));
  return true;
}

export function getHistory() { return lsGet(HIS_KEY, []).slice(); }

// ---------- 偏好 ----------
export function pref(key, val) {
  if (val === undefined) return localStorage.getItem('shici-' + key);
  // 写失败（配额满/隐私模式）不能裸抛：设置页切开关、详情页切拼音都走这里，
  // 抛出去就是「异常」红条。与 pushHistory 同口径：提示一次，不中断操作。
  try { localStorage.setItem('shici-' + key, val); } catch (e) { noteStorageFail('pref:' + key, e); }
}

// ---------- localStorage 内存缓存 + 写穿透（评审 N6）----------
// 历史/已读/背诵这类键每次开详情都要 parse+stringify 几十 KB，低端手机上切页明显变钝。
// 读一次进内存，之后操作内存对象、同步落盘——语义不变（本应用是这些键的唯一写者）。
// 纪律：凡是 lsGet 过的键，外部直接 localStorage.setItem/removeItem 会造成内存与盘
// 不一致，所有写入必须走 lsSet/lsDel（importAllData / clearUserData 已改）。
const lsMemo = new Map();
function lsGet(key, fallback) {
  if (!lsMemo.has(key)) {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    lsMemo.set(key, (v === null || v === undefined) ? fallback : v);
  }
  return lsMemo.get(key);
}
function lsSet(key, val) {
  lsMemo.set(key, val);
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { noteStorageFail(key, e); }
}
function lsDel(key) {
  lsMemo.delete(key);
  try { localStorage.removeItem(key); } catch (e) {}
}

// ---------- 背诵 ----------
const REC_KEY = 'shici-recite', REC_LOG = 'shici-recite-log';
export function getRecites() { return lsGet(REC_KEY, {}); }
export function addRecite(id) {
  const r = getRecites();
  const now = Date.now();
  if (!r[id]) r[id] = { t: now, n: 0, last: 0 };
  r[id].n++;
  r[id].last = now;
  lsSet(REC_KEY, r);
  const log = getReciteLog();
  log.push({ i: id, t: now });
  if (log.length > 8000) log.splice(0, log.length - 8000);
  lsSet(REC_LOG, log);
  return r[id];
}
export function removeRecite(id) {
  const r = getRecites();
  delete r[id];
  lsSet(REC_KEY, r);
}
export function getReciteLog() { return lsGet(REC_LOG, []); }

// ---------- 摘录本 ----------
const EXC_KEY = 'shici-excerpts';
export function getExcerpts() { return lsGet(EXC_KEY, []).slice(); }
// 保存划选的句子；同诗同句去重；返回新记录或 null（重复/超长）
export function addExcerpt(poemId, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 300) return null;
  const list = getExcerpts();
  if (list.some(e => e.i === poemId && e.t === t)) return null;
  const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), i: poemId, t, ts: Date.now() };
  list.unshift(rec);
  let capped = false;
  if (list.length > 500) { list.length = 500; capped = true; }   // 上限：静默截断改为一次性提醒（评审 N7）
  lsSet(EXC_KEY, list);
  if (capped) noteStorageFail('excerpts-cap', new Error('摘录达 500 上限'),
    '摘录已达 500 条上限，最旧的摘录会被移出。建议先导出备份。');
  return rec;
}
export function removeExcerpt(id) {
  lsSet(EXC_KEY, getExcerpts().filter(e => e.id !== id));
}

// ---------- 眉批夹批（2026-10-28） ----------
// 结构：{ [poemId]: [{ id, li, t, s, ts }] }
//   li = 写批注时的显示行号（只作提示）；t = 该行净文（真锚点，见 js/notes.js 的说明）
//   s  = 批语正文
// 存在 localStorage 里，跟收藏/摘录同一档次：只在本机，导出备份时一起走。
const NOTE_KEY = 'shici-notes';
export const NOTE_PER_POEM = 60;    // 单篇上限（再长也够用，防畸形数据撑爆一条 localStorage 记录）
export const NOTE_TOTAL = 2000;     // 全站上限，超出按时间淘汰最旧的
export function getAllNotes() { return lsGet(NOTE_KEY, {}); }
export function getNotes(poemId) {
  const a = getAllNotes()[poemId];
  return Array.isArray(a) ? a.slice() : [];
}
export function noteTotal() {
  return Object.values(getAllNotes()).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
}
function noteId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// 淘汰：全局超限时按 ts 从旧到新删
function trimNotes(all) {
  const flat = [];
  for (const k of Object.keys(all)) for (const n of all[k]) flat.push([k, n]);
  if (flat.length <= NOTE_TOTAL) return all;
  flat.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  const drop = new Set(flat.slice(0, flat.length - NOTE_TOTAL).map(([k, n]) => k + ':' + n.id));
  for (const k of Object.keys(all)) all[k] = all[k].filter(n => !drop.has(k + ':' + n.id));
  return all;
}
// anchor: { li, t }；返回记录，或 null（空/超长/满篇）
export function addNote(poemId, anchor, text) {
  const s = String(text || '').trim().slice(0, 500);
  if (!s) return null;
  const all = getAllNotes();
  const list = Array.isArray(all[poemId]) ? all[poemId] : [];
  if (list.length >= NOTE_PER_POEM) return null;
  const rec = {
    id: noteId(),
    li: Number.isFinite(+anchor.li) ? +anchor.li : 0,
    t: String(anchor.t || ''),
    s, ts: Date.now(),
  };
  list.push(rec);
  list.sort((a, b) => (a.li || 0) - (b.li || 0));
  all[poemId] = list;
  lsSet(NOTE_KEY, trimNotes(all));
  return rec;
}
export function updateNote(poemId, id, text) {
  const s = String(text || '').trim().slice(0, 500);
  const all = getAllNotes();
  const list = Array.isArray(all[poemId]) ? all[poemId] : null;
  if (!list) return false;
  const rec = list.find(n => n.id === id);
  if (!rec) return false;
  if (!s) return false;
  rec.s = s; rec.ts = Date.now();
  lsSet(NOTE_KEY, all);
  return true;
}
export function removeNote(poemId, id) {
  const all = getAllNotes();
  const list = Array.isArray(all[poemId]) ? all[poemId] : null;
  if (!list) return false;
  const next = list.filter(n => n.id !== id);
  if (!next.length) delete all[poemId]; else all[poemId] = next;
  lsSet(NOTE_KEY, all);
  return true;
}
export function clearNotes() { lsDel(NOTE_KEY); }

// ---------- 全量用户数据导出/导入（收藏+背诵+历史+摘录+已读+偏好） ----------
// 偏好键必须与 §4.6 的完整清单一致：ty/bg/autoplay/daily 曾漏在备份外，恢复后静默回默认。
const PREF_KEYS = ['theme', 'ink', 'fs', 'py', 'st', 'fn', 'ao', 'ty', 'bg', 'autoplay', 'daily', 'zh', 'hbbest', 'fhbest', 'hbstars', 'hbrounds', 'fhstars', 'fhrounds', 'sc'];
// ao = 详情页释文（译文/注释/赏析）默认展开。缺省视为开，老用户升级后立即生效。
// sc = 搜索范围（全部/标题/作者/正文，2026-11-03 搜索页下拉）；进备份清单与其他 UI 偏好同口径（第十轮 🟡-6）。
// hbbest/fhbest = 行令小游戏（合璧连对 / 飞花令单局应令数）的最高纪录。
// hbstars/hbrounds、fhstars/fhrounds = 两游戏的累计星数与局数（接上五句得一星，2026-10-31 起记）。
try { if (localStorage.getItem('shici-ao') === null) localStorage.setItem('shici-ao', '1'); } catch {}
export function exportAllData() {
  return JSON.stringify({
    app: 'shici', v: 1, exportedAt: new Date().toISOString(),
    favs: getFavs(),
    recites: getRecites(),
    reciteLog: getReciteLog(),
    history: getHistory(),
    searchHist: getSearchHist(),
    excerpts: getExcerpts(),
    read: readStore(),          // 已读记录（连续天数/累计篇数/印章的数据源），2026-10-27 起纳入备份
    notes: getAllNotes(),       // 眉批（2026-10-28 起纳入备份）
    prefs: Object.fromEntries(PREF_KEYS.map(k => [k, localStorage.getItem('shici-' + k)]).filter(([, v]) => v !== null && v !== undefined)),
  });
}
export function importAllData(jsonStr) {
  const o = JSON.parse(jsonStr);
  if (!o || typeof o !== 'object') throw new Error('格式不对');
  const summary = { favs: 0, recites: 0, history: 0, excerpts: 0, notes: 0 };
  if (Array.isArray(o.favs)) {
    const cur = getFavs();
    for (const id of o.favs) if (!cur.includes(id)) cur.unshift(id);
    if (cur.length > 2000) cur.length = 2000;
    lsSet(FAV_KEY, cur);
    summary.favs = cur.length;
  }
  if (o.recites && typeof o.recites === 'object') {
    const cur = getRecites();
    for (const [k, v] of Object.entries(o.recites)) {
      if (!cur[k] || (v.last || 0) > (cur[k].last || 0)) cur[k] = v;
    }
    lsSet(REC_KEY, cur);
    summary.recites = Object.keys(cur).length;
    const log = getReciteLog();
    const have = new Set(log.map(e => e.t + ':' + e.i));
    for (const e of (o.reciteLog || [])) if (e && !have.has(e.t + ':' + e.i)) log.push(e);
    log.sort((a, b) => a.t - b.t);
    if (log.length > 8000) log.splice(0, log.length - 8000);
    lsSet(REC_LOG, log);
  }
  if (Array.isArray(o.history)) {
    const cur = getHistory();
    for (const id of o.history) if (!cur.includes(id)) cur.push(id);
    if (cur.length > HIS_MAX) cur.length = HIS_MAX;
    lsSet(HIS_KEY, cur);
    summary.history = cur.length;
  }
  if (Array.isArray(o.searchHist)) {
    const cur0 = getSearchHist();
    for (let i2 = o.searchHist.length - 1; i2 >= 0; i2--) if (o.searchHist[i2] && !cur0.includes(o.searchHist[i2])) cur0.push(o.searchHist[i2]);
    if (cur0.length > SHIST_MAX) cur0.length = SHIST_MAX;
    lsSet(HIST_KEY, cur0);
    summary.searchHist = cur0.length;
  }
  if (o.prefs) for (const k of PREF_KEYS) {
    if (o.prefs[k] !== undefined && o.prefs[k] !== null) {
      try { localStorage.setItem('shici-' + k, o.prefs[k]); } catch {}
    }
  }
  if (Array.isArray(o.excerpts)) {
    const cur = getExcerpts();
    const have = new Set(cur.map(e => e.id));
    for (const e of o.excerpts) {
      if (e && e.id && !have.has(e.id) && e.i !== undefined && e.t) { cur.push(e); have.add(e.id); }
    }
    cur.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (cur.length > 500) cur.length = 500;
    lsSet(EXC_KEY, cur);
    summary.excerpts = cur.length;
  }
  // 已读记录：ids 并集去重；days 是「当天新读篇数」，两台设备同天合并取大（相加会把
  // 两边都读过的同一篇算两遍）。
  if (o.read && typeof o.read === 'object') {
    const cur = readStore();
    const ids = new Set(cur.ids);
    for (const id of (o.read.ids || [])) if (Number.isFinite(id)) ids.add(id);
    const days = Object.assign({}, cur.days);
    for (const [d, n] of Object.entries(o.read.days || {})) days[d] = Math.max(days[d] || 0, +n || 0);
    readSave({ ids: [...ids], days });
    summary.read = ids.size;   // Set 是 size 不是 length——写成 length 恒为 undefined，摘要里「已读」段会被静默省掉
  }
  // 眉批：按 poemId + 批注 id 合并；同一个 id 冲突时取 ts 新的那份。
  // 不按文本去重——同一行留两条不同批语是有意义的（夹批可以叠）。
  if (o.notes && typeof o.notes === 'object') {
    const all = getAllNotes();
    let added = 0;
    for (const [pid, arr] of Object.entries(o.notes)) {
      if (!Array.isArray(arr)) continue;
      const cur = Array.isArray(all[pid]) ? all[pid] : [];
      const byId = new Map(cur.map(n => [n.id, n]));
      for (const n of arr) {
        if (!n || !n.id || !n.s) continue;
        const old = byId.get(n.id);
        if (!old) { cur.push(n); byId.set(n.id, n); added++; }
        else if ((n.ts || 0) > (old.ts || 0)) { old.s = n.s; old.ts = n.ts; }
      }
      cur.sort((a, b) => (a.li || 0) - (b.li || 0));
      if (cur.length) all[pid] = cur;
    }
    lsSet(NOTE_KEY, trimNotes(all));
    summary.notes = noteTotal();
    summary.notesAdded = added;
  }
  return summary;
}
export function clearUserData(kind) {
  if (kind === 'favs') lsDel(FAV_KEY);
  else if (kind === 'history') lsDel(HIS_KEY);
  else if (kind === 'recites') { lsDel(REC_KEY); lsDel(REC_LOG); }
  else if (kind === 'searchhist') clearSearchHist();
  else if (kind === 'excerpts') lsDel(EXC_KEY);
  else if (kind === 'notes') clearNotes();
}

// ---------- 搜索历史 ----------
const HIST_KEY = 'shici-search-hist';
export function getSearchHist() { return lsGet(HIST_KEY, []).slice(); }
export function pushSearchHist(q) {
  if (!q || q.length < 2) return;
  // 顺手清掉旧数据里的前缀垃圾：早先每次防抖输入都记，留下了「静」「静夜」这类条目。
  // 现在提交「静夜思」会把它们是前缀的旧条目一并去掉，不用手动清空。
  const l = getSearchHist().filter(x => x !== q && !(q.length > x.length && q.startsWith(x)));
  l.unshift(q);
  if (l.length > SHIST_MAX) l.length = SHIST_MAX;   // 到顶设计内滚出，不提示（§4.6）
  lsSet(HIST_KEY, l);
}
export function removeSearchHist(q) {
  lsSet(HIST_KEY, getSearchHist().filter(x => x !== q));
  return true;
}
export function clearSearchHist() { lsDel(HIST_KEY); }

// ---- 随便看看：从全库随机取一首「读得下去」的 ----
// 全库 64.3 万条（manifest 55 集合合计），其中约 2.5 万是残句断章（正文不足 2 行），无作者的 1 条，
// 另有 30 篇 hide:1 的下线记录（近现代集）也不能露出。
// 命中就重摇，最多 6 次——单次命中率约 94%，6 次全空概率低到可以忽略。
// 2026-11-01（第七轮 P0-1 修复）：旧版 `roll()` 把 [0, count 总和) 当 id 空间用，
// span≠count 的集合尾区（含跨集合尾区，约 2.56 万条）永远抽不到。
// 改为按 count 加权选集合、再在该集合 id 跨度 span 内均匀抽（span 含空洞与尾区，
// 空洞 id 经 getPoem 的 remap 自动落到保留正文），返回真实记录的 i。
export async function luckyPoemId() {
  clearNavCtx();   // 随便看看 = 进入新的真实集合，退出阅读队列（2026-11-01 navCtx）
  const m = await getManifest();
  const pool = m.collections.filter(c => c.count > 0);
  const total = pool.reduce((n, c) => n + c.count, 0);
  for (let k = 0; k < 6; k++) {
    let r = Math.random() * total, col = pool[0];
    for (const c of pool) { if (r < c.count) { col = c; break; } r -= c.count; }
    const span = col.span != null ? col.span : col.count;   // 旧 manifest 无 span 时退回 count
    const id = col.start + Math.floor(Math.random() * span);
    const p = await getPoem(id).catch(() => null);
    if (p && !p.hide && p.a && (p.p || []).length >= 2) return p.i != null ? p.i : id;
  }
  // 兜底不再拿 count 总和当 id 空间摇（第八轮 🟡-3：那会永远抽不到尾区 2.8 万个 id）。
  // 三个调用方（home/detail/mine）都判 id != null，返回 null 即「这次没摇到」。
  return null;
}

// ---------- 阅读队列 navCtx（2026-11-01，用户提案）----------
// 搜索/标签/体裁/名句/作者页把「有序 id 列表」挂进来，详情页的上/下一篇优先在队列里走，
// 正文导航区下方显「队列名 第 k / N 篇」指示条；没命中队列就回落到原集合内导航。
// 存 sessionStorage：按标签页隔离（两个标签页各搜各的，互不串队），刷新后仍在。
// 约定的清除时机：随便看看（luckyPoemId）、首页/集合目录/朝代页（进入即新会话）；
// 其余聚合页（搜索/标签/体裁/名句/作者）渲染时自然替换。
const NAVQ_KEY = 'shici-navq';
const NAVQ_MAX = 1000;   // 队列上限：搜索全量命中可达数千，截断到一千够读一晚上
let _navq;               // undefined=尚未从 sessionStorage 读过
function navqLoad() {
  if (_navq === undefined) {
    try { _navq = JSON.parse(sessionStorage.getItem(NAVQ_KEY)) || null; } catch (e) { _navq = null; }
  }
  return _navq;
}
// 挂队列：内部做 remap（队列里的 id 一律是「保留正文」的 id，详情页 poem.i 才对得上）
// + 按目标 id 去重 + 截断。rawIds 为空/非数组 = **不动**当前队列（第九轮起：零结果搜索
// 不清队，保留正在进行的阅读会话；显式清队走 clearNavCtx）。
export async function setNavCtx(rawIds, label) {
  let ids = [];
  if (Array.isArray(rawIds) && rawIds.length) {
    const remap = await getDedupRemap();
    const seen = new Set();
    for (const raw of rawIds) {
      if (raw == null || !Number.isFinite(+raw)) continue;
      const id = (remap && remap[raw] != null) ? remap[raw] : +raw;
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
      if (ids.length >= NAVQ_MAX) break;
    }
  }
  if (!ids.length) return navqLoad();
  _navq = { ids, label: String(label || ''), ts: Date.now() };
  try { sessionStorage.setItem(NAVQ_KEY, JSON.stringify(_navq)); } catch (e) {}
  return _navq;
}
export function clearNavCtx() {
  _navq = null;
  try { sessionStorage.removeItem(NAVQ_KEY); } catch (e) {}
}
// 当前诗是否在队列里：返回 { q, pos }（pos 从 0 起）或 null
export function navCtxOf(id) {
  const q = navqLoad();
  if (!q || !q.ids || !q.ids.length) return null;
  id = +id;
  const pos = q.ids.indexOf(id);
  if (pos >= 0) return { q, pos };
  // remap 漂移兜底（第九轮 🟡-2）：队列挂载后数据又做过 dedup、队列里某 id 的
  // 保留正文换位——落地 id 是队列某条的新正文时，反查 remap 命中原队列位次，
  // 指示条不中途消失。命中后走位仍从原位次开始，语义不变。
  if (_remap) {
    for (let i = 0; i < q.ids.length; i++) {
      const r = _remap[q.ids[i]];
      if (r != null && +r === id) return { q, pos: i };
    }
  }
  return null;
}

// ---- 已读记录（2026-10-27，新版版面用）----
// { ids: number[], days: { 'YYYY-MM-DD': n } }
// ids 去重（同一篇重读不增数），days 记每天「新读」的篇数，用来算「今天第 N 篇」与连续天数。
const READ_KEY = 'shici-read';
// 日期键 YYYY-MM-DD：全站唯一实现，vcommon 从这里转出口（2026-10-29 复用收敛）
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readStore() {
  const o = lsGet(READ_KEY, null);
  if (o && Array.isArray(o.ids) && o.days && typeof o.days === 'object') return o;
  // 缺失/损坏：归一化一次写回（健康数据路径零写入）
  const norm = {
    ids: (o && Array.isArray(o.ids)) ? o.ids : [],
    days: (o && o.days && typeof o.days === 'object') ? o.days : {},
  };
  lsSet(READ_KEY, norm);
  return norm;
}

function readSave(o) { lsSet(READ_KEY, o); }

// 记一次「读完」。返回 { first, today }：first=本篇此前没读过
export function markRead(id) {
  const o = readStore();
  const d = dayKey(new Date());
  const first = !o.ids.includes(id);
  if (first) { o.ids.push(id); o.days[d] = (o.days[d] || 0) + 1; }
  else if (!o.days[d]) o.days[d] = 0;
  readSave(o);
  return { first, today: o.days[d] };
}

// 已读 id 的 Set（列表页一次取好，逐行判断用，别在循环里反复调 isRead）
export function readIdSet() {
  return new Set(readStore().ids);
}

// 这一篇读过没有（印章用；ids 通常几千到几万，includes 在毫秒级，够用）
export function isRead(id) {
  return readStore().ids.includes(id);
}

// 今天的篇数 / 累计篇数 / 连续天数（今天没读就从昨天往前数）
// days：累计打卡天数（days 里出现过的日期数，含只重读不新读的 0 值天）；best：史上最长连续
export function readStats() {
  const o = readStore();
  const cur = new Date();
  const today = o.days[dayKey(cur)] || 0;
  if (!o.days[dayKey(cur)]) cur.setDate(cur.getDate() - 1);
  let streak = 0;
  while (o.days[dayKey(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }
  // 最长连续：键是 YYYY-MM-DD，字典序即日期序，逐键看是否紧挨上一天。
  // 坏键（解析出 NaN）只会断链，不会抛错。
  const keys = Object.keys(o.days).sort();
  let best = 0, run = 0, prev = '';
  for (const k of keys) {
    if (prev) {
      const d = new Date(prev + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      run = dayKey(d) === k ? run + 1 : 1;
    } else run = 1;
    if (run > best) best = run;
    prev = k;
  }
  return { today, total: o.ids.length, streak, days: keys.length, best };
}
