// 合并 二十四史鉴赏辞典 144 篇专题赏析 → gujilab 二十四史集合
// 输入：data_2026-10-29/cleaned/poems/ershisishi-*.json（gujilab 原文 1297 条）
//       辞典/2026-10-28/poems/ershisi-0000.json（鉴赏 144 篇）
// 输出：追加到 data_2026-10-29/cleaned/poems/ 末尾，更新 manifest
// 用法：node merge_ershisi.cjs
const fs = require('fs');
const path = require('path');

const CLEANED = path.join(__dirname, 'data_2026-10-29', 'cleaned');
const SRC = path.join(__dirname, '..', '辞典', '2026-10-28', 'poems', 'ershisi-0000.json');
const PER_CHUNK = 200;

// ---------- 读现有数据 ----------
const manifest = JSON.parse(fs.readFileSync(path.join(CLEANED, 'manifest.json'), 'utf8'));
const col = manifest.collections.find(c => c.id === 'ershisishi');
if (!col) { console.error('ershisishi collection not found'); process.exit(1); }
const oldStart = col.start;
const oldCount = col.count;
console.log('现有:', col.name, oldCount, '条, start=' + oldStart);

// 读所有现有 ershisishi 分片（chunks 是数字索引，文件名 = ershisishi-{NNNN}.json）
let allRecords = [];
for (const chunkIdx of col.chunks) {
  const fp = path.join(CLEANED, 'poems', `ershisishi-${String(chunkIdx).padStart(4, '0')}.json`);
  const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
  allRecords = allRecords.concat(arr);
}
console.log('已读入', allRecords.length, '条原文');

// ---------- 读鉴赏辞典 ----------
const appData = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.log('鉴赏辞典:', appData.length, '篇');

// ---------- 追加鉴赏条目 ----------
let nextId = oldStart + oldCount;
const newEntries = [];
for (const o of appData) {
  // 标题加上「鉴赏」后缀以便区分
  const title = o.t ? o.t + '〔鉴赏〕' : '鉴赏·' + (o.a || '佚名');
  newEntries.push({
    i: nextId++,
    t: title,
    a: o.a || '',
    d: o.d || '',
    p: o.p || [],
    tg: ['鉴赏辞典', '史部散文', '二十四史'],
    f: {},
  });
}
allRecords = allRecords.concat(newEntries);
console.log('追加', newEntries.length, '条鉴赏 → 总', allRecords.length, '条');

// ---------- 重写分片 ----------
// 删旧分片文件
for (const chunkIdx of col.chunks) {
  const fp = path.join(CLEANED, 'poems', `ershisishi-${String(chunkIdx).padStart(4, '0')}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}
// 写新分片
const chunks = [];
for (let i = 0; i < allRecords.length; i += PER_CHUNK) {
  const chunkFile = `ershisishi-${String(Math.floor(i / PER_CHUNK)).padStart(4, '0')}.json`;
  fs.writeFileSync(path.join(CLEANED, 'poems', chunkFile), JSON.stringify(allRecords.slice(i, i + PER_CHUNK)), 'utf8');
  chunks.push(Math.floor(i / PER_CHUNK));
}
// 更新 manifest
col.count = allRecords.length;
col.visible = allRecords.length;
col.chunks = chunks;

// 修正后续集合的 start（如果有的话）
let cum = 0;
for (const c2 of manifest.collections) {
  c2.start = cum;
  cum += c2.count;
}
manifest.total = cum;

fs.writeFileSync(path.join(CLEANED, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('---');
console.log('合并完成:', col.name, col.count, '条,', chunks.length, '片');
console.log('  原文:', oldCount, '条 + 鉴赏:', newEntries.length, '条');
console.log('  manifest total:', manifest.total);
