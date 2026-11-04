// 生成宋词三百首补字覆盖稿（按位置映射切分，保证分段不串行）
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('C:/Users/xiang/Downloads/poetry-site/etl/');
const OpenCC = require('opencc-js');
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

const DATA = 'C:/Users/xiang/Downloads/poetry-site/site/data/poems';
const PUNCT = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉“”‘’"'—\-_～~.…]/g;
const norm = s => String(s || '').replace(PUNCT, '');
// opencc-js 偶尔漏转（後/麽/祗…）：反复转到稳定为止
const zh = s => {
  let x = t2s(String(s || ''));
  for (let i = 0; i < 3; i++) { const y = t2s(x); if (y === x) break; x = y; }
  // 全宋词本自身偶有「後后」「麽么」这类繁简叠字，先并掉，否则会被当成"丢字"补回来
  return x.replace(/后后+/g, '后').replace(/么么+/g, '么');
};
// 异体字不算丢字：这些字补进来只会造成两说混排
const VARIANT = new Set(['后', '么', '沉', '沈', '只', '祗', '着', '著', '里', '裡', '後', '麽']);
const BAD = /[ㄅ-ㄩ\uFFFD\u25A1\u25A0□]/;

const load = c => {
  let a = [];
  for (const f of fs.readdirSync(DATA).filter(f => f.startsWith(c + '-')).sort()) a = a.concat(JSON.parse(fs.readFileSync(DATA + '/' + f, 'utf8')));
  return a;
};
const small = load('songci300'), big = load('songci');
const bi = new Map();
for (const r of big) {
  const b = norm(zh(r.p.join('')));
  if (b.length > 10 && !bi.has(norm(r.t) + '|' + b.slice(0, 10))) bi.set(norm(r.t) + '|' + b.slice(0, 10), r);
}

// 异体字不算丢字
// 合并并给出位置映射：map[k] = base 第 k 字在结果中的位置
function mergeMap(base, ref) {
  const n = base.length, m = ref.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = base[i] === ref[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = '';
  const map = new Array(n + 1).fill(0), ins = [];
  while (i < n && j < m) {
    if (base[i] === ref[j]) { map[i] = out.length; out += base[i]; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { map[i] = out.length; out += base[i++]; }
    else {
      const ch = ref[j];
      if (!VARIANT.has(ch)) { ins.push({ at: out.length, ch }); out += ch; }
      j++;
    }
  }
  while (i < n) { map[i] = out.length; out += base[i++]; }
  while (j < m) { const ch = ref[j]; if (!VARIANT.has(ch)) { ins.push({ at: out.length, ch }); out += ch; } j++; }
  map[n] = out.length;
  return { out, map, ins, lcs: dp[0][0] };
}

const seq = new Map();
const out = { note: '宋词三百首补字：gushiwen 抓取时吞掉 GBK 外生僻字（悰/噀/敧/殢/忺…），用全宋词本逐字对齐补回。只做纯插入，不改精选已有用字；分段按原段边界的位置映射切分。', items: {} };
let made = 0;
for (const r of small) {
  const n = seq.get(r.t) || 0;
  seq.set(r.t, n + 1);
  const b = norm(r.p.join(''));
  const ref = bi.get(norm(r.t) + '|' + b.slice(0, 10));
  if (!ref) continue;
  const R = norm(zh(ref.p.join('')));
  if (R === b || R.length <= b.length) continue;
  if (BAD.test(ref.p.join(''))) { console.log(`跳过（全集有坏字符）${r.t}`); continue; }

  const { out: merged, map, ins: ins0, lcs } = mergeMap(b, R);
  const ins = ins0.filter(x => !VARIANT.has(x.ch));
  // 原段边界 → 新位置
  const bounds = [];
  let acc = 0;
  for (let k = 0; k < r.p.length - 1; k++) { acc += norm(r.p[k]).length; bounds.push(map[acc]); }
  const newP = [];
  let cur = 0;
  for (const bd of bounds) { newP.push(merged.slice(cur, bd)); cur = bd; }
  newP.push(merged.slice(cur));

  if (ins.length > 6) { console.log(`跳过（异文，插入${ins.length}字）${r.t}(${n + 1})`); continue; }
  const key = `songci300|${r.t}|${n}`;
  out.items[key] = { t: r.t, a: r.a, p: newP };
  made++;
  console.log(`${r.t}(${n + 1}) 段${r.p.length}→${newP.length} 补「${ins.map(x => x.ch).join('')}」${lcs < b.length ? ' [含替换，保留精选字]' : ''}`);
}
// 全集本自身的两处用字问题：𬘘(扩展区,兼容差)→紞；袯→祓（姜夔「仗酒祓清愁」）
for (const v of Object.values(out.items)) {
  v.p = v.p.map(x => x.split('\u{2C6DC}').join('紞').replace(/袯/g, '祓'));
}
fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/etl/songci-override.json', JSON.stringify(out, null, 1));
console.log(`写出 ${made} 首`);
