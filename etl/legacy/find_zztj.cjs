const fs = require('fs');
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const m = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const KEY = ['资治通鉴', '資治通鑑'];
// 只扫古文/经典/文言文类集合
const TARGET = ['s27_daizhige', 's28_kaggle_wikisource', 's50_chtxt_mengxue', 's51_chtxt_classics', 's39_gushiwen_wenyan', 's33_hf_tri', 's24_openchinese', 's02_cpp84', 's03_cplibrary81'];
function body(r) { return Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || '')); }
let total = 0; const byCol = {}; const samples = [];
for (const c of m.collections) {
  if (!TARGET.includes(c.id)) continue;
  let cnt = 0;
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const t = ('' + (r.t || ''));
      const p = body(r);
      if (KEY.some(k => t.includes(k) || p.slice(0, 300).includes(k))) {
        cnt++;
        if (samples.length < 8) samples.push({ id: c.id, i: r.i, t: t.slice(0, 40), a: ('' + (r.a || '')).slice(0, 16), d: r.d, plen: p.length });
      }
    }
  }
  if (cnt) { byCol[c.id] = cnt; total += cnt; }
}
console.log('=== dataset_dedup 古籍类集合含《资治通鉴》统计 ===');
console.log('合计(仅扫古籍类):', total, '条');
for (const [id, n] of Object.entries(byCol).sort((a, b) => b[1] - a[1])) console.log('  ' + id + ' : ' + n);
console.log('--- 样例 ---');
for (const s of samples) console.log(JSON.stringify(s));
