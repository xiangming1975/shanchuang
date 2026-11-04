// merge gujilab jingshi (classics+history) into main lib, EXCLUDING shuowen (说文解字)
// input: data_2026-10-29/cleaned poems for ershisishi / zitongjian / jingbu
// output: append 3 new collections to site/data (tail append, keep existing 44 i-ranges intact)
// dedup: author|title|first16 fingerprint, vs main lib then internal
// usage: node merge_guji.cjs        (dry-run report only)
//        node merge_guji.cjs --apply (backup manifest.json, write shards, rewrite manifest)
const fs = require('fs');
const path = require('path');

const MAIN = path.join(__dirname, 'site', 'data');
const MAIN_MANIFEST = path.join(MAIN, 'manifest.json');
const MAIN_POEMS = path.join(MAIN, 'poems');
const CLEANED = path.join(__dirname, 'data_2026-10-29', 'cleaned');
const CLEANED_MANIFEST = path.join(CLEANED, 'manifest.json');
const CLEANED_POEMS = path.join(CLEANED, 'poems');
const PER_CHUNK = 200;

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// target collections (by cleaned id); shuowen (说文解字) dropped per user request
const TARGETS = [
  { cid: 'ershisishi', name: '二十四史', tab: '古文', srcName: 'ershisishi' },
  { cid: 'zitongjian', name: '资治通鉴', tab: '古文', srcName: 'zitongjian' },
  { cid: 'jingbu', name: '古籍经部', tab: '经部', srcName: 'jingbu' },
];

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}
function fpOf(r) {
  const first = Array.isArray(r.p) && r.p.length ? r.p[0] : '';
  return norm(r.a) + '\u0001' + norm(r.t) + '\u0001' + norm(first).slice(0, 16);
}

// ---------- read main lib ----------
const mainManifest = JSON.parse(fs.readFileSync(MAIN_MANIFEST, 'utf8'));
const mainTotal0 = mainManifest.total;
const mainKeys = new Set();
for (const c of mainManifest.collections) {
  for (const fn of c.chunks) {
    const fp = path.join(MAIN_POEMS, fn);
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(fs.readFileSync(fp, 'utf8'))) mainKeys.add(fpOf(r));
  }
}

// ---------- read cleaned manifest ----------
const cleanManifest = JSON.parse(fs.readFileSync(CLEANED_MANIFEST, 'utf8'));
const cleanColById = {};
for (const c of cleanManifest.collections) cleanColById[c.id] = c;

// ---------- main merge loop ----------
let nextI = mainTotal0;
const newCols = [];
const srcStat = {};
for (const t of TARGETS) {
  const cc = cleanColById[t.srcName];
  if (!cc) { console.log('  [WARN] cleaned collection missing:', t.srcName); continue; }
  let all = [];
  for (const ci of cc.chunks) {
    const fn = t.srcName + '-' + String(ci).padStart(4, '0') + '.json';
    const fp = path.join(CLEANED_POEMS, fn);
    if (!fs.existsSync(fp)) { console.log('  [WARN] missing shard', fn); continue; }
    all = all.concat(JSON.parse(fs.readFileSync(fp, 'utf8')));
  }
  const st = { in: all.length, dupMain: 0, dupSelf: 0, empty: 0, kept: 0 };
  const seenSelf = new Set();
  const kept = [];
  for (const r of all) {
    if (!Array.isArray(r.p) || r.p.length === 0 || !String(r.p.join('')).trim()) { st.empty++; continue; }
    const k = fpOf(r);
    if (mainKeys.has(k)) { st.dupMain++; continue; }
    if (seenSelf.has(k)) { st.dupSelf++; continue; }
    seenSelf.add(k);
    kept.push({
      i: nextI++,
      t: r.t,
      a: r.a || '',
      d: r.d || '',
      p: r.p,
      tg: r.tg || [],
      f: r.f || {},
    });
    st.kept++;
  }
  srcStat[t.srcName] = st;
  if (kept.length === 0) continue;
  const start = kept[0].i;
  // split into shards
  const chunks = [];
  const shardFiles = [];
  for (let i = 0; i < kept.length; i += PER_CHUNK) {
    const chunkArr = kept.slice(i, i + PER_CHUNK);
    const chunkIdx = Math.floor(i / PER_CHUNK);
    const fname = t.cid + '-' + String(chunkIdx).padStart(4, '0') + '.json';
    chunks.push(fname);
    shardFiles.push({ fname, arr: chunkArr });
    if (APPLY) {
      fs.writeFileSync(path.join(MAIN_POEMS, fname), JSON.stringify(chunkArr), 'utf8');
    }
  }
  newCols.push({
    meta: { id: t.cid, name: t.name, tab: t.tab, count: kept.length, visible: kept.length, start, chunks, desc: t.name + '（gujilab 经史部，纯原文）' },
    start,
    count: kept.length,
    chunks: chunks.length,
  });
}

const totalKept = newCols.reduce((s, c) => s + c.count, 0);
const newTotal = mainTotal0 + totalKept;

// ---------- report ----------
console.log('==== gujilab 经史部 合并预览 (DRY=' + DRY + ') ====');
console.log('主库现有 total =', mainTotal0, '| 集合数 =', mainManifest.collections.length);
console.log('主库指纹数 =', mainKeys.size);
console.log('\n--- 来源 -> 去重统计 ---');
console.log('src'.padEnd(12) + 'in'.padStart(8) + 'dupMain'.padStart(10) + 'dupSelf'.padStart(10) + 'empty'.padStart(7) + 'kept'.padStart(8));
for (const t of TARGETS) {
  const st = srcStat[t.srcName];
  if (!st) continue;
  console.log(t.srcName.padEnd(12) + String(st.in).padStart(8) + String(st.dupMain).padStart(10) + String(st.dupSelf).padStart(10) + String(st.empty).padStart(7) + String(st.kept).padStart(8));
}
console.log('\n--- 将新增的分类集合 ---');
for (const nc of newCols) {
  const m = nc.meta;
  console.log(m.id.padEnd(12) + m.name.padEnd(10) + ('[' + m.tab + ']').padEnd(6) + String(nc.count).padStart(8) + '  start=' + nc.start + '  片=' + nc.chunks);
}
console.log('\n净新增 =', totalKept, '条');
console.log('主库 total: ' + mainTotal0 + ' -> ' + newTotal);
console.log('集合数: ' + mainManifest.collections.length + ' -> ' + (mainManifest.collections.length + newCols.length));

if (APPLY) {
  // backup manifest
  const bak = MAIN_MANIFEST + '.bak.' + Date.now();
  fs.copyFileSync(MAIN_MANIFEST, bak);
  console.log('\n[apply] manifest 已备份 ->', bak);
  // append collections + update total + bump v
  for (const nc of newCols) mainManifest.collections.push(nc.meta);
  mainManifest.total = newTotal;
  mainManifest.v = Date.now();
  fs.writeFileSync(MAIN_MANIFEST, JSON.stringify(mainManifest, null, 1), 'utf8');
  console.log('[apply] manifest 已更新：total=' + newTotal + ' v=' + mainManifest.v);
  console.log('[apply] 已写入 ' + newCols.reduce((s, c) => s + c.chunks, 0) + ' 个新分片');
}
