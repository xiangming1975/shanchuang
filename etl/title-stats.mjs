// 统计「标题长度」分布，用来决定列表里到底该折几行、哪些才需要省略号。
// 口径：
//   1) 显示标题 = 词牌前缀（r 与 t 不同时）+ 标题本体，并剥掉全唐诗的乐府分类前缀；
//   2) 词/曲另外算一版「标题 + 首句」，因为词牌单独看无法分辨是哪一首；
//   3) 长度按「可见字符数」算（不含空格），另外给一版「视觉宽度」（汉字 1，标点/数字 0.5）。
import fs from 'fs';
import path from 'path';

const DATA = 'site/data/poems';
const CI_SET = new Set(['songci', 'songci300', 'hjj', 'nt', 'nalan', 'yq']);
const LE_PREFIX = /^[^\s]{1,8}\s+(?=[\u4e00-\u9fa5]{2,})/;   // 「鼓吹曲辭 將進酒」→「將進酒」

const PUNCT = /[\s·・・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉“”‘’"'—\-_～~.…]/g;

// 首句：取到第一个句读，最多 16 字（统计体量，不必整句）
function firstSeg(p) {
  const s = String((p && p[0]) || '').replace(/\s+/g, '');
  const m = s.split(/[，。！？；、：,]/)[0] || s;
  return m;
}

const width = (s) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u303f\uff00-\uff60\u4e00-\u9fa5]/.test(ch) ? 1 : 0.5;
  return Math.round(w * 10) / 10;
};

function titleOf(r) {
  const raw = String(r.t || '').replace(LE_PREFIX, '');
  return r.r && r.r !== r.t ? `${r.r}·${raw}` : raw;
}

// 词里已经自带首句的（纳兰「长相思·山一程」）不重复添加
function headingOf(r, coll) {
  const t = titleOf(r);
  if (!CI_SET.has(coll)) return t;
  const parts = t.split(/[·・]/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  if (tail && [...tail].length >= 3 && !/^其一|其二|其三|其四|其五/.test(tail)) return t;
  return t + '·' + firstSeg(r.p);
}

const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json')).sort();
const lens = [];       // 全部（现状标题）
const lensCi = [];     // 词曲（标题 + 首句）
const byColl = new Map();
let total = 0;

for (const f of files) {
  const coll = f.replace(/-\d+\.json$/, '');
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { continue; }
  for (const r of arr) {
    if (r.hide) continue;
    total++;
    const t = titleOf(r);
    const n = [...String(t).replace(PUNCT, '')].length;
    lens.push(n);
    if (CI_SET.has(coll)) lensCi.push([...String(headingOf(r, coll)).replace(PUNCT, '')].length);
    if (!byColl.has(coll)) byColl.set(coll, { n: 0, max: 0, over20: 0 });
    const e = byColl.get(coll);
    e.n++; if (n > e.max) e.max = n; if (n > 20) e.over20++;
  }
}

const pct = (arr, p) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};
const hist = (arr, step, cap) => {
  const bins = new Map();
  for (const n of arr) {
    const k = Math.min(cap, Math.floor(n / step) * step);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]);
};

function report(name, arr) {
  console.log(`\n=== ${name}（${arr.length} 条）`);
  console.log('  平均', (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1),
    '| p50', pct(arr, 0.5), '| p75', pct(arr, 0.75), '| p90', pct(arr, 0.9),
    '| p95', pct(arr, 0.95), '| p99', pct(arr, 0.99), '| max', arr.reduce((a, b) => (b > a ? b : a), 0));
  for (const th of [12, 16, 20, 24, 28, 32, 40, 50, 60]) {
    const c = arr.filter(x => x > th).length;
    console.log(`  > ${String(th).padStart(2)} 字：${String(c).padStart(6)} 条 ${(c / arr.length * 100).toFixed(2)}%`);
  }
  console.log('  直方图（每 4 字一档）:');
  for (const [k, v] of hist(arr, 4, 60)) {
    console.log(`    ${String(k).padStart(2)}~${k + 3}: ${String(v).padStart(7)} ${(v / arr.length * 100).toFixed(1)}%`);
  }
}

console.log('总条数', total);
report('全部标题（现状显示）', lens);
report('词曲标题 + 首句', lensCi);

// ---- 词曲：加上首句后，>20 字的比例（按集合拆分） ----
const ciByColl = new Map();
for (const f of files) {
  const coll = f.replace(/-\d+\.json$/, '');
  if (!CI_SET.has(coll)) continue;
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { continue; }
  for (const r of arr) {
    if (r.hide) continue;
    const h = [...String(headingOf(r, coll)).replace(PUNCT, '')].length;
    const e = ciByColl.get(coll) || { n: 0, over20: 0, sum: 0, hist: {} };
    e.n++; e.sum += h;
    if (h > 20) {
      e.over20++;
      const k = h <= 24 ? '21-24' : h <= 28 ? '25-28' : h <= 32 ? '29-32' : '33+';
      e.hist[k] = (e.hist[k] || 0) + 1;
    }
    ciByColl.set(coll, e);
  }
}
console.log('\n=== 词曲「题名 + 首句」超 20 字：按集合');
let cn = 0, co = 0;
for (const [k, v] of [...ciByColl.entries()].sort((a, b) => b[1].n - a[1].n)) {
  cn += v.n; co += v.over20;
  console.log(`  ${k.padEnd(11)} ${String(v.n).padStart(6)} 条  >20 字 ${String(v.over20).padStart(5)} (${(v.over20 / v.n * 100).toFixed(1)}%)  均长 ${(v.sum / v.n).toFixed(1)}  ${JSON.stringify(v.hist)}`);
}
console.log(`  合计 ${cn} 条，>20 字 ${co} 条（${(co / cn * 100).toFixed(2)}%）`);

console.log('\n=== 各集合最长标题');
[...byColl.entries()].sort((a, b) => b[1].max - a[1].max).slice(0, 12)
  .forEach(([k, v]) => console.log(`  ${k.padEnd(12)} ${String(v.n).padStart(6)} 条  最长 ${String(v.max).padStart(3)} 字  >20 字 ${v.over20}`));
