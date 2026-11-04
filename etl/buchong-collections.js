// 把《鉴赏辞典》里主库没有的作品，整理成三个新集合的源文件 etl/out/poems-buchong.jsonl
//
// 为什么分三个集合而不是一个：**版面规则是按集合 id 写死的**（vcommon 的 PROSE_SET / CI_SET / PAIR_SET）。
// 诗、词、古文放在同一个集合里，只能套一种折行规则，另外两种必然难看。
//
// 收什么 / 不收什么：
//   收：诗（唐诗·宋诗·汉魏·先秦·元明清诗·女性诗词）、词（唐宋词·宋词·元明清词）、古文（古文·赋·元曲）
//   不收：志怪/唐宋/明清小说 754、明清传奇 92、新诗 326、二十四史 155 —— 长篇小说、戏曲脚本、现代自由诗，
//         与「读一首」的场景不合，且要另配版面规则。这 1,327 篇单独记账，不混进来。
//
// 用法：node etl/buchong-collections.js   → 写 etl/out/poems-buchong.jsonl
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const SITE = path.join(__dirname, '..', 'site');
const POEMS = path.join(SITE, 'data', 'poems');
// 源目录可用第一个命令行参数覆盖：node etl/buchong-collections.js <数据集目录>
const SRC = process.argv[2] || 'C:/Users/xiang/Downloads/buchong';
const OUT = path.join(__dirname, 'out', 'poems-buchong.jsonl');

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const t2s = (s) => (s ? conv(String(s)) : '');
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g;
const MARK = /\[\d+\]|［\d+］|【\d+】|\(\d+\)|（\d+）|[\u2460-\u2473]/g;
const NOTE_CUT = /[〔【〖]\s*注\s*[〕】〗]/;
const norm = (s) => t2s(s).replace(MARK, '').replace(PUNCT, '').toLowerCase();
const clean = (s) => String(s || '').replace(/^\uFEFF/, '').replace(MARK, '')
  .replace(/[ \t]+/g, ' ').replace(/\s+([，。；：、！？》」』）])/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)/;
const baseTitle = (s) => norm(s).replace(LE, '')
  .replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+|\d+)$/, '');
const bodyOf = (y) => norm(String(y || '').split(NOTE_CUT)[0]);

function bigrams(s) { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; }
function contain(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return hit / Math.min(A.size, B.size);
}

// 集合名 → 目标集合（含体裁归类）
const MAP = [
  [/^唐诗鉴赏|^宋诗鉴赏|^汉魏六朝诗|^先秦诗鉴赏|^元明清诗鉴赏|^历代女性诗词/, 'jsshi'],
  [/^唐宋词鉴赏|^宋词鉴赏|^元明清词/, 'jssci'],
  [/^古文鉴赏|^历代赋鉴赏/, 'jsswen'],
  [/^元曲鉴赏|^明清散曲/, 'jssci'],   // 曲与词共用「韵句一行」的版面
  [/^诗经楚辞/, 'jsshi'],           // 诗经/楚辞条目按诗处理；主库已有的会先被匹配掉
];
const SKIP = /小说|传奇|新诗|二十四史|套装|宋词鉴赏辞典：新一版|唐诗宋词元曲古文/;
function target(name) {
  if (SKIP.test(name)) return null;
  for (const [re, id] of MAP) if (re.test(name)) return id;
  return null;
}

(async () => {
  // 主库键集合（标题+作者），用来排除已有的
  const idx = new Set();
  for (const f of fs.readdirSync(POEMS).filter(x => x.endsWith('.json'))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'))) {
      const a = norm(r.a);
      idx.add(norm(r.t) + '|' + a);
      idx.add(baseTitle(r.t) + '|' + a);
    }
  }

  // 追加模式：文件里已有的作品**原样保留**——重建按顺序编号，删一条后面 id 全前移，
  // 用户收藏/背诵/眉批会整体错位。新作品只能接在文件末尾。
  let keep = [];
  const seen = new Set();   // 标题|作者|正文头：既挡文件内重复，也挡数据集内重复
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let r;
      try { r = JSON.parse(t); } catch { continue; }
      keep.push(t);
      seen.add(norm(r.t) + '|' + norm(r.a) + '|' + norm((r.p || []).join('')).slice(0, 20));
    }
    console.log(`已有 ${keep.length} 条，按追加模式处理`);
  }

  const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const out = fs.createWriteStream(OUT + '.tmp', { encoding: 'utf8' });
  for (const line of keep) out.write(line + '\n');
  const count = {};
  let scanned = 0, dup = 0, empty = 0, skipped = 0, matched = 0, wrote = 0, noauthor = 0;

  for (const col of mf) {
    const to = target(col.name);
    for (const chunk of col.chunks) {
      const fp = path.join(SRC, 'poems', chunk);
      if (!fs.existsSync(fp)) continue;
      for (const r of JSON.parse(fs.readFileSync(fp, 'utf8'))) {
        scanned++;
        if (!to) { skipped++; continue; }
        const y = (r.f && r.f.y) || '';
        const bodyN = norm(y || (r.p || []).join(''));
        if (bodyN.length < 6) { empty++; continue; }
        const dk = norm(r.t) + '|' + norm(r.a) + '|' + bodyN.slice(0, 20);
        if (seen.has(dk)) { dup++; continue; }
        seen.add(dk);
        const a = norm(r.a);
        if (idx.has(norm(r.t) + '|' + a) || idx.has(baseTitle(r.t) + '|' + a)) { matched++; continue; }
        // 这套 EPUB 有一部分条目把「赏析作者」写进了作者位（「（曹明纲）」），原作者丢失；
        // 还有 400 多条根本没有作者（多是「领字」「减字偷声」这类词学名词条目）。
        // 署名错的条目宁可不收——挂上别人的名字比缺一首更糟。
        if (!r.a || !String(r.a).trim() || /^[（(]/.test(String(r.a).trim())) { noauthor++; continue; }

        // 正文：掐掉〔注〕块，按行拆；顺手去掉注释序号
        const bodyRaw = String(y || (r.p || []).join('\n')).split(NOTE_CUT)[0];
        const p = bodyRaw.split('\n').map(clean).filter(x => x.length > 1);
        if (!p.length) { empty++; continue; }

        const tidy = (x) => clean(x).replace(/(?<=[\u4e00-\u9fff])[ \u3000]+(?=[\u4e00-\u9fff])/g, '');
        const rec = { c: to, t: tidy(r.t), a: tidy(r.a), d: clean(r.d), p, tg: ['鉴赏辞典'] };
        const f = {};
        const z = clean((r.f && r.f.z) || '');
        const s = clean((r.f && r.f.s) || '');
        if (z) f.z = z;
        if (s) f.s = s;
        if (Object.keys(f).length) rec.f = f;
        out.write(JSON.stringify(rec) + '\n');
        count[to] = (count[to] || 0) + 1;
        wrote++;
      }
    }
  }
  await new Promise(res => out.end(res));
  fs.renameSync(OUT + '.tmp', OUT);
  console.log(`扫描 ${scanned} 条：不收的体裁 ${skipped}、空壳 ${empty}、重复 ${dup}、主库已有 ${matched}、署名不可信 ${noauthor}`);
  console.log(`新增 ${wrote} 篇（原有 ${keep.length} 篇保留）→ ${OUT}，合计 ${keep.length + wrote}`);
  console.log('  按集合：', Object.entries(count).map(([k, v]) => k + ' ' + v).join(' · '));
})();
