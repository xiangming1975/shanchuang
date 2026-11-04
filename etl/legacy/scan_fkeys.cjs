const fs = require('fs');
const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup';
const m = JSON.parse(fs.readFileSync(ROOT + '/manifest.json', 'utf8'));

// tally every f key across ALL records: count + sample value + value type
const keys = {}; // key -> {count, sample, type}
let recTotal = 0;
for (const c of m.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      recTotal++;
      const f = r.f;
      if (!f || typeof f !== 'object') continue;
      for (const k of Object.keys(f)) {
        if (!keys[k]) keys[k] = { count: 0, sample: null, type: null };
        keys[k].count++;
        if (keys[k].sample === null) {
          const v = f[k];
          keys[k].type = Array.isArray(v) ? 'array' : typeof v;
          keys[k].sample = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60);
        }
      }
    }
  }
}
const out = { recTotal, keys: Object.fromEntries(Object.entries(keys).sort((a, b) => b[1].count - a[1].count)) };
fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/audit-dedup-out/fkeys-scan.json', JSON.stringify(out, null, 1));
console.log('scanned records:', recTotal);
console.log('distinct f keys:', Object.keys(keys).length);
for (const [k, v] of Object.entries(keys).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${k}: count=${v.count} type=${v.type} sample=${JSON.stringify(v.sample)}`);
}
