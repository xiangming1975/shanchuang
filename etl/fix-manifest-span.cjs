#!/usr/bin/env node
// fix-manifest-span.cjs —— 给 manifest.json 每个集合补 span（id 跨度）字段。
//
// 背景（Review-20261101-第七轮 P0-1）：`count` 是存活条数，不是 id 跨度；集合尾部
// 存在「空洞左移 + 跨集合尾区」记录时，start+count 会把合法 id 挡在门外
// （/#/p/181105 无上一首/下一首、随机抽诗抽不到尾区）。
//
// span 定义：span_i = collections[i+1].start - collections[i].start；
// 最后一个集合 = maxId + 1 - start（maxId 扫描最后一个集合分块取最大 r.i）。
// 前置校验（全部通过才落盘，任一失败即退出不写）：
//   ① collections 按 start 严格递增；
//   ② 全量扫描每个集合所有分块：记录数 === manifest count；
//      每条 r.i ∈ [start, start+span)；start+span === 下一集合 start（最后一个除外）；
//   ③ span >= count（跨度必须盖住存活条数）。
// 幂等：重跑重算同样的 span；不 bump manifest.v（分片/idx/remap 未动，
//   manifest 本身带 ?_=Date.now() 缓存穿透，bump v 会无谓清空用户 IDB 缓存）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const POEMS_DIR = path.join(ROOT, 'site', 'data', 'poems');

const raw = fs.readFileSync(MANIFEST, 'utf8');
const endsWithNewline = raw.endsWith('\n');
const j = JSON.parse(raw);
const cols = j.collections;
if (!Array.isArray(cols) || cols.length === 0) fail('manifest.collections 为空');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

// ① start 严格递增
for (let i = 1; i < cols.length; i++) {
  if (!(cols[i].start > cols[i - 1].start)) {
    fail(`collections[${i}].start(${cols[i].start}) 未严格大于前一项(${cols[i - 1].start})`);
  }
}

// 逐集合扫描分块（manifest 的 chunks 是文件名数组），收集 实际条数 / minId / maxId
function scanCollection(c) {
  if (!Array.isArray(c.chunks) || c.chunks.length === 0) fail(`${c.id}: chunks 不是非空文件名数组`);
  let n = 0, minId = Infinity, maxId = -1;
  for (const name of c.chunks) {
    const f = path.join(POEMS_DIR, name);
    if (!fs.existsSync(f)) fail(`缺分块文件: ${name}`);
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(arr)) fail(`分块不是数组: ${name}`);
    for (const r of arr) {
      if (typeof r.i !== 'number') fail(`记录缺数字 i: ${name}`);
      n++; if (r.i < minId) minId = r.i; if (r.i > maxId) maxId = r.i;
    }
  }
  return { n, minId, maxId };
}

console.log(`扫描 ${cols.length} 个集合的全部分块（校验 count / id 落在 span 窗口内）...`);
const stats = cols.map(scanCollection);

// ② 实际条数 === count
for (let i = 0; i < cols.length; i++) {
  if (stats[i].n !== cols[i].count) {
    fail(`${cols[i].id}: 分块实际 ${stats[i].n} 条 ≠ manifest count ${cols[i].count}`);
  }
}

// 计算 span
const span = new Array(cols.length);
for (let i = 0; i < cols.length - 1; i++) span[i] = cols[i + 1].start - cols[i].start;
const globalMaxId = stats[cols.length - 1].maxId;
span[cols.length - 1] = globalMaxId + 1 - cols[cols.length - 1].start;

// ③ span >= count + id 窗口校验
for (let i = 0; i < cols.length; i++) {
  const c = cols[i];
  if (span[i] < c.count) fail(`${c.id}: span(${span[i]}) < count(${c.count})`);
  if (stats[i].minId < c.start) fail(`${c.id}: minId(${stats[i].minId}) < start(${c.start})`);
  if (stats[i].maxId >= c.start + span[i]) {
    fail(`${c.id}: maxId(${stats[i].maxId}) 越界 [start, start+span)=${c.start},${c.start + span[i]})`);
  }
}

// 统计报告
let tailTotal = 0, tailCols = 0;
for (let i = 0; i < cols.length; i++) {
  if (span[i] > cols[i].count) { tailCols++; tailTotal += span[i] - cols[i].count; }
}
console.log(`✓ 校验全过：${cols.length} 集合 / ${j.total} 条；span>count 的集合 ${tailCols} 个，` +
  `跨度与条数之差合计 ${tailTotal}（空洞+跨集合尾区）`);
console.log(`  全局 maxId = ${globalMaxId}（在末集合 ${cols[cols.length - 1].id} 内）`);
for (let i = 0; i < cols.length; i++) {
  if (span[i] !== cols[i].count) {
    console.log(`  · ${cols[i].id}: start=${cols[i].start} count=${cols[i].count} → span=${span[i]}` +
      `（+${span[i] - cols[i].count}）`);
  }
}

// 落盘：保持原键序，span 插在 count 之后
for (let i = 0; i < cols.length; i++) {
  const c = cols[i];
  const rebuilt = {};
  for (const key of Object.keys(c)) {
    rebuilt[key] = c[key];
    if (key === 'count') rebuilt.span = span[i];
  }
  if (!('span' in rebuilt)) fail(`${c.id}: 对象里没有 count 键，插入点失效`);
  cols[i] = rebuilt;
}
const out = JSON.stringify(j, null, 2) + (endsWithNewline ? '\n' : '');
fs.writeFileSync(MANIFEST, out);
console.log(`✓ 已写回 ${path.relative(ROOT, MANIFEST)}（${out.length} 字节，未改 v/generatedAt）`);
