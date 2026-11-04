// 把《中国文学鉴赏辞典大系》EPUB 提取结果（~/Downloads/buchong）并进主库
//
// 用法：
//   node etl/merge-buchong.js --dry     只统计，不写盘
//   node etl/merge-buchong.js           写盘（只填空字段），并升 manifest.v
//   node etl/merge-buchong.js --undo    按日志撤销上一次写入
//
// 为什么不能直接跑 npm run build：etl/out（3.2GB 中间产物）已归档，build.js 跑不起来。
// 这批数据只填 f.z / f.s，不动 id、不动集合、不动索引，所以原地打补丁是安全的；
// 但**必须升 manifest.v**，否则客户端 IDB 里的旧正文会一直命中。
//
// 字段陷阱：
//   buchong 的 f.y 是**原文**（EPUB 没有译文），f.z 是注释，f.s 是赏析。
//   站内 schema 里 f.y 是**译文**。所以只搬 z 和 s，绝不能把 y 写进 f.y，
//   否则详情页会把「原文」当「译文」显示。
//
// 第二个坑：EPUB 的「原文」里混着注释块（〔注〕[1]云梦：…）。拿整段做正文指纹会掉到 0.5，
// 误判成「不是同一首」。指纹只取〔注〕之前的正文；相似度用包含度而不是 Dice，
// 因为补充集的正文常比主库短（词有序、诗有附注）。
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const SITE = path.join(__dirname, '..', 'site');
const POEMS = path.join(SITE, 'data', 'poems');
const MANIFEST = path.join(SITE, 'data', 'manifest.json');
const SRC = 'C:/Users/xiang/Downloads/buchong';
const LOG = path.join(__dirname, 'merge-buchong-log.json');
const REPORT = path.join(__dirname, 'merge-buchong-report.md');

const DRY = process.argv.includes('--dry');
const UNDO = process.argv.includes('--undo');

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const t2s = (s) => (s ? conv(String(s)) : '');
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g;
const MARK = /\[\d+\]|［\d+］|【\d+】|\(\d+\)|（\d+）|[\u2460-\u2473]/g;
const NOTE_CUT = /[〔【〖]\s*注\s*[〕】〗]/;

const stripMarks = (s) => String(s || '').replace(/^\uFEFF/, '').replace(MARK, '');
const norm = (s) => t2s(s).replace(MARK, '').replace(PUNCT, '').toLowerCase();
const clean = (s) => stripMarks(s)
  .replace(/[ \t]+/g, ' ')
  .replace(/\s+([，。；：、！？》」』）])/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
const bodyOf = (y) => norm(String(y || '').split(NOTE_CUT)[0]);
const baseTitle = (s) => norm(s).replace(LE, '')
  .replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+|\d+)$/, '');

function bigrams(s) {
  const a = new Set();
  for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2));
  return a;
}
function contain(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / Math.min(A.size, B.size);
}

function notesOf(rec) {
  const z = clean((rec.f && rec.f.z) || '');
  if (z) return z;
  const y = stripMarks((rec.f && rec.f.y) || '');
  const i = y.search(NOTE_CUT);
  if (i < 0) return '';
  return y.slice(i).replace(NOTE_CUT, '')
    .split(/\[\d+\]/).map(clean).filter(s => s.length >= 4).join('\n').trim();
}

const MIN_S = 30;
const MIN_Z = 8;

if (UNDO) {
  if (!fs.existsSync(LOG)) { console.error('没有日志，无从撤销'); process.exit(1); }
  const log = JSON.parse(fs.readFileSync(LOG, 'utf8'));
  const byChunk = new Map();
  for (const it of log) {
    if (!byChunk.has(it.c)) byChunk.set(it.c, []);
    byChunk.get(it.c).push(it);
  }
  let n = 0;
  for (const [chunk, items] of byChunk) {
    const fp = path.join(POEMS, chunk);
    const rows = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const it of items) {
      const r = rows[it.p];
      if (!r || !r.f) continue;
      for (const k of it.k) { delete r.f[k]; n++; }
      if (!Object.keys(r.f).length) delete r.f;
    }
    fs.writeFileSync(fp, JSON.stringify(rows), 'utf8');
  }
  const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  mf.v = Date.now();
  mf.generatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, JSON.stringify(mf, null, 2), 'utf8');
  console.log(`已撤销 ${n} 个字段，涉及 ${byChunk.size} 个分块`);
  process.exit(0);
}

const idx = new Map();
const byTitle = new Map();   // 标题单独成键：EPUB 有一部分条目把赏析者写进了作者位，作者键永远对不上
const files = fs.readdirSync(POEMS).filter(f => f.endsWith('.json'));
let existing = 0;
for (const f of files) {
  const rows = JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    existing++;
    const body = bodyOf((r.p || []).join(''));
    const a = norm(r.a);
    const item = { chunk: f, pos: i, id: r.i, body };
    for (const k of new Set([norm(r.t) + '|' + a, baseTitle(r.t) + '|' + a])) {
      if (k.startsWith('|')) continue;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(item);
    }
    for (const k of new Set([norm(r.t), baseTitle(r.t)])) {
      if (!k) continue;
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(item);
    }
  }
}
console.log(`主库 ${files.length} 块 / ${existing} 篇，索引 ${idx.size} 键`);

const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const plan = new Map();
const seen = new Set();
const st = {
  buchong: 0, dup: 0, empty: 0, matched: 0, unmatched: 0, rejectPairs: 0, acceptPairs: 0,
  fillS: 0, fillZ: 0, hasS: 0, hasZ: 0, noPair: 0,
  byCol: {}, tgt: {}, rejSample: [], okSample: [],
};

for (const col of mf) {
  for (const chunk of col.chunks) {
    const fp = path.join(SRC, 'poems', chunk);
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(fs.readFileSync(fp, 'utf8'))) {
      st.buchong++;
      const c0 = st.byCol[col.name] || (st.byCol[col.name] = { n: 0, hit: 0, fillS: 0 });
      c0.n++;
      // 这套 EPUB 的 manifest 里既有 17 部分册，也有「套装合集」和「新一版」这类整体重复，
      // 还有 400 多条连正文都没有的空壳。先按「标题+作者+正文头」去重，再谈匹配。
      const bodyN = norm((r.f && r.f.y) || (r.p || []).join(''));
      const sTxt0 = clean((r.f && r.f.s) || '');
      const zTxt0 = clean((r.f && r.f.z) || '');
      // 「空壳」只挡真的什么都没有的：诗经鉴赏辞典那批正文为空、但赏析有 900 字的，
      // 仍然值得按唯一标题补进去（它们的 p 里放的是赏析片段，不是正文）
      if (bodyN.length < 6 && sTxt0.length < 30 && zTxt0.length < 20) { st.empty++; continue; }
      const dk = norm(r.t) + '|' + norm(r.a) + '|' + bodyN.slice(0, 20);
      if (seen.has(dk)) { st.dup++; continue; }
      seen.add(dk);
      const a = norm(r.a);
      let cands = null;
      for (const k of [norm(r.t) + '|' + a, baseTitle(r.t) + '|' + a]) {
        if (idx.has(k)) { cands = idx.get(k); break; }
      }
      if (!cands) {
        // 作者位不可信（「（曹明纲）」这种）时，退回只按标题找，再用正文指纹确认
        // 同一个标题会从 norm(t) 和 baseTitle(t) 两个键各取一次，先按记录去重，
        // 否则「唯一性」判断永远看到两条自己
        const pool = [...new Map(
          [norm(r.t), baseTitle(r.t)].map(k => byTitle.get(k)).filter(Boolean).flat()
            .map(c => [c.chunk + ':' + c.pos, c])
        ).values()];
        if (!pool.length) { st.unmatched++; continue; }
        const sb0 = bodyOf((r.f && r.f.y) || (r.p || []).join(''));
        let strict = sb0 ? pool.filter(c => contain(sb0, c.body) >= 0.75) : [];
        if (strict.length) st.titleOnly = (st.titleOnly || 0) + 1;
        // 最后一档：没有任何正文可比（诗经/楚辞鉴赏辞典那 361 条，p 里放的是赏析片段），
        // 只剩标题可用。要求「整库同标题只有这一条」才认——「葛覃」「卷耳」这种足够唯一，
        // 「无题」「感遇」自然被唯一性挡掉。
        if (!strict.length && !sb0 && pool.length === 1) {
          strict = pool;
          st.weakTitle = (st.weakTitle || 0) + 1;
        }
        if (!strict.length) { st.unmatched++; continue; }
        cands = strict;
      }

      const sb = bodyOf((r.f && r.f.y) || (r.p || []).join(''));
      const sTxt = clean((r.f && r.f.s) || '');
      const zTxt = notesOf(r);
      let took = 0;
      for (const c of cands) {
        const sim = sb ? contain(sb, c.body) : (cands.length === 1 ? 1 : 0);
        if (sim < 0.7) {
          st.rejectPairs++;
          if (st.rejSample.length < 8) st.rejSample.push(`${col.name}·${r.t} ≈${sim.toFixed(2)}`);
          continue;
        }
        st.acceptPairs++;
        took++;
        if (!plan.has(c.chunk)) plan.set(c.chunk, new Map());
        const m = plan.get(c.chunk);
        if (!m.has(c.pos)) m.set(c.pos, []);
        m.get(c.pos).push({ s: sTxt, z: zTxt, src: col.name, title: r.t, sim });
        if (st.okSample.length < 6) st.okSample.push(`${r.t}／${r.a} ≈${sim.toFixed(2)} ← ${col.name}`);
      }
      if (took) { st.matched++; c0.hit++; } else st.noPair++;
    }
  }
}
console.log(`补充集 ${st.buchong} 条：去重 ${st.dup}、空壳 ${st.empty}、实得 ${st.buchong - st.dup - st.empty}`);
console.log(`  其中匹配主库 ${st.matched}（仅按标题 ${st.titleOnly || 0} 条，其中无正文靠唯一标题的 ${st.weakTitle || 0} 条；另 ${st.noPair} 条键匹配但正文对不上），未匹配 ${st.unmatched}`);

const changes = new Map();
for (const [chunk, m] of plan) {
  const rows = JSON.parse(fs.readFileSync(path.join(POEMS, chunk), 'utf8'));
  for (const [pos, adds] of m) {
    const r = rows[pos];
    const f = r.f || {};
    const curS = String(f.s || '').trim();
    const curZ = String(f.z || '').trim();
    const best = adds.slice().sort((x, y) => y.sim - x.sim);
    const sHit = best.find(x => x.s && x.s.length >= MIN_S);
    const zHit = best.find(x => x.z && x.z.length >= MIN_Z);
    const k = [];
    if (!curS && sHit) { k.push('s'); st.fillS++; st.byCol[sHit.src].fillS++; }
    else if (curS) st.hasS++;
    if (!curZ && zHit) { k.push('z'); st.fillZ++; }
    else if (curZ) st.hasZ++;
    if (!k.length) continue;
    if (!changes.has(chunk)) changes.set(chunk, []);
    const ck = chunk.split('-')[0];
    st.tgt[ck] = (st.tgt[ck] || 0) + 1;
    changes.get(chunk).push({ pos, k, s: sHit && sHit.s, z: zHit && zHit.z, title: r.t, id: r.i });
  }
}
console.log(`要改 ${changes.size} 个分块：补赏析 ${st.fillS} 处、补注释 ${st.fillZ} 处`);
console.log(`（已有赏析 ${st.hasS} 处、已有注释 ${st.hasZ} 处，不动）`);
console.log('落到哪些集合：', Object.entries(st.tgt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '));

if (DRY) {
  console.log('\n样本（补赏析）：');
  let n = 0;
  outer:
  for (const [chunk, items] of changes) {
    const rows = JSON.parse(fs.readFileSync(path.join(POEMS, chunk), 'utf8'));
    for (const it of items) {
      if (n++ >= 5) break outer;
      console.log(`· ${rows[it.pos].t}／${rows[it.pos].a} id=${it.id} [${it.k}] ${String(it.s || it.z).slice(0, 60)}…`);
    }
  }
  console.log('\n匹配正例：', st.okSample.join(' | '));
  console.log(`指纹拒绝 ${st.rejectPairs} 对，样例：`, st.rejSample.join(' | '));
  console.log('\nDRY 模式，未写盘');
  process.exit(0);
}

const log = [];
let touched = 0;
for (const [chunk, items] of changes) {
  const fp = path.join(POEMS, chunk);
  const rows = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const it of items) {
    const r = rows[it.pos];
    if (!r.f) r.f = {};
    for (const k of it.k) {
      if (String(r.f[k] || '').trim()) continue;
      r.f[k] = k === 's' ? it.s : it.z;
    }
    log.push({ c: chunk, p: it.pos, i: it.id, k: it.k });
    touched++;
  }
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows), 'utf8');
  fs.renameSync(tmp, fp);
}
fs.writeFileSync(LOG, JSON.stringify(log), 'utf8');

const mf2 = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
mf2.v = Date.now();
mf2.generatedAt = new Date().toISOString();
fs.writeFileSync(MANIFEST, JSON.stringify(mf2, null, 2), 'utf8');

const lines = [];
lines.push('# 鉴赏辞典合并报告', '');
lines.push(`写入 ${touched} 处（赏析 ${st.fillS} / 注释 ${st.fillZ}），涉及 ${changes.size} 个分块。`, '');
lines.push('| 集合 | 篇数 | 命中主库 | 补赏析 |', '| --- | ---: | ---: | ---: |');
for (const [k, v] of Object.entries(st.byCol).sort((a, b) => b[1].fillS - a[1].fillS)) {
  lines.push(`| ${k} | ${v.n} | ${v.hit} | ${v.fillS} |`);
}
lines.push('', `未匹配 ${st.unmatched} 篇（主库没有这个体裁/篇目），指纹拒绝 ${st.rejectPairs} 对。`, '');
fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');

console.log(`✓ 写入 ${touched} 处，日志 ${LOG}`);
console.log(`✓ manifest.v 升到 ${mf2.v}`);
console.log(`✓ 报告 ${REPORT}`);
