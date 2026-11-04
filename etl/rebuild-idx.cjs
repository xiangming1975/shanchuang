// 重建派生索引：site/data/poems + manifest.json → idx/ 下全部二级索引。
// 2026-11-02：主库切换到外部 79 集合管线（214.6 万首、27 个新集合）后，
// etl/build.js 的全量构建依赖已归档的 3.2GB etl/out 中间产物，不可用。
// 本脚本以「现库即事实源」，口径复刻 build.js：
//   names 4MB 分片（跳 hide）/ firstlines 重复标题首行 / authors 800 分片（bios 沿用现有分片）
//   ft 3MB 子片（排除 siku·rhyme·citunes；tang·song 收名家 r.f||r.hot）
//   mingju 六级匹配（JoyDraw 1,886 条）/ tags+tagbuckets（字符串 tg 跳过）
//   dyn 2 万分片（未映射朝代原样收录，如 未知）/ t2s·s2t 全库字频
// hot.json / citpl.json / pingze.json / cipai.json 不在本脚本范围（输入未变）。
// 跑法：node --max-old-space-size=8192 etl/rebuild-idx.cjs
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const DATA = path.join(__dirname, '..', 'site', 'data');
const CHUNK = 200;
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

// normKey 逐字繁→简：214 万标题 × 多张键表，字符级 memo 把 conv 调用压到字种数
const ccMemo = new Map();
const conv1 = (ch) => { let v = ccMemo.get(ch); if (v === undefined) { v = convT2S(ch); ccMemo.set(ch, v); } return v; };
const PUNCT_RE = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s) {
  let o = '';
  for (const ch of String(s || '')) o += conv1(ch);
  return o.replace(PUNCT_RE, '').toLowerCase();
}
const stripPunct = (x) => String(x || '').replace(PUNCT_RE, '');

// ---------- 朝代归一（口径同 build.js，勿改动映射表） ----------
const DYN_MAP = {
  '夏': '先秦', '商': '先秦', '周': '先秦', '春秋': '先秦', '战国': '先秦', '先秦': '先秦', '商周': '先秦',
  '秦': '秦',
  '汉': '汉', '两汉': '汉', '西汉': '汉', '东汉': '汉', '汉末': '汉',
  '魏晋': '魏晋', '三国': '魏晋', '晋': '魏晋', '西晋': '魏晋', '东晋': '魏晋', '魏': '魏晋',
  '三国魏': '魏晋', '三国吴': '魏晋', '三国蜀': '魏晋', '曹魏': '魏晋',
  '南北朝': '南北朝', '南北': '南北朝', '南朝': '南北朝', '北朝': '南北朝', '南朝宋': '南北朝', '南朝梁': '南北朝',
  '南朝齐': '南北朝', '南朝陈': '南北朝', '北魏': '南北朝', '东魏': '南北朝', '西魏': '南北朝', '北齐': '南北朝', '北周': '南北朝',
  '隋': '隋', '隋代': '隋',
  '唐': '唐', '唐代': '唐', '唐未': '唐',
  '五代': '五代', '五': '五代', '五代十国': '五代', '十国': '五代',
  '后梁': '五代', '后唐': '五代', '后晋': '五代', '后汉': '五代', '后周': '五代',
  '宋': '宋', '北宋': '宋', '南宋': '宋', '宋代': '宋',
  '辽': '辽', '辽朝': '辽', '辽代': '辽',
  '金': '金', '金朝': '金',
  '元': '元', '元代': '元',
  '明': '明', '明代': '明', '明高': '明', '明清': '明清',
  '清': '清', '清代': '清',
  '近现代': '近现代', '近代': '近现代', '现代': '近现代', '当代': '近现代', '民国': '近现代', '近现': '近现代',
  '金由': '金', '明远': '明', '明碧': '明',
};
const DYN_KEYS = Object.keys(DYN_MAP).sort((a, b) => b.length - a.length);
const DYN_GROUPS = [
  { k: '先秦',     m: ['先秦', '秦'] },
  { k: '汉魏六朝', m: ['汉', '魏晋', '南北朝'] },
  { k: '隋唐五代', m: ['隋', '唐', '五代'] },
  { k: '宋辽金',   m: ['宋', '辽', '金'] },
  { k: '元',       m: ['元'] },
  { k: '明清',     m: ['明', '清', '明清'] },
  { k: '近现代',   m: ['近现代'] },
];
const DYN_TO_GROUP = (() => { const o = {}; for (const g of DYN_GROUPS) for (const d of g.m) o[d] = g.k; return o; })();
function dynNorm(d) {
  const k = String(d || '').trim();
  if (!k) return '';
  if (DYN_MAP[k]) return DYN_MAP[k];
  for (const key of DYN_KEYS) if (k.startsWith(key)) return DYN_MAP[key];
  return k;
}
const dynGroup = (d) => DYN_TO_GROUP[dynNorm(d)] || String(d || '').trim();

// ---------- ft 收录口径 ----------
// 排除：siku（四库长文段落会淹死正常结果）/ rhyme（韵书）/ citunes（词牌乐谱）。
// tang/song 维持名家限制（有附件 r.f 或热标 r.hot），与旧口径一致。
const EXCLUDE_FT = new Set(['siku', 'rhyme', 'citunes']);
const FAMOUS_FT = new Set(['tang', 'song']);

// ---------- 标签同义合并（同 build.js） ----------
const TAG_MERGE = {
  描写山: '山', 写山: '山',
  描写水: '水', 写水: '水',
  写花: '花', 写雨: '雨', 写雪: '雪', 写鸟: '鸟', 写风: '风', 写马: '马',
  写物: '咏物', 咏物诗: '咏物',
  写人诗: '写人',
  带有地名: '地名',
  咏史怀古: '怀古', 咏古: '怀古',
};

function main() {
  const t0 = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const cols = manifest.collections.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < cols.length; i++) if (cols[i].start <= cols[i - 1].start) throw new Error('集合 start 非严格递增: ' + cols[i].id);

  // tab 定位（tags 用）：二分查 start
  const idTabRanges = cols.map(c => [c.start, c.tab || '']);
  const tabOfId = (id) => {
    let lo = 0, hi = idTabRanges.length - 1, hit = '';
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (id >= idTabRanges[mid][0]) { hit = idTabRanges[mid][1]; lo = mid + 1; } else hi = mid - 1;
    }
    return hit;
  };
  const colOfId = (id) => {
    let lo = 0, hi = cols.length - 1, hit = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (id >= cols[mid].start) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return cols[hit];
  };

  // 现有作者分片：bios 唯一来源（etl/out 已归档），按名合并保留
  const bioMap = new Map();
  const authorsDir = path.join(DATA, 'authors');
  const oldShardFiles = fs.readdirSync(authorsDir).filter(f => /^a-\d{3}\.json$/.test(f));
  for (const f of oldShardFiles) {
    for (const a of JSON.parse(fs.readFileSync(path.join(authorsDir, f), 'utf8'))) {
      if (a && a.name && !bioMap.has(a.name)) bioMap.set(a.name, { d: a.d || '', bio: a.bio || '' });
    }
  }
  console.log(`bios 沿用: ${oldShardFiles.length} 个旧分片 / ${bioMap.size} 位作者`);

  // 名句源 + 名句作者集
  const mingjuRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'downloads', 'jd-extra', 'mingju.json'), 'utf8'));
  const mjAuthorSet = new Set();
  for (const m of mingjuRaw) { const na = normKey(m && m.poetName || ''); if (na) mjAuthorSet.add(na); }
  console.log(`名句源: ${mingjuRaw.length} 条 / ${mjAuthorSet.size} 位名句作者`);

  // ---------- PASS 1 ----------
  console.time('pass1');
  // chunkmap：每集合各分块首行 id。外部管线的 12 个新集合分块不按 200 对齐
  //（按源文件边界切，块内 2~200 行），前端 locate 用它二分，见 store.js getChunkMap。
  const chunkMap = {};
  const charFreq = new Map();
  const titleCnt = new Map();
  const ftByColl = new Map();
  const authorPoems = new Map();
  const authorCounts = new Map();
  const mingjuByTitle = new Map();
  const mingjuByTitleAuthor = new Map();
  const mjAuthorTitles = new Map();
  const bodyByI = new Map();
  const tagMap = new Map();
  const tagAlias = {};
  const dynMap = new Map();
  let allRowsCount = 0, ftTotal = 0, tagRefs = 0, strTgRows = 0, hiddenRows = 0;

  for (const col of cols) {
    const cid = col.id;
    let colRows = 0;
    const firstIds = [];
    chunkMap[cid] = firstIds;
    for (let ci = 0; ci < col.chunks.length; ci++) {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', col.chunks[ci]), 'utf8'));
      if (!arr.length) throw new Error(`空分块: ${cid} ${col.chunks[ci]}`);
      firstIds.push(arr[0].i);
      for (const r of arr) {
        allRowsCount++; colRows++;
        if (r.i == null || r.i < col.start || r.i >= col.start + (col.span ?? col.count)) throw new Error(`id 越界: ${cid} ${r.i}`);
        // 字频（含 hide，口径同 build.js PASS A）
        if (r.t) for (const ch of r.t) charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
        if (r.a) for (const ch of r.a) charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
        if (r.p) for (const ln of r.p) { if (ln) for (const ch of ln) charFreq.set(ch, (charFreq.get(ch) || 0) + 1); }
        const kt = normKey(r.t);
        titleCnt.set(kt, (titleCnt.get(kt) || 0) + 1);
        // 朝代（含 hide）
        const dg = dynGroup(r.d);
        if (dg) { let e = dynMap.get(dg); if (!e) { e = []; dynMap.set(dg, e); } e.push(r.i); }
        // 标签（含 hide）：新集合的 tg 是字符串（集合 id 标记），只认数组且跳过纯 ASCII 条目
        const tg = r.tg;
        if (Array.isArray(tg)) {
          for (const raw of tg) {
            if (!raw) continue;
            if (/^[\x21-\x7e]+$/.test(String(raw))) continue;
            const key = normKey(raw);
            if (!key) continue;
            let e = tagMap.get(key);
            if (!e) { e = { ids: [], t: {} }; tagMap.set(key, e); }
            e.ids.push(r.i);
            tagRefs++;
            const tab = tabOfId(r.i);
            e.t[tab] = (e.t[tab] || 0) + 1;
            if (!(raw in tagAlias)) tagAlias[raw] = key;
          }
        } else if (typeof tg === 'string') strTgRows++;
        if (r.hide) { hiddenRows++; continue; }
        // 全文索引
        if (!EXCLUDE_FT.has(cid) && (!FAMOUS_FT.has(cid) || r.f || r.hot)) {
          let rows = ftByColl.get(cid);
          if (!rows) { rows = []; ftByColl.set(cid, rows); }
          rows.push([r.i, r.t, r.a, (r.p || []).join('\n').slice(0, 200)]);
          ftTotal++;
        }
        // 名句键表（首个收录集合优先）
        if (kt) {
          if (!mingjuByTitle.has(kt)) mingjuByTitle.set(kt, r.i);
          const ka = kt + '|' + normKey(r.a || '');
          if (!mingjuByTitleAuthor.has(ka)) mingjuByTitleAuthor.set(ka, r.i);
        }
        if (r.a) {
          const na = normKey(r.a);
          if (mjAuthorSet.has(na)) {
            let arr2 = mjAuthorTitles.get(na);
            if (!arr2) { arr2 = []; mjAuthorTitles.set(na, arr2); }
            arr2.push([kt, r.i]);
            if (r.p && r.p.length) bodyByI.set(r.i, stripPunct(r.p.join('')).slice(0, 320));
          }
          authorCounts.set(r.a, (authorCounts.get(r.a) || 0) + 1);
          let arr3 = authorPoems.get(r.a);
          if (!arr3) { arr3 = []; authorPoems.set(r.a, arr3); }
          if (arr3.length < 300) arr3.push({ i: r.i, t: r.t || '' });
        }
      }
    }
    if (colRows !== col.count) throw new Error(`行数不符: ${cid} 期望 ${col.count} 实际 ${colRows}`);
    if ((cols.indexOf(col)) % 10 === 0 || col === cols[cols.length - 1]) console.log(`  pass1 ${cid}: ${colRows}`);
  }
  console.timeEnd('pass1');
  console.log(`pass1 完成: ${allRowsCount} 行 / hide ${hiddenRows} / 字符 ${charFreq.size} 种 / ft ${ftTotal} 行 / 字符串tg行 ${strTgRows}`);

  // ---------- chunkmap（前端 locate 二分定位用） ----------
  fs.writeFileSync(path.join(DATA, 'idx', 'chunkmap.json'), JSON.stringify(chunkMap));
  console.log(`chunkmap: ${cols.length} 集合 / ${Object.values(chunkMap).reduce((s, a) => s + a.length, 0)} 块`);

  // ---------- t2s / s2t ----------
  const t2sMap = {}, s2tMap = {};
  for (const [ch] of charFreq) {
    const sv = conv1(ch);
    if (sv !== ch) {
      t2sMap[ch] = sv;
      const cur = s2tMap[sv];
      if (!cur || charFreq.get(ch) > (charFreq.get(cur) || 0)) s2tMap[sv] = ch;
    }
  }
  fs.writeFileSync(path.join(DATA, 'idx', 't2s.json'), JSON.stringify(t2sMap));
  fs.writeFileSync(path.join(DATA, 'idx', 's2t.json'), JSON.stringify(s2tMap));
  console.log(`t2s: ${Object.keys(t2sMap).length} 字, s2t: ${Object.keys(s2tMap).length} 字`);

  // ---------- 作者分片 ----------
  console.time('authors');
  const authorList = [];
  for (const [name, poems] of authorPoems) {
    const bio = bioMap.get(name) || {};
    authorList.push({ name, n: authorCounts.get(name) || 0, d: bio.d || '', bio: bio.bio || '', p: poems });
  }
  authorList.sort((a, b) => b.n - a.n);
  const authorChunkCount = Math.ceil(authorList.length / 800);
  for (let k = 0; k < authorChunkCount; k++) {
    fs.writeFileSync(path.join(authorsDir, `a-${String(k).padStart(3, '0')}.json`), JSON.stringify(authorList.slice(k * 800, (k + 1) * 800)));
  }
  for (let k = authorChunkCount; k < oldShardFiles.length + 10; k++) {
    try { fs.unlinkSync(path.join(authorsDir, `a-${String(k).padStart(3, '0')}.json`)); } catch (e) { break; }
  }
  const authorIdx = {};
  authorList.forEach((a, k) => { authorIdx[a.name] = [Math.floor(k / 800), k % 800]; });
  fs.writeFileSync(path.join(DATA, 'idx', 'authors.json'), JSON.stringify(authorIdx));
  console.timeEnd('authors');
  console.log(`作者: ${authorList.length} 位（旧 ${bioMap.size}）/ 分片 ${authorChunkCount}`);

  // ---------- 全文索引（3MB 子片，b = buf.length 字符数，同 build.js:492） ----------
  console.time('ft');
  const ftDir = path.join(DATA, 'idx', 'ft');
  fs.mkdirSync(ftDir, { recursive: true });
  const FT_SHARD_MAX = 3 * 1024 * 1024;
  const ftOrder = [];
  const ftWritten = new Set();
  for (const col of cols) {
    const rows = ftByColl.get(col.id);
    if (!rows || !rows.length) continue;
    let groups = [rows];
    if (Buffer.byteLength(JSON.stringify(rows)) > FT_SHARD_MAX * 1.2) {
      groups = [];
      let cur = [], curB = 0;
      for (const row of rows) {
        const rb = Buffer.byteLength(JSON.stringify(row));
        if (curB + rb > FT_SHARD_MAX && cur.length) { groups.push(cur); cur = []; curB = 0; }
        cur.push(row); curB += rb;
      }
      if (cur.length) groups.push(cur);
    }
    for (let k = 0; k < groups.length; k++) {
      const id = groups.length === 1 ? col.id : `${col.id}~${k + 1}`;
      const buf = JSON.stringify(groups[k]);
      fs.writeFileSync(path.join(ftDir, id + '.json'), buf);
      ftWritten.add(id + '.json');
      ftOrder.push({ id, n: groups[k].length, b: buf.length });
    }
  }
  ftByColl.clear();
  for (const f of fs.readdirSync(ftDir)) {
    if (f.endsWith('.json') && f !== 'index.json' && !ftWritten.has(f)) { try { fs.unlinkSync(path.join(ftDir, f)); } catch (e) {} }
  }
  fs.writeFileSync(path.join(ftDir, 'index.json'), JSON.stringify({ v: 1, total: ftTotal, order: ftOrder }));
  const ftMax = ftOrder.reduce((m, o) => Math.max(m, o.b), 0);
  console.timeEnd('ft');
  console.log(`ft: ${ftTotal} 行 / ${ftOrder.length} 片（清残留后），最大 ${(ftMax / 1048576).toFixed(1)}MB(字符)`);

  // ---------- PASS 2: names 分片 + firstlines ----------
  console.time('pass2');
  const namesDir = path.join(DATA, 'idx', 'names');
  fs.mkdirSync(namesDir, { recursive: true });
  const NAMES_PART_MAX = 4 * 1024 * 1024;
  const nameParts = [];
  let partBuf = [], partBytes = 0, partIdx = 0;
  const flushNames = () => {
    if (!partBuf.length) return;
    const id = 'p' + String(partIdx).padStart(2, '0');
    const text = partBuf.join('');
    fs.writeFileSync(path.join(namesDir, id + '.json'), text);
    nameParts.push({ id, n: partBuf.length, b: Buffer.byteLength(text) });
    partBuf = []; partBytes = 0; partIdx++;
  };
  const firstLines = {};
  let namesRows = 0;
  for (const col of cols) {
    for (const chunkFile of col.chunks) {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', chunkFile), 'utf8'));
      for (const r of arr) {
        if (r.hide) continue;
        const line = `${r.i}\t${r.t || ''}\t${r.a || ''}\n`;
        partBuf.push(line); partBytes += Buffer.byteLength(line); namesRows++;
        if (partBytes >= NAMES_PART_MAX) flushNames();
        if (titleCnt.get(normKey(r.t)) > 1) {
          firstLines[r.i] = (r.p && r.p[0] ? String(r.p[0]) : '').replace(/\s+/g, ' ').slice(0, 24);
        }
      }
    }
  }
  flushNames();
  fs.writeFileSync(path.join(namesDir, 'index.json'), JSON.stringify({ v: 1, total: allRowsCount, parts: nameParts }));
  fs.writeFileSync(path.join(DATA, 'idx', 'firstlines.json'), JSON.stringify(firstLines));
  console.timeEnd('pass2');
  console.log(`names: ${namesRows} 行 / ${nameParts.length} 片, firstlines: ${Object.keys(firstLines).length} 条`);
  titleCnt.clear();

  // ---------- 标签 ----------
  console.time('tags');
  // 旧库 tg 补全（2026-11-02）：外部管线重写 52 个集合的块时丢了大半 tg——
  // hanwei/qingS/smts/jinyuan/hjj/mingS/xdS/yq/cc/nalan 整集归零，songci -1479、shijing -356，
  // 全库约 3,900 条引用、63 个键消失（id 稳定性抽查 60/60，标题+作者全一致）。
  // etl/tags-legacy-20261102.json 是丢数据前最后一版 tags.json 快照，先并入 tagMap 再做
  // 同义合并/分桶；主库块里的 tg 已不可恢复（详情页标签 chips 跟主库走，聚合层以此快照为准）。
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'tags-legacy-20261102.json'), 'utf8'));
    let restoredKeys = 0, restoredRefs = 0;
    for (const [k, val] of Object.entries(legacy.k || {})) {
      const ids = Array.isArray(val) ? val[1] : null;
      const mainTab = Array.isArray(val) ? String(val[0] || '') : '';
      if (!ids || !ids.length) continue;
      let e = tagMap.get(k);
      if (!e) { e = { ids: [], t: {} }; tagMap.set(k, e); restoredKeys++; }
      const before = e.ids.length;
      e.ids = [...new Set([...e.ids, ...ids])];
      const add = e.ids.length - before;
      restoredRefs += add;
      if (add) e.t[mainTab] = (e.t[mainTab] || 0) + add;
    }
    console.log(`旧标签快照并入: 恢复 ${restoredKeys} 键 / ${restoredRefs} 引用`);
  } catch (e) { console.log('旧标签快照缺失，跳过补全:', e.message); }
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
  }
  for (const [, e] of tagMap) if (e.ids.length > 1) e.ids = [...new Set(e.ids)];
  const tagObj = {};
  for (const [k, e] of tagMap) {
    let mainTab = '', mainN = -1;
    for (const [tab, n] of Object.entries(e.t)) if (n > mainN) { mainTab = tab; mainN = n; }
    tagObj[k] = [mainTab, e.ids.sort((a, b) => a - b)];
  }
  fs.writeFileSync(path.join(DATA, 'idx', 'tags.json'), JSON.stringify({ v: 1, a: tagAlias, k: tagObj }));
  const BUCKET_RULES = [
    ['textbook', /年级|册|课内|课外|必背|教材/],
    ['genre', /^(五言|七言|杂言)?(律诗|绝句|古诗|歌行|乐府)$|^(词|小令|散曲|赋)$/],
  ];
  const BOOKISH = /三百首|精选|观止|十九首|列传|本纪|世家|通鉴|国风|蒙学|千家诗/;
  const buckets = { textbook: [], genre: [], theme: [], bookish: [] };
  for (const [k, e] of tagMap) {
    const n = e.ids.length;
    const mainTab = Object.entries(e.t).sort((a, b) => b[1] - a[1])[0][0] || '';
    let hit = '';
    for (const [id, re] of BUCKET_RULES) if (re.test(k)) { hit = id; break; }
    if (!hit) hit = (BOOKISH.test(k) || mainTab === '古文' || mainTab === '经部') ? 'bookish' : 'theme';
    if (hit === 'theme' && n < 20) continue;
    buckets[hit].push([k, n]);
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(path.join(DATA, 'idx', 'tagbuckets.json'), JSON.stringify({ v: 1, rows: buckets }));
  console.timeEnd('tags');
  console.log(`tags: ${tagMap.size} 种 / ${tagRefs} 引用 / 桶 课本${buckets.textbook.length} 体裁${buckets.genre.length} 选集${buckets.bookish.length} 题材${buckets.theme.length}`);

  // ---------- 朝代分片 ----------
  console.time('dyn');
  const dynDir = path.join(DATA, 'idx', 'dyn');
  fs.mkdirSync(dynDir, { recursive: true });
  const DYNBUCKET = 20000;
  const dynOrder = new Map(DYN_GROUPS.map((g, i) => [g.k, i]));
  const dynMeta = [];
  const dynWritten = new Set();
  [...dynMap.entries()]
    .sort((a, b) => {
      const ia = dynOrder.has(a[0]) ? dynOrder.get(a[0]) : 999;
      const ib = dynOrder.has(b[0]) ? dynOrder.get(b[0]) : 999;
      return ia - ib || b[1].length - a[1].length;
    })
    .forEach(([k, ids], oi) => {
      const chunks = [];
      for (let p = 0; p * DYNBUCKET < ids.length; p++) {
        const name = `${String(oi).padStart(3, '0')}-${String(p).padStart(4, '0')}.json`;
        fs.writeFileSync(path.join(dynDir, name), JSON.stringify(ids.slice(p * DYNBUCKET, (p + 1) * DYNBUCKET)));
        dynWritten.add(name);
        chunks.push('dyn/' + name);
      }
      dynMeta.push({ k, c: ids.length, chunks });
    });
  for (const f of fs.readdirSync(dynDir)) {
    if (f.endsWith('.json') && !dynWritten.has(f)) { try { fs.unlinkSync(path.join(dynDir, f)); } catch (e) {} }
  }
  fs.writeFileSync(path.join(DATA, 'idx', 'dyn.json'), JSON.stringify({ v: 1, rows: dynMeta }));
  console.timeEnd('dyn');
  console.log(`dyn: ${dynMeta.map(d => d.k + ':' + d.c).join(' ')}`);

  // ---------- 名句 ----------
  console.time('mingju');
  const mjRows = [];
  const mjSeen = new Set();
  const mjHow = {};
  const CN = '一二三四五六七八九十百';
  const RE_SEQ = new RegExp(`([·・]其[${CN}]+|其[${CN}]+|[(（][${CN}]+[)）]|[${CN}]+首|[${CN}]+章)$`);
  const stripSeq = (x) => {
    let t = String(x || '').trim(), again = true;
    while (again) {
      again = false;
      const m = t.match(RE_SEQ);
      if (m && t.length > m[1].length) { t = t.slice(0, -m[1].length); again = true; }
    }
    return t;
  };
  const stripParen = (x) => String(x || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[〔\[【][^〕\]】]*[〕\]】]/g, '').trim();
  const bodyHas = (id, needle) => {
    if (!needle) return false;
    const b = bodyByI.get(id);
    return !!b && b.indexOf(needle) >= 0;
  };
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
    for (let k = 0; k < Math.min(scored.length, 8); k++) {
      if (bodyHas(scored[k][1], needle)) return scored[k][1];
    }
    return null;
  }
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
    if (id === undefined) {
      const s1 = stripSeq(name);
      if (s1 !== name) id = mingjuByTitleAuthor.get(normKey(s1) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s1));
      if (id !== undefined) how = 'seq';
    }
    if (id === undefined && name.indexOf('·') > 0) {
      const tail = stripSeq(name.split('·').pop());
      if (tail && tail !== name.split('·').pop()) id = mingjuByTitle.get(normKey(tail));
      if (id !== undefined) how = 'seq';
    }
    if (id === undefined) {
      const s2 = stripParen(name);
      if (s2 && s2 !== name) id = mingjuByTitleAuthor.get(normKey(s2) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s2));
      if (id !== undefined) how = 'paren';
    }
    if (id === undefined) {
      const cand = pickByAuthor(stripSeq(stripParen(name)), author, needle)
        ?? (name.indexOf('·') > 0 ? pickByAuthor(name.split('·')[0], author, needle) : null);
      if (cand != null) { id = cand; how = 'author+fuzzy'; }
    }
    if (id === undefined && author) {
      const arr = mjAuthorTitles.get(normKey(author));
      if (arr) {
        for (const [, cid] of arr) {
          if (bodyHas(cid, needle)) { id = cid; how = 'content'; break; }
        }
      }
    }
    if (id === undefined) { mjHow.none = (mjHow.none || 0) + 1; continue; }
    if (mjSeen.has(content)) continue;
    mjSeen.add(content);
    mjRows.push([content, author, name, id]);
    mjHow[how] = (mjHow[how] || 0) + 1;
  }
  // 元信息补全：朝代 / 集合名 / 标签（tg 数组形态才收）
  for (const row of mjRows) {
    const id = row[3];
    const col = colOfId(id);
    // 新集合分块不按 200 对齐：chunkmap 二分取块，不能 floor((id-start)/200)
    const fi = chunkMap[col.id];
    let lo = 0, hi = fi.length - 1, k = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (id >= fi[mid]) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', col.chunks[k]), 'utf8'));
    const rec = arr.find(x => x.i === id);
    row[4] = rec ? (rec.d || '') : '';
    row[5] = col.name;
    row[6] = rec && Array.isArray(rec.tg) ? rec.tg : [];
  }
  fs.writeFileSync(path.join(DATA, 'idx', 'mingju.json'), JSON.stringify(mjRows));
  console.timeEnd('mingju');
  console.log(`mingju: ${mjRows.length}/${mingjuRaw.length} 条 ` + Object.entries(mjHow).map(([k, v]) => `${k}=${v}`).join(' '));

  console.log(`REBUILD_OK 用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
}

main();
