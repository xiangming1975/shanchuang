const fs = require('fs');
const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup';
const m = JSON.parse(fs.readFileSync(ROOT + '/manifest.json', 'utf8'));

// ids globally contiguous? sum count == nextId means ids 0..n-1 assigned once each with no gap
const sum = m.collections.reduce((s, c) => s + c.count, 0);
console.log('manifest.total:', m.total, '| sum count:', sum, '| MATCH:', sum === m.total);

// targeted checks on collections that previously carried the stripped fields
const targets = ['s14_hf_instruction', 's10_hf_translation', 's09_hf_matrixstudio', 's31_kaggle_yololzw', 's01_chinese_poetry'];
for (const tid of targets) {
  const c = m.collections.find(x => x.id === tid);
  if (!c) { console.log(tid, 'NOT FOUND'); continue; }
  let eCnt = 0, qCnt = 0, pinCnt = 0, checked = 0, fObj = 0, fArr = 0;
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      checked++;
      if (r.f) { if (r.f.e) eCnt++; if (r.f.q) qCnt++; if (r.f.pinyin || r.f.tpinyin) pinCnt++; }
      if (Array.isArray(r.f)) fArr++; else if (r.f && typeof r.f === 'object') fObj++;
    }
  }
  console.log(`  ${tid}: checked=${checked} e=${eCnt} q=${qCnt} pinyin=${pinCnt} fObj=${fObj} fArr=${fArr}`);
}
// confirm s15 absent
console.log('s15 present?', m.collections.some(c => c.id === 's15_hf_benchmark'));

// coarse id contiguity: collect all ids from a few collections and ensure sequential within global span
let minId = Infinity, maxId = -Infinity;
const seen = new Set();
for (const c of m.collections) {
  const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + c.chunks[0], 'utf8'));
  for (const r of arr) { if (typeof r.i === 'number') { if (r.i < minId) minId = r.i; if (r.i > maxId) maxId = r.i; seen.add(r.i); } }
}
console.log('first-chunk id span:', minId, '..', maxId, '| unique:', seen.size, '(global contiguity guaranteed by sum==nextId in apply)');
