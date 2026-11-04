// 构建飞花令句库：site/data/idx/fh/<令字>.json —— [[分句(原文含句读), 诗id], ...]
//
// 为什么要有它（2026-10-31，用户实测反馈「我寄愁心与明月」查不到）：
//   ft 全文语料（idx/ft/*，搜索正文用）对《全唐诗》《全宋诗》只收名家名篇子集
//   （build.js 的 FULLTEXT_FAMOUS：r.f 或 jd>=500，全唐诗 56255 首只收 5062 首），
//   只收录于《全唐诗》的句子在 ft 里根本不存在，飞花令旧版扫 ft 永远查不到。
//   本脚本改为从**全部集合的正文块**（data/poems/*.json）抽句，全库覆盖；
//   且按 20 个令字分文件——游戏一次只下载当前令字的一份（约 1–3MB），
//   不用再逐个扫 41 个 ft 分片（36MB）。
//
// 抽句规则与 site/js/views/feihua.js 的 fhSentences 严格一致：
//   按 LINE_BREAK 分句、\n 重置、3–24 字（含句读）、含任一令字（简繁写法都算）。
//   令字清单从 feihua.js 的 FEI_CHARS 正则提取（单一事实源，改字后重跑本脚本）。
//   简繁写法用 idx/s2t.json / t2s.json 单字表互推。
//
// 去重：同一分句跨集合/跨令字只留第一次遇到的（manifest 集合顺序遍历，
//   精选本在前，出处自然偏向《唐诗三百首》这类选本）。
//
// 重跑本脚本后：feihua.js 的 FH_R +1（绕开 IndexedDB 里的旧句库缓存）。
// 用法：node etl/build-fhsents.cjs
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const POEMS = path.join(SITE, 'data', 'poems');
const OUT = path.join(SITE, 'data', 'idx', 'fh');

// 令字单一事实源：feihua.js
const feiSrc = fs.readFileSync(path.join(SITE, 'js', 'views', 'feihua.js'), 'utf8');
const feiMatch = feiSrc.match(/const FEI_CHARS = \[([^\]]*)\]/);
if (!feiMatch) throw new Error('feihua.js 里找不到 FEI_CHARS 定义');
const FEI_CHARS = [...feiMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
if (FEI_CHARS.length !== 20) throw new Error('FEI_CHARS 应为 20 字，实得 ' + FEI_CHARS.length);

// 每个令字的可匹配写法（简+繁）
const S2T = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'idx', 's2t.json'), 'utf8'));
const T2S = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'idx', 't2s.json'), 'utf8'));
const writingsOf = {};
for (const c of FEI_CHARS) writingsOf[c] = [...new Set([c, T2S[c] || c, S2T[c] || c])];

// 抽句：与 fhSentences 同规则
const LB = /[，、：。？！；…—]/;
function* sents(content) {
  let buf = '';
  for (const ch of String(content || '')) {
    if (ch === '\n' || ch === '\r') { buf = ''; continue; }
    buf += ch;
    if (!LB.test(ch)) continue;
    const s = buf.trim();
    const n = [...s].length;
    if (n >= 3 && n <= 24) yield s;
    buf = '';
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'manifest.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const byChar = new Map(FEI_CHARS.map(c => [c, []]));   // 令字 → [[句, id], ...]
const seen = new Set();                                 // 令字 \0 句 → 已收
let poems = 0, skippedHidden = 0;

for (const coll of manifest.collections) {
  for (const chunk of (coll.chunks || [])) {
    const f = path.join(POEMS, chunk);
    if (!fs.existsSync(f)) { console.log('缺块跳过: ' + chunk); continue; }
    let rows;
    try { rows = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log('坏块跳过: ' + chunk); continue; }
    for (const r of rows) {
      if (!r || !r.p || !r.p.length) continue;
      if (r.hide) { skippedHidden++; continue; }
      poems++;
      const content = r.p.join('\n');
      for (const s of sents(content)) {
        for (const c of FEI_CHARS) {
          if (!writingsOf[c].some(w => s.includes(w))) continue;
          const key = c + '\u0000' + s;
          if (seen.has(key)) continue;
          seen.add(key);
          byChar.get(c).push([s, r.i]);
        }
      }
    }
  }
}

const sizes = {};
let total = 0;
for (const c of FEI_CHARS) {
  const rows = byChar.get(c);
  total += rows.length;
  const json = JSON.stringify(rows);
  fs.writeFileSync(path.join(OUT, c + '.json'), json);
  sizes[c] = { n: rows.length, mb: +(json.length / 1048576).toFixed(2) };
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, r: 1, chars: FEI_CHARS, total, sizes }));
const mb = Object.values(sizes).reduce((s, x) => s + x.mb, 0);
console.log(`飞花令句库: ${poems} 首（另跳过下线 ${skippedHidden} 首）→ ${total} 句 / ${FEI_CHARS.length} 个令字文件，共 ${mb.toFixed(1)}MB`);
for (const c of FEI_CHARS) console.log(`  ${c}: ${sizes[c].n} 句 ${sizes[c].mb}MB`);
