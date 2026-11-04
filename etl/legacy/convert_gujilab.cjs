// gujilab 语料 → 主库格式转换（data_2026-10-29 清洗）
// 输入：data_2026-10-29/gujilab_corpus.jsonl（12,009 条，24史+通鉴+十三经+说文）
// 输出：data_2026-10-29/cleaned/{poems/, manifest.json}
// 格式与主库一致：poems/{cid}-{NNNN}.json（200条/片），manifest.json 含集合信息
// 用法：node convert_gujilab.cjs
const fs = require('fs');
const path = require('path');

const IN = path.join(__dirname, 'data_2026-10-29', 'gujilab_corpus.jsonl');
const OUT_DIR = path.join(__dirname, 'data_2026-10-29', 'cleaned');
const OUT_POEMS = path.join(OUT_DIR, 'poems');
const PER_CHUNK = 200;

// ---------- 来源 → 集合映射 ----------
// 说文解字太大单列，二十四史归一类，通鉴单列，剩余经部归一类
const SRC2CID = {};
const COLLECTIONS = [
  { cid: 'shuowen', name: '说文解字', tab: '古文', sources: ['说文解字'] },
  { cid: 'ershisishi', name: '二十四史', tab: '古文', sources: [
    '史记','汉书','后汉书','三国志','晋书','宋书','南齐书','梁书','陈书',
    '魏书','北齐书','周书','隋书','北史','南史',
  ]},
  { cid: 'zitongjian', name: '资治通鉴', tab: '古文', sources: ['资治通鉴'] },
  { cid: 'jingbu', name: '古籍经部', tab: '经部', sources: [
    '周易','尚书','礼记','尔雅','孝经','春秋左传','春秋公羊传','春秋穀梁传','大学','中庸',
  ]},
];
for (const col of COLLECTIONS) for (const src of col.sources) SRC2CID[src] = col.cid;

// 朝代→主库单字格式
const DYNASTY_MAP = {
  '唐': '唐', '汉': '汉', '魏': '魏', '晋': '晋', '南北朝': '南北朝', '宋': '宋',
  '先秦': '先秦', '周': '先秦', '西汉': '汉', '东汉': '汉', '清': '清', '明': '明',
};

// ---------- 读入并分配 ----------
const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
const byCol = {};   // cid → [records]
let skipped = 0, total = 0;

for (const line of lines) {
  const o = JSON.parse(line);
  total++;
  const cid = SRC2CID[o.source];
  if (!cid) { skipped++; continue; }
  if (!byCol[cid]) byCol[cid] = [];
  // 标题：优先 chapter（含卷号），否则 source+volume
  let title = o.chapter || '';
  if (!title) title = o.source + (o.volume ? '·卷' + o.volume : '');
  // 段落：content 按双换行拆段
  const paras = String(o.content || '').split(/\n\n+/).map(s2 => s2.replace(/\n/g, '')).filter(s2 => s2.trim());
  if (!paras.length) { skipped++; continue; }
  byCol[cid].push({
    srcId: o.id,
    t: title,
    a: o.author || '',
    d: DYNASTY_MAP[o.era] || o.era || '',
    p: paras,
    src: o.source,
    vol: o.volume || 0,
  });
}

// ---------- 输出 ----------
fs.mkdirSync(OUT_POEMS, { recursive: true });
const manifest = { v: Date.now(), collections: [] };
let globalStart = 0;
const CID_NAME = {};
for (const col of COLLECTIONS) CID_NAME[col.cid] = col.name;

for (const col of COLLECTIONS) {
  const records = byCol[col.cid];
  if (!records || !records.length) continue;
  const chunks = [];
  for (let i = 0; i < records.length; i += PER_CHUNK) {
    const chunk = records.slice(i, i + PER_CHUNK).map((r2, k) => ({
      i: globalStart + i + k,
      t: r2.t,
      a: r2.a,
      d: r2.d,
      p: r2.p,
      tg: [r2.src],
      f: {},
    }));
    const chunkFile = `${col.cid}-${String(Math.floor(i / PER_CHUNK)).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(OUT_POEMS, chunkFile), JSON.stringify(chunk), 'utf8');
    chunks.push(Math.floor(i / PER_CHUNK));
  }
  manifest.collections.push({
    id: col.cid,
    name: col.name,
    tab: col.tab,
    count: records.length,
    visible: records.length,
    start: globalStart,
    chunks,
    desc: `${col.name}（gujilab/chinese-classical-corpus 提取，纯原文）`,
  });
  console.log(`${col.cid}: ${records.length} 条, ${chunks.length} 片, start=${globalStart}`);
  globalStart += records.length;
}

manifest.total = globalStart;
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('---');
console.log('总计:', globalStart, '条 | 跳过:', skipped, '| 输出:', OUT_DIR);
