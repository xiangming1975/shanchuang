// C线: 把未用源里主库完全没有的新诗词正文, 去重后作为新集合导入主库。
// 去重: 剔除"整诗精确匹配主库已有"的记录(用归一化hash|pre12)。
// 新集合 id 重映射: start = 7000000 + seq*1000000。
// DRY=1 仅报量; 实写备份 manifest 到 import-bak2/ 并写新分块。
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const DRY = process.env.DRY === '1';
const CHUNK = 200;
const norm = s => ('' + (s || '')).replace(/[\s，。、？！；：“”‘’《》()（）.,?!;:\-]/g, '');
function hash(str){ let h=0x100000001b3n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001b3n)&0x1ffffffffffffn; } return h.toString(36); }

const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const srcById = Object.fromEntries(sm.collections.map(c => [c.id, c]));

// 主库全量索引
const idx = new Set();
let mi = 0;
for (const c of mm.collections) {
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
      if (p.length < 6) continue;
      idx.add(hash(p) + '|' + p.slice(0, 12)); mi++;
    }
  }
}
console.error('主库索引条目: ' + mi);

// 导入计划: 源 -> 新集合
const PLAN = [
  { src: 's27_daizhige',        id: 'daizhige',    name: '东海渔歌',   tab: '清词',   desc: '清代女词人顾春《东海渔歌》词集' },
  { src: 's25_hf_orchestra',    id: 'guyishi',      name: '古逸诗',     tab: '先秦',   desc: '先秦古逸诗(甯封子等)' },
  { src: 's21_sfw2099',         id: 'wudaici',      name: '五代词',     tab: '五代词', desc: '五代词选(和凝等)' },
  { src: 's26_hf_papersnake',   id: 'songbu',       name: '宋诗补遗',   tab: '宋诗',   desc: '陆游等宋诗补遗' },
  { src: 's19_aopao',           id: 'tangkuo',      name: '唐人诗扩',   tab: '唐诗',   desc: '李白等唐诗扩展' },
  { src: 's36_ms_translation',  id: 'qingci',       name: '清词',       tab: '清词',   desc: '清词(陈维崧等)' },
  { src: 's31_kaggle_yololzw',  id: 'shiciku',      name: '诗词杂录',   tab: '诗词',   desc: '诗词杂录' },
  { src: 's13_hf_zhtw',         id: 'zhtw',         name: '繁体诗词',   tab: '诗词',   desc: '繁体中文诗词' },
  { src: 's06_joydraw2017',     id: 'tangkuo2',     name: '唐诗·二',    tab: '唐诗',   desc: '高适等唐诗' },
  { src: 's24_openchinese',     id: 'shijingbu',    name: '诗经补遗',   tab: '诗经',   desc: '诗经异文补遗' },
  { src: 's18_shenyunhang',     id: 'tangkuo3',     name: '唐诗·三',    tab: '唐诗',   desc: '杜牧等唐诗' },
  { src: 's22_shewrote',        id: 'songciku',     name: '宋词·女',    tab: '宋词',   desc: '李清照等宋词' },
  { src: 's29_kaggle_songci',   id: 'songciku2',    name: '宋词·二',    tab: '宋词',   desc: '宋词选' },
  { src: 's08_hf_songs',        id: 'huici',        name: '回文诗词',   tab: '诗词',   desc: '回文诗等' },
  { src: 's11_hf_tang300',      id: 'tang300ext',   name: '唐诗三百首补', tab: '唐诗',  desc: '唐诗三百首补充' },
  { src: 's01_chinese_poetry',  id: 'huajianji',    name: '花间集补',   tab: '唐五代词', desc: '花间集等补充' },
  { src: 's50_chtxt_mengxue',   id: 'mengxue_cht',  name: '蒙学(测)',   tab: '蒙学',   desc: '三字经千字文等' },
  { src: 's51_chtxt_classics',  id: 'jingbu_cht',   name: '经部(测)',   tab: '经部',   desc: '中庸等经部' },
];
if (!DRY) fs.mkdirSync(MAIN + '/import-bak2', { recursive: true });

let base = 7000000, totalNew = 0, totalDup = 0;
for (let s = 0; s < PLAN.length; s++) {
  const cfg = PLAN[s]; const c = srcById[cfg.src];
  if (!c) { console.error('跳过(源缺失):', cfg.src); continue; }
  const start = base + s * 1000000;
  const newChunks = []; let idx2 = 0, written = 0, dup = 0, raw = 0; const sample = [];
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    let buf = [];
    for (const r of arr) {
      const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
      raw++;
      if (p.length < 6) { // 太短无法可靠去重, 直接收
        buf.push(mkRec(r, start, idx2++, cfg.id)); if (sample.length < 2) sample.push(buf[buf.length-1]); continue;
      }
      const key = hash(p) + '|' + p.slice(0, 12);
      if (idx.has(key)) { dup++; continue; } // 主库已有, 去重跳过
      buf.push(mkRec(r, start, idx2++, cfg.id)); if (sample.length < 2) sample.push(buf[buf.length-1]);
      if (buf.length >= CHUNK) {
        const fn = cfg.id + '-' + String(newChunks.length).padStart(4,'0') + '.json';
        if (!DRY) fs.writeFileSync(MAIN + '/poems/' + fn, JSON.stringify(buf));
        newChunks.push(fn); written++; buf = [];
      }
    }
    if (buf.length) {
      const fn = cfg.id + '-' + String(newChunks.length).padStart(4,'0') + '.json';
      if (!DRY) fs.writeFileSync(MAIN + '/poems/' + fn, JSON.stringify(buf));
      newChunks.push(fn); written++;
    }
  }
  totalNew += idx2; totalDup += dup;
  const entry = { id: cfg.id, name: cfg.name, desc: cfg.desc, tab: cfg.tab, count: idx2, span: idx2, visible: idx2, chunks: newChunks, start };
  if (!DRY) {
    fs.writeFileSync(MAIN + '/import-bak2/manifest.json.bak', JSON.stringify(mm, null, 0));
    mm.collections.push(entry);
  }
  console.error('[' + (DRY?'规划':'已建') + '] ' + cfg.id + '(' + cfg.name + ') 原始=' + raw + ' 去重跳过=' + dup + ' 导入=' + idx2 + ' 分块=' + newChunks.length);
  if (sample[0]) console.error('   样例 t=' + ('' + sample[0].t).slice(0,24) + ' | p前30:' + (Array.isArray(sample[0].p)?sample[0].p.join(''):''+sample[0].p).slice(0,30) + ' | f键:' + Object.keys(sample[0].f).join(','));
}
function mkRec(r, start, seq, tg){ return { i: start + seq, t: r.t, a: r.a, d: r.d, p: r.p, tg, f: r.f || {} }; }
if (!DRY) { mm.total = (mm.total||0) + totalNew; mm.fulltextCount = (mm.fulltextCount||0) + totalNew; fs.writeFileSync(MAIN + '/manifest.json', JSON.stringify(mm)); }
console.error('去重跳过总计: ' + totalDup + ' | 新导入总计: ' + totalNew + (DRY ? ' (DRY,未写)' : ' (已写,manifest已更新,备份import-bak2/)'));
