// ETL：体裁索引 → site/data/idx/genre.json
// 目的：详情页给每首作品贴一个体裁标签（五绝/七律/五古/词牌…），标签页要能列出该体裁的名篇。
// 名篇口径：有「热」标记或来自精选集；再按 id 早晚稳一下，避免每次构建顺序漂移。
// 用法：node etl/build-genre.js（依赖 site/data/poems + idx/pingze.json）
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '..', 'site', 'data');
// 2026-11-01 与 site/js/vcommon.js 的 PROSE_SET/CI_SET 对齐（pdb_* 补遗此前被当诗分类，词全进了「古体」）
// 2026-11-02 主库更新补登记：新散文 shihua/mengxue_cht/jingbu_cht，新词曲 citunes/daizhige/zhtw/wudaici/qingci/songciku2/huajianji
const PROSE = new Set(['guwen', 'gwdj', 'ssxx', 'lunyu', 'mengxue', 'ymy', 'fu', 'jsswen', 'ershisishi', 'zitongjian', 'jingbu', 'pdb_guwen', 'shihua', 'mengxue_cht', 'jingbu_cht']);
const CI = new Set(['songci', 'songci300', 'hjj', 'nt', 'nalan', 'yq', 'jssci', 'pdb_songci', 'pdb_songci300', 'pdb_yuan', 'citunes', 'daizhige', 'zhtw', 'wudaici', 'qingci', 'songciku2', 'huajianji']);
// 不参与体裁统计的参照库：siku/rhyme 是扫描底本与字典；couplets 上下联会被 detectRegulated 误判成绝句；
// feihualing 是残句摘录（原诗大多已在别的集合里）
const SKIP = new Set(['siku', 'rhyme', 'couplets', 'feihualing']);
const PICK = new Set(['tang300', 'songci300', 'qjs', 'shijing', 'chuci', 'guwen', 'lunyu', 'ssxx', 'mengxue', 'keben', 'hjj', 'nt', 'nalan', 'cc']);
const TOP_N = 20;

const SPLIT = /[，。、；！？,.;!?]/;
// 同一首词常在 全宋词 与 宋词三百首 各存一份，选名篇时要按「作者+首句」去重
const headOf = (p) => String((p.p && p.p[0]) || '').replace(/[\s，。、；！？,.;!?]/g, '').slice(0, 12);

async function main() {
  const regu = await import(pathToFileURL(path.join(__dirname, '..', 'site', 'js', 'regu.js')).href);
  const pz = JSON.parse(fs.readFileSync(path.join(DATA, 'idx', 'pingze.json'), 'utf8'));
  const table = { m: pz.m, d: pz.d };
  const citpl = JSON.parse(fs.readFileSync(path.join(DATA, 'idx', 'citpl.json'), 'utf8')).m;
  // 题名可能是「别名・正名」或「词牌 题注」（pdb_songci 曾用空格分隔），与前端同一规则拆段
  const ciName = (p) => {
    const segs = String(p.t || '').split(/[・·\s　]+/).map(x => x.trim()).filter(Boolean);
    if (!segs.length) return '词';
    const n = (p.p || []).join('').split('').filter(ch => !/[，。、；！？,.;!?]/.test(ch)).length;
    return segs.find(s => citpl[s + '|' + n]) || segs[0];
  };

  const stat = new Map();   // key → { n, picks: Map<id, [score, author]> }
  const bump = (key, id, score, author, head) => {
    let e = stat.get(key);
    if (!e) { e = { n: 0, picks: new Map() }; stat.set(key, e); }
    e.n++;
    if (score > 0 && (!e.picks.has(id) || e.picks.get(id)[0] < score)) e.picks.set(id, [score, author || '', head || '']);
  };

  for (const f of fs.readdirSync(path.join(DATA, 'poems'))) {
    const cid = f.replace(/-\d+\.json$/, '');
    const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', f), 'utf8'));
    for (const p of arr) {
      if (p.hide) continue;
      if (SKIP.has(cid)) continue;
      const score = (p.hot ? 2 : 0) + (PICK.has(cid) ? 1 : 0);
      if (PROSE.has(cid)) { bump(cid === 'fu' ? '赋' : '古文', p.i, score, p.a, headOf(p)); continue; }
      if (CI.has(cid)) {
        const name = ciName(p);
        bump('词·' + name, p.i, score, p.a, headOf(p));
        continue;
      }
      // 诗：先看是不是近体
      const reg = regu.detectRegulated(p, table);
      if (reg) {
        const size = reg.len === 5 ? '五' : '七';
        const form = reg.kind === '律诗' ? '律' : '绝';
        bump(size + form, p.i, score, p.a, headOf(p));
        continue;
      }
      // 古体：按句长粗分五古/七古，长短不齐归「古体」
      const lens = new Set();
      for (const line of (p.p || [])) {
        for (const seg of String(line).split(SPLIT)) {
          const n = [...seg].filter(ch => /[\u3400-\u9fff]/.test(ch)).length;
          if (n) lens.add(n);
        }
      }
      if (lens.size === 1 && lens.has(5)) bump('五古', p.i, score, p.a, headOf(p));
      else if (lens.size === 1 && lens.has(7)) bump('七古', p.i, score, p.a, headOf(p));
      else bump('古体', p.i, score, p.a, headOf(p));
    }
  }

  const m = {};
  let total = 0;
  for (const [k, e] of stat) {
    if (k.startsWith('词·') && e.n < 20) continue;   // 冷门词牌不单列，前端归到「词」
    // 同一位作者最多 2 首，否则「浣溪沙」名篇会被一个人占掉半屏；
    // 若因此凑不满，第二轮不再限制。
    const sorted = [...e.picks.entries()].sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0]);
    const perAuthor = new Map();
    const seen = new Set();
    const picks = [];
    const rest = [];
    for (const [id, [, author, head]] of sorted) {
      const dup = (author || '') + '|' + head;
      if (head && seen.has(dup)) continue;      // 重复收录，跳过
      seen.add(dup);
      const k = author || '佚名';
      const used = perAuthor.get(k) || 0;
      if (used < 2) { perAuthor.set(k, used + 1); picks.push(id); if (picks.length >= TOP_N) break; }
      else rest.push(id);
    }
    for (const id of rest) { if (picks.length >= TOP_N) break; picks.push(id); }
    m[k] = { n: e.n, top: picks };
    total += e.n;
  }
  // 被过滤的冷门词牌汇总成「词」
  let ciRest = 0;
  for (const [k, e] of stat) if (k.startsWith('词·') && !(k in m)) ciRest += e.n;
  if (ciRest) m['词'] = { n: ciRest, top: [] };

  fs.writeFileSync(path.join(DATA, 'idx', 'genre.json'), JSON.stringify({ v: 1, m }));
  const bytes = fs.statSync(path.join(DATA, 'idx', 'genre.json')).size;
  const keys = Object.keys(m).sort((a, b) => m[b].n - m[a].n);
  console.log(`体裁 ${keys.length} 类，覆盖 ${total} 篇，${(bytes / 1024).toFixed(0)}KB`);
  console.log('前 12:', keys.slice(0, 12).map(k => `${k}:${m[k].n}`).join(' '));
  console.log('GENRE_OK');
}

main();
