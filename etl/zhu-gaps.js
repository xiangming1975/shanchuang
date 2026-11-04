// 列出经部字词注还没覆盖到的段落（用于把覆盖率补到 100%）
// 用法：
//   node etl/zhu-gaps.js                # 只列未覆盖段落的篇名与段号
//   node etl/zhu-gaps.js 孟子·梁惠王上    # 列出指定篇的未覆盖段落全文
//   node etl/zhu-gaps.js --all          # 列出全部未覆盖段落全文
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const DATA = path.join(ROOT, 'site/data/poems');
const FILES = ['lunyu-zhu.json', 'jingbu-zhu.json'];

const OpenCC = require('./node_modules/opencc-js');
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });
function normKey(s) {
  let o = '';
  for (const ch of String(s || '')) o += convT2S(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
}

const rows = [];
for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.json')) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const r of arr) if (r.p && r.p.length) rows.push(r);
}
const byKey = new Map();
for (const r of rows) byKey.set(normKey(r.t), r);

function touchedSegs(rec, body) {
  const full = rec.p.join('\n');
  const fullNorm = [...full].map(ch => convT2S(ch)).join('');
  const touched = new Set();
  for (const line of String(body).split('\n')) {
    if (!line.trim()) continue;
    const i = line.search(/[：:]/);
    if (i <= 0) continue;
    const term = line.slice(0, i).trim();
    const pos = fullNorm.indexOf([...term].map(ch => convT2S(ch)).join(''));
    if (pos < 0) continue;
    let acc = 0;
    for (let k = 0; k < rec.p.length; k++) {
      const end = acc + rec.p[k].length;
      if (pos >= acc && pos < end) { touched.add(k); break; }
      acc = end + 1;
    }
  }
  return touched;
}

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const want = args.filter(a => !a.startsWith('--')).map(normKey);

let gapTotal = 0;
const per = [];
for (const file of FILES) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }
  catch (e) { continue; }
  for (const [title, body] of Object.entries(raw)) {
    const rec = byKey.get(normKey(title));
    if (!rec) continue;
    const touched = touchedSegs(rec, body);
    const gaps = [];
    for (let k = 0; k < rec.p.length; k++) if (!touched.has(k)) gaps.push(k);
    gapTotal += gaps.length;
    per.push({ title, segs: rec.p.length, cov: touched.size, gaps, rec });
  }
}

per.sort((a, b) => (a.cov / a.segs) - (b.cov / b.segs));
console.log(`未覆盖段落合计 ${gapTotal} 段\n`);
for (const p of per) {
  if (!p.gaps.length) continue;
  const pct = (p.cov / p.segs * 100).toFixed(0);
  console.log(`${p.title}  段${p.segs} 覆盖${p.cov}(${pct}%) 缺${p.gaps.length} → 段号 ${p.gaps.map(k => k + 1).join(',')}`);
}

const show = wantAll ? per : per.filter(p => want.includes(normKey(p.title)));
if (show.length) {
  for (const p of show) {
    if (!p.gaps.length) continue;
    console.log(`\n===== ${p.title} =====`);
    for (const k of p.gaps) console.log(`[${k + 1}] ${p.rec.p[k]}`);
  }
}
