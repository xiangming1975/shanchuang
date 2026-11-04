'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/xiang/Downloads/dataset_dedup';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const cols = manifest.collections || [];

let anomalies = [];
let totalRec = 0;
let fArrayCount = 0;       // f still an array (should be 0 after unify)
let fEmptyObject = 0;      // f === {} allowed
let missingField = 0;      // missing i/t/a/d/p/f
let nullBody = 0;
let idGaps = 0;
let idDups = 0;
let chunkSizeViolations = 0;
let fTextFields = 0;       // f has at least one of y/z/s/b/n/cm text

for (const col of cols) {
  const start = col.start;
  const count = col.count;
  const expectedIds = new Set();
  for (let k = 0; k < count; k++) expectedIds.add(start + k);
  const seen = new Set();
  let recCount = 0;
  const chunks = col.chunks || [];
  for (const ch of chunks) {
    const fp = path.join(ROOT, 'poems', ch);
    if (!fs.existsSync(fp)) { anomalies.push(`[${col.id}] missing chunk file ${ch}`); continue; }
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (arr.length > 200) chunkSizeViolations++;
    for (const r of arr) {
      recCount++;
      // fields
      if (r.i === undefined || r.t === undefined || r.a === undefined || r.d === undefined || r.p === undefined || r.f === undefined) {
        missingField++;
        if (missingField <= 5) anomalies.push(`[${col.id}] rec missing field: i=${r.i} t=${(r.t||'').slice(0,8)}`);
      }
      if (r.d == null || (typeof r.d === 'string' && r.d.trim() === '')) nullBody++;
      // id contiguity
      if (!expectedIds.has(r.i)) {
        if (r.i < start || r.i >= start + count) anomalies.push(`[${col.id}] id=${r.i} out of range [${start},${start+count-1}]`);
      }
      if (seen.has(r.i)) { idDups++; }
      seen.add(r.i);
      // f type
      if (Array.isArray(r.f)) { fArrayCount++; if (fArrayCount <= 5) anomalies.push(`[${col.id}] f still array: i=${r.i}`); }
      else if (r.f && typeof r.f === 'object') {
        const keys = Object.keys(r.f);
        if (keys.length === 0) fEmptyObject++;
        else fTextFields++;
      }
      totalRec++;
    }
  }
  if (recCount !== count) anomalies.push(`[${col.id}] count mismatch manifest=${count} actual=${recCount}`);
  // gap check
  for (let k = 0; k < count; k++) if (!seen.has(start + k)) { idGaps++; if (idGaps <= 10) anomalies.push(`[${col.id}] missing id ${start+k}`); }
}

// manifest totals
const sumCount = cols.reduce((s,c)=>s+(c.count||0),0);
const sumStart = cols.reduce((s,c)=>s+(c.start||0),0);
const maxEnd = cols.reduce((s,c)=>Math.max(s,(c.start||0)+(c.count||0)),0);

console.log('=== dataset_dedup rewrite verification ===');
console.log('collections:', cols.length);
console.log('manifest.total:', manifest.total, '| sum(count):', sumCount, '| match:', manifest.total === sumCount);
console.log('total records scanned:', totalRec, '| vs sum(count):', sumCount, '| match:', totalRec === sumCount);
console.log('global id span: 0 ..', maxEnd-1, '| contiguous (maxEnd==sumCount):', maxEnd === sumCount);
console.log('--- field/id checks ---');
console.log('missingField:', missingField);
console.log('nullBody:', nullBody);
console.log('idDups:', idDups);
console.log('idGaps:', idGaps);
console.log('chunkSizeViolations(>200):', chunkSizeViolations);
console.log('--- f form ---');
console.log('fArrayCount(should be 0):', fArrayCount);
console.log('fEmptyObject({}):', fEmptyObject);
console.log('fTextFields(obj w/ keys):', fTextFields);
console.log('--- anomalies (first 30) ---');
console.log(anomalies.slice(0,30).join('\n') || '(none)');
console.log('=== DONE ===');
