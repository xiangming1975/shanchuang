// 把 dataset_dedup 的新体裁集合 作为新集合导入主库。
// 仅新增,不改现有集合。每个新集合 start 取 1e6 + seq*1e6, i=start+序号, 保证不冲突。
// DRY=1 仅规划; 不带 DRY 实写(先备份 manifest 与新集合文件)。
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const DRY = process.env.DRY === '1';
const CHUNK = 200;

const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const srcById = Object.fromEntries(sm.collections.map(c => [c.id, c]));

// 导入配置: 源id -> {新id, 中文名, tab, desc}
const PLAN = [
  { src: 's47_couplets',        id: 'couplets',    name: '对联',     tab: '对联',   desc: '历代对联集萃' },
  { src: 's48_feihualing',      id: 'feihualing',  name: '飞花令',   tab: '飞花令', desc: '飞花令诗句' },
  { src: 's49_songci_tunes',    id: 'citunes',     name: '词牌',     tab: '词牌',   desc: '词牌格式范例' },
  { src: 's46_rhyme',           id: 'rhyme',       name: '韵书',     tab: '韵书',   desc: '韵书注音释义' },
  { src: 's53_shihua',          id: 'shihua',      name: '诗话',     tab: '诗话',   desc: '诗话词话批评' },
  { src: 's28_kaggle_wikisource', id: 'siku',      name: '四库全书', tab: '四库全书', desc: '四库全书/宋文鉴等原文' },
];

if (!DRY) fs.mkdirSync(MAIN + '/import-bak', { recursive: true });

let totalNew = 0, base = 1000000;
for (let s = 0; s < PLAN.length; s++) {
  const cfg = PLAN[s];
  const c = srcById[cfg.src]; if (!c) { console.error('跳过(源缺失):', cfg.src); continue; }
  const start = base + s * 1000000;
  const newChunks = [];
  let idx = 0, written = 0;
  const sample = [];
  for (const ch of c.chunks) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    let buf = [];
    for (const r of arr) {
      const rec = {
        i: start + idx,
        t: r.t,
        a: r.a,
        d: r.d,
        p: r.p,
        tg: cfg.id,
        f: r.f || {},
      };
      if (sample.length < 2) sample.push(rec);
      buf.push(rec); idx++;
      if (buf.length >= CHUNK) {
        const fn = cfg.id + '-' + String(newChunks.length).padStart(4, '0') + '.json';
        if (!DRY) fs.writeFileSync(MAIN + '/poems/' + fn, JSON.stringify(buf));
        newChunks.push(fn); buf = []; written++;
      }
    }
    if (buf.length) {
      const fn = cfg.id + '-' + String(newChunks.length).padStart(4, '0') + '.json';
      if (!DRY) fs.writeFileSync(MAIN + '/poems/' + fn, JSON.stringify(buf));
      newChunks.push(fn); written++;
    }
  }
  totalNew += idx;
  // manifest 条目
  const entry = { id: cfg.id, name: cfg.name, desc: cfg.desc, tab: cfg.tab, count: idx, span: idx, visible: idx, chunks: newChunks, start };
  if (!DRY) {
    fs.writeFileSync(MAIN + '/import-bak/manifest.json.bak', JSON.stringify(mm, null, 0));
    mm.collections.push(entry);
  }
  console.error('[' + (DRY ? '规划' : '已建') + '] ' + cfg.id + '(' + cfg.name + ') start=' + start + ' 记录=' + idx + ' 分块=' + newChunks.length);
  if (sample[0]) console.error('   样例 t=' + ('' + sample[0].t).slice(0, 24) + ' | p前30:' + (Array.isArray(sample[0].p) ? sample[0].p.join('') : '' + sample[0].p).slice(0, 30) + ' | f键:' + Object.keys(sample[0].f).join(','));
}
if (!DRY) {
  mm.total = (mm.total || 0) + totalNew;
  mm.fulltextCount = (mm.fulltextCount || 0) + totalNew;
  fs.writeFileSync(MAIN + '/manifest.json', JSON.stringify(mm));
}
console.error('新增记录合计: ' + totalNew + (DRY ? ' (DRY,未写)' : ' (已写入, manifest 已更新, 备份在 import-bak/)'));
