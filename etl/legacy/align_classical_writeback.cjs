// 通用：用 s33 全量文白库给主库古典集合(史/子/经/古文)补 f.y
// 书盲子串匹配(4字前缀分桶); 仅给无 f.y 的记录补; 每个集合先备份再写.
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const DRY = process.env.DRY === '1';
const TS = new Date().toISOString().replace(/[:.]/g, '-');

const PUNCT = /[\s，。、；：？！“”‘’（）《》〈〉<>\[\]【】…—·~`!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>/\?]/g;
const norm = (s) => ('' + (s || '')).replace(PUNCT, '').toLowerCase();
const MIN_LEN = 8;

const t0 = Date.now();
const log = (...a) => console.error('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's]', ...a);

// ---------- 1. 全量 s33 文白库 (书盲) ----------
log('构建 s33 全量文白索引...');
const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const s33 = sm.collections.find(c => c.id === 's33_hf_tri');
const patMap = new Map();
const pats = [], bhs = [];
let s33Total = 0;
for (const ch of s33.chunks) {
  const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    s33Total++;
    const p = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    const w = norm(p);
    if (w.length < MIN_LEN) continue;
    if (!patMap.has(w)) {
      const b = (r.f && r.f.y) ? ('' + r.f.y).trim() : '';
      patMap.set(w, b);
      pats.push(w); bhs.push(b);
    }
  }
}
const bucket = new Map();
for (let i = 0; i < pats.length; i++) {
  const k = pats[i].substr(0, 4);
  let l = bucket.get(k); if (!l) { l = []; bucket.set(k, l); }
  l.push(i);
}
log('s33 记录', s33Total, '| 去重句', pats.length, '| 桶', bucket.size);

// ---------- 2. 目标集合 ----------
const TARGETS = ['ershisishi', 'jingbu', 'gwdj', 'guwen', 'pdb_guwen', 'jsswen',
  'lunyu', 'ssxx', 'mengxue', 'keben', 'fu', 'pdb_other', 'other'];
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const report = { generated: new Date().toISOString(), dry: DRY, targets: {}, backupDir: null };

for (const id of TARGETS) {
  const col = mm.collections.find(c => c.id === id);
  if (!col) { log('跳过(无集合):', id); continue; }
  log('处理', id, 'chunks=', col.chunks.length);
  let total = 0, skipped = 0, hit = 0, miss = 0, baihuaChars = 0;
  // 备份 (仅实写)
  if (!DRY) {
    const bakDir = MAIN + '/zt-writeback-bak/' + TS;
    if (!report.backupDir) { fs.mkdirSync(bakDir, { recursive: true }); report.backupDir = bakDir.replace(MAIN, 'site/data'); }
    for (const ch of col.chunks) fs.copyFileSync(MAIN + '/poems/' + ch, bakDir + '/' + col.id + '__' + ch);
  }
  for (const ch of col.chunks) {
    const fp = MAIN + '/poems/' + ch;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const r of arr) {
      total++;
      if (r.f && r.f.y) { skipped++; continue; }            // 已有白话, 保留
      const T = norm(Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || '')));
      const seen = new Set();
      for (let i = 0; i < T.length; i++) {
        const list = bucket.get(T.substr(i, 4));
        if (!list) continue;
        for (const c of list) {
          if (seen.has(c)) continue;
          if (T.startsWith(pats[c], i)) seen.add(c);
        }
      }
      if (seen.size) {
        const idx = [...seen].sort((a, b) => a - b);
        const y = idx.map(i => bhs[i]).join('');
        if (y) { if (!DRY) { r.f = r.f || {}; r.f.y = y; } hit++; baihuaChars += y.length; }
        else miss++;
      } else miss++;
    }
    if (!DRY) fs.writeFileSync(fp, JSON.stringify(arr));
  }
  report.targets[id] = { total, skippedHasY: skipped, gainedY: hit, noMatch: miss, baihuaChars };
  log('  ', id, '总', total, '| 已有y跳过', skipped, '| 新补', hit, '| 未命中', miss, '| 白话字', baihuaChars);
}

// ---------- 3. 校验 (实写后) ----------
if (!DRY) {
  let vOk = 0, vBad = 0;
  for (const id of TARGETS) {
    const col = mm.collections.find(c => c.id === id); if (!col) continue;
    for (const ch of col.chunks) {
      const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
      for (const r of arr) {
        const exp = report.targets[id];
        // 仅校验本批应被补且应有 y 的(粗略): 已有y或本批gained
        if (r.f && r.f.y && r.f.y.length) vOk++;
      }
    }
  }
  report.verifyRecordsWithY = vOk;
  log('校验: 主库现含 f.y 记录数(全目标集合合计)', vOk);
}
fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/classical_writeback_report.json', JSON.stringify(report, null, 1));
log('报告写入 classical_writeback_report.json');
console.log(JSON.stringify(report.targets, null, 1));
