#!/usr/bin/env node
// 发布瘦身（2026-11-03）：把 site/ 从 29,001 个文件压到 2 万以内，并消除 3 个超 25MiB 的文件。
//
// 三个动作（彼此独立，可单独跑）：
//   1. jl 分桶    —— data/idx/jl/ 每首字一个文件装进 64 个桶，保留大文件独立。
//   2. fh 分片+样本 —— data/idx/fh/<令字>.json 拆成 <=18MB 的数片用于查验，另抽 3 万句做 seed 供出句。
//   3. firstlines 分片 —— data/idx/firstlines.json 按 id 每 20 万一片，客户端顺序加载。
//
// 安全性：原文件一律 rename 到 ../backup-pack-20261103/，不删除。加 --go 才真跑，否则只打印计划（真只读）。
// 幂等：检测到已打过包（jl-b/ 有 .json 或 .json.gz、fh index.v==2、firstlines/ 有文件）就跳过对应步骤。
// 两阶段提交（第十一轮 B-4）：先把全部产物生成到 site/data/.pack-tmp-<pid>，校验通过后一次性写入目标、
//   再移动源文件、最后才写 idx.v=2 / jl-meta.v=2；中途异常只清理临时目录，不写状态、不移源文件。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SITE = path.resolve('site');
const DATA = path.join(SITE, 'data');
const IDX = path.join(DATA, 'idx');
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

// ---------------------------------------------------------------- 两阶段提交
const TMP = path.join(DATA, '.pack-tmp-' + process.pid);
const staged = { writes: [], moves: [], status: [], clears: [] };
const stageWrite = (dst, obj) => {
  if (!GO) return;                              // 干跑：绝不生成临时产物
  const rel = path.relative(DATA, dst);
  const tmp = path.join(TMP, rel);
  ensureDir(path.dirname(tmp));
  fs.writeFileSync(tmp, typeof obj === 'string' ? obj : JSON.stringify(obj));
  staged.writes.push({ tmp, dst });
};
const stageMove = (src, sub) => { if (GO) staged.moves.push({ src, sub }); };
const stageStatus = (file, obj) => { if (GO) staged.status.push({ file, obj }); };
const stageClear = (dir) => { if (GO) staged.clears.push(dir); };   // 旧分片清除推迟到提交阶段

// moveToBak：所有写入都包进 if (GO)；备份目标已存在时不覆盖，改用带时间戳的新文件名（第十一轮 B-4e）
function moveToBak(src, sub) {
  if (!GO) return;
  const base = path.basename(src);
  let dst = path.join(BAK, sub, base);
  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) dst = path.join(BAK, sub, `${base}.${Date.now()}`);
  fs.renameSync(src, dst);
}
// writeJSON：ensureDir 与实际写入都包进 if (GO)（第十一轮 B-2）
function writeJSON(file, obj) {
  if (!GO) return;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj));
}
// dirs：幂等检测要同时认明文 .json 与 gz 化后的 .json.gz（第十一轮 B-3）
const dirs = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json') || f.endsWith('.json.gz')) : [];

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
    const ch = f.replace(/\.json(\.gz)?$/, '');
    let rows, size;
    if (p.endsWith('.gz')) {
      // 源分片已被 gz 化（与 splitFh 的 zlib.gunzipSync 回退一致）
      const buf = zlib.gunzipSync(fs.readFileSync(p));
      rows = JSON.parse(buf);
      size = buf.length;                          // 用解压后体积对齐 JL_THR 口径
    } else {
      rows = JSON.parse(fs.readFileSync(p, 'utf8'));
      size = fs.statSync(p).size;
    }
    if (size >= JL_THR) { own.push(ch); ownBytes += size; continue; }
    const cp = ch.codePointAt(0) || 0;
    buckets[cp % JL_BUCKETS][ch] = rows;
    packBytes += size;
    toMove.push(p);
  }
  say(`[jl] 独立 ${own.length} 个 / ${mb(ownBytes)}；打包 ${toMove.length} 个 / ${mb(packBytes)} -> ${JL_BUCKETS} 桶`);

  // jl-meta.json：明文优先；明文已被 gz 步骤移走时回退读 gz 版（照 splitFh:101-106 写法，第十一轮 B-3）
  const metaPath = path.join(IDX, 'jl-meta.json');
  let meta;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } else {
    const gz = metaPath + '.gz';
    if (!fs.existsSync(gz)) { say('[jl] 无 jl-meta，跳过状态写入'); return; }
    meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)));
    say('[jl] 读 gz 版 jl-meta（明文已被 gz 移走）');
  }
  meta.v = 2;
  meta.own = own.sort().join('');
  meta.buckets = JL_BUCKETS;
  meta.thr = JL_THR;

  if (!GO) { say('[jl] 干跑：将写 64 桶 + jl-meta.v=2，不落盘'); return; }
  buckets.forEach((obj, i) => {
    if (!Object.keys(obj).length) return;
    stageWrite(path.join(outDir, i + '.json'), obj);
  });
  toMove.forEach(p => stageMove(p, 'jl'));
  stageStatus(metaPath, meta);                   // 状态最后写
  say(`[jl] 暂存 ${staged.writes.length} 桶产物（提交阶段统一落盘）`);
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

    // 出句样本：等距抽 FH_SEED 条，铺满全语料
    const n = Math.min(FH_SEED, rows.length);
    const stride = rows.length / n;
    const seed = [];
    for (let i = 0; i < n; i++) seed.push(rows[Math.floor(i * stride)]);

    sizes[ch] = { n: rows.length, parts: parts.length, seed: seed.length };
    totalParts += parts.length;
    moved++;
    if (GO) {
      parts.forEach((arr, i) => stageWrite(path.join(src, `${ch}-p${i}.json`), arr));
      stageWrite(path.join(src, `${ch}-seed.json`), seed);
      stageMove(p, 'fh');
    }
    say(`[fh] ${ch}: ${rows.length} 句 -> ${parts.length} 片 (最大 ${mb(Math.max(...parts.map(a => Buffer.byteLength(JSON.stringify(a)))))}), seed ${seed.length}`);
  }

  idx.v = 2;
  idx.r = 3;
  idx.sizes = sizes;
  idx.totalParts = totalParts;
  if (!GO) { say(`[fh] 干跑：将写 ${totalParts} 片 + ${moved} 个 seed + idx.v=2，不落盘`); return; }
  stageStatus(idxPath, idx);                    // 状态最后写
  say(`[fh] 暂存 ${moved} 个令字 / ${totalParts} 片 + seed`);
}

// --------------------------------------------------- 3. firstlines 按 id 分片
function splitFirstlines() {
  const src = path.join(IDX, 'firstlines.json');
  const outDir = path.join(IDX, 'firstlines');
  if (!fs.existsSync(src)) { say('[fl] 无源文件，跳过'); return; }
  // build 每次重建 firstlines.json 明文；旧分片可能陈旧。清除动作推迟到提交阶段（第十一轮 B-2/B-4），
  // 干跑只打印、不删；生成阶段异常也不会破坏现有分片。
  if (GO) {
    stageClear(outDir);
    if (fs.existsSync(outDir)) say('[fl] 将在提交阶段清除旧分片，准备重切');
  } else if (fs.existsSync(outDir)) {
    say(`[fl] 干跑：将清除旧分片 ${outDir}（未执行）`);
  }

  const map = JSON.parse(fs.readFileSync(src, 'utf8'));
  // id 空间以 manifest.total 为界：越界 key 属于历史遗留死键，顺手清掉。
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
  if (!GO) { say(`[fl] 干跑：将写 ${keys.length} 片 + index.json，不落盘`); return; }
  keys.forEach(k => stageWrite(path.join(outDir, k + '.json'), shards[k]));
  stageWrite(path.join(outDir, 'index.json'), { v: 2, shard: FL_SHARD, parts: keys });
  stageMove(src, 'firstlines');
  say(`[fl] 暂存 ${keys.length} 片 + index.json`);
}

// ------------------------------------------------------------------ 提交
function commitStaged() {
  // 校验：全部暂存产物存在且为合法 JSON，任一缺失即整体放弃
  for (const w of staged.writes) {
    if (!fs.existsSync(w.tmp)) throw new Error('暂存产物缺失: ' + w.tmp);
    if (w.dst.endsWith('.json')) JSON.parse(fs.readFileSync(w.tmp, 'utf8'));
  }
  // 1) 校验通过后先清旧分片，再一次性写入目标（同盘 rename，产物此时才对前端可见）
  for (const d of staged.clears) fs.rmSync(d, { recursive: true, force: true });
  for (const w of staged.writes) {
    ensureDir(path.dirname(w.dst));
    fs.renameSync(w.tmp, w.dst);
  }
  // 2) 移动源文件到备份区
  for (const m of staged.moves) moveToBak(m.src, m.sub);
  // 3) 最后写状态标记（idx.v=2 / jl-meta.v=2）
  for (const s of staged.status) writeJSON(s.file, s.obj);
}

// ------------------------------------------------------------------ 执行
say(GO ? '=== 实跑模式（两阶段提交；原文件移到 ' + BAK + '）===' : '=== 干跑模式（只读，加 --go 才真写）===');
try {
  if (GO) {
    fs.rmSync(TMP, { recursive: true, force: true });   // 清上次残留
    fs.mkdirSync(TMP, { recursive: true });
  }
  if (!step('jl')) packJl();
  if (!step('fh')) splitFh();
  if (!step('fl')) splitFirstlines();
  if (GO) {
    commitStaged();
    say('✓ 提交完成：产物已落盘 → 源文件已移备份区 → 状态标记已写');
  } else {
    say('干跑结束：未写任何文件（未删除 / 未移动 / 未建目录）');
  }
} catch (e) {
  console.error('✗ pack 失败：' + e.message);
  console.error('  已放弃提交：不写状态标记；临时产物将在退出前清理（不写 site/data 正式产物）。');
  process.exitCode = 1;
} finally {
  // 中途异常只清理临时目录，不写状态、不移源文件
  if (GO) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
}

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
