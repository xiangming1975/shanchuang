#!/usr/bin/env node
/**
 * audit-schema.cjs — 主库数据结构与字段合规审计（只读）
 *
 * 依据《数据结构-f字段说明.md》的规格逐条核对：
 *   1) 记录 schema：必备字段/类型
 *   2) 分块不变量：块号 = id 区块号；count 与磁盘记录数一致
 *   3) 正文质量：HTML 残留、全角空格、控制字符、过碎/过整
 *   4) 释文质量：f.y 即原文、脚注序号残留、f 空壳、卡片串台
 *   5) 作者/题名：括号作者、书名号、序号后缀
 *   6) 重复：正文指纹 / 标题+作者
 */
'use strict';
const fs = require('fs');
const path = require('path');

const POEMS = 'site/data/poems';
const MANIFEST = 'site/data/manifest.json';
const PER_CHUNK = 200;

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const BAD = { htmlP: 0, htmlF: 0, htmlT: 0, fullSpace: 0, ctrl: 0 };
const F = { none: 0, empty: 0, y_is_p: 0, z_fn: 0, s_fn: 0, tooShort: 0, total: 0, y: 0, z: 0, s: 0, b: 0 };
const P = { none: 0, oneLong: 0, huge: 0, short: 0 };
const A = { bracket: 0, empty: 0, spaced: 0 };
const T = { bookquote: 0, ordinal: 0, spaced: 0, empty: 0, long: 0 };
const CHUNK = { idOutside: 0, countMismatch: [], chunkLenNot200: 0 };
const HIDE = { n: 0 };
const DUP = { bySig: 0 };
const samples = { htmlP: [], y_is_p: [], z_fn: [], a_bracket: [], t_bookquote: [], idOutside: [], oneLong: [] };

const sigMap = new Map();
let totalRec = 0;
const collectStats = [];

const HA = /[\u3400-\u9fff]/;
const htmlRe = /<\/?[a-zA-Z][^>]*>/;

function countHan(s) { let n = 0; for (const c of String(s)) if (HA.test(c)) n++; return n; }

for (const col of manifest.collections) {
  let recCount = 0;
  let badId = 0;
  let notFull = 0;
  let hideN = 0;
  for (let k = 0; k < col.chunks.length; k++) {
    const fp = path.join(POEMS, col.chunks[k]);
    if (!fs.existsSync(fp)) { continue; }
    let arr;
    try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
    if (arr.length !== PER_CHUNK) notFull++;
    const lo = col.start + k * PER_CHUNK;
    const hi = lo + PER_CHUNK;   // [lo, hi)
    for (const r of arr) {
      totalRec++; recCount++;
      const i = r.i;
      if (!(i >= lo && i < hi)) {
        badId++;
        if (samples.idOutside.length < 5) samples.idOutside.push(`${col.id} ${col.chunks[k]} i=${i} 期望[${lo},${hi})`);
      }
      if (r.hide) { hideN++; HIDE.n++; }

      // ---- 正文 ----
      const p = Array.isArray(r.p) ? r.p : null;
      if (!p || !p.length) P.none++; else {
        const joined = p.join('\n');
        if (htmlRe.test(joined)) { BAD.htmlP++; if (samples.htmlP.length < 5) samples.htmlP.push(`${col.id}#${i} ${joined.slice(0, 80)}`); }
        if (/[\u3000\u00a0\u200b]/.test(joined)) BAD.fullSpace++;
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(joined)) BAD.ctrl++;
        const han = countHan(joined);
        if (p.length === 1 && han > 60) { P.oneLong++; if (samples.oneLong.length < 5) samples.oneLong.push(`${col.id}#${i} ${r.t} ${han}字`); }
        if (p.some(x => countHan(x) > 2000)) P.huge++;
        if (han < 10) P.short++;
      }

      // ---- 题名 ----
      const t = String(r.t || '');
      if (!t) T.empty++;
      if (/[《》]/.test(t)) { T.bookquote++; if (samples.t_bookquote.length < 5) samples.t_bookquote.push(`${col.id}#${i} ${t}`); }
      if (/[其一其二其三]$|其[一二三四五六七八九十]+$/.test(t)) T.ordinal++;
      if (/\s/.test(t.trim()) && /\S\s+\S/.test(t.trim())) T.spaced++;
      if (t.length > 60) T.long++;

      // ---- 作者 ----
      const a = String(r.a || '');
      if (!a) A.empty++;
      else {
        if (/^[（(]/.test(a)) { A.bracket++; if (samples.a_bracket.length < 5) samples.a_bracket.push(`${col.id}#${i} ${t} / ${a}`); }
        if (/\s/.test(a.trim())) A.spaced++;
      }

      // ---- 释文 f ----
      if (r.f && typeof r.f === 'object') {
        F.total++;
        const f = r.f;
        const keys = ['y', 'z', 's', 'b'].filter(k => f[k] != null && String(f[k]).trim() !== '');
        if (!keys.length) F.empty++;
        for (const k of keys) F[k]++;
        const fy = f.y ? String(f.y) : '';
        const fz = f.z ? String(f.z) : '';
        const fsx = f.s ? String(f.s) : '';
        if (fy && p) {
          // f.y 与正文重合度（按汉字集合近似）
          const pj = p.join('');
          let same = 0, n = 0;
          for (const c of fy) if (HA.test(c)) { n++; if (pj.includes(c)) same++; }
          if (n > 10 && same / n > 0.9) { F.y_is_p++; if (samples.y_is_p.length < 5) samples.y_is_p.push(`${col.id}#${i} ${t}`); }
        }
        if (/[\[［]\d+[\]］]|[①-⑳]|〔注〕/.test(fz)) { F.z_fn++; if (samples.z_fn.length < 5) samples.z_fn.push(`${col.id}#${i} ${t} ${fz.slice(0, 60)}`); }
        if (/[\[［]\d+[\]］]|[①-⑳]/.test(fsx)) F.s_fn++;
        if (fz && countHan(fz) < 4) F.tooShort++;
      } else F.none++;

      // ---- 重复指纹 ----
      if (p && p.length && !r.hide) {
        const sig = p.join('').replace(/[\s\u3000，。、；：？！"''""（）()《》〈〉,.;:!?\-—…·]/g, '');
        if (sig.length >= 12) {
          const prev = sigMap.get(sig);
          if (prev) DUP.bySig++; else sigMap.set(sig, col.id + '#' + i);
        }
      }
    }
  }
  collectStats.push({ id: col.id, manifestCount: col.count, disk: recCount, badId, notFull, hide: hideN });
}

const sumCount = manifest.collections.reduce((s, c) => s + c.count, 0);

const out = {
  meta: {
    collections: manifest.collections.length,
    manifestTotal: manifest.total,
    sumCount,
    diskRecords: totalRec,
    uniqueBodies: sigMap.size,
    hideRecords: HIDE.n,
  },
  chunkInvariant: {
    recordsWithIdOutsideBlock: CHUNK.idOutside || collectStats.reduce((s, c) => s + c.badId, 0),
    collectionsWithCountMismatch: collectStats.filter(c => c.disk !== c.manifestCount).map(c => ({ id: c.id, count: c.manifestCount, disk: c.disk, diff: c.manifestCount - c.disk })),
    chunksNotFull: collectStats.reduce((s, c) => s + c.notFull, 0),
  },
  body: { missing: P.none, singleElementOver60Han: P.oneLong, elementOver2000Han: P.huge, bodyUnder10Han: P.short, htmlTag: BAD.htmlP, fullwidthOrInvisibleSpace: BAD.fullSpace, controlChar: BAD.ctrl },
  fField: { recordsWithF: F.total, emptyFObject: F.empty, noF: F.none, y: F.y, z: F.z, s: F.s, b: F.b, yLooksLikeBody: F.y_is_p, zHasFootnoteMark: F.z_fn, sHasFootnoteMark: F.s_fn, zUnder4Han: F.tooShort },
  author: { empty: A.empty, startsWithBracket: A.bracket, hasInnerSpace: A.spaced },
  title: { empty: T.empty, hasBookQuote: T.bookquote, endsWithOrdinal: T.ordinal, hasInnerSpace: T.spaced, over60Chars: T.long },
  duplicates: { sameBodySignature: DUP.bySig },
  samples,
};

fs.writeFileSync('audit-out/schema-audit.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
