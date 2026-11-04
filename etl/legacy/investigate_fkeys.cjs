const fs = require('fs');
const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup';
const m = JSON.parse(fs.readFileSync(ROOT + '/manifest.json', 'utf8'));

const suspect = ['p', 'src', 'from', 'person', 'collection', 'c', 'uuid', 'url', 'u', 'style', 'audio', 'split', 'pid'];
// which collections carry each suspect key, and 2 samples each
const perKey = {}; // key -> {cols:Set, samples:[]}
for (const k of suspect) perKey[k] = { cols: new Set(), samples: [] };

for (const c of m.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const f = r.f || {};
      for (const k of suspect) {
        if (f[k] !== undefined) {
          perKey[k].cols.add(c.id);
          if (perKey[k].samples.length < 2) {
            perKey[k].samples.push({
              col: c.id, a: r.a, t: r.t, d: r.d,
              pbody: (Array.isArray(r.p) ? r.p.join('') : r.p || '').slice(0, 40),
              fk: k, fv: (typeof f[k] === 'string' ? f[k] : JSON.stringify(f[k])).slice(0, 80)
            });
          }
        }
      }
    }
  }
}
for (const k of suspect) {
  const e = perKey[k];
  console.log(`\n=== f.${k} ===  collections(${e.cols.size}):`, [...e.cols].join(', '));
  for (const s of e.samples) console.log(`   [${s.col}] a=${s.a} t=${s.t} d=${s.d} | body="${s.pbody}" | ${k}="${s.fv}"`);
}
// also: for records that have ONLY discard keys (no keep keys), show a few to assess data loss
const keep = new Set(['y', 'z', 's', 'b', 'o', '词牌']);
let onlyDiscard = 0, onlyDiscardSamples = [];
for (const c of m.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(ROOT + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const f = r.f || {};
      const keys = Object.keys(f);
      if (keys.length === 0) continue;
      const hasKeep = keys.some(k => keep.has(k));
      if (!hasKeep) {
        onlyDiscard++;
        if (onlyDiscardSamples.length < 5) onlyDiscardSamples.push({ col: c.id, a: r.a, t: r.t, f });
      }
    }
  }
}
console.log(`\n=== records with ONLY discard-key(s) (no keep key): ${onlyDiscard} ===`);
for (const s of onlyDiscardSamples) console.log(`   [${s.col}] a=${s.a} t=${s.t} f=${JSON.stringify(s.f).slice(0, 120)}`);
