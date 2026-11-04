const fs = require('fs');
const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup.fix';
const m = JSON.parse(fs.readFileSync(ROOT + '/manifest.json', 'utf8'));
const KEEP = new Set(['y', 'z', 's', 'b', 'o', '词牌', 'p']);
const sum = m.collections.reduce((s, c) => s + c.count, 0);

console.log('manifest.total:', m.total, '| sum count:', sum, '| MATCH:', sum === m.total);
console.log('fulltextCount:', m.fulltextCount, '| authors:', m.authors);
console.log('requiresIdRemap:', m.requiresIdRemap);
console.log('importNote:', m.importNote ? 'present' : 'MISSING');

// verify every f key is in KEEP, across first chunk of each collection
let badKeys = new Set();
let arrF = 0, objF = 0, emptyT = 0;
for (const c of m.collections) {
  const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + c.chunks[0], 'utf8'));
  for (const r of arr) {
    if (r.f) {
      if (Array.isArray(r.f)) arrF++; else objF++;
      for (const k of Object.keys(r.f)) if (!KEEP.has(k)) badKeys.add(k);
    }
    if (!r.t || !String(r.t).trim()) emptyT++;
  }
}
console.log('first-chunk: array-f=', arrF, '| object-f=', objF, '| empty-t=', emptyT);
console.log('non-keep f keys found:', badKeys.size ? [...badKeys].join(',') : 'NONE (clean)');

// actual file count vs declared chunks
const files = fs.readdirSync(ROOT + '/poems');
let chunks = 0; for (const c of m.collections) chunks += c.chunks.length;
console.log('declared chunks:', chunks, '| actual files:', files.length, '| MATCH:', chunks === files.length);
