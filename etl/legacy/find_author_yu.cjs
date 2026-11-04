const fs = require('fs');
const path = require('path');
const DATA = 'C:\\Users\\xiang\\Downloads\\poetry-site\\site\\data';

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const collName = {};
for (const c of manifest.collections) collName[c.id] = c.name;

const files = fs.readdirSync(path.join(DATA, 'poems')).filter(f => f.endsWith('.json'));
const variants = { '夏禹': [], '大禹': [], '禹': [] };
for (const fn of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', fn), 'utf8')); }
  catch (e) { continue; }
  if (!Array.isArray(arr)) continue;
  for (const r of arr) {
    if (r && r.a) {
      if (r.a === '夏禹') variants['夏禹'].push(r);
      if (r.a === '大禹') variants['大禹'].push(r);
      if (r.a === '禹') variants['禹'].push(r);
    }
  }
}
for (const k of Object.keys(variants)) {
  console.log(`AUTHOR_EXACT[${k}] = ${variants[k].length}`);
  for (const r of variants[k].slice(0, 10)) {
    console.log(`   ${r.i}\t[${collName[r.tg] || r.tg}]\t${r.t}\t${r.d}`);
  }
}
