// 临时：新批次 vs 主库 内容头撞车扫描（跑完删）
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const PUNCT = /[\s·•／/、，。：:；!！?？（）()【】[\]「」『』《》〈〉“”‘’"'—\-_～~.…∙○◎〔〕]/g;
const norm = (s) => conv(String(s || '')).replace(PUNCT, '').toLowerCase();

// 主库内容头键：norm(p[0]).slice(0,24) + 标题键
const head = new Map(); // contentHead -> count
const tkey = new Set();
for (const f of fs.readdirSync('site/data/poems').filter((x) => x.endsWith('.json'))) {
  const cid = f.replace(/-\d+\.json$/, '');
  for (const r of JSON.parse(fs.readFileSync(path.join('site/data/poems', f), 'utf8'))) {
    const h = norm((r.p || []).join('')).slice(0, 24);
    if (h.length >= 10) head.set(h, (head.get(h) || 0) + 1);
    tkey.add(norm(r.t) + '|' + norm(r.a));
  }
}
console.log('主库内容头键:', head.size, '| 标题|作者键:', tkey.size);

// 按源扫描 jsonl（比 cleaned 更全：含字头等字段，且能按 source 分组）
const rl = require('readline').createInterface({ input: fs.createReadStream('data_2026-10-29/gujilab_corpus.jsonl'), crlfDelay: Infinity });
const stat = {}; const dupRows = {};
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cnNum = (n) => String(n).split('').map((d) => CN[+d]).join('');
const lines = [];
rl.on('line', (l) => lines.push(JSON.parse(l)));
rl.on('close', () => {
  for (const o of lines) {
    const s = o.source;
    if (!stat[s]) stat[s] = { total: 0, dupHead: 0, dupList: [] };
    const st = stat[s];
    st.total++;
    const body = String(o.content || '');
    const paras = body.split(/\n\n+/).map((x) => x.replace(/\n/g, '')).filter((x) => x.trim());
    if (!paras.length) continue;
    const h = norm(paras.join('')).slice(0, 24);
    if (h.length >= 10 && head.has(h)) {
      st.dupHead++;
      if (st.dupList.length < 6) st.dupList.push(`${o.author || '?'}《${o.chapter || o.char || cnNum(o.volume || 0)}》`);
    }
  }
  let grand = 0, tot = 0;
  for (const [s, st] of Object.entries(stat).sort((a, b) => b[1].dupHead - a[1].dupHead)) {
    if (!['说文解字', '资治通鉴', '诗经', '论语', '孟子'].includes(s) === false) { }
    console.log(`${s}: ${st.dupHead}/${st.total} 内容头撞主库${st.dupHead ? '  例: ' + st.dupList.slice(0, 3).join(' / ') : ''}`);
    grand += st.dupHead; tot += st.total;
  }
  console.log('合计:', grand, '/', tot);
});
