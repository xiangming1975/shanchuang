const fs = require('fs');
const path = require('path');

const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const DEDUP = 'C:/Users/xiang/Downloads/dataset_dedup';

function readManifest(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function summarizeManifest(label, m) {
  console.log(`\n===== ${label} manifest =====`);
  console.log('top-level keys:', Object.keys(m));
  if (m.collections) {
    console.log('collections count:', m.collections.length);
    let tot = 0;
    for (const c of m.collections) {
      tot += (c.count || 0);
      console.log(`  - ${c.id} | name=${c.name} | tab=${c.tab} | visible=${c.visible} | count=${c.count} | start=${c.start} | total=${c.total} | chunks=${Array.isArray(c.chunks)?c.chunks.length:'?'} | desc=${String(c.desc).slice(0,30)}`);
    }
    console.log('SUM count =', tot);
  }
  if (m.meta) console.log('meta:', JSON.stringify(m.meta));
  if (m.version !== undefined) console.log('version:', m.version);
}

function listPoemsDir(d, label) {
  console.log(`\n===== ${label} poems dir =====`);
  const entries = fs.readdirSync(d, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  console.log('subdirs:', dirs);
  console.log('top-level files:', files.length, files.slice(0, 10));
  // count total json files recursively
  let totalFiles = 0, totalBytes = 0;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.json')) { totalFiles++; totalBytes += fs.statSync(fp).size; }
    }
  }
  walk(d);
  console.log('total json files (recursive):', totalFiles, ' total MB:', (totalBytes/1048576).toFixed(1));
}

function sampleChunk(fp, label, n=3) {
  console.log(`\n----- sample ${label}: ${fp} -----`);
  try {
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    console.log('array length:', Array.isArray(arr) ? arr.length : 'NOT ARRAY ('+typeof arr+')');
    const recs = Array.isArray(arr) ? arr.slice(0, n) : [arr];
    for (const r of recs) {
      console.log('keys:', Object.keys(r).join(','));
      const clone = JSON.parse(JSON.stringify(r));
      // truncate long fields
      for (const k of ['t','a','d','p']) if (typeof clone[k]==='string' && clone[k].length>60) clone[k]=clone[k].slice(0,60)+'…';
      if (clone.f) clone.f = Object.keys(clone.f);
      console.log(JSON.stringify(clone));
    }
  } catch(e) {
    console.log('ERR reading', fp, e.message);
  }
}

// MAIN
const mainM = readManifest(path.join(MAIN,'manifest.json'));
summarizeManifest('MAIN LIBRARY', mainM);
listPoemsDir(path.join(MAIN,'poems'), 'MAIN');

// DEDUP
const dedupM = readManifest(path.join(DEDUP,'manifest.json'));
summarizeManifest('DATASET_DEDUP', dedupM);
listPoemsDir(path.join(DEDUP,'poems'), 'DEDUP');

// sample one chunk from each
const mainChunkDir = path.join(MAIN,'poems');
const mainFirst = fs.readdirSync(mainChunkDir).find(f=>f.endsWith('.json'));
sampleChunk(path.join(mainChunkDir, mainFirst), 'MAIN first chunk '+mainFirst);

const dedupChunkDir = path.join(DEDUP,'poems');
const dedupFirst = (() => {
  // find first json recursively
  function walk(dir){ for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const fp=path.join(dir,e.name); if(e.isDirectory()){const r=walk(fp); if(r)return r;} else if(e.name.endsWith('.json')) return fp; } return null; }
  return walk(dedupChunkDir);
})();
sampleChunk(dedupFirst, 'DEDUP first chunk '+path.relative(DEDUP,dedupFirst));
