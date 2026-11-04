#!/usr/bin/env node
/*
 * dedup.cjs — 主库完全重复正文去重 + 注释/译文/赏析/创作背景合并
 *
 * 设计（非破坏式，三阶段）：
 *   --plan   干跑：读取 audit-out/duplicates.json，构建去重/合并计划，
 *            落盘 audit-out/dedup-plan.json，打印统计，不改动任何数据。
 *   --build  平行构建：在 site/data/poems-dedup/ 写出去重后的分片（文件名不变），
 *            写出 site/data/manifest.dedup.json（count/visible 递减、v 升、start/chunks 不变），
 *            写出 site/data/dedup-remap.json（旧 i → 保留 i，供前端重定向用户数据）。
 *            原 site/data/poems/ 与 manifest.json 全程不动。
 *   --swap   校验后执行：把 poems → poems-<ts>-bak，poems-dedup → poems；
 *            manifest.json → manifest.json.bak.<ts>，manifest.dedup.json → manifest.json。
 *            原数据以 poems-<ts>-bak 保留，可回滚。
 *
 * 关键约束（来自用户要求 + 源码确认）：
 *   - 删除记录保持 i 不变（store.js:164 用 arr.find(r=>r.i===id) 兼容空槽），
 *     记录始终留在原分片（分片归属由 i 决定，store.js:156），不移动、不重建 i。
 *   - 不重建派生索引（idx/）：删除项的 idx 条目按用户要求留空（悬空）。
 *   - f 字段合并：f.y=译文, f.z=注释, f.s=赏析, f.b=创作背景；
 *     同组各成员去空白后取互异非空值，单值保留原串，多值以 \n\n 拼接。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const DATA = path.join(ROOT, 'site', 'data');
const POEMS = path.join(DATA, 'poems');
const DEDUP_POEMS = path.join(DATA, 'poems-dedup');
const MANIFEST = path.join(DATA, 'manifest.json');
const DUP_SRC = path.join(ROOT, 'audit-out', 'duplicates.json');
const PLAN_OUT = path.join(ROOT, 'audit-out', 'dedup-plan.json');
const REMAP_OUT = path.join(DATA, 'dedup-remap.json');

const FKEYS = ['y', 'z', 's', 'b']; // 译文 / 注释 / 赏析 / 创作背景

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}
function chunkPath(fn) {
  const a = path.join(POEMS, fn);
  if (fs.existsSync(a)) return a;
  const b = path.join(DATA, fn);
  return fs.existsSync(b) ? b : null;
}

// 合并一组记录的 f 字段（仅 y/z/s/b）
function mergeF(members) {
  const merged = {};
  for (const k of FKEYS) {
    const seen = new Set();
    const vals = [];
    for (const r of members) {
      const v = r && r.f && r.f[k];
      if (typeof v === 'string' && v.trim()) {
        const t = v.trim();
        if (!seen.has(t)) { seen.add(t); vals.push(t); }
      }
    }
    if (vals.length === 1) merged[k] = vals[0];
    else if (vals.length > 1) merged[k] = vals.join('\n\n');
  }
  return merged;
}

function loadManifest() {
  return readJson(MANIFEST);
}

// ---------- 计划构建（读全部分片，仅收集需要的记录）----------
function buildPlan() {
  const dups = readJson(DUP_SRC);
  const m = loadManifest();
  const needI = new Set();
  const groups = [];
  for (const g of dups) {
    const members = g.members.map(x => ({ i: x.i, coll: x.coll, a: x.a, t: x.t }));
    let canon = members[0];
    for (const mm of members) if (mm.i < canon.i) canon = mm;
    const del = members.filter(mm => mm.i !== canon.i).map(mm => mm.i);
    for (const mm of members) needI.add(mm.i);
    groups.push({ canon, del, memberKeys: members.map(mm => mm.i) });
  }

  // 读全部分片，收集 needI 对应记录
  const recById = new Map();
  const changedChunks = new Set(); // 含 needI 的分片文件（用于 build 阶段只读这些）
  const collOfChunk = new Map();   // fn -> collId
  for (const c of m.collections) {
    for (const fn of (c.chunks || [])) {
      collOfChunk.set(fn, c.id);
      const fp = chunkPath(fn);
      if (!fp) continue;
      let arr;
      try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
      if (!Array.isArray(arr)) continue;
      let touched = false;
      for (const r of arr) {
        if (r && typeof r.i === 'number' && needI.has(r.i)) {
          recById.set(r.i, r);
          touched = true;
        }
      }
      if (touched) changedChunks.add(fn);
    }
  }

  // 构建 deleteSet / canonF / remap
  const deleteSet = new Set();
  const canonF = new Map();   // canonI -> merged f
  const remap = {};           // oldI -> canonI
  const missing = [];
  const planGroups = [];
  for (const g of groups) {
    const members = g.memberKeys.map(i => recById.get(i)).filter(Boolean);
    if (members.length < g.memberKeys.length) {
      const got = new Set(members.map(r => r.i));
      for (const i of g.memberKeys) if (!got.has(i)) missing.push(i);
    }
    const merged = mergeF(members);
    canonF.set(g.canon.i, merged);
    for (const i of g.del) { deleteSet.add(i); remap[i] = g.canon.i; }
    planGroups.push({ canon: g.canon, del: g.del, members, merged });
  }

  return { m, groups, recById, deleteSet, canonF, remap, changedChunks, collOfChunk, missing, planGroups };
}

function runPlan() {
  const plan = buildPlan();
  const oldTotal = plan.m.total;
  const newTotal = oldTotal - plan.deleteSet.size;

  // 各集合删除数（跨集合去重时影响显著，需透明展示）
  // 直接用 duplicates.json 成员自带的 coll 字段统计（plan.planGroups 的 members 是原始分片记录，无 coll）
  const dupsRaw = readJson(DUP_SRC);
  const perCollDel = {};
  for (const g of dupsRaw) {
    let canon = g.members[0];
    for (const mm of g.members) if (mm.i < canon.i) canon = mm;
    for (const mm of g.members) if (mm.i !== canon.i) perCollDel[mm.coll] = (perCollDel[mm.coll] || 0) + 1;
  }
  console.log('── 去重计划（干跑）──');
  console.log('重复组数      :', plan.groups.length);
  console.log('将删除条目    :', plan.deleteSet.size);
  console.log('主库原总数    :', oldTotal);
  console.log('主库新总数    :', newTotal, '(', (newTotal / oldTotal * 100).toFixed(2), '% )');
  console.log('涉及分片文件  :', plan.changedChunks.size);
  const perCollArr = Object.entries(perCollDel).sort((a, b) => b[1] - a[1]);
  console.log('各集合删除数  : 共', perCollArr.length, '个集合受影响');
  for (const [c, n] of perCollArr.slice(0, 20)) console.log('   ', c, n);
  if (perCollArr.length > 20) console.log('   … 其余', perCollArr.length - 20, '个集合见 dedup-plan.json');
  if (plan.missing.length) console.log('⚠ 缺失成员 i :', plan.missing.length, plan.missing.slice(0, 10));

  // 抽样：前 12 组，展示合并前后的 f
  const samples = plan.planGroups.slice(0, 12).map(g => {
    const canon = g.canon;
    const before = {};
    const cRec = g.members.find(r => r.i === canon.i);
    if (cRec && cRec.f) for (const k of FKEYS) if (cRec.f[k]) before[k] = (cRec.f[k] + '').slice(0, 60);
    const delF = g.del.map(i => {
      const r = g.members.find(x => x.i === i);
      const f = {};
      if (r && r.f) for (const k of FKEYS) if (r.f[k]) f[k] = (r.f[k] + '').slice(0, 40);
      return { i, coll: (r ? r.coll : '?'), f };
    });
    return { keep: { i: canon.i, coll: canon.coll, a: canon.a, t: canon.t }, before, merged: g.merged, del: delF };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    mode: 'plan',
    dupGroups: plan.groups.length,
    deleteCount: plan.deleteSet.size,
    oldTotal, newTotal,
    missing: plan.missing,
    remap: plan.remap,
    samples,
  };
  fs.writeFileSync(PLAN_OUT, JSON.stringify(out, null, 1));
  console.log('计划已落盘    :', PLAN_OUT, '(', (fs.statSync(PLAN_OUT).size / 1024).toFixed(1), 'KB )');
  console.log('\n── 抽样合并（前 3 组）──');
  for (const s of samples.slice(0, 3)) {
    console.log(`《${s.keep.t}》${s.keep.a}  保留 i=${s.keep.i}[${s.keep.coll}]  删 ${s.del.length} 条`);
    for (const k of FKEYS) {
      if (s.merged[k]) console.log(`   ${k}: ${s.merged[k].slice(0, 70).replace(/\n/g, '⏎')}`);
    }
  }
  return plan;
}

// ---------- 平行构建（不改原数据）----------
function runBuild() {
  const plan = buildPlan();
  const m = plan.m;
  fs.mkdirSync(DEDUP_POEMS, { recursive: true });

  const delPerColl = {}; // collId -> 删除数
  const newV = Date.now();

  // 只读 changedChunks，改写；其余直接拷贝
  const allChunks = [];
  for (const c of m.collections) for (const fn of (c.chunks || [])) allChunks.push({ fn, coll: c.id });

  for (const { fn, coll } of allChunks) {
    const fp = chunkPath(fn);
    if (!fp) { console.log('⚠ 分片缺失:', fn); continue; }
    const outPath = path.join(DEDUP_POEMS, fn);
    if (plan.changedChunks.has(fn)) {
      let arr;
      try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { fs.copyFileSync(fp, outPath); continue; }
      if (!Array.isArray(arr)) { fs.copyFileSync(fp, outPath); continue; }
      const out = [];
      for (const r of arr) {
        if (typeof r.i !== 'number') { out.push(r); continue; }
        if (plan.deleteSet.has(r.i)) { delPerColl[coll] = (delPerColl[coll] || 0) + 1; continue; }
        if (plan.canonF.has(r.i)) {
          const merged = plan.canonF.get(r.i);
          r.f = Object.assign({}, r.f, merged);
        }
        out.push(r);
      }
      fs.writeFileSync(outPath, JSON.stringify(out));
    } else {
      fs.copyFileSync(fp, outPath);
    }
  }

  // 新 manifest
  const nm = JSON.parse(JSON.stringify(m));
  nm.v = newV;
  for (const c of nm.collections) {
    const del = delPerColl[c.id] || 0;
    c.count = c.count - del;
    if (c.visible != null && c.visible === (m.collections.find(x => x.id === c.id).count)) {
      c.visible = c.count;
    } else if (c.visible != null) {
      c.visible = Math.max(0, c.visible - del);
    }
  }
  nm.total = nm.collections.reduce((s, c) => s + c.count, 0);
  const maniOut = path.join(DATA, 'manifest.dedup.json');
  fs.writeFileSync(maniOut, JSON.stringify(nm));

  // remap 文件（供前端重定向用户数据）：与现有 remap 链式合并，避免覆盖第一次去重的重定向
  let remapObj;
  if (fs.existsSync(REMAP_OUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(REMAP_OUT, 'utf8'));
      const merged = {};
      for (const k in plan.remap) merged[k] = plan.remap[k];        // D2：活 i -> 最终保留 i
      const exMap = (existing && existing.map) ? existing.map : {};
      for (const k in exMap) {                                      // D1：旧 i -> D1保留i(可能再被D2删)
        const v1 = exMap[k];
        merged[k] = (plan.remap[v1] !== undefined) ? plan.remap[v1] : v1;
      }
      remapObj = { v: newV, generatedAt: new Date().toISOString(), map: merged };
      console.log('remap 合并    : 现有', Object.keys(exMap).length, '条 + 本次', Object.keys(plan.remap).length,
                  '条 -> 合并', Object.keys(merged).length, '条');
    } catch (e) {
      remapObj = { v: newV, generatedAt: new Date().toISOString(), map: plan.remap };
      console.log('⚠ remap 合并失败，退回本次映射:', e.message);
    }
  } else {
    remapObj = { v: newV, generatedAt: new Date().toISOString(), map: plan.remap };
  }
  fs.writeFileSync(REMAP_OUT, JSON.stringify(remapObj));

  console.log('── 平行构建完成（原数据未动）──');
  console.log('新分片目录    :', DEDUP_POEMS);
  console.log('新 manifest   :', maniOut);
  console.log('remap 文件    :', REMAP_OUT, '(', Object.keys(remapObj.map).length, '条 )');
  console.log('新总数        :', nm.total, '( 原', m.total, '删', plan.deleteSet.size, ' )');
  console.log('新 v          :', newV);
  return { nm, remapObj, delPerColl };
}

// ---------- swap（校验后执行，原数据保留为备份）----------
function runSwap() {
  if (!fs.existsSync(DEDUP_POEMS)) { console.error('✗ 未找到 poems-dedup/，请先 --build'); process.exit(2); }
  if (!fs.existsSync(path.join(DATA, 'manifest.dedup.json'))) { console.error('✗ 未找到 manifest.dedup.json，请先 --build'); process.exit(2); }
  const ts = Date.now();
  const poemsBak = path.join(DATA, `poems-${ts}-bak`);
  const maniBak = path.join(DATA, `manifest.json.bak.${ts}`);
  fs.renameSync(POEMS, poemsBak);
  fs.renameSync(DEDUP_POEMS, POEMS);
  fs.copyFileSync(MANIFEST, maniBak);
  fs.renameSync(path.join(DATA, 'manifest.dedup.json'), MANIFEST);
  console.log('── 已切换（swap）──');
  console.log('原分片备份    :', poemsBak);
  console.log('原 manifest   :', maniBak);
  console.log('当前分片      :', POEMS);
  console.log('当前 manifest :', MANIFEST);
  console.log('如需回滚：把 poems-${ts}-bak  renamed 回 poems，manifest.json.bak.${ts} 还原。');
}

// ---------- 入口 ----------
const arg = process.argv[2] || '--plan';
if (arg === '--plan') runPlan();
else if (arg === '--build') runBuild();
else if (arg === '--swap') runSwap();
else { console.error('用法: node dedup.cjs [--plan|--build|--swap]'); process.exit(2); }
