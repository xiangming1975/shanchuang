// 校验经部字词注（etl/*-zhu.json）能否落在原文上
//   1) 词条必须是该篇原文的连续子串（locateTerms 按子串定位）
//   2) 词条长度 ≤12、冒号位置 ≤14（与前端解析一致）
//   3) 解释里不能出现 。；;：: （parseColonNotes 按这些切句/分隔）
//   4) 每篇的注条数、覆盖到的段数
//
// 用法：node etl/check-zhu.js [--verbose]
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const DATA = path.join(ROOT, 'site/data/poems');
const FILES = ['lunyu-zhu.json', 'jingbu-zhu.json'];
const VERBOSE = process.argv.includes('--verbose');

const OpenCC = require('./node_modules/opencc-js');
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });
function normKey(s) {
  let o = '';
  for (const ch of String(s || '')) o += convT2S(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
}

// 读全部作品（只取标题与段落）
const rows = [];
for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.json')) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const r of arr) if (r.p && r.p.length) rows.push(r);
}
const byKey = new Map();
for (const r of rows) byKey.set(normKey(r.t), r);
console.log(`作品 ${rows.length} 条`);

let totalTerms = 0, bad = [];
const stat = [];
for (const file of FILES) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }
  catch (e) { console.log(`跳过 ${file}（${e.message}）`); continue; }
  for (const [title, body] of Object.entries(raw)) {
    const rec = byKey.get(normKey(title));
    if (!rec) { bad.push([title, '(标题未命中)', '整篇']); continue; }
    const full = rec.p.join('\n');
    // 繁体正文 + 简体词条：按逐字繁→简归一后再找（与前端 locateTerms 的做法一致）
    const fullNorm = [...full].map(ch => convT2S(ch)).join('');   // 归一后与原文逐字等长
    const touched = new Set();
    let n = 0;
    for (const line of String(body).split('\n')) {
      if (!line.trim()) continue;
      const i = line.search(/[：:]/);
      if (i <= 0) { bad.push([title, line.slice(0, 16), '缺冒号']); continue; }
      const term = line.slice(0, i).trim();
      const expl = line.slice(i + 1).trim();
      n++; totalTerms++;
      if (term.length > 12) bad.push([title, term, '词条过长']);
      if (i > 14) bad.push([title, term, '冒号位置过远']);
      if (/[。；;：:]/.test(expl)) bad.push([title, term, '解释含 。；：']);
      if (!expl) bad.push([title, term, '解释为空']);
      const termNorm = [...term].map(ch => convT2S(ch)).join('');
      let pos = fullNorm.indexOf(termNorm);
      if (pos < 0) { bad.push([title, term, '原文未出现']); continue; }
      // 标出命中的段
      let acc = 0;
      for (let k = 0; k < rec.p.length; k++) {
        const end = acc + rec.p[k].length;
        if (pos >= acc && pos < end) { touched.add(k); break; }
        acc = end + 1;
      }
    }
    stat.push([title, rec.p.length, n, touched.size]);
  }
}

stat.sort((a, b) => (a[3] / a[1]) - (b[3] / b[1]));
console.log('\n篇目            段数  注数  覆盖段  覆盖率');
for (const [t, segs, n, cov] of stat) {
  const pct = (cov / segs * 100).toFixed(0) + '%';
  console.log(`${t.padEnd(16)} ${String(segs).padStart(3)}  ${String(n).padStart(4)}  ${String(cov).padStart(5)}  ${pct.padStart(5)}`);
}
console.log(`\n合计 ${stat.length} 篇 / ${totalTerms} 条`);
if (bad.length) {
  console.log(`\n✗ ${bad.length} 处问题：`);
  for (const [t, term, why] of bad.slice(0, VERBOSE ? 999 : 40)) console.log(`  ${why}｜${t}｜${term}`);
  process.exit(1);
}
console.log('✓ 全部词条都能在原文定位，格式合规');
