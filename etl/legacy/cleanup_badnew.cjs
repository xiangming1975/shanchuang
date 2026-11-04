// 清理上一轮安全追加生成的「坏 id」新集合：删除其块文件，并把 manifest 恢复到备份基线。
// 回填(f 字段)在原始记录上，不受 manifest 恢复影响，保留。
const fs = require('fs');
const path = require('path');
const POEMS = path.join('site', 'data', 'poems');
const BAK = 'site/data/manifest.json.bak-20261031';
const CUR = 'site/data/manifest.json';
const BM = JSON.parse(fs.readFileSync(BAK, 'utf8'));
const CM = JSON.parse(fs.readFileSync(CUR, 'utf8'));
const bmIds = new Set(BM.collections.map(c => c.id));
let del = 0;
for (const c of CM.collections) if (!bmIds.has(c.id)) for (const ck of c.chunks) {
  const fp = path.join(POEMS, ck); if (fs.existsSync(fp)) { fs.unlinkSync(fp); del++; }
}
fs.copyFileSync(BAK, CUR);
console.log(`已删除坏新集合块文件 ${del} 个，manifest 恢复基线（集合数=${BM.collections.length}）`);
