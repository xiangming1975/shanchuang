// dataset_dedup 对照主库做去重分析（只读主库，不改主库）。
// 判定标准复用主库 merge_cleaned3.cjs 的三级匹配：
//   T1 精确: normKey(t)|normKey(a) 命中主库
//   T2 模糊: baseTitle(t)|normKey(a) 命中且正文 LCP>=15
//   T3 正文: 同作者 + 正文签名 LCP>=阈值(min(24,max(8,floor(min(len,24)*0.9))))
// 用法:
//   node dedup_vs_main.cjs            # 试跑分析，只输出，不改 dataset_dedup
//   node dedup_vs_main.cjs --apply    # 真正删除 dataset_dedup 中的主库重复并记录，重排 id，写回 manifest
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const MAIN_POEMS = path.join(ROOT, 'site', 'data', 'poems');
const MAIN_MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const DEDUP = 'C:/Users/xiang/Downloads/dataset_dedup';
const OUT = path.join(ROOT, 'audit-dedup-out');
fs.mkdirSync(OUT, { recursive: true });

// ---- 规范化（与主库 merge_cleaned3.cjs 完全一致）----
let OpenCC;
try { OpenCC = require(path.join(ROOT, 'etl', 'node_modules', 'opencc-js')); }
catch (e) { try { OpenCC = require('opencc-js'); } catch (e2) { console.log('no opencc'); } }
const convT2S = OpenCC ? OpenCC.Converter({ from: 't', to: 'cn' }) : (s => s);
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
function normKey(s) { let o = ''; for (const ch of String(s || '')) o += convT2S(ch); return o.replace(PUNCT, '').toLowerCase(); }
const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
function baseTitle(s) { return normKey(s).replace(LE, '').replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+首?|\d+首?)$/, ''); }
const RE_VAR = /[（(][^（）()]{0,16}(?:一作|原作|通|同)[^（）()]{0,16}[)）]/g;
function stripHtml(x) { return x == null ? x : String(x).replace(/<[^>]+>/g, ''); }
function stripVar(x) { return x ? x.replace(RE_VAR, '') : x; }
function bodySig(r) {
  let p0 = (r.p && r.p[0]) ? String(r.p[0]) : '';
  if (p0.length > 80) p0 = p0.slice(0, 80); // 限制转换量：只需前 40 归一化字符
  return normKey(stripHtml(stripVar(p0))).slice(0, 40);
}
function lcp(a, b) { let n = 0; const m = Math.min(a.length, b.length); while (n < m && a[n] === b[n]) n++; return n; }
function paraArr(p) { if (Array.isArray(p)) return p; if (typeof p === 'string') return [p]; return []; }
function recKey(r) { return normKey(r.t) + '|' + normKey(r.a); }
function recBase(r) { return baseTitle(r.t) + '|' + normKey(r.a); }
function recSig(r) { return bodySig(r); }

// ---- 建主库索引（只读）----
console.log('[1] 扫描主库建索引 ...');
const mm = JSON.parse(fs.readFileSync(MAIN_MANIFEST, 'utf8'));
const exactSet = new Map();   // key -> {t,a,coll}
const baseMap = new Map();    // baseKey -> [{sig,coll}]
const authSig = new Map();    // author+'|'+prefix20 -> [{sig,coll}]
let scanned = 0;
for (const col of mm.collections) {
  for (const ck of (col.chunks || [])) {
    const fp = path.join(MAIN_POEMS, ck);
    if (!fs.existsSync(fp)) continue;
    let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { continue; }
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      scanned++;
      const k = recKey(r), bk = recBase(r), sg = recSig(r), an = normKey(r.a);
      if (!exactSet.has(k)) exactSet.set(k, { t: r.t, a: r.a, coll: col.id });
      let bl = baseMap.get(bk); if (!bl) { bl = []; baseMap.set(bk, bl); } bl.push({ sig: sg, coll: col.id });
      if (an && sg) {
        const pk = an + '|' + sg.slice(0, 20);
        let al = authSig.get(pk); if (!al) { al = []; authSig.set(pk, al); } al.push({ sig: sg, coll: col.id });
      }
    }
  }
}
console.log(`    主库索引: ${scanned} 条, 唯一精确key ${exactSet.size}, baseKey ${baseMap.size}, authSig前缀 ${authSig.size}`);

// ---- 扫描 dataset_dedup ----
console.log('[2] 扫描 dataset_dedup ...');
const dm = JSON.parse(fs.readFileSync(path.join(DEDUP, 'manifest.json'), 'utf8'));
function listDedupFiles() {
  const out = [];
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const fp=path.join(d,e.name); if(e.isDirectory()) walk(fp); else if(e.name.endsWith('.json')) out.push(fp); } })(path.join(DEDUP,'poems'));
  return out;
}
const files = listDedupFiles().sort();

const perColl = {}; // id -> {total,dup_exact,dup_base,dup_body,keep,internalDup}
const seenInDedup = new Map(); // key -> count (内部重复检测)
let total = 0, dupExact=0, dupBase=0, dupBody=0, keep=0, internalDup=0;
const samples = []; // 抽样的被删记录
const boundarySamples = []; // T2/T3 边界（LCP 接近阈值）样本，供核对误删
for (const fp of files) {
  const base = path.basename(fp);
  const cid = base.replace(/-(\d+)\.json$/, '');
  let arr; try { arr = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e){ continue; }
  if (!Array.isArray(arr)) continue;
  if (!perColl[cid]) perColl[cid] = { total:0, dup_exact:0, dup_base:0, dup_body:0, keep:0, internalDup:0 };
  const pc = perColl[cid];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    total++; pc.total++;
    const k = recKey(r), bk = recBase(r), sg = recSig(r), an = normKey(r.a);
    // 内部重复
    const seen = seenInDedup.get(k) || 0;
    if (seen > 0) { internalDup++; pc.internalDup++; }
    seenInDedup.set(k, seen + 1);
    // 主库匹配
    let tier = 0, matchColl = null, matchLcp = 0;
    if (exactSet.has(k)) { tier = 1; matchColl = exactSet.get(k).coll; }
    else {
      const bl = baseMap.get(bk);
      if (bl) { let best = 0, bc = null; for (const e of bl) { const l = lcp(sg, e.sig); if (l > best) { best = l; bc = e.coll; } } if (best >= 15) { tier = 2; matchColl = bc; matchLcp = best; } }
      if (!tier && an && sg) {
        const al = authSig.get(an + '|' + sg.slice(0, 20));
        if (al) {
          const need = Math.min(24, Math.max(8, Math.floor(Math.min(sg.length, 24) * 0.9)));
          let best = 0, bc = null; for (const e of al) { const l = lcp(sg, e.sig); if (l > best) { best = l; bc = e.coll; } }
          if (best >= need) { tier = 3; matchColl = bc; matchLcp = best; }
        }
      }
    }
    if (tier === 1) { dupExact++; pc.dup_exact++; }
    else if (tier === 2) { dupBase++; pc.dup_base++; }
    else if (tier === 3) { dupBody++; pc.dup_body++; }
    else { keep++; pc.keep++; }
    if (tier && samples.length < 40) samples.push({ coll: cid, tier, matchColl, t: r.t, a: r.a, d: r.d, matchMain: exactSet.has(k)?{t:exactSet.get(k).t,a:exactSet.get(k).a}:null });
    if ((tier === 2 || tier === 3) && matchLcp > 0 && matchLcp <= 24 && boundarySamples.length < 25) boundarySamples.push({ coll: cid, tier, matchLcp, t: r.t, a: r.a, d: r.d, sig: sg });
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'APPLY' : 'DRY',
  mainLibScanned: scanned,
  dedupTotal: total,
  dupExact, dupBase, dupBody,
  dupTotal: dupExact + dupBase + dupBody,
  keep,
  internalDupInDedup: internalDup,
  perColl,
  samples,
  boundarySamples,
};
fs.writeFileSync(path.join(OUT, APPLY ? 'dedup-apply-result.json' : 'dedup-dryrun.json'), JSON.stringify(result, null, 1));

console.log('=== DRY/APPLY SUMMARY ===');
console.log('dedup 总记录:', total);
console.log('命中主库(将被删):', result.dupTotal, ` (精确${dupExact} / 模糊${dupBase} / 正文${dupBody})`);
console.log('保留(新增):', keep);
console.log('dataset_dedup 内部重复(同key>:1):', internalDup);
console.log('--- 每集合 ---');
for (const [id, pc] of Object.entries(perColl)) console.log(`  ${id}: total=${pc.total} 删=${pc.dup_exact+pc.dup_base+pc.dup_body} (E${pc.dup_exact}/B${pc.dup_base}/Y${pc.dup_body}) 留=${pc.keep} 内重=${pc.internalDup}`);
console.log('--- 抽样被删(前20) ---');
for (const s of samples.slice(0,20)) console.log(`  [${s.tier}] ${s.coll} 《${s.t}》${s.a}(${s.d}) -> 主库${s.matchColl}`);
console.log('--- 边界样本(T2/T3, LCP<=24, 供核对误删) ---');
for (const s of boundarySamples) console.log(`  [T${s.tier},LCP${s.matchLcp}] ${s.coll} 《${s.t}》${s.a} sig=${s.sig}`);
console.log('DONE');
