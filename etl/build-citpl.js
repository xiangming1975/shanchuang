// ETL：从同调作品反推词谱模板 → site/data/idx/citpl.json
// 思路：词的字数由词牌固定，只要「词牌 + 总字数」相同，逐字位置就对齐，
//       不需要外部词谱（现成词谱只覆盖 3% 的无平仄词作，且多为正体，套不上变格）。
// 规则：同组 ≥8 首才建模板；某位置平/仄多数占比 ≥70% 且样本 ≥8 才认定为固定位，否则记「中」。
// 用法：node etl/build-citpl.js（依赖 site/data/poems + idx/pingze.json）
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'site', 'data');
const SPLIT = /[，。、；！？,.;!?]/;
const table = require(path.join(DATA, 'idx', 'pingze.json')).m;
const toneOf = (ch) => (table[ch] === '平' || table[ch] === '仄') ? table[ch] : '';

const CI_DIRS = ['songci'];   // 全宋词是唯一有量级的词库；其余词集样本太少，靠同调凑不够 8 首
const MIN_SAMPLE = 5;   // 同调 ≥5 首即可建模板（样本少时靠更严的固定位阈值兜底）
const MIN_TOP = 0.75;

function bodyChars(p) {
  const out = [];
  for (const line of p) for (const ch of line) if (!SPLIT.test(ch)) out.push(ch);
  return out;
}

function main() {
  const groups = new Map();
  for (const f of fs.readdirSync(path.join(DATA, 'poems'))) {
    const cid = f.replace(/-\d+\.json$/, '');
    if (!CI_DIRS.includes(cid)) continue;
    for (const p of JSON.parse(fs.readFileSync(path.join(DATA, 'poems', f), 'utf8'))) {
      if (p.st && p.st.length) continue;
      const name = String(p.t || '').split(/[・·]/)[0].trim();
      if (!name) continue;
      const chars = bodyChars(p.p || []);
      if (chars.length < 8) continue;
      const key = name + '|' + chars.length;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chars);
    }
  }

  const m = {};
  let tpl = 0, covered = 0, fixedSum = 0, posSum = 0;
  for (const [key, arr] of groups) {
    if (arr.length < MIN_SAMPLE) continue;
    const L = arr[0].length;
    let fixed = 0;
    const pat = [];
    for (let i = 0; i < L; i++) {
      let ping = 0, ze = 0;
      for (const c of arr) { const t = toneOf(c[i]); if (t === '平') ping++; else if (t === '仄') ze++; }
      const n = ping + ze;
      if (n >= MIN_SAMPLE && Math.max(ping, ze) / n >= MIN_TOP) {
        pat.push(ping >= ze ? '平' : '仄');
        fixed++;
      } else pat.push('中');
    }
    tpl++; covered += arr.length; fixedSum += fixed; posSum += L;
    m[key] = [pat.join(''), arr.length];   // 模板 + 样本数（前端用来显示依据）
  }

  fs.writeFileSync(path.join(DATA, 'idx', 'citpl.json'), JSON.stringify({ v: 1, m }));
  const bytes = fs.statSync(path.join(DATA, 'idx', 'citpl.json')).size;
  console.log(`模板 ${tpl} 组，覆盖 ${covered} 首，平均固定位 ${(fixedSum / posSum * 100).toFixed(0)}%`);
  console.log(`citpl.json ${(bytes / 1024).toFixed(0)}KB`);
  console.log('CITPL_OK');
}

main();
