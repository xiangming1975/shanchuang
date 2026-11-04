#!/usr/bin/env node
// 发布瘦身（2026-11-03）：把 site/ 从 29,001 个文件压到 2 万以内，并消除 3 个超 25MiB 的文件。
//
// 三个动作（彼此独立，可单独跑）：
//   1. jl 分桶    —— data/idx/jl/ 每首字一个文件（17,547 个），其中 15,102 个 <100KB、合计仅 129MB。
//                    保留 >=100KB 的 2,445 个独立文件，其余按 字码 % 64 装进 64 个桶文件。
//   2. fh 分片+样本 —— data/idx/fh/<令字>.json（人 = 75.9MB）拆成 <=18MB 的数片用于查验，
//                    另抽 3 万句做 seed 供出句（进页先拿 seed，秒开；全量后台预热）。
//   3. firstlines 分片 —— data/idx/firstlines.json 48.8MB 按 id 每 20 万一片，客户端顺序加载。
//
// 安全性：原文件一律 rename 到 ../backup-pack-20261103/，不删除。加 --go 才真跑，否则只打印计划。
// 幂等：检测到已打过包（jl-b/、firstlines/ 目录、fh/index.json 的 v==2）就跳过对应步骤。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SITE = path.resolve('site');
const IDX = path.join(SITE, 'data', 'idx');
const BAK = path.resolve('..', 'backup-pack-20261103');
const GO = process.argv.includes('--go');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

const JL_THR = 100 * 1024;        // 小于此体积的首字进桶
const JL_BUCKETS = 64;
const FH_SEED = 30000;            // 每令字抽样句数（出句用）
const FH_MAX_PART = 18 * 1024 * 1024;
const FL_SHARD = 200000;          // firstlines 每片覆盖的 id 数

const say = (...a) => console.log(...a);
const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
const step = (n) => ONLY && ONLY !== n;
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
function moveToBak(src, sub) {
  const dst = path.join(BAK, sub, path.basename(src));
  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) fs.unlinkSync(dst);
  if (GO) fs.renameSync(src, dst);
}
function writeJSON(file, obj) {
  ensureDir(path.dirname(file));
  if (GO) fs.writeFileSync(file, JSON.stringify(obj));
}
const dirs = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')) : [];

// ---------------------------------------------------------------- 1. jl 分桶
function packJl() {
  const src = path.join(IDX, 'jl');
  const outDir = path.join(IDX, 'jl-b');
  if (fs.existsSync(outDir) && dirs(outDir).length) { say('[jl] 已打过包，跳过'); return; }
  const files = dirs(src);
  if (!files.length) { say('[jl] 无源文件，跳过'); return; }

  const own = [];
  const buckets = Array.from({ length: JL_BUCKETS }, () => ({}));
  const toMove = [];
  let ownBytes = 0, packBytes = 0;
  for (const f of files) {
    const p = path.join(src, f);
    const ch = f.replace(/\.json$/, '');
    const size = fs.statSync(p).size;
    if (size >= JL_THR) {
      own.push(ch); ownBytes += size;
      continue;
    }
    const cp = ch.codePointAt(0) || 0;
    const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
    buckets[cp % JL_BUCKETS][ch] = rows;
    packBytes += size;
    toMove.push(p);
  }
  say(`[jl] 独立 ${own.length} 个 / ${mb(ownBytes)}；打包 ${toMove.length} 个 / ${mb(packBytes)} -> ${JL_BUCKETS} 桶`);

  if (GO) {
    ensureDir(outDir);
    buckets.forEach((obj, i) => {
      if (!Object.keys(obj).length) return;
      fs.writeFileSync(path.join(outDir, i + '.json'), JSON.stringify(obj));
    });
    toMove.forEach(p => moveToBak(p, 'jl'));
  }

  const metaPath = path.join(IDX, 'jl-meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.v = 2;
  meta.own = own.sort().join('');      // 独立文件的首字（客户端 new Set(str) 后判断）
  meta.buckets = JL_BUCKETS;
  meta.thr = JL_THR;
  writeJSON(metaPath, meta);
  say(`[jl] jl-meta.json 已加 own(${own.length} 字) / buckets=${JL_BUCKETS}`);
}

// ------------------------------------------------------- 2. fh 分片 + 出句样本
function splitFh() {
  const src = path.join(IDX, 'fh');
  const idxPath = path.join(src, 'index.json');
  let idx;
  if (fs.existsSync(idxPath)) {
    idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  } else {
    // 重跑场景：明文 index 已被 gz 步骤压成 .gz 并移走，回退读 gz 版判断分片状态
    const gz = idxPath + '.gz';
    if (!fs.existsSync(gz)) { say('[fh] 无 index，跳过'); return; }
    idx = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)));
    say('[fh] 读 gz 版 index（明文已被 gz 移走）');
  }
  if (idx.v === 2) { say('[fh] 已分片，跳过'); return; }
  const chars = idx.chars || [];
  const sizes = {};
  let totalParts = 0, moved = 0;

  for (const ch of chars) {
    const p = path.join(src, ch + '.json');
    if (!fs.existsSync(p)) { say(`[fh] 缺 ${ch}.json，跳过`); continue; }
    const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) { say(`[fh] ${ch} 空，跳过`); continue; }

    // 分片：按累计字节切，每片 <= FH_MAX_PART
    const parts = [];
    let cur = [], curBytes = 0;
    for (const r of rows) {
      const b = Buffer.byteLength(JSON.stringify(r)) + 1;
      if (cur.length && curBytes + b > FH_MAX_PART) { parts.push(cur); cur = []; curBytes = 0; }
      cur.push(r); curBytes += b;
    }
    if (cur.length) parts.push(cur);
    if (GO) parts.forEach((arr, i) => fs.writeFileSync(path.join(src, `${ch}-p${i}.json`), JSON.stringify(arr)));

    // 出句样本：等距抽 FH_SEED 条，铺满全语料
    const n = Math.min(FH_SEED, rows.length);
    const stride = rows.length / n;
    const seed = [];
    for (let i = 0; i < n; i++) seed.push(rows[Math.floor(i * stride)]);
    if (GO) fs.writeFileSync(path.join(src, `${ch}-seed.json`), JSON.stringify(seed));

    sizes[ch] = { n: rows.length, parts: parts.length, seed: seed.length };
    totalParts += parts.length;
    moveToBak(p, 'fh');
    moved++;
    say(`[fh] ${ch}: ${rows.length} 句 -> ${parts.length} 片 (最大 ${mb(Math.max(...parts.map(a => Buffer.byteLength(JSON.stringify(a)))))}), seed ${seed.length}`);
  }

  idx.v = 2;
  idx.r = 3;
  idx.sizes = sizes;
  idx.totalParts = totalParts;
  writeJSON(idxPath, idx);
  say(`[fh] ${moved} 个令字，共 ${totalParts} 片 + ${moved} 个 seed`);
}

// --------------------------------------------------- 3. firstlines 按 id 分片
function splitFirstlines() {
  const src = path.join(IDX, 'firstlines.json');
  const outDir = path.join(IDX, 'firstlines');
  if (!fs.existsSync(src)) { say('[fl] 无源文件，跳过'); return; }
  // build 每次重建 firstlines.json 明文；旧分片可能陈旧，始终基于最新源重切。
  if (fs.existsSync(outDir)) { fs.rmSync(outDir, { recursive: true, force: true }); say('[fl] 清除旧分片，准备重切'); }

  const map = JSON.parse(fs.readFileSync(src, 'utf8'));
  // id 空间以 manifest.total 为界：firstlines 里有 35 万条 key 越界（>2,145,874），
  // 搜到的 row[1] 永远落不到那里，属于历史遗留的死键，顺手清掉可省一半体积。
  const TOTAL = JSON.parse(fs.readFileSync(path.join(IDX, '..', 'manifest.json'), 'utf8')).total;
  const shards = {};
  let n = 0, dead = 0;
  for (const k in map) {
    const id = +k;
    if (!Number.isFinite(id) || id < 0 || id >= TOTAL) { dead++; continue; }
    const s = Math.floor(id / FL_SHARD);
    (shards[s] || (shards[s] = {}))[k] = map[k];
    n++;
  }
  const keys = Object.keys(shards).map(Number).sort((a, b) => a - b);
  say(`[fl] 保留 ${n} 条（丢弃越界 ${dead} 条）-> ${keys.length} 片（每片 ${FL_SHARD} 个 id）`);
  if (GO) {
    ensureDir(outDir);
    keys.forEach(k => fs.writeFileSync(path.join(outDir, k + '.json'), JSON.stringify(shards[k])));
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ v: 2, shard: FL_SHARD, parts: keys }));
  }
  moveToBak(src, 'firstlines');
  say(`[fl] 索引 firstlines/index.json 已写`);
}

// ------------------------------------------------------------------ 执行
say(GO ? '=== 实跑模式（原文件移到 ' + BAK + '）===' : '=== 干跑模式（加 --go 才真写）===');
if (!step('jl')) packJl();
if (!step('fh')) splitFh();
if (!step('fl')) splitFirstlines();

say('');
say('=== 结果 ===');
const walk = (d, acc) => {
  acc = acc || { files: 0, bytes: 0, max: 0, maxPath: '' };
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p, acc); continue; }
    const st = fs.statSync(p);
    acc.files++; acc.bytes += st.size;
    if (st.size > acc.max) { acc.max = st.size; acc.maxPath = p.replace(SITE, '.'); }
  }
  return acc;
};
const r = walk(SITE);
say(`文件 ${r.files} 个 / ${(r.bytes / 1073741824).toFixed(2)}GB`);
say(`最大单文件 ${mb(r.max)} -> ${r.maxPath}`);
