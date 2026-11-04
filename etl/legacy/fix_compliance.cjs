const fs = require('fs');

const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const OUT = 'C:/Users/xiang/Downloads/dataset_dedup.fix';

// keep these f keys (display / provenance / feihualing pair content)
const KEEP = new Set(['y', 'z', 's', 'b', 'o', '词牌', 'p']);
const DISCARD = ['src', 'uuid', 'from', 'url', 'u', 'style', 'audio', 'split', 'pid', 'person', 'collection', 'c'];

const manifest = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const authors = new Set();
let fulltextCount = 0;
let totalRec = 0;
let strippedF = 0;        // records whose f changed (had discard keys)
let emptiedT = 0;         // records whose empty t got filled
let keptP = 0;            // feihualing pair kept

fs.mkdirSync(OUT + '/poems', { recursive: true });

for (const c of manifest.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      totalRec++;
      // 1) filter f
      const f = r.f;
      if (f && typeof f === 'object' && !Array.isArray(f)) {
        const nf = {};
        let changed = false;
        for (const k of Object.keys(f)) {
          if (KEEP.has(k)) {
            const v = f[k];
            nf[k] = (v == null) ? '' : (typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
            if (k === 'p') keptP++;
          } else {
            changed = true;
          }
        }
        if (changed) strippedF++;
        r.f = nf;
      }
      // 2) empty t -> 默认标题
      if (!r.t || !String(r.t).trim()) { r.t = '（无题）'; emptiedT++; }
      // 3) fulltext + authors stats
      const body = r.p;
      if (Array.isArray(body) ? body.some(s => s && String(s).trim()) : (body && String(body).trim())) fulltextCount++;
      if (r.a && String(r.a).trim()) authors.add(String(r.a).trim());
      out[i] = r;
    }
    fs.writeFileSync(OUT + '/poems/' + ch, JSON.stringify(out));
  }
}

// rebuild manifest top-level
const newManifest = Object.assign({}, manifest);
newManifest.fulltextCount = fulltextCount;
newManifest.authors = authors.size;
newManifest.requiresIdRemap = true;
newManifest.importNote = 'id 跨度 [0,' + totalRec + ') 与主库重叠，导入时各集合 start 须重映射为主库 maxId+1（不动主库原索引）。f 已白名单过滤，仅保留 y/z/s/b/o/词牌/p。非诗内容按 tab 路由，勿混入诗词浏览。';
newManifest.cleanedAt = new Date().toISOString();
fs.writeFileSync(OUT + '/manifest.json', JSON.stringify(newManifest));

console.log('totalRec:', totalRec);
console.log('fulltextCount:', fulltextCount);
console.log('authors(unique):', authors.size);
console.log('records with f stripped:', strippedF);
console.log('empty t filled:', emptiedT);
console.log('feihualing pair(p) kept:', keptP);
console.log('manifest.total matches:', manifest.total === totalRec);
