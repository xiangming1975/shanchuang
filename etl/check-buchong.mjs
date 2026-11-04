// 提取结果自检：把《数据结构-f字段说明.md》里的六条硬规则跑成可执行的检查
//
// 用法：node etl/check-buchong.mjs [目录]    默认 C:/Users/xiang/Downloads/buchong
// 只看汇总：node etl/check-buchong.mjs --quiet
//
// 它不修改任何文件，只报告。六项全绿再谈合并。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv.slice(2).find(a => !a.startsWith('--')) || 'C:/Users/xiang/Downloads/buchong';
const QUIET = process.argv.includes('--quiet');
const MANIFEST = path.join(DIR, 'manifest.json');
const POEMS = path.join(DIR, 'poems');

if (!fs.existsSync(MANIFEST)) {
  console.error('找不到 manifest.json：' + MANIFEST);
  process.exit(1);
}

const MARK = /\[\d+\]|［\d+］|【\d+】|[\u2460-\u2473]/g;
const NOTE_CUT = /[〔【〖]\s*注\s*[〕】〗]/;
const norm = (s) => String(s || '').replace(MARK, '').replace(/[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g, '').toLowerCase();
const bigrams = (s) => { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; };
const overlap = (a, b) => {                       // 短的那份有多大比例被长的包含
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return hit / Math.min(A.size, B.size);
};

const checks = [
  { k: 'yIsRaw', name: 'f.y 像原文', why: '译文栏会重复正文' },
  { k: 'badAuthor', name: '作者位可疑', why: '挂错人，永远匹配不上' },
  { k: 'zMark', name: '注释带序号', why: '前端没有脚注锚点' },
  { k: 'sMark', name: '赏析带序号', why: '同上' },
  { k: 'pNote', name: '正文混注释', why: '正文被〔注〕污染' },
  { k: 'pShape', name: '正文过碎/过整', why: '折行规则失效' },
];

const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const rows = [];
const samples = Object.fromEntries(checks.map(c => [c.k, []]));
let total = 0;

for (const col of mf) {
  const st = { name: col.name, n: 0 };
  for (const c of checks) st[c.k] = 0;
  for (const chunk of col.chunks || []) {
    const fp = path.join(POEMS, chunk);
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(fs.readFileSync(fp, 'utf8'))) {
      st.n++; total++;
      const f = r.f || {};
      const pTxt = (r.p || []).join('');

      if (f.y) {
        const o = overlap(norm(f.y), norm(pTxt));
        if (o > 0.6) { st.yIsRaw++; samples.yIsRaw.length < 6 && samples.yIsRaw.push(`${col.name}·${r.t} 重合 ${o.toFixed(2)}`); }
      }
      const a = String(r.a || '').trim();
      if (!a || /^[（(]/.test(a)) { st.badAuthor++; samples.badAuthor.length < 6 && samples.badAuthor.push(`${col.name}·${r.t} 作者「${a}」`); }
      if (MARK.test(String(f.z || ''))) { MARK.lastIndex = 0; st.zMark++; samples.zMark.length < 6 && samples.zMark.push(`${col.name}·${r.t}`); }
      MARK.lastIndex = 0;
      if (MARK.test(String(f.s || ''))) { MARK.lastIndex = 0; st.sMark++; samples.sMark.length < 6 && samples.sMark.push(`${col.name}·${r.t}`); }
      MARK.lastIndex = 0;
      if (NOTE_CUT.test(pTxt) || (r.p || []).some(x => NOTE_CUT.test(x))) { st.pNote++; samples.pNote.length < 6 && samples.pNote.push(`${col.name}·${r.t}`); }
      const lens = (r.p || []).map(x => String(x).length);
      const bad = lens.some(l => l > 2000) || (lens.length === 1 && lens[0] > 60);
      if (bad) { st.pShape++; samples.pShape.length < 6 && samples.pShape.push(`${col.name}·${r.t} 段数 ${lens.length} 首段 ${lens[0] || 0} 字`); }
    }
  }
  rows.push(st);
}

const pct = (n, d) => d ? (n * 100 / d).toFixed(n ? 1 : 0) + '%' : '—';
console.log(`\n检查目录：${DIR}`);
console.log(`共 ${total} 条\n`);
console.log('| 集合 | 条数 | ' + checks.map(c => c.name).join(' | ') + ' |');
console.log('| --- | ---: | ' + checks.map(() => '---:').join(' | ') + ' |');
for (const r of rows) {
  if (!r.n) continue;
  console.log(`| ${r.name} | ${r.n} | ` + checks.map(c => `${r[c.k]} ${pct(r[c.k], r.n)}`).join(' | ') + ' |');
}
const sum = checks.reduce((o, c) => (o[c.k] = rows.reduce((s, r) => s + r[c.k], 0), o), {});
console.log(`| **合计** | ${total} | ` + checks.map(c => `${sum[c.k]} ${pct(sum[c.k], total)}`).join(' | ') + ' |');

if (!QUIET) {
  console.log('\n样例：');
  for (const c of checks) {
    if (!samples[c.k].length) continue;
    console.log(`\n[${c.name}] —— ${c.why}`);
    for (const s of samples[c.k]) console.log('  ' + s);
  }
}

const fatal = sum.yIsRaw + sum.badAuthor;
console.log('\n' + (fatal ? `✗ 必须修：f.y 像原文 ${sum.yIsRaw} 条、作者位可疑 ${sum.badAuthor} 条` : '✓ 两项致命问题都没有'));
process.exit(fatal ? 1 : 0);
