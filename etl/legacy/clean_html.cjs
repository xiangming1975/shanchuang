// 清理主库中的 HTML 标签/实体残留
// 1) poems/*.json: p[] 按块级标签边界拆段，行内标签剥除，实体解码；t/a/f 等字符串字段同样净化
// 2) 其他 site/data 下的 .json（idx、manifest 等）：通用字符串净化
// 受影响文件先备份到 ../backup_html_2026-10-31/
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'site', 'data');
const BACKUP_DIR = path.join(__dirname, 'backup_html_2026-10-31');

const HAS_TAG = /<\/?(?:p|br|strong|em|span|div|a|img|b|i|u|h[1-6]|ul|ol|li|table|tr|td|th|font|sub|sup|blockquote|center|small|big)\b[^>]*>|&[a-z]+;|&#\d+;|&#x[0-9a-fA-F]+;/i;
// 块级边界（遇到就换行拆段）
const BLOCK_RE = /<\/p\s*>|<br\s*\/?\s*>|<\/div\s*>|<\/h[1-6]\s*>|<\/li\s*>|<\/blockquote\s*>|<\/tr\s*>|<\/ul\s*>|<\/ol\s*>/gi;

function decodeEntities(s) {
  return s.replace(/&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|laquo|raquo|ldquo|rdquo|lsquo|rsquo|#\d+|#x[0-9a-fA-F]+);/gi, (m, g) => {
    const k = g.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(code); } catch (e) { return ''; }
    }
    const map = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
    return map[k] !== undefined ? map[k] : m;
  });
}

// 行内净化（标题/作者等短字段）：块级标签→空格，其余标签剥除，实体解码，空白折叠
function cleanInline(s) {
  if (!HAS_TAG.test(s)) return s;
  let out = s.replace(BLOCK_RE, ' ').replace(/<[^>]+>/g, '');
  out = decodeEntities(out).replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}

// 段落净化：块级边界→换行，剥标签，解码，拆成多个自然段
function cleanParas(s) {
  if (!HAS_TAG.test(s)) return [s];
  const withBreaks = s.replace(BLOCK_RE, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks).split('\n').map(x => x.trim()).filter(Boolean);
}

// 长文本净化（f.y/z/s）：块级边界→换行，剥标签，解码
function cleanText(s) {
  if (!HAS_TAG.test(s)) return s;
  const out = decodeEntities(s.replace(BLOCK_RE, '\n').replace(/<[^>]+>/g, ''));
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// 通用遍历：poems 记录按字段语义处理
function cleanRecord(rec, stats) {
  if (!rec || typeof rec !== 'object') return false;
  let changed = false;
  if (Array.isArray(rec.p)) {
    for (let i = rec.p.length - 1; i >= 0; i--) {
      const s = rec.p[i];
      if (typeof s !== 'string') continue;
      const pieces = cleanParas(s);
      if (pieces.length !== 1 || pieces[0] !== s) {
        rec.p.splice(i, 1, ...pieces);
        stats.parasAdded += Math.max(0, pieces.length - 1);
        changed = true;
      }
    }
  }
  for (const key of ['t', 'a', 'd']) {
    if (typeof rec[key] === 'string') {
      const c = cleanInline(rec[key]);
      if (c !== rec[key]) { rec[key] = c; changed = true; stats.strings++; }
    }
  }
  if (rec.f && typeof rec.f === 'object') {
    for (const k of Object.keys(rec.f)) {
      const v = rec.f[k];
      if (typeof v === 'string') {
        const c = cleanText(v);
        if (c !== v) { rec.f[k] = c; changed = true; stats.strings++; }
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] === 'string') {
            const pieces = cleanParas(v[i]);
            if (pieces.length !== 1 || pieces[0] !== v[i]) { v.splice(i, 1, ...pieces); changed = true; stats.strings++; }
          }
        }
      }
    }
  }
  // 其他杂项字符串字段（h、comment、prologue、tg、st 等）：行内净化
  for (const key of Object.keys(rec)) {
    if (['p', 't', 'a', 'd', 'f'].includes(key)) continue;
    const v = rec[key];
    if (typeof v === 'string') {
      const c = cleanInline(v);
      if (c !== v) { rec[key] = c; changed = true; stats.strings++; }
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === 'string') {
          const c = cleanInline(v[i]);
          if (c !== v[i]) { v[i] = c; changed = true; stats.strings++; }
        }
      }
    }
  }
  return changed;
}

// 通用 JSON 遍历净化（idx/manifest 等）：所有字符串做行内净化
function cleanGeneric(obj, stats) {
  let changed = false;
  if (typeof obj === 'string') {
    const c = cleanInline(obj);
    if (c !== obj) { stats.strings++; return { changed: true, value: c }; }
    return { changed: false };
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = cleanGeneric(obj[i], stats);
      if (r.changed) { obj[i] = r.value; changed = true; }
    }
    return { changed };
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const r = cleanGeneric(obj[k], stats);
      if (r.changed) { obj[k] = r.value; changed = true; }
    }
    return { changed };
  }
  return { changed: false };
}

function backupFile(relPath, raw) {
  const dst = path.join(BACKUP_DIR, relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, raw);
}

function serialize(raw, obj) {
  const lines = raw.split('\n').length;
  return lines <= 5 ? JSON.stringify(obj) : JSON.stringify(obj, null, 1);
}

const stats = { filesChanged: 0, parasAdded: 0, strings: 0 };
const changedFiles = [];

// 1) poems/ 目录：记录级清理
const poemsDir = path.join(DATA_DIR, 'poems');
const files = fs.readdirSync(poemsDir).filter(f => f.endsWith('.json')).sort();
let totalRecords = 0;
for (const fname of files) {
  const fp = path.join(poemsDir, fname);
  const raw = fs.readFileSync(fp, 'utf8');
  let records;
  try { records = JSON.parse(raw); } catch (e) { console.log('解析失败跳过:', fname, e.message); continue; }
  if (!Array.isArray(records)) continue;
  totalRecords += records.length;
  let fileChanged = false;
  for (const rec of records) {
    if (cleanRecord(rec, stats)) fileChanged = true;
  }
  if (fileChanged) {
    backupFile(path.join('poems', fname), raw);
    fs.writeFileSync(fp, JSON.stringify(records));
    changedFiles.push(path.join('poems', fname));
    stats.filesChanged++;
  }
}

// 2) site/data 其余 .json：通用净化
function walkDir(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walkDir(fp, cb);
    else if (name.endsWith('.json')) cb(fp);
  }
}
walkDir(DATA_DIR, fp => {
  const rel = path.relative(DATA_DIR, fp).replace(/\\/g, '/');
  if (rel.startsWith('poems/')) return;
  const raw = fs.readFileSync(fp, 'utf8');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return; }
  const sub = { strings: 0 };
  const r = cleanGeneric(obj, sub);
  if (r.changed) {
    backupFile(rel, raw);
    fs.writeFileSync(fp, serialize(raw, obj));
    changedFiles.push(rel);
    stats.filesChanged++;
    stats.strings += sub.strings;
  }
});

console.log('=== 清理完成 ===');
console.log('记录总数(不变应为643061):', totalRecords);
console.log('改动文件:', stats.filesChanged);
console.log('拆分新增段落:', stats.parasAdded);
console.log('净化字符串:', stats.strings);
console.log('改动文件清单(前40):');
changedFiles.slice(0, 40).forEach(f => console.log(' ', f));
