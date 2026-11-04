// 把 data_2026-10-29/cleaned3 并入主库（site/data/poems + manifest.json）
// 策略（用户确认）：匹配回填 + 未匹配追加；other 新增为独立集合。
// 不改动任何既有 id；仅在集合末尾追加新诗。
//
// 用法：
//   node etl/merge_cleaned3.cjs           # 试运行（只打印计划，不改文件）
//   node etl/merge_cleaned3.cjs --apply   # 真正执行
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');

const ROOT = __dirname;
const SITE = path.join(ROOT, '..', 'site');
const POEMS = path.join(SITE, 'data', 'poems');
const MANIFEST = path.join(SITE, 'data', 'manifest.json');
const CLEANED3 = path.join(ROOT, '..', 'data_2026-10-29', 'cleaned3');
const CHUNK = 200;

let OpenCC;
try { OpenCC = require(path.join(ROOT, 'node_modules', 'opencc-js')); }
catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) { console.log('no opencc:', e2.message); } }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);

const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s) { let o = ''; for (const ch of String(s || '')) o += convT2S(ch); return o.replace(PUNCT, '').toLowerCase(); }
const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
function baseTitle(s) {
  return normKey(s).replace(LE, '')
    .replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+首?|\d+首?)$/, '');
}
function bodySig(r) { const p0 = (r.p && r.p[0]) ? String(r.p[0]) : ''; return normKey(stripHtml(stripVar(p0))).slice(0, 40); }
function lcp(a, b) { let n = 0; const m = Math.min(a.length, b.length); while (n < m && a[n] === b[n]) n++; return n; }

// 异文校记括号（含「一作/原作/通/同」）：古诗文网把异文混进正文，删掉
const RE_VAR = /[（(][^（）()]{0,16}(?:一作|原作|通|同)[^（）()]{0,16}[)）]/g;
function stripVar(x) { return x ? x.replace(RE_VAR, '') : x; }
function stripHtml(x) { return x == null ? x : String(x).replace(/<[^>]+>/g, ''); }
function stripSpaces(x) { return x == null ? x : String(x).replace(/[ \u00a0\u3000\u200b\t]/g, ''); }
function cleanP(x) { return stripSpaces(stripVar(x)); }

function fHas(v) { if (v == null || v === '') return false; if (typeof v === 'string') return v.trim().length > 0; if (Array.isArray(v)) return v.some(fHas); if (typeof v === 'object') return Object.keys(v).length > 0; return true; }

// ---------- 读 cleaned3 ----------
const c3mf = JSON.parse(fs.readFileSync(path.join(CLEANED3, 'manifest.json'), 'utf8'));
const c3 = []; // {collId, t,a,d,p,tg, f:{y,z,s}, key, bp, fy,fz,fs}
for (const col of c3mf.collections) {
  for (const chunk of col.chunks) {
    const fp = path.join(CLEANED3, 'poems', chunk);
    if (!fs.existsSync(fp)) continue;
    let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
    for (const r of arr) {
      const f = r.f && typeof r.f === 'object' ? r.f : {};
      const a = normKey(r.a), t = normKey(r.t);
      c3.push({
        collId: col.id, t: r.t, a: r.a, d: r.d, p: (r.p || []).map(cleanP),
        tg: Array.isArray(r.tg) ? r.tg : [],
        fy: fHas(f.y) ? f.y : '', fz: fHas(f.z) ? f.z : '', fs: fHas(f.s) ? f.s : '',
        key: t + '|' + a, baseKey: baseTitle(r.t) + '|' + a, sig: bodySig(r),
      });
    }
  }
}
console.log(`cleaned3 载入 ${c3.length} 条`);

// ---------- 建主库索引（仅位置 + 轻量签名，不存全文） ----------
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const collSet = new Set(manifest.collections.map(c => c.id));
const liveIndex = new Map(); // key -> [{collId, file, idx, baseKey, sig, hasF:{y,z,s}}]
const liveByAuthor = new Map(); // author(norm) -> [{collId, file, idx, sig, hasF}]
let scanned = 0;
for (const col of manifest.collections) {
  for (const ck of col.chunks) {
    const fp = path.join(POEMS, ck);
    if (!fs.existsSync(fp)) continue;
    let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
    for (let idx = 0; idx < arr.length; idx++) {
      const r = arr[idx];
      if (!r || typeof r !== 'object') continue;
      scanned++;
      const key = normKey(r.t) + '|' + normKey(r.a);
      const f = r.f && typeof r.f === 'object' ? r.f : {};
      const rec = { collId: col.id, file: ck, idx, baseKey: baseTitle(r.t) + '|' + normKey(r.a), sig: bodySig(r), hasF: { y: fHas(f.y), z: fHas(f.z), s: fHas(f.s) } };
      let list = liveIndex.get(key); if (!list) { list = []; liveIndex.set(key, list); } list.push(rec);
      const an = normKey(r.a);
      if (an) { let al = liveByAuthor.get(an); if (!al) { al = []; liveByAuthor.set(an, al); } al.push(rec); }
    }
  }
}
console.log(`主库索引 ${scanned} 条, 唯一 key ${liveIndex.size}`);

// ---------- 匹配：回填目标 + 新诗 ----------
// 精确 key(题|作者) 命中：题名+作者完全一致，足以定位同一首诗，直接回填所有候选
//   （原始/全集副本的题面格式常与精校副本不同，不应再用正文相似度把它们过滤掉）。
//   仅填目标缺失的字段；多来源取更长内容。
// 模糊 baseKey(去序号题|作者) 命中（处理「行路难三首」vs「行路难·其一」分组/拆分）：
//   用正文 LCP≥15 确认是同一首，避免同题不同诗的误填。
function pickByKey(rec, cands) { return (cands && cands.length) ? cands.slice() : []; }
function pickByBase(rec, cands) {
  if (!cands || !cands.length) return [];
  return cands.map(c => ({ c, s: lcp(rec.sig, c.sig) })).filter(x => x.s >= 15).map(x => x.c);
}
// 第三层：题名不同但同作者+正文强相似（处理「题名异文/别名」导致的漏匹配）。
// 阈值：长诗要求重叠≥24 字符；短诗要求覆盖较短签名的 90%，避免常见起句误判。
function pickByBody(rec, cands) {
  if (!cands || !cands.length) return [];
  const need = Math.min(24, Math.max(8, Math.floor(Math.min(rec.sig.length, 24) * 0.9)));
  return cands.map(c => ({ c, s: lcp(rec.sig, c.sig) })).filter(x => x.s >= need).map(x => x.c);
}
const fillTargets = new Map(); // file -> Map(idx -> {y,z,s})
const newByColl = {};          // collId -> [c3rec]
let stat = { fill: 0, fillFields: { y: 0, z: 0, s: 0 }, new: 0, newByColl: {}, baseOnlyUsed: 0 };

for (const rec of c3) {
  let chosen = pickByKey(rec, liveIndex.get(rec.key));
  if (!chosen.length) chosen = pickByBase(rec, liveIndex.get(rec.baseKey));
  if (!chosen.length) chosen = pickByBody(rec, liveByAuthor.get(normKey(rec.a)));
  if (!chosen.length) { (newByColl[rec.collId] = newByColl[rec.collId] || []).push(rec); stat.new++; continue; }
  for (const c of chosen) {
    let m = fillTargets.get(c.file); if (!m) { m = new Map(); fillTargets.set(c.file, m); }
    let fld = m.get(c.idx); if (!fld) { fld = { y: '', z: '', s: '' }; m.set(c.idx, fld); }
    if (!c.hasF.y && rec.fy && rec.fy.length > fld.y.length) fld.y = rec.fy;
    if (!c.hasF.z && rec.fz && rec.fz.length > fld.z.length) fld.z = rec.fz;
    if (!c.hasF.s && rec.fs && rec.fs.length > fld.s.length) fld.s = rec.fs;
  }
  stat.fill++;
}
for (const m of fillTargets.values()) for (const fld of m.values()) {
  if (fld.y) stat.fillFields.y++; if (fld.z) stat.fillFields.z++; if (fld.s) stat.fillFields.s++;
}
for (const [k, v] of Object.entries(newByColl)) stat.newByColl[k] = v.length;

console.log(`\n=== 计划 ===`);
console.log(`回填条数(诗的记录数): ${stat.fill}`);
console.log(`  将写入 译文:${stat.fillFields.y} 注释:${stat.fillFields.z} 赏析:${stat.fillFields.s}（仅填缺失字段）`);
console.log(`新增诗(无匹配): ${stat.new} 按集合:`, JSON.stringify(stat.newByColl));
console.log(`受影响需改写的块文件: ${fillTargets.size} 个（回填）`);

if (!APPLY) {
  console.log('\n[DRY RUN] 未改动任何文件。加 --apply 执行。');
  process.exit(0);
}

// ================= 执行 =================
console.log('\n--- 执行回填 ---');
let fillFiles = 0, fillRecs = 0;
for (const [file, m] of fillTargets) {
  const fp = path.join(POEMS, file);
  let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { console.log('跳过(读失败)', file, e.message); continue; }
  let touched = false;
  for (const [idx, fld] of m) {
    const r = arr[idx]; if (!r) continue;
    const f = Object.assign({}, r.f || {});
    let ch = false;
    if (fld.y && !fHas(f.y)) { f.y = fld.y; ch = true; stat.fillFields.y && 0; }
    if (fld.z && !fHas(f.z)) { f.z = fld.z; ch = true; }
    if (fld.s && !fHas(f.s)) { f.s = fld.s; ch = true; }
    if (ch) { if (Object.keys(f).length) r.f = f; else delete r.f; touched = true; fillRecs++; }
  }
  if (touched) { fs.writeFileSync(fp, JSON.stringify(arr)); fillFiles++; }
}
console.log(`回填完成：改写 ${fillFiles} 个块文件, ${fillRecs} 条记录被补入释文`);

// 新增诗：本库 id 为「按集合连续全局 id」，不能安全插入到中间集合——
// 会破坏 start/count 路由（store.js 用二分按 start 定位集合），且需重排后续全部 id（破坏收藏）。
// 因此把未命中的新诗，按来源集合分别建成「位于末尾的新集合」，id 从全局最大 id 之后顺序分配，绝不冲突。
console.log('\n--- 执行追加（新建末尾集合，安全不重排）---');
let globalMax = 0;
for (const c of manifest.collections) for (const ck of c.chunks) {
  const fp = path.join(POEMS, ck); if (!fs.existsSync(fp)) continue;
  let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
  for (const r of arr) if (typeof r.i === 'number' && r.i > globalMax) globalMax = r.i;
}
let nextId = globalMax + 1;
const collIdUsed = new Set(manifest.collections.map(c => c.id));
for (const [collId, recs] of Object.entries(newByColl)) {
  if (!recs.length) continue;
  const c3col = c3mf.collections.find(c => c.id === collId) || { id: collId, name: collId, tab: '全集' };
  let newId = collId === 'other' ? 'other' : `${collId}_new`;
  while (collIdUsed.has(newId)) newId = newId + '_';
  collIdUsed.add(newId);
  const chunks = []; let count = 0, ci = 0; let pending = recs.slice();
  while (pending.length) {
    const take = pending.splice(0, CHUNK);
    const name = `${newId}-${String(ci).padStart(4, '0')}.json`;
    const arr = [];
    for (let j = 0; j < take.length; j++) arr.push(makeRec(take[j], nextId + count + j));
    count += take.length;
    fs.writeFileSync(path.join(POEMS, name), JSON.stringify(arr));
    chunks.push(name); ci++;
  }
  const entry = {
    id: newId,
    name: collId === 'other' ? c3col.name : (c3col.name + '（新增）'),
    tab: c3col.tab || '全集',
    desc: (c3col.desc || '') + '（cleaned3 未在主库命中的新诗）',
    start: nextId, count, visible: count, chunks,
  };
  manifest.collections.push(entry);
  nextId += count;
  console.log(`新集合 ${newId}: start=${entry.start}, count=${count}, 块=${chunks.length}`);
}

function makeRec(rec, i) {
  const o = { i, t: rec.t, a: rec.a, d: rec.d, p: rec.p };
  if (rec.tg && rec.tg.length) o.tg = rec.tg;
  const f = {};
  if (rec.fy) f.y = rec.fy;
  if (rec.fz) f.z = rec.fz;
  if (rec.fs) f.s = rec.fs;
  if (Object.keys(f).length) o.f = f;
  return o;
}

// 仅更新 total / 版本号。既有集合的 start/count/chunks 一律不动（保证 id 与路由不变）。
manifest.total = nextId;
manifest.v = Date.now();
manifest.generatedAt = new Date().toISOString();
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`manifest 更新：total=${manifest.total}, 集合数=${manifest.collections.length}`);
console.log('MERGE_DONE');
