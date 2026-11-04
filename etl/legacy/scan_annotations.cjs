// Scan the site main library (site/data/poems) for translation/annotation/appreciation coverage.
// Groups by collection id from manifest.json, reads each chunk file once.
const fs = require('fs');
const path = require('path');

const POEMS = path.join(__dirname, 'site', 'data', 'poems');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'site', 'data', 'manifest.json'), 'utf8'));

// Field keys on f
const FIELDS = [
  ['y', '译文'],
  ['z', '注释'],
  ['s', '赏析'],
  ['b', '背景'],
];

function hasContent(v) {
  if (v == null || v === '') return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) {
    if (v.length === 0) return false;
    return v.some(el => hasContent(el));
  }
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// Collect all json files actually present
const presentFiles = new Set(fs.readdirSync(POEMS).filter(f => f.endsWith('.json')));

// Build per-collection stats
const stats = {}; // id -> {name, total, fields:{y,z,s,b counts}}
for (const col of manifest.collections) {
  stats[col.id] = { id: col.id, name: col.name, desc: col.desc, total: 0, has: { y: 0, z: 0, s: 0, b: 0 } };
}

// Process chunks
for (const col of manifest.collections) {
  const st = stats[col.id];
  for (const chunk of (col.chunks || [])) {
    if (!presentFiles.has(chunk)) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(POEMS, chunk), 'utf8')); }
    catch (e) { continue; }
    if (!Array.isArray(arr)) arr = [arr];
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      st.total++;
      const f = it.f;
      if (f && typeof f === 'object') {
        for (const [k] of FIELDS) {
          if (hasContent(f[k])) st.has[k]++;
        }
      }
    }
  }
}

// Cross-check: any poem file whose prefix is not in manifest collections
const knownPrefixes = new Set(manifest.collections.map(c => c.id));
const orphanPrefixes = {};
for (const f of presentFiles) {
  const m = f.match(/^(.*?)-(\d+)\.json$/);
  if (!m) continue;
  const pre = m[1];
  if (!knownPrefixes.has(pre)) {
    orphanPrefixes[pre] = (orphanPrefixes[pre] || 0) + 1;
  }
}

// Output
console.log('collection | name | total | 译文% | 注释% | 赏析% | 背景%');
const rows = manifest.collections.map(c => {
  const st = stats[c.id];
  const pct = k => st.total ? (st.has[k] / st.total * 100) : 0;
  return { id: c.id, name: c.name, total: st.total, y: pct('y'), z: pct('z'), s: pct('s'), b: pct('b'), hy: st.has.y, hz: st.has.z, hs: st.has.s, hb: st.has.b };
}).sort((a, b) => b.total - a.total);

for (const r of rows) {
  const fmt = v => v.toFixed(1).padStart(5);
  console.log(`${r.id} | ${r.name} | ${String(r.total).padStart(6)} | ${fmt(r.y)} | ${fmt(r.z)} | ${fmt(r.s)} | ${fmt(r.b)}`);
}

console.log('\n=== 缺译注汇总（覆盖率 < 1% 视为缺失）===');
const miss = (k, label) => rows.filter(r => r.total > 0 && r[k] < 1).map(r => `${r.name}(${r.id}): ${r['h' + k]}条`);
console.log('\n缺【译文】(f.y) 的集合:');
console.log(miss('y', '译文').join('\n') || '（无）');
console.log('\n缺【注释】(f.z) 的集合:');
console.log(miss('z', '注释').join('\n') || '（无）');
console.log('\n缺【赏析】(f.s) 的集合:');
console.log(miss('s', '赏析').join('\n') || '（无）');
console.log('\n缺【背景】(f.b) 的集合:');
console.log(miss('b', '背景').join('\n') || '（无）');

if (Object.keys(orphanPrefixes).length) {
  console.log('\n=== 文件前缀不在 manifest 集合清单中（孤儿前缀）===');
  console.log(JSON.stringify(orphanPrefixes, null, 0));
}

// Save detailed JSON
fs.writeFileSync(path.join(__dirname, 'annot_scan_mainlib.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows, orphanPrefixes }, null, 2), 'utf8');
console.log('\n详细结果已写入 annot_scan_mainlib.json');
