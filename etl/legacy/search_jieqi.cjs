// 二十四节气 + 传统节日诗句检索（2026-10-28）
// 在主库 site/data/poems 全部作品里，找「上句 / 本句 / 下句」窗口中出现节气、节日名的句子。
// 口径与 search_window_lit.cjs 一致：关键词落在**本句**；不足 10 首的类放宽到窗口三句（标注命中位）。
// 每类收录 10 首（按类种子洗牌，可复现）；输出 CSV（UTF-8 BOM，Excel 直开）。
// 用法：node search_jieqi.cjs
const fs = require('fs');
const path = require('path');

const POEMS_DIR = path.join(__dirname, 'site', 'data', 'poems');
const MANIFEST = path.join(__dirname, 'site', 'data', 'manifest.json');
const OUT = path.join(__dirname, '节气节日诗句.csv');

// ---------- 类别与关键词 ----------
const JIEQI = ['立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪',
  '冬至', '小寒', '大寒'];

// 传统节日：节气里已有的「清明」不重复建类；关键词只收节令专名，避开泛义字词
//（如「登高」「菊花」「月亮」会命中大量与节日无关的作品）。
const FESTIVALS = {
  '春节': ['元日', '元旦', '新春', '岁旦', '爆竹', '屠苏', '桃符'],
  '除夕': ['除夜', '除夕', '岁除', '守岁'],
  '元宵': ['元宵', '上元', '元夕', '灯节', '火树银花'],
  '寒食': ['寒食', '禁烟', '禁火'],
  '端午': ['端午', '端阳', '重午', '重五', '龙舟', '角黍', '菖蒲', '浴兰', '艾虎'],
  '七夕': ['七夕', '乞巧', '鹊桥', '双星', '天孙'],
  '中元': ['中元', '盂兰'],
  '中秋': ['中秋', '月夕'],
  '重阳': ['重阳', '重九', '茱萸', '菊节'],
  '上巳': ['上巳', '修禊', '祓禊', '兰亭', '曲水'],
  '社日': ['社日', '春社', '秋社', '社鼓', '社酒'],
  '寒衣节': ['寒衣', '授衣', '十月朝'],
  '腊八': ['腊八', '腊日', '腊粥'],
  '祭灶': ['祭灶', '灶君', '灶王', '小年'],
  '下元': ['下元'],
};

const PER_CAT = 10;

// ---------- 关键词 → 类别 映射 + 合并正则 ----------
const KW2CAT = new Map();
for (const k of JIEQI) KW2CAT.set(k, k + '（节气）');
for (const [cat, kws] of Object.entries(FESTIVALS)) for (const k of kws) KW2CAT.set(k, cat + '（节日）');
const ALL_RE = new RegExp([...KW2CAT.keys()].join('|'), 'g');

// 类别 → 关键词集（判断某句是否属于该类）
const CAT_KWS = new Map();
for (const k of JIEQI) { if (!CAT_KWS.has(k + '（节气）')) CAT_KWS.set(k + '（节气）', new Set([k])); }
for (const [cat, kws] of Object.entries(FESTIVALS)) {
  const key = cat + '（节日）';
  if (!CAT_KWS.has(key)) CAT_KWS.set(key, new Set());
  for (const k of kws) CAT_KWS.get(key).add(k);
}

// ---------- 可复现洗牌 ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- 集合名 ----------
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
// 散文类集合不出「诗句」：首页题句要的是诗，不是「是月也，以立春」这类小注
const PROSE_COLS = new Set(['古文典籍', '鉴赏古文']);
function colOf(id) {
  const cols = manifest.collections;
  let lo = 0, hi = cols.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= cols[mid].start) lo = mid + 1; else hi = mid - 1;
  }
  const c = cols[Math.max(0, hi)];
  return c && id >= c.start && id < c.start + c.count ? c.name : '';
}

// 取某句所在的一联。sents 已按「，。！？；、：」切开，故只能靠句尾标点判断上下句：
//   句尾是「。！？」→ 下句，与前一「非联末」句合成一联；
//   否则是上句，与后一句合成一联。
// 必须是联内配对，跨联拼会拼出「上一联下联 + 下一联上联」的假对句。
const isEnd = s => /[。！？]$/.test(s);
function coupletAt(sents, idx) {
  const cur = sents[idx] || '';
  if (!cur) return '';
  if (isEnd(cur)) {
    const prev = idx > 0 ? sents[idx - 1] : '';
    return (!prev || isEnd(prev) ? '' : prev) + cur;
  }
  const next = sents[idx + 1] || '';
  return next ? cur + next : '';
}

// ---------- 扫描（单遍）----------
// hits: cat -> { primary: [], secondary: [] }，元素 {kw, sentIdx, prev, cur, next, poem}
const hits = new Map();
for (const key of CAT_KWS.keys()) hits.set(key, { primary: [], secondary: [] });
let files = 0, poems = 0, hidden = 0, sentTotal = 0;
const t0 = Date.now();

for (const f of fs.readdirSync(POEMS_DIR)) {
  if (!f.endsWith('.json')) continue;
  files++;
  const arr = JSON.parse(fs.readFileSync(path.join(POEMS_DIR, f), 'utf8'));
  for (const p of arr) {
    if (!p || !Array.isArray(p.p) || !p.p.length) continue;
    if (p.hide) { hidden++; continue; }
    if (PROSE_COLS.has(colOf(p.i))) continue;   // 古文/鉴赏散文不出「诗句」
    poems++;
    // 全诗句子流（跨段相邻也算上下句）
    const sents = [];
    for (const para of p.p) {
      for (const s2 of String(para).split(/(?<=[，。？！；、：])/)) {
        const t2 = s2.replace(/\s+/g, '');
        if (t2) sents.push(t2);
      }
    }
    if (!sents.length) continue;
    sentTotal += sents.length;
    // 每句命中的关键词（一条合并正则，一次 exec 链拿全）
    const matched = sents.map(() => null);
    for (let i = 0; i < sents.length; i++) {
      ALL_RE.lastIndex = 0;
      const m = sents[i].match(ALL_RE);
      if (m) matched[i] = m;
    }
    // 逐类判定：本句命中 → primary；本句无、上/下句命中 → secondary
    for (const [key, kws] of CAT_KWS) {
      const slot = hits.get(key);
      for (let i = 0; i < sents.length; i++) {
        const cur = matched[i];
        if (cur && cur.some(kw => kws.has(kw))) {
          slot.primary.push({
            kw: cur.find(kw => kws.has(kw)), sentIdx: i,
            prev: i > 0 ? sents[i - 1] : '', cur: sents[i],
            next: i < sents.length - 1 ? sents[i + 1] : '', poem: p,
            cpl: coupletAt(sents, i),
          });
          break;   // 同诗同类一句即记，下一句同类不再记
        }
      }
      if (slot.primary.length && slot.primary[slot.primary.length - 1].poem.i === p.i) continue;
      if (slot.secondary.some(h => h.poem.i === p.i)) continue;
      // secondary：本句无类内关键词，上/下句有
      for (let i = 0; i < sents.length; i++) {
        const cur = matched[i];
        if (cur && cur.some(kw => kws.has(kw))) continue;   // 本句已有该类词 → 不算窗口命中
        const prevKw = i > 0 && matched[i - 1] && matched[i - 1].some(kw => kws.has(kw));
        const nextKw = i < sents.length - 1 && matched[i + 1] && matched[i + 1].some(kw => kws.has(kw));
        if (prevKw || nextKw) {
          slot.secondary.push({
            kw: (prevKw ? (matched[i - 1] || []).find(kw => kws.has(kw)) : '') ||
                (nextKw ? (matched[i + 1] || []).find(kw => kws.has(kw)) : ''),
            sentIdx: i, pos: prevKw ? '上句' : '下句',
            prev: i > 0 ? sents[i - 1] : '', cur: sents[i],
            next: i < sents.length - 1 ? sents[i + 1] : '', poem: p,
            cpl: coupletAt(sents, prevKw ? i - 1 : i + 1),
          });
          break;   // 同诗同类记一条
        }
      }
    }
  }
}

// ---------- 每类取 10 首（primary 优先 → secondary 补足；洗牌可复现）----------
const rows = [];
for (const key of CAT_KWS.keys()) {
  const slot = hits.get(key);
  const seenPoem = new Set();
  const primary = slot.primary.filter(h => { if (seenPoem.has(h.poem.i)) return false; seenPoem.add(h.poem.i); return true; });
  const rnd = mulberry32(hashStr(key));
  for (let i = primary.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [primary[i], primary[j]] = [primary[j], primary[i]];
  }
  let picked = primary.slice(0, PER_CAT).map(h => ({ ...h, pos: '本句' }));
  if (picked.length < PER_CAT) {
    const usedSent = new Set(picked.map(h => h.poem.i + ':' + h.sentIdx));
    const secondary = slot.secondary.filter(h =>
      !seenPoem2(h) && !usedSent.has(h.poem.i + ':' + h.sentIdx));
    function seenPoem2(h) { return picked.some(x => x.poem.i === h.poem.i); }
    for (const h of secondary) {
      if (picked.length >= PER_CAT) break;
      picked.push({ ...h, pos: h.pos || '上/下句' });
    }
  }
  for (const h of picked) {
    // 联句为空（该句在联末且无下句）时退回「本句 + 下句」，保证每行都有一整联
    const cpl = h.cpl || ((h.cur || '') + (h.next || ''));
    rows.push([key, h.kw, h.pos, h.poem.t || '', h.poem.a || '', h.poem.d || '',
      colOf(h.poem.i), h.prev, h.cur, h.next, cpl, String(h.poem.i)]);
  }
}

// ---------- 写 CSV（UTF-8 BOM）----------
const esc = (v) => { const s2 = String(v == null ? '' : v); return /[",\n\r]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2; };
const header = '类别,命中词,命中位,标题,作者,朝代,集合,上句,本句,下句,联句,id';
fs.writeFileSync(OUT, '\ufeff' + header + '\n' + rows.map(r2 => r2.map(esc).join(',')).join('\n'), 'utf8');

console.log('扫描', files, '个文件 /', poems, '首作品（跳过下线', hidden, '）/ 句子', sentTotal, '，耗时', Date.now() - t0, 'ms');
for (const key of CAT_KWS.keys()) {
  const n = rows.filter(r2 => r2[0] === key).length;
  console.log((n === PER_CAT ? '✓' : '△'), key, n + '/' + PER_CAT);
}
console.log('输出', OUT, '共', rows.length, '行');
