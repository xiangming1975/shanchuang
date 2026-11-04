const fs = require('fs');
// T2S converter (best-effort)
let convT2S = (s) => s;
try {
  const { Converter } = require('C:/Users/xiang/Downloads/poetry-site/etl/node_modules/opencc-js');
  const cv = Converter({ from: 't', to: 'cn' });
  convT2S = (s) => cv(s);
} catch (e) {
  try {
    const { Converter } = require('opencc-js');
    const cv = Converter({ from: 't', to: 'cn' });
    convT2S = (s) => cv(s);
  } catch (e2) { console.error('opencc not available, using raw normalize'); }
}
const PUNCT = /[\s，。、；：？！“”‘’（）《》〈〉<>\[\]【】…—·~`!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>/\?]/g;
function norm(s) { let o = ''; for (const ch of String(s || '')) o += convT2S(ch); return o.replace(PUNCT, '').toLowerCase(); }

const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';

// ---- Phase 1: build s33 文言 set ----
console.error('building s33 index...');
const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const s33 = sm.collections.find(c => c.id === 's33_hf_tri');
const s33set = new Set();
let s33rec = 0;
for (const ch of s33.chunks) {
  const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    s33rec++;
    const p = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    const k = norm(p);
    if (k.length >= 3) s33set.add(k);
  }
}
console.error('s33 records=' + s33rec + ' unique 文言 keys=' + s33set.size);

// ---- Phase 2: scan main lib ----
console.error('scanning main lib...');
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
function splitSent(t) { return t.split(/[。！？；\n]+/).map(x => x.trim()).filter(x => x.length >= 3); }

let poemRec = 0, poemRecCov = 0, poemU = 0, poemUc = 0;
let ztRec = 0, ztRecCov = 0, ztU = 0, ztUc = 0;
for (const c of mm.collections) {
  const isZT = (c.id === 'zitongjian');
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const p = Array.isArray(r.p) ? r.p : [r.p];
      let units;
      if (isZT) units = splitSent(p.join(''));
      else units = p.map(x => ('' + x).trim()).filter(x => x.length >= 2);
      let recCov = false, uc = 0;
      for (const u of units) {
        const k = norm(u);
        if (k.length < 2) continue;
        if (isZT) { ztU++; } else { poemU++; }
        if (s33set.has(k)) { uc++; recCov = true; if (isZT) ztUc++; else poemUc++; }
      }
      if (isZT) { ztRec++; if (recCov) ztRecCov++; }
      else { poemRec++; if (recCov) poemRecCov++; }
    }
  }
}
console.log('=== 覆盖率实测结果 ===');
console.log('s33 唯一文言句(索引):', s33set.size);
console.log('');
console.log('【A】主库 诗词(tang/song/全集等, 排除通鉴)');
console.log('  诗记录总数:', poemRec);
console.log('  至少1句命中 s33:', poemRecCov, '(' + (100 * poemRecCov / poemRec).toFixed(2) + '%)');
console.log('  诗句单元:', poemU, ' | 命中:', poemUc, '(' + (100 * poemUc / poemU).toFixed(2) + '%)');
console.log('');
console.log('【B】主库 资治通鉴(zitongjian)');
console.log('  通鉴记录数:', ztRec);
console.log('  至少1句命中 s33:', ztRecCov, '(' + (100 * ztRecCov / ztRec).toFixed(2) + '%)');
console.log('  通鉴句单元:', ztU, ' | 命中:', ztUc, '(' + (100 * ztUc / ztU).toFixed(2) + '%)');
