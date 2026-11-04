// 临时：对比 prep 式 c24 与 duphead 式 c24 对三国志的差异（跑完删）
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const PUNCT = /[\s·•／/、，。：:；!！?？（）()【】[\]「」『』《》〈〉“”‘’"'—\-_～~.…∙○◎〔〕]/g;
const norm = (s) => conv(String(s || '')).replace(PUNCT, '').toLowerCase();

const POEMS = path.join(__dirname, '..', 'site', 'data', 'poems');
const haveC = new Set();
for (const f of fs.readdirSync(POEMS).filter((x) => x.endsWith('.json'))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'))) {
    const c24 = norm((r.p || []).join('')).slice(0, 24);
    if (c24.length >= 10) haveC.add(c24);
  }
}

const rl = require('readline').createInterface({ input: fs.createReadStream(path.join(__dirname, '..', 'data_2026-10-29', 'gujilab_corpus.jsonl')), crlfDelay: Infinity });
let shown = 0;
rl.on('line', (l) => {
  const o = JSON.parse(l);
  if (o.source !== '三国志' || shown >= 3) return;
  shown++;
  const body = String(o.content || '');
  // duphead 式
  const parasA = body.split(/\n\n+/).map((x) => x.replace(/\n/g, '')).filter((x) => x.trim());
  const cA = norm(parasA.join('')).slice(0, 24);
  // prep 式（splitParas 简化版）
  const PURE = /^[\s　，。、；：！？“”‘’（）【】〔〕《》〈〉…·—\-○◎]+$/;
  const out = [];
  for (const block of body.split(/\n\n+/)) for (const line of block.split('\n')) for (const cell of line.split(/[　]{2,}/)) { const s = cell.trim(); if (s && !PURE.test(s)) out.push(s); }
  const cB = norm(out.join('')).slice(0, 24);
  console.log('《' + o.chapter + '》');
  console.log('  duphead式:', JSON.stringify(cA), '在主库:', haveC.has(cA));
  console.log('  prep式:  ', JSON.stringify(cB), '在主库:', haveC.has(cB));
  console.log('  首段A:', JSON.stringify(parasA[0] && parasA[0].slice(0, 50)));
  console.log('  首段B:', JSON.stringify(out[0] && out[0].slice(0, 50)), '| 段数B:', out.length);
});
