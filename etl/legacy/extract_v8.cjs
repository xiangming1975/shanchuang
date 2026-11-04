// 辞典 EPUB 规格化提取 v8.3
// 修复: sup脚注剥除 / aside剥离 / cifu署名覆盖 / guwen2 kai切分+FT精确注释 / nvxing作者debug
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FOLDER = 'C:/Users/xiang/Downloads/辞典';
const OUT = path.join(FOLDER, '2026-10-28');
const POEMS = path.join(OUT, 'poems');
fs.mkdirSync(POEMS, { recursive: true });

// ============ ZIP ============
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  const cdCount = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compMethod = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    entries[buf.slice(p + 46, p + 46 + fnLen).toString('utf8')] = { compMethod, compSize, localOffset };
    p += 46 + fnLen + extraLen + commentLen;
  }
  return { buf, entries };
}
function extractEntry(zip, name) {
  const e = zip.entries[name];
  if (!e) return null;
  const { buf } = zip;
  let p = e.localOffset;
  const fnLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + fnLen + extraLen;
  const compData = buf.slice(dataStart, dataStart + e.compSize);
  return e.compMethod === 0 ? compData : (e.compMethod === 8 ? zlib.inflateRawSync(compData) : null);
}

// ============ 解析 ============
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&[a-z]+;/g, '');
}
// 预清洗: 剥 aside(脚注区)与 sup(脚注号)
function preClean(html) {
  return html.replace(/<aside[\s\S]*?<\/aside>/gi, '').replace(/<sup[\s\S]*?<\/sup>/gi, '');
}
function getBody(html) { const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/); return m ? m[1] : html; }
function cleanText(s) {
  return decodeEntities(String(s || '')).replace(/<[^>]+>/g, '')
    .replace(/[\u3000]+/g, '').replace(/\s+/g, ' ').replace(/\r/g, '').replace(/\n/g, '').trim();
}
function parseBlocks(html) {
  const body = getBody(preClean(html));
  const blocks = [];
  const tagRegex = /<(\/?)(\w+)([^>]*)>/g;
  let m, guard = 0;
  while ((m = tagRegex.exec(body)) !== null) {
    if (++guard > 2000000) break;
    const [full, slash, tag, attrs] = m;
    const tagLower = tag.toLowerCase();
    if (slash || !BLOCK_TAGS.has(tagLower)) continue;
    const cls = (attrs.match(/class="([^"]*)"/) || [, ''])[1];
    let depth = 1;
    const contentStart = tagRegex.lastIndex;
    const innerRegex = /<(\/?)(\w+)([^>]*)>/g;
    innerRegex.lastIndex = contentStart;
    let m2 = null;
    while (depth > 0 && (m2 = innerRegex.exec(body)) !== null) {
      const [, s2, t2] = m2;
      const tl = t2.toLowerCase();
      if (!s2 && BLOCK_TAGS.has(tl)) depth++;
      else if (s2 && BLOCK_TAGS.has(tl)) { depth--; if (depth === 0) break; }
    }
      if (m2) {
      const content = body.slice(contentStart, innerRegex.lastIndex - m2[0].length);
      if (/<(p|div|h[1-6])\b/i.test(content)) {
        tagRegex.lastIndex = contentStart;
      } else {
        const hrefs = [];
        const hRe = /href="[^"]*#(FT[^"]*)"/g;
        let hm;
        while ((hm = hRe.exec(content)) !== null) hrefs.push(hm[1]);
        blocks.push({ tag: tagLower, cls, text: cleanText(content), kai: /kindle-cn-kai/.test(content), hrefs });
        tagRegex.lastIndex = innerRegex.lastIndex;
      }
    }
  }
  return blocks;
}
function parseTables(html) {
  const body = getBody(preClean(html));
  const out = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRegex.exec(body)) !== null) {
    const rows = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = trRegex.exec(tm[1])) !== null) {
      const cells = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = tdRegex.exec(rm[1])) !== null) cells.push(cleanText(cm[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

// ============ 规格清洗 ============
const MARK = /\[\d+\]|［\d+］|【\d+】|\(\d{1,2}\)|（\d{1,2}）|[\u2460-\u2473]/g;
const NOTE_CUT = /[〔【〖]\s*注\s*[〕】〗]/;
function stripMarks(s) { return String(s || '').replace(MARK, ''); }
function cleanPLine(s) {
  let t = stripMarks(s).replace(/[\u3000]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[〔【]\s*(导言|赏析|题解|说明|注释|注)\s*[〕】]\s*/, '');
  return t;
}
function joinLines(lines) {
  const out = [];
  let buf = '';
  for (let l of lines) {
    l = String(l || '').trim();
    if (!l) continue;
    buf += l;
    if (/[，、；,;]$/.test(buf)) continue;
    out.push(buf); buf = '';
  }
  if (buf) out.push(buf);
  return out;
}
function buildZ(rawTexts) {
  const lines = [];
  for (let t of rawTexts) {
    t = String(t || '').replace(NOTE_CUT, '').replace(/^[\s:：]*/, '').trim();
    if (!t) continue;
    const parts = t.split(/\[\d+\]|［\d+］|【\d+】|(?=[\u2460-\u2473])/).map(x => stripMarks(x).trim()).filter(x => x.length >= 4);
    for (const p of parts) if (p) lines.push(p);
  }
  return lines.join('\n');
}
function cleanS(texts) {
  const out = [];
  for (let t of texts) {
    t = String(t || '').trim();
    if (!t) continue;
    if (/^[（(][^）)]{1,12}[）)]$/.test(t)) continue;
    if (/^【赏析】|^〔赏析〕/.test(t)) t = t.replace(/^【赏析】|^〔赏析〕/, '').trim();
    if (!t) continue;
    if (/^[（(]/.test(t) && t.length < 15) continue;
    t = t.replace(/\s*[（(][^）)]{1,12}[）)]\s*$/, '').trim(); // 尾部署名
    out.push(stripMarks(t));
  }
  return out.filter(x => x.length > 10).join('\n');
}
function bigrams(s) { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; }
function overlap(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return hit / Math.min(A.size, B.size);
}
function norm(s) { return String(s || '').replace(MARK, '').replace(/[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…]+/g, ''); }
function cleanT(s) {
  let t = String(s || '').replace(/[\u3000]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^《/, '').replace(/》$/, '');
  t = t.replace(MARK, '').trim();
  t = t.replace(/[（(][^）)]*其[一二三四五六七八九十][^）)]*[）)]\s*$/, '').trim();
  // 排版拆字("曹 刿 论 战"): 空格≥2 视为排版空格,全合并
  if ((t.match(/ /g) || []).length >= 2) t = t.replace(/ /g, '');
  return t;
}
function cleanA(s) {
  let t = String(s || '').replace(/[\u3000]/g, '').replace(/\s+/g, '').trim();
  if (/^[（(]/.test(t)) return '';
  t = t.replace(/[（(][^）)]*[）)]$/g, '').trim();
  t = t.replace(/\*+$/g, '');
  if (t.length > 20) return '';
  return t;
}

let GID = 1;
// 按句切分(保留标点), 引号不配对时并回
function splitSentences(s) {
  const raw = s.split(/(?<=[。！？；!?])/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const seg of raw) {
    const prev = out[out.length - 1];
    if (prev) {
      const cnt = (x) => (x.match(/[“”"]/g) || []).length;
      if (cnt(prev) % 2 === 1) { out[out.length - 1] = prev + seg; continue; } // 引号未闭合,并回
    }
    out.push(seg);
  }
  return out;
}
function makeWork(c, t, a, d, pLines, f, tg, opts) {
  opts = opts || {};
  let p = joinLines((pLines || []).map(cleanPLine).filter(x => x.length >= 2));
  if (!opts.prose) {
    // 诗词类: 单元素>60字 → 按句切; 单元素>2000字必切
    if (p.length === 1 && p[0].length > 60) p = splitSentences(p[0]);
    p = p.flatMap(x => x.length > 2000 ? splitSentences(x) : [x]);
  } else {
    p = p.flatMap(x => x.length > 2000 ? splitSentences(x) : [x]);
  }
  const tt = cleanT(t);
  if (!tt || !p.length) return null;
  const rec = { c, t: tt, a: cleanA(a) || '', d: d || '', p, tg: tg && tg.length ? tg : ['鉴赏辞典'] };
  const ff = {};
  if (f) {
    if (f.y && f.y.length) {
      const yText = Array.isArray(f.y) ? f.y.join('\n') : f.y;
      if (overlap(norm(yText), norm(p.join(''))) <= 0.6) ff.y = yText;
    }
    if (f.z && f.z.length) { const z = buildZ(f.z); if (z) ff.z = z; }
    if (f.s && f.s.length) { const s = cleanS(f.s); if (s) ff.s = s; }
    if (f.b && f.b.length) { const b = cleanS(f.b); if (b) ff.b = b; }
  }
  if (Object.keys(ff).length) rec.f = ff;
  rec.i = GID++;
  return rec;
}

// ============ toc ============
function parseToc(tocData) {
  const navPoints = [];
  const re = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/g;
  let m;
  while ((m = re.exec(tocData)) !== null) {
    const label = decodeEntities((m[1].match(/<navLabel>\s*<text[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>/) || [, ''])[1].trim());
    const src = (m[1].match(/<content\s+src="([^"]*)"/) || [, ''])[1];
    navPoints.push({ label: label.replace(/[\u3000]/g, '').trim(), src });
  }
  return navPoints;
}
function findTocFile(zip) { return Object.keys(zip.entries).find(n => /toc\.ncx$/i.test(n)); }
function loadHtml(zip, src) {
  const file = src.split('#')[0];
  for (const prefix of ['', 'OEBPS/', 'Text/', 'text/', 'EPUB/']) {
    const d = extractEntry(zip, prefix + file);
    if (d) return d.toString('utf8');
  }
  return null;
}
function buildAuthorMap(zip, navPoints) {
  const authorByFile = new Map();
  const pageCache = new Map();
  let last = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file) continue;
    if (!pageCache.has(file)) {
      let name = null;
      if (/^[\u4e00-\u9fa5·]{2,8}$/.test(np.label)) {
        const html = loadHtml(zip, np.src);
        if (html && /作者小传|诗人小传/.test(html)) {
          const head = cleanText(getBody(html)).slice(0, 150);
          if (head.includes(np.label)) name = np.label;
        }
      }
      pageCache.set(file, name);
    }
    const a = pageCache.get(file);
    if (a) { last = a; authorByFile.set(file, a); }
    else if (last) authorByFile.set(file, last);
  }
  return authorByFile;
}
// 脚注: aside li 顺序数组
function extractFootnotes(html) {
  const notes = [];
  const aside = html.match(/<aside[^>]*>([\s\S]*?)<\/aside>/i);
  const src = aside ? aside[1] : '';
  if (!src) return notes;
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(src)) !== null) {
    const t = cleanText(m[1]);
    if (t && t.length >= 2) notes.push(t);
  }
  return notes;
}
// 脚注精确映射: 正文 href="#FTxxx" → 注释元素文本; aside 优先, fallback 全文 id=FT 元素
function extractFootnoteMap(html) {
  const map = new Map();
  const aside = html.match(/<aside[^>]*>([\s\S]*?)<\/aside>/i);
  const src = aside ? aside[1] : html;
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m, ord = 0;
  while (aside && (m = liRe.exec(src)) !== null) {
    const idM = m[1].match(/\sid="(FT[^"]*)"/);
    const text = cleanText(m[1]);
    if (text && text.length >= 2) {
      if (idM) map.set(idM[1], text);
      else map.set('ORD:' + ord, text);
      ord++;
    }
  }
  if (map.size) return map;
  // fallback: 全文找 id 以 FT/ft 开头的元素
  const elRe = /<(\w+)[^>]*\sid="((?:FT|ft)[^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = elRe.exec(html)) !== null) {
    const text = cleanText(m[3]);
    if (text && text.length >= 2) map.set(m[2], text);
  }
  return map;
}

// ============ 通用提取器 ============
function extractGeneric(zip, navPoints, c, dDefault, opts) {
  opts = opts || {};
  const authorMap = opts.noAuthorMap ? null : buildAuthorMap(zip, navPoints);
  const works = [];
  let cur = null, author = '', appOn = false, noteOn = false, inBio = false;
  const pL = [], sL = [], zL = [];
  const flush = () => {
    if (cur) {
      const w = makeWork(c, cur, author, dDefault, pL, { s: sL, z: zL });
      if (w) works.push(w);
    }
    cur = null; author = ''; appOn = false; noteOn = false; inBio = false;
    pL.length = 0; sL.length = 0; zL.length = 0;
  };
  let prevFile = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    if (authorMap) {
      const pa = authorMap.get(file);
      if (pa && pa !== author && !cur) { flush(); author = pa; }
      else if (pa && !cur) author = pa;
    }
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const t = b.text, cl = b.cls;
      if (!t) continue;
      const isAuthorHeader = (b.tag === 'h1' && (cl.includes('calibre') || cl.includes('kindle-cn-heading'))) ||
        cl.includes('btling') || /作者小传|诗人小传/.test(t);
      const isTitle = !isAuthorHeader && (
        cl.includes('title-poem') ||
        (b.tag === 'h3' && (cl.includes('calibre3') || cl.includes('calibre4') || cl.includes('calibre12') || cl.includes('center'))) ||
        (b.tag === 'h2' && cl.includes('calibre2') && t.length <= 30 && !/小传/.test(t)) ||
        (b.tag === 'h2' && cl.includes('center') && t.length <= 30) ||
        ((b.tag === 'h2' || b.tag === 'h3') && cl.includes('kindle-cn-heading2') && t.length <= 40) ||
        (b.tag === 'h4' && cl.includes('calibre5'))
      ) && !/出版|版权|目录|撰稿|序言|凡例|后记|附录|索引|新一版序|前言/.test(t) && t.length <= 40;
      if (isTitle) { flush(); cur = t; continue; }
      if (isAuthorHeader) {
        flush();
        if (/^[\u4e00-\u9fa5·]{2,8}$/.test(t)) author = t;
        inBio = true;
        continue;
      }
      if (inBio) {
        if (isTitle) { inBio = false; }
        else if (t.length > 60) { inBio = false; }
        continue;
      }
      if (!cur) continue;
      if (cl.includes('shuming')) { author = t.replace(/[\u3000\s]/g, ''); continue; }
      if (cl.includes('luokuan') || cl.includes('signature')) continue;
      if (cl.includes('para-right1')) { if (!pL.length && t.length <= 10) author = t.replace(/[\u3000\s]/g, ''); continue; }
      if (cl.includes('para-right')) { if (!/^[（(]/.test(t) && !pL.length && t.length <= 8) author = t.replace(/[\u3000\s]/g, ''); continue; }
      if (NOTE_CUT.test(t)) { noteOn = true; zL.push(t.replace(NOTE_CUT, '')); continue; }
      if (noteOn) {
        if (cl.includes('normaltext')) { noteOn = false; sL.push(t); appOn = true; }
        else zL.push(t);
        continue;
      }
      if (/^【赏析】|^〔赏析〕/.test(t)) { appOn = true; const rest = t.replace(/^【赏析】|^〔赏析〕/, '').trim(); if (rest) sL.push(rest); continue; }
      if (cl.includes('normaltext')) { appOn = true; sL.push(t); continue; }
      if (cl.includes('kai_long') || cl === 'yinwen' || (b.tag === 'div' && cl.includes('yinwen')) || cl.includes('yinwen-fs') || cl.includes('poem') || cl.includes('kindle-cn-kai')) {
        if (!appOn) pL.push(t); else sL.push(t);
        continue;
      }
      if (cl.includes('yinwen1')) {
        if (appOn) sL.push(t);
        else if (/^\[\d+\]|^［\d+］|^〔?\d/.test(t)) zL.push(t);
        else pL.push(t);
        continue;
      }
      if (cl.includes('left')) { if (appOn || pL.length) sL.push(t); else pL.push(t); continue; }
      if (cl.includes('fnote')) { zL.push(t); continue; }
      // 无 class 长段落: 正文已出现 → 赏析(元曲新一版等)
      if (b.tag === 'p' && !cl && t.length > 30 && pL.length) { sL.push(t); appOn = true; continue; }
    }
  }
  flush();
  return works;
}

// ---- 唐诗-萧涤非 ----
function extractTangXp(zip, navPoints) {
  const works = [];
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || /preface|chubsm|coverpage|toc|index/i.test(file)) continue;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    let t = '', a = '', inShx = false;
    const pL = [], sL = [], zL = [];
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h2' && !cl.includes('shangxi')) { t = tx; inShx = false; continue; }
      if (cl.includes('author')) { a = tx; continue; }
      if (cl.includes('shangxi')) { inShx = true; continue; }
      if (cl.includes('sgntr') || cl.includes('piczs') || cl.includes('ypic')) continue;
      if (cl.includes('poem')) { pL.push(tx); continue; }
      if (cl.includes('fnote')) { zL.push(tx); continue; }
      if (inShx && tx.length > 10) sL.push(tx);
    }
    const w = makeWork('tangshi', t || np.label, a, '唐', pL, { s: sL, z: zL });
    if (w) works.push(w);
  }
  return works;
}

// ---- 二十四史 ----
function extract24(zip, navPoints) {
  const works = [];
  let prevFile = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    let cur = null;
    const pL = [];
    const flush = () => {
      if (cur) {
        const w = makeWork('ershisi', cur, '', '', pL, {}, null, { prose: true });
        if (w) { w.tg = ['鉴赏辞典', '史部散文']; works.push(w); }
      }
      cur = null; pL.length = 0;
    };
    for (const b of blocks) {
      if (!b.text) continue;
      if ((b.tag === 'h3' || b.tag === 'h2') && b.cls.includes('center')) { flush(); cur = b.text; continue; }
      if (cur && b.cls.includes('left') && b.text.length > 10) pL.push(b.text);
    }
    flush();
  }
  return works;
}

// ---- 先秦诗 ----
function extractXianQin(zip, navPoints) {
  const works = [];
  let prevFile = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    let t = '', mode = null;
    const pL = [], yL = [], zL = [], sL = [];
    const flush = () => {
      if (t) {
        const w = makeWork('xianqinshi', t, '佚名', '先秦', pL, { y: yL, s: sL, z: zL });
        if (w) works.push(w);
      }
      t = ''; mode = null; pL.length = 0; yL.length = 0; zL.length = 0; sL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h4' && cl.includes('calibre5')) { flush(); t = tx; continue; }
      if (cl.includes('luokuan')) continue;
      if (!t) continue;
      if (cl.includes('normaltext')) { sL.push(tx); mode = 'app'; continue; }
      if (mode === 'app') { sL.push(tx); continue; }
      if (NOTE_CUT.test(tx)) { mode = 'note'; zL.push(tx.replace(NOTE_CUT, '')); continue; }
      if (mode === 'note') { zL.push(tx); continue; }
      if (cl.includes('yinwen2')) { mode = 'raw'; if (!(/^[\u4e00-\u9fa5]{1,4}$/.test(tx))) pL.push(tx); continue; }
      if (cl === 'yinwen') {
        mode = (mode === 'raw') ? 'trans' : 'raw';
        if (mode === 'raw') pL.push(tx); else yL.push(tx);
        continue;
      }
      if (cl.includes('yinwen1')) {
        if (mode === 'raw') pL.push(tx);
        else if (mode === 'trans') yL.push(tx);
        else if (mode === 'note') zL.push(tx);
        else { mode = 'raw'; pL.push(tx); }
        continue;
      }
    }
    flush();
  }
  return works;
}

// ---- 历代女性诗词 ----
function extractNvxing(zip, navPoints) {
  const authorByFile = new Map();
  let last = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file) continue;
    if (/^[\u4e00-\u9fa5·]{2,8}$/.test(np.label)) last = np.label;
    if (last) authorByFile.set(file, last);
  }
  const works = [];
  let prevFile = '', carryAuthor = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    if (authorByFile.has(file)) carryAuthor = authorByFile.get(file) || carryAuthor;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    let t = '', a = carryAuthor, appOn = false;
    const pL = [], sL = [];
    const flush = () => {
      if (t) {
        const w = makeWork('nvxing', t, a, '', pL, { s: sL });
        if (w) works.push(w);
      }
      t = ''; a = carryAuthor; appOn = false; pL.length = 0; sL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if ((b.tag === 'h1' || b.tag === 'h2') && !cl.includes('center') && /^[\u4e00-\u9fa5·]{2,8}$/.test(tx)) { carryAuthor = tx; a = tx; continue; }
      if (b.tag === 'h3' && cl.includes('center')) { flush(); t = tx; a = carryAuthor; continue; }
      if (cl.includes('right') && tx.length <= 12) {
        if (/^[（(]/.test(tx)) continue; // 署名跳过,防止覆盖真作者
        a = tx.replace(/[\u3000\s]/g, ''); continue;
      }
      if (cl.includes('luokuan') || cl.includes('signature')) continue;
      if (/^【赏析】/.test(tx)) { appOn = true; continue; }
      if (cl.includes('yinwen-fs') || cl.includes('yinwen-kt-c') || cl.includes('yinwen-fs-n')) { pL.push(tx); continue; }
      if (cl.includes('left') && tx.length > 20) { appOn = true; sL.push(tx); continue; }
    }
    flush();
  }
  return works;
}

// ---- 历代赋 ----
function extractDaiFu(zip, navPoints) {
  const works = [];
  let prevFile = '', curAuthor = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    const authorHeader = blocks.find(b => b.tag === 'h2' && b.cls.includes('center'));
    if (authorHeader) curAuthor = authorHeader.text.replace(/[\u3000\s]/g, '');
    let t = '', appOn = false;
    const pL = [], sL = [], zL = [];
    const flush = () => {
      if (t) {
        const w = makeWork('daifu', t, curAuthor, '', pL, { s: sL, z: zL });
        if (w) works.push(w);
      }
      t = ''; appOn = false; pL.length = 0; sL.length = 0; zL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h2' && cl.includes('center')) continue;
      if (b.tag === 'h3' && cl.includes('center')) { flush(); t = tx; continue; }
      if (cl.includes('center') && tx.length <= 8 && t && !pL.length) continue;
      if (cl.includes('luokuan')) continue;
      if (cl.includes('btling') || /作者小传/.test(tx)) { appOn = false; pL.length = 0; sL.length = 0; zL.length = 0; continue; }
      if (NOTE_CUT.test(tx)) { zL.push(tx); continue; }
      if (/^【赏析】/.test(tx)) { appOn = true; continue; }
      if (cl.includes('left') && tx.length > 2) {
        if (appOn) sL.push(tx);
        else if (pL.length === 0) pL.push(tx);
        else sL.push(tx);
        continue;
      }
      if (cl.includes('noindent') && tx.length > 10) { sL.push(tx); continue; }
    }
    flush();
  }
  return works;
}

// ---- 历代辞赋(霍旭东) ----
function extractCiFu(zip, navPoints) {
  const works = [];
  const seen = new Set();
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!/Section/i.test(file)) continue;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const footnotes = extractFootnotes(html);
    const blocks = parseBlocks(html);
    let t = '', a = '', zone = 'raw', titleSeen = false;
    const pL = [], sL = [], zL = [];
    const flush = () => {
      if (t) {
        const zAll = zL.concat(footnotes);
        const w = makeWork('cifu', t, a, '', pL, { s: sL, z: zAll });
        if (w) works.push(w);
      }
      t = ''; a = ''; pL.length = 0; sL.length = 0; zL.length = 0; titleSeen = false; zone = 'raw';
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (cl.includes('title') && b.tag === 'p') { flush(); t = tx; titleSeen = true; zone = 'raw'; continue; }
      if (cl.includes('lk1')) { a = tx; continue; }
      if (cl === 'lk' || cl.includes('luokuan')) continue;
      if (/^〔注|^【注|^\s*注释\s*$|^\s*题解\s*$/.test(tx)) { zone = 'note'; if (!/^\s*(注释|题解)\s*$/.test(tx)) zL.push(tx.replace(/^〔注|^【注/, '')); continue; }
      if (/^【赏析】|^〔赏析〕|^\s*赏析\s*$|^\s*鉴赏\s*$/.test(tx)) { zone = 'app'; continue; }
      if (!titleSeen) continue;
      if (cl.includes('normaltext')) {
        if (zone === 'raw') pL.push(tx);
        else if (zone === 'note') zL.push(tx);
        else sL.push(tx);
        continue;
      }
      if (cl.includes('fnote')) { zL.push(tx); continue; }
    }
    flush();
  }
  return works;
}

// ---- 古文新一版(含6册古文) ----
function extractGuwen2(zip, navPoints, c) {
  c = c || 'guwen2';
  const authorMap = buildAuthorMap(zip, navPoints);
  const works = [];
  let prevFile = '';
  let carryAuthor = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    if (/^《.+》$/.test(np.label)) carryAuthor = ''; // 书名 navPoint: 重置
    if (authorMap.has(file)) {
      const pa = authorMap.get(file);
      if (pa) carryAuthor = pa;
    }
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const fnMap = extractFootnoteMap(html);
    const blocks = parseBlocks(html);
    let t = '', sawBody = false;
    const pL = [], sL = [], zL = [];
    const ftIds = []; // 本篇的 FT 锚序
    let collecting = false;
    const flush = () => {
      if (t) {
        // 精确注释: 按本篇 FT 锚序从 map 取
        const ordered = [];
        for (const fid of ftIds) { if (fnMap.has(fid)) ordered.push(fnMap.get(fid)); }
        for (let k = 0; k < fnMap.size && ordered.length === 0; k++) { const v = fnMap.get('ORD:' + k); if (v) ordered.push(v); }
        const zAll = zL.concat(ordered);
        const w = makeWork(c, t, carryAuthor, '', pL, { s: sL, z: zAll });
        if (w) works.push(w);
      }
      t = ''; pL.length = 0; sL.length = 0; zL.length = 0; sawBody = false; ftIds.length = 0; collecting = false;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (collecting && b.hrefs) ftIds.push(...b.hrefs);
      if (b.tag === 'h2' && /作者小传/.test(tx)) { carryAuthor = tx.replace(/【作者小传】|【诗人小传】/g, '').trim(); continue; }
      if (b.tag === 'h2') continue;
      if (/作者小传/.test(tx) && b.tag === 'p') continue;
      if (b.tag === 'h3' && (cl.includes('calibre12') || cl.includes('calibre3') || cl.includes('kindle-cn-heading2'))) {
        flush();
        t = tx.replace(/《[^》]*》\s*$/, '').trim();
        collecting = true;
        continue;
      }
      if (!t) continue;
      if (tx.length < 12 && /^[（(]/.test(tx)) continue;
      if (cl.includes('kindle-cn-para-right') || cl.includes('signature')) continue;
      if (/^〔注|^【注/.test(tx)) { zL.push(tx.replace(/^〔注|^【注/, '')); continue; }
      if (/^\s*注释\s*$|^\s*题解\s*$|^\s*说明\s*$/.test(tx)) continue;
      if (cl.includes('calibre8') || cl.includes('calibre6') || cl.includes('calibre24') || cl.includes('normaltext') || cl.includes('kindle-cn-para-left')) {
        if (b.kai) { pL.push(tx); sawBody = true; continue; }        // 文言正文(span kai)
        if (!sawBody && pL.length === 0 && tx.length > 200) continue; // 篇前解题?暂丢
        if (!sawBody) { pL.push(tx); sawBody = true; continue; }
        sL.push(tx);
        continue;
      }
    }
    flush();
  }
  return works;
}

// ---- 明清散曲 ----
function extractSanqu(zip, navPoints) {
  const works = [];
  let prevFile = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    let t = '', a = '', zone = 'raw';
    const pL = [], sL = [], zL = [];
    const flush = () => {
      if (t) {
        const w = makeWork('sanqu', t, a, '', pL, { s: sL, z: zL });
        if (w) works.push(w);
      }
      t = ''; a = ''; zone = 'raw'; pL.length = 0; sL.length = 0; zL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h1') { flush(); t = tx; continue; }
      if (b.tag === 'h2' && t) { t = t + ' ' + tx; continue; }
      if (b.tag === 'h2') { flush(); t = tx; continue; }
      if (b.tag === 'h4') {
        const k = tx.replace(/\s+/g, '');
        if (k === '作者') zone = 'bio';
        else if (k === '注释') zone = 'note';
        else if (k === '鉴赏') zone = 'app';
        continue;
      }
      if (cl.includes('para-center')) { a = tx.replace(/[\u3000\s]/g, ''); continue; }
      if (cl.includes('para-right')) continue;
      if (cl.includes('kai')) { if (zone === 'raw') pL.push(tx); continue; }
      if (cl.includes('fnote')) { if (zone !== 'bio') zL.push(tx); continue; }
      if (b.tag === 'p' && tx.length > 20) {
        if (zone === 'app') sL.push(tx);
        else if (zone === 'note') zL.push(tx);
        else if (pL.length) sL.push(tx);
        continue;
      }
    }
    flush();
  }
  return works;
}

// ---- 诗经楚辞 ----
function extractShiJing(zip, navPoints) {
  const works = [];
  let prevFile = '';
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!file || file === prevFile) continue;
    prevFile = file;
    const html = loadHtml(zip, np.src);
    if (!html) continue;
    const blocks = parseBlocks(html);
    const tables = parseTables(html);
    let t = '', zone = '';
    const pL = [], yL = [], zL = [], sL = [];
    const flush = () => {
      if (t) {
        const w = makeWork('shijingchuci', t, '佚名', '先秦', pL, { y: yL, s: sL, z: zL });
        if (w) works.push(w);
      }
      t = ''; zone = ''; pL.length = 0; yL.length = 0; zL.length = 0; sL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h3' && cl.includes('calibre9')) { flush(); t = tx; continue; }
      if (b.tag === 'h4') { zone = tx.replace(/\s+/g, ''); continue; }
      if (cl.includes('signature')) continue;
      if (cl.includes('fnote')) { zL.push(tx); continue; }
      if (zone === '鉴赏' && cl.includes('calibre3') && tx.length > 20) { sL.push(tx); continue; }
      if (cl.includes('kai1') && tx.length > 5) { sL.push(tx); continue; }
    }
    for (const rows of tables) {
      for (const cells of rows) {
        if (cells.length >= 2) {
          if (cells[0] && cells[0].length >= 2) pL.push(cells[0]);
          if (cells[1] && cells[1].length >= 2) yL.push(cells[1]);
        }
      }
    }
    flush();
  }
  return works;
}

// ---- 先秦两汉魏晋南北朝 ----
function extractXQLH(zip, navPoints) {
  const works = [];
  const byFile = new Map();
  for (const np of navPoints) {
    const file = np.src.split('#')[0];
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(np);
  }
  let dbg = { files: 0, h3: 0, para: 0, works: 0 };
  for (const [file] of byFile) {
    const html = loadHtml(zip, file);
    if (!html) continue;
    dbg.files++;
    const footnotes = extractFootnotes(html);
    const blocks = parseBlocks(html);
    let t = '', a = '';
    const pL = [], sL = [], zL = [];
    const flush = () => {
      if (t) {
        let d = '';
        if (/诗经|楚辞|周南|召南|邶风|鄘风|卫风|王风|郑风|齐风|魏风|唐风|秦风|陈风|桧风|曹风|豳风|九歌|离骚|九章|天问|渔父|卜居/.test(a)) d = '先秦';
        else if (/汉|乐府/.test(a)) d = '汉';
        else if (/魏|晋/.test(a)) d = '魏晋';
        else if (/南北朝|南朝|北朝/.test(a)) d = '南北朝';
        if (a === '佚名') d = d || '先秦';
        const zAll = zL.concat(footnotes);
        const w = makeWork('xqlh', t, a, d, pL, { s: sL, z: zAll });
        if (w) { dbg.works++; works.push(w); }
      }
      t = ''; a = ''; pL.length = 0; sL.length = 0; zL.length = 0;
    };
    for (const b of blocks) {
      const cl = b.cls, tx = b.text;
      if (!tx) continue;
      if (b.tag === 'h3' && cl.includes('heading2')) { dbg.h3++; flush(); t = tx; continue; }
      if (cl.includes('para-right')) {
        if (/^[（(]/.test(tx)) continue;
        if (/^《.+》$/.test(tx) && tx.length < 25 && !pL.length && !sL.length) {
          a = /诗经|楚辞|乐府|古诗|玉台|文选/.test(tx) ? '佚名' : tx.replace(/[《》]/g, '');
          continue;
        }
        if (tx.length <= 8 && !pL.length && !sL.length) { a = tx.replace(/[\u3000\s]/g, ''); continue; }
        continue;
      }
      if (cl.includes('para-left')) { dbg.para++; pL.push(tx); continue; }
      if (cl.includes('calibre6') && tx.length > 30) { sL.push(tx); continue; }
      if (/^〔注|^【注/.test(tx)) { zL.push(tx); continue; }
    }
    flush();
  }
  console.log(`  [xqlh debug] files=${dbg.files} h3=${dbg.h3} para=${dbg.para} works=${dbg.works}`);
  return works;
}

// ============ 主流程 ============
const books = [
  { file: '唐诗鉴赏辞典 - 萧涤非.epub', id: 'tangshi', name: '唐诗鉴赏辞典(萧涤非版)', fn: extractTangXp },
  { file: '二十四史鉴赏辞典 (上海辞书出品) - 顾晓鸣.epub', id: 'ershisi', name: '二十四史鉴赏辞典', fn: extract24 },
  { file: '元曲鉴赏辞典.新一版.中国文学鉴赏辞典大系 -- 蒋星煜等著 -- 2014 -- 上海辞书出版社  -- Anna’s Archive.epub', id: 'yuanqu2', name: '元曲鉴赏辞典(新一版)', fn: (z, n) => extractGeneric(z, n, 'yuanqu2', '元') },
  { file: '先秦两汉魏晋南北朝诗歌鉴赏辞典 (中国古典诗词曲赋鉴赏系列工具书) - 魏耕原.epub', id: 'xqlh', name: '先秦两汉魏晋南北朝诗歌鉴赏辞典', fn: extractXQLH },
  { file: '先秦诗鉴赏辞典.epub', id: 'xianqinshi', name: '先秦诗鉴赏辞典', fn: extractXianQin },
  { file: '历代女性诗词鉴赏辞典.epub', id: 'nvxing', name: '历代女性诗词鉴赏辞典', fn: extractNvxing },
  { file: '历代赋鉴赏辞典.epub', id: 'daifu', name: '历代赋鉴赏辞典', fn: extractDaiFu },
  { file: '历代辞赋鉴赏辞典 - 霍旭东.epub', id: 'cifu', name: '历代辞赋鉴赏辞典', fn: extractCiFu },
  { file: '古文鉴赏辞典(新一版)(全二册)_(中国文学鉴赏辞典大系(新一版)).epub', id: 'guwen2', name: '古文鉴赏辞典(新一版)', fn: (z, n) => extractGuwen2(z, n, 'guwen2') },
  { file: '唐宋词鉴赏辞典：新一版.epub', id: 'tangsongci', name: '唐宋词鉴赏辞典(新一版)', fn: (z, n) => extractGeneric(z, n, 'tangsongci', '唐宋') },
  { file: '宋词鉴赏辞典(新一版)(全二册).epub', id: 'songci2', name: '宋词鉴赏辞典(新一版)', fn: (z, n) => extractGeneric(z, n, 'songci2', '宋') },
  { file: '明清散曲鉴赏辞典 (中国古典诗词曲赋鉴赏系列工具书) -- 赵义山 -- 2013 -- cj5  -- Anna’s Archive.epub', id: 'sanqu', name: '明清散曲鉴赏辞典', fn: extractSanqu },
  { file: '汉魏六朝诗鉴赏辞典.epub', id: 'hanwei', name: '汉魏六朝诗鉴赏辞典', fn: (z, n) => extractGeneric(z, n, 'hanwei', '汉魏六朝') },
  { file: '诗经楚辞鉴赏辞典 (中国古典诗词曲赋鉴赏系列工具书) -- 周啸天 -- 2011 -- cj5  -- Anna’s Archive.epub', id: 'shijingchuci', name: '诗经楚辞鉴赏辞典', fn: extractShiJing },
];

const manifest = [];
let totalWorks = 0;
for (const bk of books) {
  const fp = path.join(FOLDER, bk.file);
  if (!fs.existsSync(fp)) { console.log(`缺文件: ${bk.file}`); continue; }
  console.log(`\n=== ${bk.name} ===`);
  const zip = readZip(fp);
  const tocName = findTocFile(zip);
  const navPoints = tocName ? parseToc(extractEntry(zip, tocName).toString('utf8')) : [];
  console.log(`  toc: ${navPoints.length} navPoints`);

  const works = bk.fn(zip, navPoints, bk.d || '');
  const seen = new Set();
  const uniq = [];
  for (const w of works) {
    const k = w.t + '|' + w.a;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(w);
  }
  if (!uniq.length) { console.log(`  ${bk.id}: 0 条`); continue; }
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 200) {
    const cf = `${bk.id}-${String(Math.floor(i / 200)).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(POEMS, cf), JSON.stringify(uniq.slice(i, i + 200), null, 1), 'utf8');
    chunks.push(cf);
  }
  manifest.push({ id: bk.id, name: bk.name, count: uniq.length, chunks, start: uniq[0].i });
  totalWorks += uniq.length;
  let wT = 0, wS = 0, wZ = 0, wY = 0, bA = 0;
  for (const w of uniq) {
    if (w.p.length) wT++;
    if (w.f && w.f.s) wS++;
    if (w.f && w.f.z) wZ++;
    if (w.f && w.f.y) wY++;
    if (!w.a || /^[（(]/.test(w.a)) bA++;
  }
  console.log(`  ${bk.id}: ${uniq.length} 条 | 正文 ${wT} 赏析 ${wS} 注释 ${wZ} 译文 ${wY} 作者空/可疑 ${bA}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n=== 完成: ${manifest.length} 集合, ${totalWorks} 条 ===`);
console.log(`输出: ${OUT}`);
