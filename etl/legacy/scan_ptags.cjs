// 分析 p[] 字段中的标签种类与样例
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'site', 'data', 'poems');
const TAG_RE = /<\/?(?:p|br|strong|em|span|div|a|img|b|i|u|h[1-6]|ul|ol|li|table|tr|td|th|font|sub|sup|blockquote|center|small|big)\b[^>]*>/gi;
const ENT_RE = /&(?:nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|laquo|raquo|ldquo|rdquo|lsquo|rsquo|#\d+|#x[0-9a-fA-F]+);/g;

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const tagCounter = new Map();
const entCounter = new Map();
const tagSamples = [];
for (const fname of files) {
  let records;
  try { records = JSON.parse(fs.readFileSync(path.join(DIR, fname), 'utf8')); } catch (e) { continue; }
  for (const rec of records) {
    if (!Array.isArray(rec.p)) continue;
    for (const s of rec.p) {
      if (typeof s !== 'string') continue;
      const m1 = s.match(TAG_RE);
      if (m1) {
        for (const x of m1) {
          const k = x.toLowerCase().replace(/"[^"]*"/g, '…').replace(/'[^']*'/g, '…');
          tagCounter.set(k, (tagCounter.get(k) || 0) + 1);
        }
        if (tagSamples.length < 10) tagSamples.push(fname + ' | ' + JSON.stringify(s.slice(0, 90)));
      }
      const m2 = s.match(ENT_RE);
      if (m2) { for (const x of m2) entCounter.set(x, (entCounter.get(x) || 0) + 1); }
    }
  }
}
console.log('--- p[] 标签种类(前25) ---');
[...tagCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(JSON.stringify(k), v));
console.log('--- p[] 实体种类 ---');
[...entCounter.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(k, v));
console.log('--- p[] 样例 ---');
tagSamples.forEach(s => console.log(s));
