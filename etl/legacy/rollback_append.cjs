// 回滚 merge_cleaned3.cjs --apply 引入的错误追加，恢复正确的 manifest 路由。
// 做法：
//  1) 以备份 manifest（正确 start）为准，逐集合过滤其原始块——只保留 i 落在 [colStart, colEnd) 的原始记录，
//     移除因追加而写进末尾块的坏 id 记录（追加 id 从 colEnd 起，必在区间外）。
//  2) 删除合并时新建的块文件（CM 有、BM 没有的块）。
//  3) 删除合并新增的集合（如 other）的块文件。
//  4) 恢复 manifest = 备份。
// 注意：回填写进原始记录的 f.y/z/s 不受影响（原始记录被保留）。
const fs = require('fs');
const path = require('path');
const POEMS = path.join('site', 'data', 'poems');
const BAK = 'site/data/manifest.json.bak-20261031';
const CUR = 'site/data/manifest.json';

// 先备份当前(坏) manifest，便于查证
if (fs.existsSync(CUR)) fs.copyFileSync(CUR, 'site/data/manifest.json.bad-20261031');

const BM = JSON.parse(fs.readFileSync(BAK, 'utf8'));
const CM = JSON.parse(fs.readFileSync(CUR, 'utf8'));
const bmIds = new Set(BM.collections.map(c => c.id));

let removed = 0, deletedFiles = 0, rewritten = 0;
for (const c of BM.collections) {
  const colStart = c.start, colEnd = c.start + c.count;
  for (const ck of c.chunks) {
    const fp = path.join(POEMS, ck);
    if (!fs.existsSync(fp)) continue;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const keep = arr.filter(r => r.i >= colStart && r.i < colEnd);
    if (keep.length !== arr.length) { removed += arr.length - keep.length; fs.writeFileSync(fp, JSON.stringify(keep)); rewritten++; }
  }
  // 删除 CM 多出的块
  const cur = CM.collections.find(x => x.id === c.id);
  if (cur) for (const ck of cur.chunks) {
    if (!c.chunks.includes(ck)) { const fp = path.join(POEMS, ck); if (fs.existsSync(fp)) { fs.unlinkSync(fp); deletedFiles++; } }
  }
}
// 删除 CM 中完全新增的集合的块
for (const c of CM.collections) if (!bmIds.has(c.id)) for (const ck of c.chunks) {
  const fp = path.join(POEMS, ck); if (fs.existsSync(fp)) { fs.unlinkSync(fp); deletedFiles++; }
}
// 恢复 manifest
fs.copyFileSync(BAK, CUR);
console.log(`ROLLBACK: 移除追加记录 ${removed} 条, 删除新增块文件 ${deletedFiles} 个, 改写末尾块 ${rewritten} 个, manifest 已恢复`);
