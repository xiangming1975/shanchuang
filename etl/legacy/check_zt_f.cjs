const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const zt = mm.collections.find(c => c.id === 'zitongjian');
console.log('通鉴集合:', zt.id, '| 记录数:', zt.count, '| chunks:', zt.chunks.length);

const keyCount = {};      // f 各键出现次数
const recWithF = {};      // 各键覆盖的记录数
let emptyF = 0;
const samples = [];
for (const ch of zt.chunks) {
  const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    const f = r.f || {};
    const keys = Object.keys(f);
    if (keys.length === 0) emptyF++;
    for (const k of keys) {
      keyCount[k] = (keyCount[k] || 0) + 1;
      if (f[k] && String(f[k]).trim().length) recWithF[k] = (recWithF[k] || 0) + 1;
    }
    if (keys.length && samples.length < 3) {
      samples.push({ i: r.i, t: r.t, fkeys: keys.join(','), y: (f.y || '').slice(0, 40), z: (f.z || '').slice(0, 40) });
    }
  }
}
console.log('\n=== f 字段键总出现次数 ===');
console.log(JSON.stringify(keyCount, null, 0));
console.log('\n=== 各键「有内容」的记录数 (共', zt.count, '条) ===');
for (const [k, n] of Object.entries(recWithF)) console.log('  f.' + k + ' : ' + n + ' 条 (' + (100 * n / zt.count).toFixed(1) + '%)');
console.log('\n空 f({}) 记录数:', emptyF, '(' + (100 * emptyF / zt.count).toFixed(1) + '%)');
console.log('\n=== 有 f 内容的样例 ===');
samples.forEach(s => console.log(JSON.stringify(s)));
