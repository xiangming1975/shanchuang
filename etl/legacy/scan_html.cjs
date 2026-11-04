// 扫描主库 chunks 中的 HTML 标签/实体残留
const fs = require('fs');
const path = require('path');

const POEMS_DIR = path.join(__dirname, 'site', 'data', 'poems');
const TAG_RE = /<\/?(?:p|br|strong|em|span|div|a|img|b|i|u|h[1-6]|ul|ol|li|table|tr|td|th|font|sub|sup|blockquote|center|small|big)\b[^>]*>/gi;
const ENT_RE = /&(?:nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|laquo|raquo|ldquo|rdquo|lsquo|rsquo|#\d+|#x[0-9a-fA-F]+);/g;

// 遍历记录的所有字符串
function walkStrings(obj, pathPrefix, out) {
  if (typeof obj === 'string') {
    out.push([pathPrefix, obj]);
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) walkStrings(obj[i], pathPrefix + '[' + i + ']', out);
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walkStrings(obj[k], pathPrefix ? pathPrefix + '.' + k : k, out);
  }
}

const fileStats = [];
let totalAffectedRecords = 0;
const fieldCounter = new Map();
const fTypes = new Map(); // f.y 字段类型统计（string vs array）
const samples = [];

const files = fs.readdirSync(POEMS_DIR).filter(f => f.endsWith('.json')).sort();
let done = 0;
for (const fname of files) {
  const fp = path.join(POEMS_DIR, fname);
  let records;
  try { records = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { console.log('解析失败:', fname, e.message); continue; }
  let fileHits = 0;
  for (const rec of records) {
    const strs = [];
    walkStrings(rec, '', strs);
    let recHit = false;
    for (const [p, s] of strs) {
      // f 字段类型统计（每条记录一次）
      if (p === 'f.y' && !fTypes.has(fname.split('-')[0])) {
        fTypes.set(fname.split('-')[0], Array.isArray(rec.f && rec.f.y) ? 'array' : 'string');
      }
      const hasTag = TAG_RE.test(s); TAG_RE.lastIndex = 0;
      const hasEnt = ENT_RE.test(s); ENT_RE.lastIndex = 0;
      if (hasTag || hasEnt) {
        fileHits++; recHit = true;
        const field = p.replace(/\[\d+\]/g, '[]').split('.')[0] + (p.startsWith('f.') ? '.' + p.split('.')[1] : '');
        fieldCounter.set(field, (fieldCounter.get(field) || 0) + 1);
        if (samples.length < 15) {
          const m = s.match(hasTag ? TAG_RE : ENT_RE);
          samples.push(fname + ' | ' + p + ' | 匹配:' + m.slice(0, 3).join(',') + ' | ' + s.slice(0, 60).replace(/\n/g, '⏎'));
        }
      }
    }
    if (recHit) totalAffectedRecords++;
  }
  if (fileHits) fileStats.push([fname, fileHits]);
  done++;
  if (done % 500 === 0) console.log('已扫描', done, '/', files.length);
}

console.log('=== 扫描完成 ===');
console.log('文件总数:', files.length, ' 受影响文件:', fileStats.length, ' 受影响记录:', totalAffectedRecords);
console.log('--- 字段分布 ---');
[...fieldCounter.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(k + ': ' + v));
console.log('--- 受影响文件(前30) ---');
fileStats.slice(0, 30).forEach(([f, n]) => console.log(f + ': ' + n));
console.log('--- 样例 ---');
samples.forEach(s => console.log(s));
