const fs = require('fs');
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const m = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const c = m.collections.find(c => c.id === 's33_hf_tri');
let total = 0, withY = 0, noY = 0;
let lenSum = 0, lenMin = 1e9, lenMax = 0;
let realAuthor = 0, anon = 0;
let poemLike = 0; // 文言句长 5-8 字（五言/七言特征）
const authorEx = []; const poemEx = [];
for (const ch of c.chunks) {
  const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    total++;
    const p = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    const L = p.length;
    lenSum += L; if (L < lenMin) lenMin = L; if (L > lenMax) lenMax = L;
    if (r.f && r.f.y) withY++; else noY++;
    const a = ('' + (r.a || '')).trim();
    const isAnon = (a === '佚名' || a === '未知' || a === '' || a === '不详');
    if (isAnon) anon++; else { realAuthor++; if (authorEx.length < 12) authorEx.push(a + ' | ' + r.t + ' | ' + p.slice(0, 24)); }
    if (L >= 5 && L <= 8) {
      poemLike++;
      if (poemEx.length < 12) poemEx.push((a || '?') + ' | ' + (r.t || '') + ' | ' + p + ' → ' + (r.f && r.f.y ? r.f.y : ''));
    }
  }
}
console.log('=== s33_hf_tri 构成分析 ===');
console.log('总记录:', total);
console.log('有 f.y(白话译文):', withY, ' | 无:', noY);
console.log('文言句均长:', (lenSum / total).toFixed(1), ' | 最短:', lenMin, ' 最长:', lenMax);
console.log('匿名作者(佚名/未知/空):', anon, '(' + (100 * anon / total).toFixed(1) + '%)', ' | 真实作者:', realAuthor, '(' + (100 * realAuthor / total).toFixed(1) + '%)');
console.log('句长5-8字(疑似诗句):', poemLike, '(' + (100 * poemLike / total).toFixed(1) + '%)');
console.log('--- 真实作者样例(可能含诗词) ---');
authorEx.forEach(x => console.log('  ' + x));
console.log('--- 句长5-8字 样例 ---');
poemEx.forEach(x => console.log('  ' + x));
