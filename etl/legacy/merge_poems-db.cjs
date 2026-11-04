// 将 poems-db 数据合并到主库（追加新集合，不破坏 id 连续性）
// 策略：poems-db 数据归入新集合 "poemsdb"（诗词集·数据库），追加到 manifest 末尾
// 用法：node merge_poems-db.cjs
const fs = require('fs');
const path = require('path');

const CLEANED2 = path.join(__dirname, 'data_2026-10-29', 'cleaned2');
const MANIFEST = path.join(__dirname, 'site', 'data', 'manifest.json');
const POEMS_DIR = path.join(__dirname, 'site', 'data', 'poems');
const PER_CHUNK = 200;

// ---------- 读主库 manifest ----------
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let nextStart = manifest.total; // 从已有总条数之后开始
console.log('主库现有:', manifest.total, '条,', manifest.collections.length, '集合');

// ---------- 读 cleaned2 manifest ----------
const cleanedManifest = JSON.parse(fs.readFileSync(path.join(CLEANED2, 'manifest.json'), 'utf8'));

// ---------- 收集所有 poems-db 数据 ----------
const allRecords = [];
for (const col of cleanedManifest.collections) {
  for (const chunkIdx of col.chunks) {
    const fpath = path.join(CLEANED2, 'poems', `${col.id}-${String(chunkIdx).padStart(4, '0')}.json`);
    const arr = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    for (const r of arr) {
      allRecords.push(r);
    }
  }
}
console.log('poems-db 总计:', allRecords.length, '条');

// ---------- 重写 id 并分片写入主库 ----------
// 统一归入新集合 "poemsdb"
for (let i = 0; i < allRecords.length; i++) {
  allRecords[i].i = nextStart + i;
}

// 分片写入主库 poems 目录
const chunks = [];
for (let i = 0; i < allRecords.length; i += PER_CHUNK) {
  const chunkIdx = Math.floor(i / PER_CHUNK);
  const chunkFile = `poemsdb-${String(chunkIdx).padStart(4, '0')}.json`;
  fs.writeFileSync(path.join(POEMS_DIR, chunkFile), JSON.stringify(allRecords.slice(i, i + PER_CHUNK)), 'utf8');
  chunks.push(chunkIdx);
}

// ---------- 更新主库 manifest ----------
manifest.collections.push({
  id: 'poemsdb',
  name: '诗词集·数据库',
  tab: '全集',
  count: allRecords.length,
  visible: allRecords.length,
  start: nextStart,
  chunks,
  desc: 'poems-db (yxcs/poems-db) 数据库提取，含注释/译文/赏析',
});
manifest.total += allRecords.length;

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');

console.log('---');
console.log('追加完成: poemsdb 集合,', allRecords.length, '条,', chunks.length, '片');
console.log('主库总计:', manifest.total, '条,', manifest.collections.length, '集合');
console.log('新集合 start:', nextStart, '~', nextStart + allRecords.length - 1);
