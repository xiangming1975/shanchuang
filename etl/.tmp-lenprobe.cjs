// 临时：对比 gwdj 与新批次重叠条是全文还是节选（跑完删）
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const PUNCT = /[\s·•／/、，。：:；!！?？（）()【】[\]「」『』《》〈〉“”‘’"'—\-_～~.…∙○◎〔〕]/g;
const norm = (s) => conv(String(s || '')).replace(PUNCT, '').toLowerCase();

// 主库索引：head -> [{cid, i, t, a, len}]
const headMap = new Map();
for (const f of fs.readdirSync('site/data/poems').filter((x) => x.endsWith('.json'))) {
  const cid = f.replace(/-\d+\.json$/, '');
  if (cid !== 'gwdj') continue;
  for (const r of JSON.parse(fs.readFileSync(path.join('site/data/poems', f), 'utf8'))) {
    const h = norm((r.p || []).join('')).slice(0, 24);
    headMap.set(h, { cid, i: r.i, t: r.t, a: r.a, d: r.d, len: (r.p || []).join('').length, npara: (r.p || []).length, tg: (r.tg || []).join(',') });
  }
}
console.log('gwdj head 键:', headMap.size);

const probes = ['尚书', '礼记', '孝经', '南史', '汉书', '周易', '大学', '中庸'];
const lines = [];
const rl = require('readline').createInterface({ input: fs.createReadStream('data_2026-10-29/gujilab_corpus.jsonl'), crlfDelay: Infinity });
rl.on('line', (l) => lines.push(JSON.parse(l)));
rl.on('close', () => {
  for (const src of probes) {
    let shown = 0;
    for (const o of lines) {
      if (o.source !== src) continue;
      const paras = String(o.content || '').split(/\n\n+/).map((x) => x.replace(/\n/g, '')).filter((x) => x.trim());
      if (!paras.length) continue;
      const h = norm(paras.join('')).slice(0, 24);
      const hit = headMap.get(h);
      if (hit && shown < 3) {
        shown++;
        const newLen = paras.join('').length;
        console.log(`[${src}] 新批《${o.chapter}》${newLen}字/${paras.length}段  vs  gwdj#${hit.i}《${hit.t}》${hit.len}字/${hit.npara}段 tg=${hit.tg}  ${newLen === hit.len ? '等长' : newLen > hit.len ? '新批长' + (newLen - hit.len) : 'gwdj长' + (hit.len - newLen)}`);
      }
    }
  }
});
