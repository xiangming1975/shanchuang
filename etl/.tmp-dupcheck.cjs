// 临时：新批次与主库标题撞车检查（跑完删）
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const PUNCT = /[\s·•／/、，。：:；!！?？（）()【】[\]「」『』《》〈〉“”‘’"'—\-_～~.…∙]+/g;
const norm = (s) => conv(String(s || '')).replace(PUNCT, '').toLowerCase();

const POEMS = 'site/data/poems';
const keys = new Set();
for (const f of fs.readdirSync(POEMS).filter((x) => x.endsWith('.json'))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'))) {
    keys.add(norm(r.t) + '|' + norm(r.a));
    keys.add(norm(r.t));
  }
}
console.log('主库标题键:', keys.size);

const hits = {};
let scanned = 0;
for (const f of fs.readdirSync('data_2026-10-29/cleaned/poems').filter((x) => x.endsWith('.json'))) {
  for (const r of JSON.parse(fs.readFileSync(path.join('data_2026-10-29/cleaned/poems', f), 'utf8'))) {
    if (r.t === '说文解字') continue; // 字头丢失待重做，跳过
    scanned++;
    const k = norm(r.t);
    if (keys.has(k) || keys.has(k + '|' + norm(r.a))) hits[r.t] = (hits[r.t] || 0) + 1;
  }
}
const ent = Object.entries(hits).sort((a, b) => b[1] - a[1]);
console.log('扫描(除说文):', scanned, '| 标题撞主库:', ent.reduce((a, e) => a + e[1], 0));
console.log(ent.slice(0, 50).map((e) => e[0] + '×' + e[1]).join(' / ') || '(无)');
