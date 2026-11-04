// ETL：从已有平仄数据反推「字 → 平/仄/多」表 → site/data/idx/pingze.json
// 用法：node etl/build-pingze.js
// 只统计正文里的汉字与对应平仄；同一字既读平又读仄的标「多」，交由格律模板决定。
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

// 带平仄的数据全在繁体集合（全唐诗/全宋诗），简体作品（明诗、清诗、课文名篇）查不到字。
// 统计时把每个字同时投给「原字」和「繁→简」两种写法，两边都能查到。
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

const DATA = path.join(__dirname, '..', 'site', 'data');
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

function main() {
  const vote = new Map();   // 字 → [平次, 仄次]
  let lines = 0, chars = 0;
  const dir = path.join(DATA, 'poems');
  for (const f of fs.readdirSync(dir)) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const r of arr) {
      if (!r.st || !r.st.length || !r.p) continue;
      for (let k = 0; k < r.p.length; k++) {
        const text = r.p[k], strain = r.st[k];
        if (!strain) continue;
        lines++;
        const n = Math.min(text.length, strain.length);
        for (let i = 0; i < n; i++) {
          const ch = text[i], pz = strain[i];
          if (pz !== '平' && pz !== '仄') continue;
          if (!HAN.test(ch)) continue;
          chars++;
          const sv = convT2S(ch);
          for (const key of (sv && sv !== ch ? [ch, sv] : [ch])) {
            let v = vote.get(key);
            if (!v) { v = [0, 0]; vote.set(key, v); }
            if (pz === '平') v[0]++; else v[1]++;
          }
        }
      }
    }
  }

  // 判定：占比 <8% 的一侧视为噪声；两侧都够格且样本 ≥4 才算多音。
  // m 存「主音」（多音字取占比高的那侧，供古体诗只标字音时使用）；
  // d 单独列出多音字，格律/词模板可用时优先用模板定音。
  const m = {}, duo = [];
  let ping = 0, ze = 0;
  for (const [ch, [p, z]] of vote) {
    const total = p + z;
    if (!total) continue;
    const main = p >= z ? '平' : '仄';
    m[ch] = main;
    if (main === '平') ping++; else ze++;
    if (Math.min(p, z) / total >= 0.08 && total >= 4) duo.push(ch);
  }

  fs.writeFileSync(path.join(DATA, 'idx', 'pingze.json'), JSON.stringify({ v: 2, m, d: duo }));
  const bytes = fs.statSync(path.join(DATA, 'idx', 'pingze.json')).size;
  console.log(`扫描 ${lines} 行 / ${chars} 字次`);
  console.log(`字表 ${Object.keys(m).length} 字（主音 平 ${ping} / 仄 ${ze} / 多音 ${duo.length}），${(bytes / 1024).toFixed(0)}KB`);
  console.log('PINGZE_OK');
}

main();
