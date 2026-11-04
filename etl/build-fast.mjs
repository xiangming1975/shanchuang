// 生成 site/data/idx/fast.json —— 搜索「精选快道」。
// fast.json = rank.js BONUS_COLLS 那些集合的标题 TSV（~125KB）：行内容与 names 分片
// 同源同序（直接从 p00..p06 按行过滤，不重扫全库），前端首搜第一跳拉它，
// 不用等 1.9MB 的 names 首片（2026-11-01，层1搜索提速）。
// 可重跑：输出只依赖 manifest + names 分片 + rank.js，幂等。
// 精选清单直接 import 站内 rank.js 的 BONUS_COLLS —— 单一事实源，
// 加成清单改动不需要同步本脚本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BONUS_COLLS } from '../site/js/rank.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, '..', 'site', 'data');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const namesIdx = JSON.parse(fs.readFileSync(path.join(DATA, 'idx', 'names', 'index.json'), 'utf8'));
const cols = manifest.collections;

// 与站内 store.js colIndexOf 同款二分：collections 按 start 升序，取最后一个 start <= id
function colIndexOf(id) {
  let lo = 0, hi = cols.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= cols[mid].start) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

const out = [];
const covered = new Set();
for (const part of namesIdx.parts) {
  const text = fs.readFileSync(path.join(DATA, 'idx', 'names', part.id + '.json'), 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const ci = colIndexOf(parseInt(line.slice(0, tab), 10));
    if (ci < 0) continue;
    const cid = cols[ci].id;
    if (!BONUS_COLLS.has(cid)) continue;
    covered.add(cid);
    out.push(line);
  }
}
if (!out.length) throw new Error('fast.json 一行都没收着——清单或数据对不上，先查 BONUS_COLLS 与 manifest');
const text = out.join('\n') + '\n';
fs.writeFileSync(path.join(DATA, 'idx', 'fast.json'), text);
console.log(`fast.json: ${out.length} 行 / ${(Buffer.byteLength(text) / 1024).toFixed(0)}KB / 覆盖 ${covered.size} 个精选集合: ${[...covered].join(', ')}`);
console.log(`清单未命中的精选集合（数据里没有，正常可空）: ${[...BONUS_COLLS].filter(c => !covered.has(c)).join(', ') || '无'}`);
