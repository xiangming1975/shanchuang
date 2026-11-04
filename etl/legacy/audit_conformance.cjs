'use strict';
// 严格结构合规检查：对照主库 schema，扫描重写后的 dataset_dedup
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup';
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const mmain = JSON.parse(fs.readFileSync(path.join(MAIN, 'manifest.json'), 'utf8'));

const cols = manifest.collections || [];
const mainCols = mmain.collections || [];
const mainMaxId = mainCols.reduce((m,c)=>Math.max(m,(c.start||0)+(c.count||0)),0);

const report = {
  topLevel: {
    dedupKeys: Object.keys(manifest),
    mainKeys: Object.keys(mmain),
    dedupMissingVsMain: Object.keys(mmain).filter(k=>!(k in manifest)),
  },
  schema: { fieldOrder: null, fKeyDist: {}, tgCount: 0, recScanned: 0, bodyLenStats: {min:1e9,max:0,sum:0} },
  collections: [],
  idSpace: {
    dedupMin: 0,
    dedupMax: cols.reduce((m,c)=>Math.max(m,(c.start||0)+(c.count||0)),0),
    mainMin: 0,
    mainMax: mainMaxId,
    collision: null,
  },
  nonPoetry: { byTab: {}, total: 0 },
  descIssues: [],
  chunkViolations: 0,
};

// id collision check
report.idSpace.collision = (report.idSpace.dedupMax > report.idSpace.mainMin) && (report.idSpace.mainMax > report.idSpace.dedupMin);

const fKeyDist = {};
let tgCount = 0, recScanned = 0;
let bodyMin=1e9, bodyMax=0, bodySum=0;
const nonPoetryByTab = {};
const stdFKeys = new Set(['y','z','s','b','n','cm','词牌']);

for (const col of cols) {
  const chunks = col.chunks || [];
  let rec = 0;
  let hasTg = 0;
  let fObj = 0, fArr = 0;
  let fKeys = new Set();
  for (const ch of chunks) {
    const fp = path.join(ROOT, 'poems', ch);
    if (!fs.existsSync(fp)) continue;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (arr.length > 200) report.chunkViolations++;
    for (const r of arr) {
      rec++;
      recScanned++;
      if (r.tg !== undefined) { hasTg++; tgCount++; }
      if (r.d != null) { const L = (''+r.d).length; if (L<bodyMin)bodyMin=L; if (L>bodyMax)bodyMax=L; bodySum+=L; }
      if (Array.isArray(r.f)) { fArr++; }
      else if (r.f && typeof r.f === 'object') { fObj++; for (const k of Object.keys(r.f)) { fKeyDist[k]=(fKeyDist[k]||0)+1; fKeys.add(k); } }
    }
  }
  const tab = col.tab || '(none)';
  const isNonPoem = ['语料','工具','古文','对联','训练'].some(t=>tab.includes(t)) || ['tri','couplets','rhyme','feihualing','instruction','benchmark','wenyan','yongwu','shihua','classics','mengxue','diming'].some(s=>col.id.includes(s));
  if (isNonPoem) { nonPoetryByTab[tab]=(nonPoetryByTab[tab]||0)+rec; }
  // desc 注水 heuristic: desc contains the number of poems or generic repetition
  let descIssue = '';
  if (!col.desc) descIssue = 'desc 缺失';
  else if (col.desc.length > 200) descIssue = 'desc 过长(>'+(col.desc.length)+')';
  else if (/^[0-9,]+$/.test(col.desc.trim())) descIssue = 'desc 仅数字';
  report.collections.push({ id: col.id, name: col.name, tab, count: col.count, chunks: chunks.length, hasTg, fObj, fArr, fKeys: [...fKeys], nonPoem: isNonPoem, descIssue });
  if (descIssue) report.descIssues.push(`${col.id}: ${descIssue}`);
}

report.schema.recScanned = recScanned;
report.schema.tgCount = tgCount;
report.schema.fKeyDist = fKeyDist;
report.schema.bodyLenStats = { min: bodyMin, max: bodyMax, avg: Math.round(bodySum/recScanned) };
report.nonPoetry.byTab = nonPoetryByTab;
report.nonPoetry.total = Object.values(nonPoetryByTab).reduce((s,v)=>s+v,0);

fs.writeFileSync('audit-dedup-out/conformance.json', JSON.stringify(report, null, 1));
console.log('=== conformance audit (rewritten dataset_dedup) ===');
console.log('dedup collections:', cols.length, '| main collections:', mainCols.length);
console.log('dedup id space: [0,', report.idSpace.dedupMax, ') | main id space: [0,', report.idSpace.mainMax, ')');
console.log('ID COLLISION with main lib:', report.idSpace.collision, '(importer MUST remap dedup ids to start > mainMax)');
console.log('dedup top-level keys:', report.topLevel.dedupKeys.join(','));
console.log('main top-level keys:', report.topLevel.mainKeys.join(','));
console.log('dedup MISSING vs main:', report.topLevel.dedupMissingVsMain.join(',') || '(none)');
console.log('records scanned:', recScanned);
console.log('tg(field) present in records:', tgCount);
console.log('f sub-key distribution:', JSON.stringify(fKeyDist));
console.log('body length: min', bodyMin, 'max', bodyMax, 'avg', Math.round(bodySum/recScanned));
console.log('chunk violations (>200):', report.chunkViolations);
console.log('non-poetry total (est):', report.nonPoetry.total, 'byTab:', JSON.stringify(nonPoetryByTab));
console.log('collections flagged nonPoem:', report.collections.filter(c=>c.nonPoem).map(c=>c.id).join(', '));
console.log('desc issues:', report.descIssues.length);
console.log('=== DONE (written audit-dedup-out/conformance.json) ===');
