#!/usr/bin/env node
// 修复派生索引中的「已删 id」（dedup-remap 键，2026-10-31 去重遗留）：
//   1. idx/firstlines.json —— 键为行 id：删除已删键；目标键缺失时改键为 remap 目标（保留首行）
//   2. idx/ft/tang.json / idx/ft/song.json —— 行 id 改写为 remap 目标；改写后按 id 去重
//      （2026-11-02 处理后确认这两个文件是孤儿——ft/index.order 不含、ftSearch 只按
//       order 枚举分片、全站零引用——已删除归档；现脚本对缺失文件自动跳过）
// 幂等：改写后的 id 不在 remap 键集内，重复运行无变化。
// 注意：ft/index.json 不做同步——order 本就不含 tang/song（n/b/total 无需动）；
//       且 b 的口径是 build.js 的 buf.length（字符数），不是 Buffer.byteLength。
// 其余索引（names/fast/mingju/tags/tagbuckets/genre/hot/dyn/列表 authors/jl/fh/citpl 等）
// 经 2026-11-02 精确扫描不含已删 id，无需处理。
// 运行：node etl/fix-index-ids.cjs          （默认写回）
//       node etl/fix-index-ids.cjs --dry    （只报告不写）
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const SITE = path.join(__dirname, '..', 'site');
const rm = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'dedup-remap.json'), 'utf8')).map;
const delSet = new Set(Object.keys(rm));
console.log('dedup-remap 映射数:', delSet.size, DRY ? '[dry]' : '[写回]');

// ---------- 1. firstlines.json ----------
const flPath = path.join(SITE, 'data', 'idx', 'firstlines.json');
const fl = JSON.parse(fs.readFileSync(flPath, 'utf8'));
const flOut = {};
let flKeep = 0, flRename = 0, flDrop = 0;
for (const k of Object.keys(fl)) {
  if (!delSet.has(k)) { flOut[k] = fl[k]; flKeep++; continue; }
  const t = String(rm[k]);
  if (flOut[t] === undefined) { flOut[t] = fl[k]; flRename++; }   // 目标缺首行 → 改键补上
  else flDrop++;                                                  // 目标已有 → 丢弃重复键
}
let flBad = 0;
for (const k of Object.keys(flOut)) if (delSet.has(k)) flBad++;
console.log(`firstlines: 原 ${Object.keys(fl).length} 键 → 保留 ${flKeep} 改键 ${flRename} 丢弃 ${flDrop}，残留已删键 ${flBad}`);
if (flBad) { console.error('!! firstlines 残留已删键，中止'); process.exit(1); }
if (!DRY) fs.writeFileSync(flPath, JSON.stringify(flOut));

// ---------- 2. ft/tang.json / ft/song.json（孤儿已删，缺失即跳过） ----------
for (const f of ['tang', 'song']) {
  const p = path.join(SITE, 'data', 'idx', 'ft', `${f}.json`);
  if (!fs.existsSync(p)) { console.log(`ft/${f}: 文件不存在（已作为孤儿删除归档），跳过`); continue; }
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const seen = new Set();
  const out = [];
  let rew = 0, dedup = 0;
  for (const rowIn of rows) {
    let row = rowIn;
    let id = String(row[0]);
    if (delSet.has(id)) { id = String(rm[id]); row = [Number(id)].concat(row.slice(1)); rew++; }
    if (seen.has(id)) { dedup++; continue; }
    seen.add(id);
    out.push(row);
  }
  let bad = 0;
  for (const row of out) if (delSet.has(String(row[0]))) bad++;
  console.log(`ft/${f}: 原 ${rows.length} 行 → 改写 ${rew} 去重 ${dedup} 剩 ${out.length}，残留已删 ${bad}`);
  if (bad) { console.error(`!! ft/${f} 残留已删 id，中止`); process.exit(1); }
  if (!DRY) fs.writeFileSync(p, JSON.stringify(out));
}

// ---------- 终检：firstlines 可解析、键数对账 ----------
{
  const fl2 = JSON.parse(fs.readFileSync(flPath, 'utf8'));
  if (Object.keys(fl2).length !== flKeep + flRename) throw new Error('firstlines 键数对账不符');
  console.log('终检通过：firstlines 键数对账一致。');
}
