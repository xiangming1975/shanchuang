// 正文分片瘦身：把 idx/ft 下磁盘超过 ~3.6MB 的大分片切成 ~3MB 子片，
// 重写 ft/index.json 的 order（子片按序展开，扫描顺序与结果完全不变）。
// 背景（2026-11-01，层1搜索提速）：pdb_song 单片 13.8MB，下载要几秒，
// 正文检索「逐片渐进落地」必须单片够小，第一批结果才出得快。
// 可重跑：已切过的都是小子片，再跑一遍是无操作。
// 口径：切分阈值看磁盘字节（Buffer.byteLength），order 里的 b 仍是 JSON 字符串长度
// （与 build.js 原口径一致，前端只用它做大小判断）。
// 防复发：etl/build.js 的全文索引段已同步加同款切分，未来重建直接产子片；
// 本脚本只负责「不重建全库也能把现有分片切小」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FT_DIR = path.resolve(here, '..', 'site', 'data', 'idx', 'ft');
const SPLIT_MAX = 3 * 1024 * 1024;      // 目标单片 ≤3MB
const SPLIT_THRESHOLD = SPLIT_MAX * 1.2; // 留 20% 余量：3.1MB 的不值得多切一刀

const idxPath = path.join(FT_DIR, 'index.json');
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
const oldSum = idx.order.reduce((a, e) => a + e.n, 0);
const newOrder = [];
let splitCount = 0;

for (const entry of idx.order) {
  const file = path.join(FT_DIR, entry.id + '.json');
  const size = fs.statSync(file).size;
  if (size <= SPLIT_THRESHOLD) { newOrder.push(entry); continue; }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 贪心装箱：行是原子单位（一首的全文不能拦腰断），单片不超 SPLIT_MAX
  const parts = [];
  let cur = [], curB = 0;
  for (const row of rows) {
    const rb = Buffer.byteLength(JSON.stringify(row));
    if (curB + rb > SPLIT_MAX && cur.length) { parts.push(cur); cur = []; curB = 0; }
    cur.push(row); curB += rb;
  }
  if (cur.length) parts.push(cur);
  const sumN = parts.reduce((a, p) => a + p.length, 0);
  if (sumN !== entry.n) throw new Error(`${entry.id}: 切分行数对不上（${sumN} != ${entry.n}），不动 index.json`);
  for (let k = 0; k < parts.length; k++) {
    const id = `${entry.id}~${k + 1}`;
    const buf = JSON.stringify(parts[k]);
    fs.writeFileSync(path.join(FT_DIR, id + '.json'), buf);
    newOrder.push({ id, n: parts[k].length, b: buf.length });
  }
  fs.unlinkSync(file);
  splitCount++;
  console.log(`  ${entry.id}: ${(size / 1048576).toFixed(1)}MB → ${parts.length} 片（${parts.map(p => p.length).join('/')} 行）`);
}

if (!splitCount) { console.log('没有超过阈值的分片，无需切分。'); process.exit(0); }

// 校验：行数守恒 + 新片齐全可解析
const newSum = newOrder.reduce((a, e) => a + e.n, 0);
if (newSum !== oldSum) throw new Error(`行数不守恒：${oldSum} → ${newSum}，不写 index.json`);
for (const e of newOrder) {
  const f = path.join(FT_DIR, e.id + '.json');
  if (!fs.existsSync(f)) throw new Error(`缺文件：${e.id}.json`);
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (rows.length !== e.n) throw new Error(`${e.id}: 行数与清单不符（${rows.length} != ${e.n}）`);
}
idx.order = newOrder;
fs.writeFileSync(idxPath, JSON.stringify(idx));
console.log(`切分完成：${splitCount} 个大分片 → order 共 ${newOrder.length} 项，行数守恒 ${oldSum} = ${newSum}`);
