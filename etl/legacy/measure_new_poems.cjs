// 反向匹配: 建主库全量诗索引, 扫候选源统计"主库已存在/缺失(新诗)"。
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const norm = s => ('' + (s || '')).replace(/[\s，。、？！；：“”‘’《》()（）.,?!;:\-]/g, '');
function hash(str){ let h=0x100000001b3n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001b3n)&0x1ffffffffffffn; } return h.toString(36); }

const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const srcById = Object.fromEntries(sm.collections.map(c => [c.id, c]));

// 主库全量索引: Set of "hash|pre12"
const idx = new Set();
let mi = 0;
for (const c of mm.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
      if (p.length < 6) continue;
      idx.add(hash(p) + '|' + p.slice(0,12)); mi++;
    }
  }
}
console.error('主库索引条目: ' + mi);

const cand = ['s27_daizhige','s25_hf_orchestra','s21_sfw2099','s26_hf_papersnake','s19_aopao','s24_openchinese','s01_chinese_poetry','s13_hf_zhtw','s06_joydraw2017','s31_kaggle_yololzw','s36_ms_translation','s18_shenyunhang','s22_shewrote','s29_kaggle_songci','s08_hf_songs','s11_hf_tang300','s10_hf_translation','s32_kaggle_shijing3en','s50_chtxt_mengxue','s51_chtxt_classics','s05_werneror85','s12_hf_zhangqiaobit','s30_kaggle_diming'];
for (const id of cand) {
  const c = srcById[id]; if (!c) continue;
  let tot = 0, hit = 0;
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
      if (p.length < 6) continue; tot++;
      if (idx.has(hash(p) + '|' + p.slice(0,12))) hit++;
    }
  }
  const miss = tot - hit;
  console.error('  ' + id.padEnd(22) + ' 总=' + String(tot).padEnd(7) + ' 命中主库=' + String(hit).padEnd(7) + ' 缺失(新诗)=' + String(miss).padEnd(7) + ' 新诗率=' + (tot? Math.round(miss/tot*100) : 0) + '%');
}
