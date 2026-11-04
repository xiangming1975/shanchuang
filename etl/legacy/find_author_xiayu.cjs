const fs = require('fs');
const path = require('path');

const DATA = 'C:\\Users\\xiang\\Downloads\\poetry-site\\site\\data';
const TARGET = '夏禹';

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const collName = {};
for (const c of manifest.collections) collName[c.id] = c.name;

const files = fs.readdirSync(path.join(DATA, 'poems')).filter(f => f.endsWith('.json'));
const hits = [];
for (const fn of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', fn), 'utf8')); }
  catch (e) { continue; }
  if (!Array.isArray(arr)) continue;
  for (const r of arr) {
    if (r && r.a === TARGET) {
      hits.push({
        i: r.i,
        tg: r.tg,
        coll: collName[r.tg] || r.tg,
        a: r.a,
        d: r.d,
        t: (r.t || '').slice(0, 60),
        first: Array.isArray(r.p) ? (r.p[0] || '').slice(0, 40) : ''
      });
    }
  }
}

console.log('TOTAL_HITS=' + hits.length);
const byColl = {};
for (const h of hits) byColl[h.coll] = (byColl[h.coll] || 0) + 1;
console.log('BY_COLLECTION=' + JSON.stringify(byColl, null, 0));
// print first 40
for (const h of hits.slice(0, 60)) {
  console.log(`${h.i}\t[${h.coll}]\t${h.a}\t${h.t}\t||\t${h.first}`);
}
