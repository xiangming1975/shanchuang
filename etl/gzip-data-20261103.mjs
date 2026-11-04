#!/usr/bin/env node
// 把 site/data 下所有 .json 压成同名 .json.gz，并删除原 .json（原文件先移到备份区）。
// 目的：上传体积 5.87GB -> ~1.3GB，并消掉 18MB 级大文件导致的 HeadersTimeoutError。
//
// 为什么不用改代码：store.js 的 cachedText() 对每个 data URL 都先试 `<path>.json.gz`，
// 拿到 arrayBuffer 后自己 DecompressionStream 解压；取不到才回退 .json。
// 已实测 Cloudflare Pages 对 .gz 只给 Content-Type: application/gzip，不加 Content-Encoding，
// 所以浏览器不会替我们解一次。
//
// 例外：manifest.json 必须保持明文——store.js 的 getManifest() 用裸 fetch 取它，不走 cachedText。
//
// 用法：node etl/gzip-data-20261103.mjs [--go]   默认只打印计划

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = path.resolve('site', 'data');
const BAK = path.resolve('..', 'backup-json-20261103');
const GO = process.argv.includes('--go');
const SKIP = new Set(['manifest.json']);
// 这些文件被 tests / 离线脚本直接读明文（rules 读 pingze、zh 读 s2td，
// etl/patch-derived-20261101.cjs 读 dedup-remap），保留 .json 副本供离线脚本读取；
// 同时也写 .gz 供线上 store 用，免得线上每次多一次 404 回退。
const KEEP_PLAIN = new Set(['idx/pingze.json', 'idx/s2td.json', 'idx/t2s.json', 'idx/s2t.json', 'dedup-remap.json']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = walk(DATA);
let before = 0, after = 0, done = 0, skipped = 0;

console.log(GO ? '=== 压缩并删除原文件 ===' : '=== 干跑 ===');
for (const f of files) {
  const rel = path.relative(DATA, f).split(path.sep).join('/');
  if (SKIP.has(rel)) { skipped++; console.log('跳过（保持明文）', rel); continue; }
  const raw = fs.readFileSync(f);
  const gz = zlib.gzipSync(raw, { level: 6 });
  before += raw.length;
  after += gz.length;
  done++;
  if (GO) {
    fs.writeFileSync(f + '.gz', gz);
    if (!KEEP_PLAIN.has(rel)) {
      let b = path.join(BAK, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      if (fs.existsSync(b)) b = path.join(BAK, `${rel}.${Date.now()}`);  // 备份目标已存在时不覆盖旧备份
      fs.renameSync(f, b);   // 原文件移到备份区，不删除
    }
  }
  if (done % 2000 === 0) console.log(`  ${done} 个… 已压 ${(after / 1048576).toFixed(0)}MB`);
}

console.log(`文件 ${done} 个（跳过 ${skipped}），${(before / 1073741824).toFixed(2)}GB -> ${(after / 1073741824).toFixed(2)}GB，压缩比 ${(before / after).toFixed(1)}x`);
