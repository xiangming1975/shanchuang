// 定向索引重建（reindex-idx.cjs）
// ---------------------------------------------------------------
// 只读 site/data/manifest.json + 全部分片，只重建派生索引：
//   idx/names/*  firstlines.json  idx/ft/*  authors/* + idx/authors.json
//   tags.json  tagbuckets.json  mingju.json
// 不碰任何分片文件、不动 manifest 的 i 分区。
// 目的：让尾部追加的 pdb_* 新集合可被搜索、出现在作者页/标签页/名句页。
//
// 与 etl/build.js 的区别：build.js 从源 JSONL 重排分片（会丢掉 pdb_*），
// 本脚本从【已有分片】读最终态数据，仅复制其索引生成逻辑，故格式与历史产物一致。
//
// 用法：node reindex-idx.cjs            # 先备份 idx + authors，再写
//       node reindex-idx.cjs --dry      # 只统计，不写盘
// ---------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');
const POEMS = path.join(DATA, 'poems');
const IDX = path.join(DATA, 'idx');
const AUTHORS_DIR = path.join(DATA, 'authors');
const CHUNK = 200;
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });
const DRY = process.argv.includes('--dry');

// ---------- 辅助函数（逐字复制自 etl/build.js） ----------
function nonEmptyLines(s) { return String(s || '').split('\n').filter(l => l.trim()).length; }
function normKey(s) {
  let o = '';
  for (const ch of String(s || '')) o += convT2S(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
}
const PUNCT_RE = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
const stripPunct = (x) => String(x || '').replace(PUNCT_RE, '');

// 全文搜索开放的集合（原 FULLTEXT_SETS）；pdb_* 全部纳入，使新集合可被全文搜到
const FULLTEXT_SETS = new Set(['tang300', 'shijing', 'chuci', 'lunyu', 'ssxx', 'guwen', 'songci300', 'hjj', 'nt', 'cc', 'nalan', 'ymy', 'smts', 'hanwei', 'jinyuan', 'xdS', 'gwdj', 'fu', 'songci', 'yq', 'mingS', 'qingS', 'jsshi', 'jssci', 'jsswen', 'ershisishi', 'zitongjian', 'jingbu']);
// 标签同义合并 / 分桶规则（逐字复制）
const TAG_MERGE = {
  描写山: '山', 写山: '山', 描写水: '水', 写水: '水',
  写花: '花', 写雨: '雨', 写雪: '雪', 写鸟: '鸟', 写风: '风', 写马: '马',
  写物: '咏物', 咏物诗: '咏物', 写人诗: '写人', 带有地名: '地名',
  咏史怀古: '怀古', 咏古: '怀古',
};
const BUCKET_RULES = [
  ['textbook', /年级|册|课内|课外|必背|教材/],
  ['genre', /^(五言|七言|杂言)?(律诗|绝句|古诗|歌行|乐府)$|^(词|小令|散曲|赋)$/],
];
const BOOKISH = /三百首|精选|观止|十九首|列传|本纪|世家|通鉴|国风|蒙学|千家诗/;

function backup() {
  const ts = Date.now();
  const dst = path.join(DATA, `idx-authors.bak.${ts}`);
  fs.mkdirSync(dst, { recursive: true });
  for (const sub of ['names', 'ft']) {
    const s = path.join(IDX, sub);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(dst, sub), { recursive: true });
  }
  const a = AUTHORS_DIR;
  if (fs.existsSync(a)) fs.cpSync(a, path.join(dst, 'authors'), { recursive: true });
  for (const f of ['authors.json', 'firstlines.json', 'tags.json', 'tagbuckets.json', 'mingju.json']) {
    const fp = path.join(IDX, f);
    if (fs.existsSync(fp)) fs.copyFileSync(fp, path.join(dst, f));
  }
  console.log('已备份现有索引到', dst);
  return dst;
}

// ---------- 1. 读 manifest + 全部分片 ----------
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const collections = manifest.collections;
// 把所有 pdb_* 也加入全文索引集合
for (const c of collections) if (c.id.startsWith('pdb_')) FULLTEXT_SETS.add(c.id);

console.log('集合数:', collections.length, '| 总条数:', manifest.total);
console.log('全文索引集合数:', FULLTEXT_SETS.size);
if (!DRY) backup();

// 载入每个集合的记录（最终态），并建立 id→tab 区间（标签用）
const rowsByColl = new Map();
const idTabRanges = [];
let acc = 0;
for (const c of collections) {
  const arr = [];
  for (const fn of c.chunks) {
    const fp = path.join(POEMS, fn);
    if (!fs.existsSync(fp)) { console.log('  [缺分片]', fn); continue; }
    const a = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const r of a) arr.push(r);
  }
  rowsByColl.set(c.id, arr);
  idTabRanges.push([acc, acc + c.count, c.tab || '']);
  acc += c.count;
}
const allRows = [];
for (const c of collections) for (const r of rowsByColl.get(c.id)) allRows.push(r);
console.log('载入记录:', allRows.length);

const tabOfId = (id) => {
  let lo = 0, hi = idTabRanges.length - 1, hit = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= idTabRanges[mid][0]) { hit = idTabRanges[mid][2]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return hit;
};

// ---------- 2. names + firstlines ----------
console.log('--- names + firstlines ---');
const titleCnt = new Map();
const keyOf = new Map();
for (const r of allRows) { const k = normKey(r.t); keyOf.set(r.i, k); titleCnt.set(k, (titleCnt.get(k) || 0) + 1); }
const NAMES_PART_MAX = 4 * 1024 * 1024;
const nameParts = [];
let partBuf = [], partBytes = 0, partIdx = 0;
const flushNames = () => {
  if (!partBuf.length) return;
  const id = 'p' + String(partIdx).padStart(2, '0');
  const text = partBuf.join('');
  nameParts.push({ id, n: partBuf.length, b: Buffer.byteLength(text) });
  if (!DRY) fs.writeFileSync(path.join(IDX, 'names', id + '.json'), text);
  partBuf = []; partBytes = 0; partIdx++;
};
const firstLines = {};
for (const r of allRows) {
  if (r.hide) continue;
  const line = `${r.i}\t${r.t || ''}\t${r.a || ''}\n`;
  partBuf.push(line);
  partBytes += Buffer.byteLength(line);
  if (partBytes >= NAMES_PART_MAX) flushNames();
  if (titleCnt.get(keyOf.get(r.i)) > 1) {
    firstLines[r.i] = (r.p && r.p[0] ? String(r.p[0]) : '').replace(/\s+/g, ' ').slice(0, 24);
  }
}
flushNames();
if (!DRY) {
  fs.writeFileSync(path.join(IDX, 'names', 'index.json'), JSON.stringify({ v: 1, total: allRows.length, parts: nameParts }));
  fs.writeFileSync(path.join(IDX, 'firstlines.json'), JSON.stringify(firstLines));
}
console.log(`names: ${allRows.length} 行 / ${nameParts.length} 分片; firstlines 重复标题 ${Object.keys(firstLines).length} 条`);

// ---------- 3. 全文索引 ft ----------
console.log('--- ft ---');
const ftDir = path.join(IDX, 'ft');
fs.mkdirSync(ftDir, { recursive: true });
const ftOrder = [];
let ftTotal = 0;
for (const c of collections) {
  if (!FULLTEXT_SETS.has(c.id)) continue;
  const rows = [];
  for (const r of rowsByColl.get(c.id)) {
    if (r.hide) continue;
    rows.push([r.i, r.t, r.a, (r.p || []).join('\n').slice(0, 200)]);
  }
  if (!rows.length) continue;
  const buf = JSON.stringify(rows);
  if (!DRY) fs.writeFileSync(path.join(ftDir, c.id + '.json'), buf);
  ftOrder.push({ id: c.id, n: rows.length, b: buf.length });
  ftTotal += rows.length;
}
const ftMax = ftOrder.reduce((m, o) => Math.max(m, o.b), 0);
if (!DRY) fs.writeFileSync(path.join(ftDir, 'index.json'), JSON.stringify({ v: 1, total: ftTotal, order: ftOrder }));
console.log(`ft: ${ftTotal} 行 / ${ftOrder.length} 分片，最大 ${(ftMax / 1048576).toFixed(1)}MB`);

// ---------- 4. 作者索引（保留历史 bios，避免回归） ----------
console.log('--- authors ---');
// 载入历史 bios（d/bio）以保留
const existingAuthors = new Map();
try {
  const ai = JSON.parse(fs.readFileSync(path.join(IDX, 'authors.json'), 'utf8'));
  for (const [name, [ci, wi]] of Object.entries(ai)) {
    const fp = path.join(AUTHORS_DIR, `a-${String(ci).padStart(3, '0')}.json`);
    if (!fs.existsSync(fp)) continue;
    const list = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rec = list[wi];
    if (rec) existingAuthors.set(name, rec);
  }
} catch (e) { console.log('  [warn] 历史 authors 读取失败，bios 将缺失:', e.message); }

const authorCounts = new Map();
const authorPoems = new Map();
for (const c of collections) {
  for (const r of rowsByColl.get(c.id)) {
    if (!r.a) continue;
    authorCounts.set(r.a, (authorCounts.get(r.a) || 0) + 1);
    if (!authorPoems.has(r.a)) authorPoems.set(r.a, []);
    const arr = authorPoems.get(r.a);
    if (arr.length < 300) arr.push({ i: r.i, t: r.t || '' });
  }
}
const authorList = [];
for (const [name, poems] of authorPoems) {
  const ex = existingAuthors.get(name) || {};
  authorList.push({ name, n: authorCounts.get(name) || 0, d: ex.d || '', bio: ex.bio || '', p: poems });
}
authorList.sort((a, b) => b.n - a.n);
const authorChunkCount = Math.ceil(authorList.length / 800);
if (!DRY) fs.mkdirSync(AUTHORS_DIR, { recursive: true });
for (let k = 0; k < authorChunkCount; k++) {
  if (!DRY) fs.writeFileSync(path.join(AUTHORS_DIR, `a-${String(k).padStart(3, '0')}.json`), JSON.stringify(authorList.slice(k * 800, (k + 1) * 800)));
}
const authorIdx = {};
authorList.forEach((a, k) => { authorIdx[a.name] = [Math.floor(k / 800), k % 800]; });
if (!DRY) fs.writeFileSync(path.join(IDX, 'authors.json'), JSON.stringify(authorIdx));
console.log(`作者: ${authorList.length} 位, 分块 ${authorChunkCount}`);

// ---------- 5. 标签索引 + 分桶 ----------
console.log('--- tags ---');
const tagMap = new Map();
const tagAlias = {};
let tagRefs = 0;
for (const r of allRows) {
  const tg = r.tg;
  if (!tg || !tg.length) continue;
  for (const raw of tg) {
    const key = normKey(raw);
    if (!key) continue;
    let e = tagMap.get(key);
    if (!e) { e = { ids: [], t: {} }; tagMap.set(key, e); }
    e.ids.push(r.i); tagRefs++;
    const tab = tabOfId(r.i);
    e.t[tab] = (e.t[tab] || 0) + 1;
    if (!(raw in tagAlias)) tagAlias[raw] = key;
  }
}
const mergedCount = {};
for (const [from, to] of Object.entries(TAG_MERGE)) {
  const fromKey = normKey(from), toKey = normKey(to);
  if (fromKey === toKey) continue;
  const src = tagMap.get(fromKey);
  if (!src) continue;
  let dst = tagMap.get(toKey);
  if (!dst) { dst = { ids: [], t: {} }; tagMap.set(toKey, dst); }
  dst.ids.push(...src.ids);
  for (const [tab, n] of Object.entries(src.t)) dst.t[tab] = (dst.t[tab] || 0) + n;
  tagMap.delete(fromKey);
  for (const [raw, key] of Object.entries(tagAlias)) if (key === fromKey) tagAlias[raw] = toKey;
  mergedCount[to] = (mergedCount[to] || 0) + src.ids.length;
}
let mergedRefs = 0;
for (const [, e] of tagMap) {
  if (e.ids.length > 1) { const before = e.ids.length; e.ids = [...new Set(e.ids)]; mergedRefs += before - e.ids.length; }
}
const tagObj = {};
for (const [k, e] of tagMap) {
  let mainTab = '', mainN = -1;
  for (const [tab, n] of Object.entries(e.t)) if (n > mainN) { mainTab = tab; mainN = n; }
  tagObj[k] = [mainTab, e.ids.sort((a, b) => a - b)];
}
if (!DRY) fs.writeFileSync(path.join(IDX, 'tags.json'), JSON.stringify({ v: 1, a: tagAlias, k: tagObj }));
const buckets = { textbook: [], genre: [], theme: [], bookish: [] };
for (const [k, e] of tagMap) {
  const n = e.ids.length;
  const mainTab = Object.entries(e.t).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  let hit = '';
  for (const [id, re] of BUCKET_RULES) if (re.test(k)) { hit = id; break; }
  if (!hit) hit = (BOOKISH.test(k) || mainTab === '古文' || mainTab === '经部') ? 'bookish' : 'theme';
  if (hit === 'theme' && n < 20) continue;
  buckets[hit].push([k, n]);
}
for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b[1] - a[1]);
if (!DRY) fs.writeFileSync(path.join(IDX, 'tagbuckets.json'), JSON.stringify({ v: 1, rows: buckets }));
console.log(`标签: ${tagMap.size} 种 / ${tagRefs} 引用 / ${Object.keys(tagAlias).length} 写法`);

// ---------- 6. 名句索引（JoyDraw → 本站 id） ----------
console.log('--- mingju ---');
const mjSrc = path.join(ROOT, 'downloads', 'jd-extra', 'mingju.json');
if (!fs.existsSync(mjSrc)) {
  console.log('  [skip] 名句源文件不存在:', mjSrc);
} else {
  const mingjuRaw = JSON.parse(fs.readFileSync(mjSrc, 'utf8'));
  const mjAuthorSet = new Set();
  for (const m of mingjuRaw) { const na = normKey(m && m.poetName || ''); if (na) mjAuthorSet.add(na); }
  const mingjuByTitle = new Map();
  const mingjuByTitleAuthor = new Map();
  const mjAuthorTitles = new Map();
  const bodyByI = new Map();
  for (const r of allRows) {
    if (r.t) {
      const kt = normKey(r.t);
      if (kt && !mingjuByTitle.has(kt)) mingjuByTitle.set(kt, r.i);
      const ka = kt + '|' + normKey(r.a || '');
      if (ka && !mingjuByTitleAuthor.has(ka)) mingjuByTitleAuthor.set(ka, r.i);
    }
    if (r.a && mjAuthorSet.size && mjAuthorSet.has(normKey(r.a))) {
      const na = normKey(r.a);
      let arr = mjAuthorTitles.get(na);
      if (!arr) { arr = []; mjAuthorTitles.set(na, arr); }
      arr.push([normKey(r.t || ''), r.i]);
    }
    if (r.p && r.p.length) bodyByI.set(r.i, stripPunct(r.p.join('')).slice(0, 320));
  }
  const CN = '一二三四五六七八九十百';
  const RE_SEQ = new RegExp(`([·・]其[${CN}]+|其[${CN}]+|[(（][${CN}]+[)）]|[${CN}]+首|[${CN}]+章)$`);
  const stripSeq = (x) => { let t = String(x || '').trim(), again = true; while (again) { again = false; const m = t.match(RE_SEQ); if (m && t.length > m[1].length) { t = t.slice(0, -m[1].length); again = true; } } return t; };
  const stripParen = (x) => String(x || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[〔\[【][^〕\]】]*[〕\]】]/g, '').trim();
  const bodyHas = (id, needle) => { if (!needle) return false; const b = bodyByI.get(id); return !!b && b.indexOf(needle) >= 0; };
  function pickByAuthor(name, author, needle) {
    const arr = mjAuthorTitles.get(normKey(author));
    if (!arr || !arr.length) return null;
    const nk = normKey(name);
    const dot = name.indexOf('·');
    const base = normKey(dot > 0 ? name.slice(0, dot) : name);
    const sub = dot > 0 ? normKey(name.slice(dot + 1)) : '';
    const scored = [];
    for (const [nt, id] of arr) {
      let sc = 0;
      if (nt && nt === nk) sc = 1000;
      else if (nk && nt && (nt.startsWith(nk) || nk.startsWith(nt))) sc = 300 + Math.min(nt.length, nk.length);
      else if (base && nt.startsWith(base)) sc = 100 + (sub && nt.indexOf(sub) >= 0 ? 80 : 0) + Math.min(nt.length, base.length);
      if (sc) scored.push([sc, id]);
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (scored.length === 1) return scored[0][1];
    for (let k = 0; k < Math.min(scored.length, 8); k++) if (bodyHas(scored[k][1], needle)) return scored[k][1];
    return null;
  }
  const mjRows = [], mjSeen = new Set(), mjHow = {};
  for (const m of mingjuRaw) {
    if (!m) continue;
    const name = String(m.poetryName || '').trim();
    const author = String(m.poetName || '');
    const content = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (!name || !content) continue;
    const needle = stripPunct(content).slice(0, 12);
    let id, how;
    const nk = normKey(name);
    if ((id = mingjuByTitleAuthor.get(nk + '|' + normKey(author))) !== undefined) how = 'title+author';
    else if ((id = mingjuByTitle.get(nk)) !== undefined) how = 'title';
    else if (name.indexOf('·') > 0 && (id = mingjuByTitle.get(normKey(name.split('·').pop()))) !== undefined) how = 'subtitle';
    if (id === undefined) { const s1 = stripSeq(name); if (s1 !== name) id = mingjuByTitleAuthor.get(normKey(s1) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s1)); if (id !== undefined) how = 'seq'; }
    if (id === undefined && name.indexOf('·') > 0) { const tail = stripSeq(name.split('·').pop()); if (tail && tail !== name.split('·').pop()) id = mingjuByTitle.get(normKey(tail)); if (id !== undefined) how = 'seq'; }
    if (id === undefined) { const s2 = stripParen(name); if (s2 && s2 !== name) id = mingjuByTitleAuthor.get(normKey(s2) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s2)); if (id !== undefined) how = 'paren'; }
    if (id === undefined) { const cand = pickByAuthor(stripSeq(stripParen(name)), author, needle) ?? (name.indexOf('·') > 0 ? pickByAuthor(name.split('·')[0], author, needle) : null); if (cand != null) { id = cand; how = 'author+fuzzy'; } }
    if (id === undefined && author) { const arr = mjAuthorTitles.get(normKey(author)); if (arr) { for (const [, cid] of arr) { if (bodyHas(cid, needle)) { id = cid; how = 'content'; break; } } } }
    if (id === undefined) { mjHow.none = (mjHow.none || 0) + 1; continue; }
    if (mjSeen.has(content)) continue;
    mjSeen.add(content);
    mjRows.push([content, author, name, id]);
    mjHow[how] = (mjHow[how] || 0) + 1;
  }
  // 补朝代/集合/标签
  const starts = [];
  let acc2 = 0;
  for (const c of collections) { const n = c.count || 0; starts.push({ id: c.id, name: c.name, start: acc2, count: n }); acc2 += n; }
  const colOf = (id) => { let lo = 0, hi = starts.length - 1, hit = starts[0]; while (lo <= hi) { const mid = (lo + hi) >> 1; if (id >= starts[mid].start) { hit = starts[mid]; lo = mid + 1; } else hi = mid - 1; } return hit; };
  const cache = new Map();
  for (const row of mjRows) {
    const id = row[3]; const c = colOf(id);
    const file = path.join(POEMS, `${c.id}-${String(Math.floor((id - c.start) / CHUNK)).padStart(4, '0')}.json`);
    let arr = cache.get(file);
    if (!arr) { try { arr = JSON.parse(fs.readFileSync(file, 'utf8')); cache.set(file, arr); } catch { arr = []; cache.set(file, arr); } }
    const rec = arr.find(x => x.i === id);
    row[4] = rec ? (rec.d || '') : '';
    row[5] = c.name;
    row[6] = rec && rec.tg ? rec.tg : [];
  }
  if (!DRY) fs.writeFileSync(path.join(IDX, 'mingju.json'), JSON.stringify(mjRows));
  console.log(`名句: ${mjRows.length}/${mingjuRaw.length} 匹配 ` + Object.entries(mjHow).map(([k, v]) => `${k}=${v}`).join(' '));
}

console.log(DRY ? '\n[DRY] 未写入。' : '\n[OK] 索引重建完成（分片未动）。');
