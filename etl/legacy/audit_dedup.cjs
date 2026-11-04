const fs = require('fs');
const path = require('path');

const DEDUP = 'C:/Users/xiang/Downloads/dataset_dedup';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/audit-dedup-out';
fs.mkdirSync(OUT, { recursive: true });

const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 0; // 0 = no limit

const m = JSON.parse(fs.readFileSync(path.join(DEDUP, 'manifest.json'), 'utf8'));
const KNOWN_F = new Set(['y','z','s','b','n','cm']); // main-lib f codes
const REQUIRED = ['i','t','a','d','p'];

// group files by collection
const files = [];
(function walk(dir){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name.endsWith('.json')) files.push(fp);
  }
})(path.join(DEDUP, 'poems'));
files.sort();
if (LIMIT) files.splice(LIMIT);

// per-collection accumulators
const cols = {}; // id -> {files, recCount, minId, maxId, ids:Set, keyFreq, fCode, tgStats, missing, badF, emptyP, nonNumI, chunkSizes}
function getCol(id){
  if (!cols[id]) cols[id] = { files:0, recCount:0, minId:Infinity, maxId:-Infinity, ids:new Set(),
    keyFreq:{}, fCode:{}, tg:{present:0,absent:0,notArray:0}, missing:{}, badF:0, emptyP:0, nonNumI:0, chunkSizes:[] };
  return cols[id];
}
let globalBadFiles = [];
let globalNotArray = [];

for (const fp of files) {
  const base = path.basename(fp);
  const cid = base.replace(/-(\d+)\.json$/, '');
  const c = getCol(cid);
  c.files++;
  let arr;
  try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch(e){ globalBadFiles.push({fp, err:e.message}); continue; }
  if (!Array.isArray(arr)) { globalNotArray.push(fp); c.chunkSizes.push('NOTARRAY'); continue; }
  c.chunkSizes.push(arr.length);
  c.recCount += arr.length;
  for (const r of arr) {
    if (typeof r !== 'object' || r === null) { c.missing._nonObject = (c.missing._nonObject||0)+1; continue; }
    const keys = Object.keys(r);
    for (const k of keys) c.keyFreq[k] = (c.keyFreq[k]||0)+1;
    for (const k of REQUIRED) if (!(k in r) || r[k] == null) c.missing[k] = (c.missing[k]||0)+1;
    // i
    if ('i' in r) {
      if (typeof r.i !== 'number' || !isFinite(r.i)) c.nonNumI++;
      else { c.ids.add(r.i); if (r.i < c.minId) c.minId = r.i; if (r.i > c.maxId) c.maxId = r.i; }
    }
    // p
    if ('p' in r) { if (Array.isArray(r.p) && r.p.length === 0) c.emptyP++; else if (typeof r.p === 'string' && r.p.length===0) c.emptyP++; }
    // f
    if ('f' in r) {
      if (!Array.isArray(r.f)) c.badF++;
      else for (const code of r.f) c.fCode[String(code)] = (c.fCode[String(code)]||0)+1;
    }
    // tg
    if ('tg' in r) { if (Array.isArray(r.tg)) c.tg.present++; else c.tg.notArray++; }
    else c.tg.absent++;
  }
}

// finalize per collection
const colReport = {};
let totalRecords = 0;
let totalIds = 0;
let dupWithin = 0;
for (const [id, c] of Object.entries(cols)) {
  totalRecords += c.recCount;
  totalIds += c.ids.size;
  const contiguous = (c.maxId - c.minId + 1) === c.ids.size && c.ids.size === c.recCount;
  const hasDup = c.ids.size !== c.recCount; // duplicate ids within collection
  if (hasDup) dupWithin += (c.recCount - c.ids.size);
  // unknown f codes
  const unknownF = {};
  for (const [code, n] of Object.entries(c.fCode)) if (!KNOWN_F.has(code)) unknownF[code] = n;
  colReport[id] = {
    files: c.files,
    recCount: c.recCount,
    minId: c.minId === Infinity ? null : c.minId,
    maxId: c.maxId === -Infinity ? null : c.maxId,
    idSpan: c.minId === Infinity ? 0 : (c.maxId - c.minId + 1),
    distinctIds: c.ids.size,
    contiguous,
    dupWithinCollection: c.recCount - c.ids.size,
    keyFreq: c.keyFreq,
    unknownFCodes: unknownF,
    knownFCodes: Object.fromEntries(Object.entries(c.fCode).filter(([k])=>KNOWN_F.has(k))),
    tg: c.tg,
    missing: c.missing,
    badF: c.badF,
    emptyP: c.emptyP,
    nonNumI: c.nonNumI,
    chunkSizes: c.chunkSizes,
    maxChunk: Math.max(...c.chunkSizes.filter(x=>typeof x==='number')),
    minChunk: Math.min(...c.chunkSizes.filter(x=>typeof x==='number')),
  };
}

// manifest consistency
const manifestCols = {};
for (const mc of m.collections) manifestCols[mc.id] = mc;
const manifestIssues = [];
for (const mc of m.collections) {
  const rep = colReport[mc.id];
  if (!rep) { manifestIssues.push({id:mc.id, issue:'NO_FILES_FOUND'}); continue; }
  if (mc.count !== rep.recCount) manifestIssues.push({id:mc.id, issue:'COUNT_MISMATCH', manifest:mc.count, actual:rep.recCount});
  if ((mc.chunks||[]).length !== rep.files) manifestIssues.push({id:mc.id, issue:'CHUNKFILE_MISMATCH', manifest:(mc.chunks||[]).length, actual:rep.files});
  if (mc.start !== rep.minId) manifestIssues.push({id:mc.id, issue:'START_MISMATCH', manifest:mc.start, actualMin:rep.minId});
  if (mc.count === 0 && rep.recCount > 0) manifestIssues.push({id:mc.id, issue:'EMPTY_MANIFEST_BUT_HAS_DATA'});
}
// global id adjacency / overlap
const sorted = m.collections.slice().sort((a,b)=>a.start-b.start);
const adjacency = [];
for (let i=1;i<sorted.length;i++){
  const prev = colReport[sorted[i-1].id];
  const cur = colReport[sorted[i].id];
  if (prev && cur && prev.maxId != null && cur.minId != null) {
    if (cur.minId !== prev.maxId + 1) adjacency.push({gapAfter:sorted[i-1].id, prevMax:prev.maxId, curId:sorted[i].id, curMin:cur.minId, delta: cur.minId - prev.maxId});
  }
}

const summary = {
  generatedAt: m.generatedAt,
  manifestTopKeys: Object.keys(m),
  manifestHasFulltext: 'fulltextCount' in m,
  manifestHasAuthors: 'authors' in m,
  manifestTotal: m.total,
  manifestCollectionCount: m.collections.length,
  actualFileCount: files.length,
  totalRecords,
  totalDistinctIds: totalIds,
  dupWithinTotal: dupWithin,
  globalBadFiles: globalBadFiles.slice(0,20),
  globalNotArray: globalNotArray.slice(0,20),
  unknownFcodesGlobal: {}, // aggregated below
  collections: colReport,
  manifestIssues,
  adjacencyIssues: adjacency,
};
// aggregate unknown f codes globally
const agg = {};
for (const [id, rep] of Object.entries(colReport)) for (const [code,n] of Object.entries(rep.unknownFCodes)) agg[code]=(agg[code]||0)+n;
summary.unknownFcodesGlobal = agg;

fs.writeFileSync(path.join(OUT,'audit-dedup.json'), JSON.stringify(summary, null, 1));

// console summary
console.log('=== AUDIT DEDUP SUMMARY ===');
console.log('manifest top keys:', summary.manifestTopKeys);
console.log('has fulltextCount:', summary.manifestHasFulltext, '| has authors:', summary.manifestHasAuthors);
console.log('manifest total:', summary.manifestTotal, '| actual records:', summary.totalRecords, '| distinct ids:', summary.totalDistinctIds);
console.log('dup within collections (total):', summary.dupWithinTotal);
console.log('bad files:', globalBadFiles.length, '| not array:', globalNotArray.length);
console.log('actual file count:', summary.actualFileCount, '| manifest collections:', summary.manifestCollectionCount);
console.log('UNKNOWN f codes (global):', JSON.stringify(summary.unknownFcodesGlobal));
console.log('manifest issues count:', manifestIssues.length);
for (const mi of manifestIssues.slice(0,40)) console.log('  ', JSON.stringify(mi));
console.log('adjacency issues count:', adjacency.length);
for (const a of adjacency.slice(0,40)) console.log('  ', JSON.stringify(a));
console.log('--- per-collection key/f issues ---');
for (const [id, rep] of Object.entries(colReport)) {
  if (rep.missing && Object.keys(rep.missing).length) console.log('  MISSING', id, JSON.stringify(rep.missing));
  if (rep.nonNumI) console.log('  nonNumI', id, rep.nonNumI);
  if (rep.badF) console.log('  badF', id, rep.badF);
  if (rep.emptyP) console.log('  emptyP', id, rep.emptyP);
  if (!rep.contiguous) console.log('  NOT_CONTIGUOUS', id, 'recCount',rep.recCount,'span',rep.idSpan,'distinct',rep.distinctIds);
  if (rep.maxChunk > 200) console.log('  CHUNK>200', id, 'max', rep.maxChunk);
  if (Object.keys(rep.unknownFCodes).length) console.log('  UNKNOWN_F', id, JSON.stringify(rep.unknownFCodes));
}
console.log('DONE');
