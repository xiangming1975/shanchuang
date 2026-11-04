const fs = require('fs');
const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup.out';
const m = JSON.parse(fs.readFileSync(ROOT + '/manifest.json', 'utf8'));
const sum = m.collections.reduce((s, c) => s + (c.count || 0), 0);
console.log('collections:', m.collections.length);
console.log('manifest.total:', m.total, '| sum count:', sum, '| MATCH:', sum === m.total);
console.log('s15 still present?', m.collections.some(c => c.id === 's15_hf_benchmark'));

let totalChunks = 0;
for (const c of m.collections) totalChunks += (c.chunks || []).length;
const files = fs.readdirSync(ROOT + '/poems');
console.log('declared chunks:', totalChunks, '| actual poems files:', files.length, '| MATCH:', totalChunks === files.length);

// sample: first chunk of each collection only
let eLeft = 0, qLeft = 0, pinyinLeft = 0, fObj = 0, fArr = 0, minId = Infinity, maxId = -Infinity;
let s14qSample = null;
for (const c of m.collections) {
  const ch = c.chunks[0];
  const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    if (r.f) {
      if (r.f.e) eLeft++;
      if (r.f.q) { qLeft++; if (c.id === 's14_hf_instruction' && !s14qSample) s14qSample = r.i; }
      if (r.f.pinyin || r.f.tpinyin) pinyinLeft++;
    }
    if (Array.isArray(r.f)) fArr++; else if (r.f && typeof r.f === 'object') fObj++;
    if (typeof r.i === 'number') { if (r.i < minId) minId = r.i; if (r.i > maxId) maxId = r.i; }
  }
}
console.log('--- sampled first chunk of each collection ---');
console.log('leftover e:', eLeft, '| leftover q:', qLeft, '| leftover pinyin:', pinyinLeft);
console.log('f as object:', fObj, '| f as array:', fArr);
console.log('sampled id span:', minId, '..', maxId, '(first-chunk only, not global)');
if (s14qSample) console.log('WARNING: s14 still has f.q at record', s14qSample);
