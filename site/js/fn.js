// 脚注系统：解析注释文本为词条对，在正文（含繁体）中定位词条位置
import { cachedText } from './store.js';

let T2S = null; // 繁→简 单字映射
let S2T = null; // 简→繁 单字映射（按字频选最常见繁体）
export async function loadCharMap() {
  if (T2S) return T2S;
  try {
    T2S = JSON.parse(await cachedText('data/idx/t2s.json'));
  } catch { T2S = {}; }
  try {
    S2T = JSON.parse(await cachedText('data/idx/s2t.json'));
  } catch { S2T = {}; }
  return T2S;
}
function t2s(ch) { return T2S ? (T2S[ch] || ch) : ch; }
function s2t(ch) { return S2T ? (S2T[ch] || ch) : ch; }

// ---------- 简繁显示转换（2026-10-29） ----------
// 语料繁简混杂（同库内曹操简体、屈原繁体），设置里可切「简体（默认）/ 繁體」：
//   简体：检测为繁体源的字符串逐字转简（t2s 繁→简近乎无歧义）。
//   繁體：繁体原文原样不动（零回归）；检测为简体源的字符串逐字转繁。
// 映射表 idx/s2td.json 由 etl/build-s2td.js 生成：opencc-js 词组级转换对全语料
// 逐字投票取众数，再经「繁体源高频即钉原字 / 转换率<50% 即钉原字」两条规则与
// 人工兜底（沈/谷/面/斗/后/里/松/才/胡/冬/欲/御/志/曲…）过滤，最后叠加词组
// 修正表（詩雲→詩云、白發→白髮、鞦韆、並刀…）。
// 逐字等长 ⇒ 眉批/摘录的字符偏移、注释定位、平仄 zip 全部不受影响；映射幂等。
let ZH_MODE = 's';
let S2TD = null;      // 简体源 → 繁体：显示级逐字映射
let SO_SET = null;    // 简体侧字符集合（出现即视为简体源候选）
let TO_SET = null;    // 繁体侧字符集合（出现即视为繁体源候选）
let FIX_PAIRS = null; // 转换后词组修正表，按键长降序
export function setZhMode(v) { ZH_MODE = v === 't' ? 't' : 's'; }
export async function loadZhConv() {
  if (S2TD) return;
  try {
    const d = JSON.parse(await cachedText('data/idx/s2td.json'));
    S2TD = d.m || {};
    SO_SET = new Set(d.so || '');
    TO_SET = new Set(d.to || '');
    FIX_PAIRS = Object.keys(d.fix || {}).sort((a, b) => b.length - a.length).map(k => [k, d.fix[k]]);
  } catch {
    S2TD = {}; SO_SET = new Set(); TO_SET = new Set(); FIX_PAIRS = [];
  }
}
function convBy(s, map) { let o = ''; for (const ch of s) o += map[ch] || ch; return o; }
// 显示层转换：任何来源的文本都安全（幂等，快照二次转换结果不变）
export function zhShow(s) {
  const str = String(s == null ? '' : s);
  if (!str || !SO_SET || SO_SET.size === 0) return str;   // 映射未就绪/加载失败：原样
  if (ZH_MODE === 's') {
    if (!T2S) return str;
    for (const ch of str) if (TO_SET.has(ch)) return convBy(str, T2S);
    return str;
  }
  // 繁體：简体源才转；繁体原文与繁简混排（引文跨库）不动
  let hasS = false, hasT = false;
  for (const ch of str) {
    if (SO_SET.has(ch)) { hasS = true; if (hasT) return str; }
    else if (TO_SET.has(ch)) hasT = true;
  }
  if (!hasS || hasT) return str;
  let out = convBy(str, S2TD);
  for (const [k, v] of FIX_PAIRS) if (out.includes(k)) out = out.split(k).join(v);
  return out;
}
// 词条字符串 → 简体化（用于与繁体正文匹配；placeNotes 跨简繁匹配也用它）。
// t2s 表未载时逐字原样返回。
export function simpStr(s) { let o = ''; for (const ch of String(s || '')) o += t2s(ch); return o; }
// 查询词的双向形式：[简体形式, 繁体形式] —— 搜索用
export function queryVariants(q) {
  let a = '', b = '';
  for (const ch of String(q)) { a += t2s(ch); b += s2t(ch); }
  return [a.toLowerCase(), b.toLowerCase()];
}

// ---------- 注释文本 → [{term, expl}] ----------
function cleanTerm(t) {
  return t.replace(/^[\u2460-\u2473\u2474-\u2487\u2488-\u249B\u3251-\u325F\u32B1-\u32BF]\s*/g, '') // ①⑴⒈㉑㊱等带圈序号
    .replace(/^\s*\d+\s*[.、)）]?\s*/, '')   // 序号
    .replace(/[（(][^）)]{0,12}[）)]/g, '')        // 注音括号
    .replace(/[〔\[][^〕\]]{0,12}[〕\]]/g, '')
    .replace(/^[　\s]+|[　\s]+$/g, '');
}

// gushiwen 风格："词：解释。 词2：解释2。"
function parseColonNotes(text) {
  const pairs = [];
  const sentences = String(text || '').split(/\n+|(?<=[。；;])/);
  let prev = null;
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    const i = s.search(/[：:]/);
    if (i > 0 && i <= 14) {
      const term = cleanTerm(s.slice(0, i));
      const expl = s.slice(i + 1).trim().replace(/[。;；]$/, '');
      if (term && expl && term.length <= 12) { prev = { term, expl: expl, display: s.slice(0, i).trim().replace(/^[\u2460-\u2473\u2474-\u2487\u2488-\u249B\u3251-\u325F\u32B1-\u32BF]\s*/, '') }; pairs.push(prev); continue; }
    }
    if (prev && pairs.length) prev.expl += '。' + s.replace(/[。;；]$/, ''); // 无词条的后续句并入上一条
  }
  return pairs;
}

// 花间集风格数组："1.小山--写女子的隔夜残妆。..."
function parseDashNotes(arr) {
  const pairs = [];
  for (const item of arr || []) {
    const s = String(item || '').trim();
    if (!s) continue;
    const no = s.match(/^\s*\d+\s*[.、]\s*/);
    const body = no ? s.slice(no[0].length) : s;
    const i = body.search(/--|――|——|[：:]/);
    if (i > 0) {
      const term = cleanTerm(body.slice(0, i));
      const expl = body.slice(i + (body.slice(i).startsWith('--') ? 2 : 1)).trim();
      if (term && term.length <= 12) pairs.push({ term, expl, display: body.slice(0, i).trim().replace(/^[\u2460-\u2473\u2474-\u2487\u2488-\u249B\u3251-\u325F\u32B1-\u32BF]\s*/, '') });
    } else if (pairs.length) {
      pairs[pairs.length - 1].expl += '。' + body;
    }
  }
  return pairs;
}

// 从详情数据产出词条对（f.z 优先合并 n）
export function buildNotes(poem) {
  const pairs = [];
  if (poem.n && poem.n.length) pairs.push(...parseDashNotes(poem.n));
  if (poem.f && poem.f.z) pairs.push(...parseColonNotes(String(poem.f.z).replace(/^\s*(字词)?注释[:：]?\s*\n?/, '')));
  // 去重（同词条先出现的优先）
  const seen = new Set();
  return pairs.filter(p => {
    const k = p.term;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- 正文定位 ----------
// 在一段（可能繁体）文字中找词条出现位置（简繁匹配），长词优先，不重叠；
// used：跨段落共享的 Set（词条 idx），保证全诗每词条只标注一次
export function locateTerms(paragraph, notes, used) {
  const usedSet = used || new Set();
  const chars = [...paragraph];
  const simp = chars.map(t2s);
  const cands = notes
    .map((p, idx) => ({ ...p, idx, st: simpStr(p.term) }))
    .filter(p => p.st.length >= 1 && p.st.length <= 12 && !usedSet.has(p.idx))
    .sort((a, b) => b.st.length - a.st.length);
  const taken = new Array(chars.length).fill(false);
  const hits = [];
  for (const p of cands) {
    const L = [...p.st];
    for (let i = 0; i + L.length <= chars.length; i++) {
      let ok = true;
      for (let j = 0; j < L.length; j++) {
        if (taken[i + j] || simp[i + j] !== L[j]) { ok = false; break; }
      }
      if (ok) {
        hits.push({ start: i, len: L.length, n: p.idx, term: p.term });
        for (let j = 0; j < L.length; j++) taken[i + j] = true;
        usedSet.add(p.idx);
        break; // 每个词条只标首次出现
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// 繁简归一（去重键用）：逐字转简体 + 小写
export function normZh(s) {
  if (!s) return '';
  let o = '';
  for (const ch of String(s)) o += t2s(ch);
  return o.toLowerCase();
}

// 去重键：标题|作者|首句前 12 字（繁简归一）。多集合收录同一首时靠它合并，
// 搜索 / 标签聚合 / 正文检索共用（2026-10-29 复用收敛，原先 3 处重复）。
export function dedupeKey(t, a, first) {
  return normZh(t || '') + '|' + normZh(a || '') + '|' + normZh((first || '').slice(0, 12));
}
