// 接龙句库生成器（2026-11-01）：site/data/idx/jl/<首字>.json + jl-meta.json
// 规则：
//   句 = 正文段按 [，。？！；：、] 拆出的分句，2–20 字、首字为汉字；
//   每个首字一份文件，行格式 [句, 作者, 题, poemId]，与 fhVerifyHit 兼容（只读 r[0]）。
//   每字上限 CAP：名句（idx/mingju.json 的上下半句）优先全收（保护位），
//   其余全库句子蓄水池均匀采样补足——文件不致爆炸，常见名句必在库。
//   同字内按句文本去重（名句与全库重复只留一份，繁简视为不同句）。
// 用法：node etl/build-jl.mjs   （重跑后把 site/js/views/jl.js 的 JL_R +1 绕开旧缓存）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const POEMS = path.join(ROOT, 'site/data/poems');
const OUT = path.join(ROOT, 'site/data/idx/jl');
const MINGJU = path.join(ROOT, 'site/data/idx/mingju.json');
const META = path.join(ROOT, 'site/data/idx/jl-meta.json');
const CAP = 4000;
const HAN0 = /^[\u3400-\u9fff]/;
const SPLIT = /[，。？！；：、]/;

// 首字 -> { seed: [行], res: [行], set: Set(句文本), n: 已见非重复句数 }
const by = new Map();
function bucket(c) {
  let b = by.get(c);
  if (!b) { b = { seed: [], res: [], set: new Set(), n: 0 }; by.set(c, b); }
  return b;
}
function addSeed(s, a, t, id) {
  const c = [...s][0];
  if (!HAN0.test(s)) return;
  const b = bucket(c);
  if (b.set.has(s) || b.seed.length + b.res.length >= CAP) return;
  b.set.add(s);
  b.seed.push([s, a, t, id]);
}
function addVerse(s, a, t, id) {
  const c = [...s][0];
  const b = bucket(c);
  b.n++;
  if (b.set.has(s)) return;
  const room = CAP - b.seed.length;
  if (b.res.length < room) { b.set.add(s); b.res.push([s, a, t, id]); return; }
  if (room <= 0) return;
  const j = Math.floor(Math.random() * b.n);        // 蓄水池：等概率换掉一条采样位
  if (j < room) {
    b.set.delete(b.res[j][0]);
    b.set.add(s);
    b.res[j] = [s, a, t, id];
  }
}
function versesOf(para) {
  const out = [];
  for (const s of String(para || '').split(SPLIT)) {
    const n = [...s].length;
    if (n >= 2 && n <= 20 && HAN0.test(s)) out.push(s);
  }
  return out;
}

// 1) 名句优先（mingju 上下半句都收）
const mj = JSON.parse(fs.readFileSync(MINGJU, 'utf8'));
let mjN = 0;
for (const r of mj) {
  for (const half of String(r[0] || '').split(/[，？！；]/)) {
    const s = half.trim();
    if (!s) continue;
    for (const v of versesOf(s)) { addSeed(v, r[1] || '', r[2] || '', r[3]); mjN++; }
  }
}
console.log('名句种子句', mjN);

// 2) 全库蓄水池采样
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(POEMS).filter(f => f.endsWith('.json'));
let poemN = 0, verseN = 0;
for (const f of files) {
  const arr = JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'));
  for (const rec of arr) {
    poemN++;
    for (const para of (rec.p || [])) {
      for (const s of versesOf(para)) { addVerse(s, rec.a || '', rec.t || '', rec.i); verseN++; }
    }
  }
}
console.log('扫描诗', poemN, '分句', verseN);

// 3) 落盘
let fileN = 0, rowN = 0;
for (const [c, b] of by) {
  const rows = [...b.seed, ...b.res];
  if (!rows.length) continue;
  fs.writeFileSync(path.join(OUT, c + '.json'), JSON.stringify(rows));
  fileN++; rowN += rows.length;
}
const chars = [...by.keys()].filter(c => (by.get(c).seed.length + by.get(c).res.length) > 0).sort();
fs.writeFileSync(META, JSON.stringify({ v: 1, cap: CAP, chars }));
console.log('写出', fileN, '个字文件，共', rowN, '句；meta 字数', chars.length);
