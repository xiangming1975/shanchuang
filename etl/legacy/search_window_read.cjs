// 窗边读诗书检索（2026-10-28）
// 在主库 site/data/poems 全部作品里，找相邻两句（一联）中**同时**出现
//   ①窗类词：窗 / 户 / 牖（+ 扉 / 棂 / 绮窗 / 绮疏 等窗边意境词）
//   ②读书类词：读 / 吟 / 诵 / 诗 / 书 / 卷 / 笔 / 字（+ 展卷 / 把卷 / 青灯黄卷 等意境词）
// 的句子对。两词可同句、也可分在上句/下句。
// 「户」带负面过滤：万户/千户/门户/渔户 这类「住户」义不算窗。
// 输出：窗边读诗书.csv（UTF-8 BOM）：标题、作者、诗句。
// 用法：node search_window_read.cjs
const fs = require('fs');
const path = require('path');

const POEMS_DIR = path.join(__dirname, 'site', 'data', 'poems');
const MANIFEST = path.join(__dirname, 'site', 'data', 'manifest.json');
const OUT = path.join(__dirname, '窗边读诗书.csv');

// 散文类集合不出「诗句」：首页题句要的是诗，古文里的「是月也，以立春」放上去不对味
const PROSE_COLS = new Set(['古文典籍', '鉴赏古文']);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
function colOf(id) {
  const cols = manifest.collections;
  let lo = 0, hi = cols.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (id >= cols[mid].start) lo = mid + 1; else hi = mid - 1;
  }
  const c = cols[Math.max(0, hi)];
  return c && id >= c.start && id < c.start + c.count ? c.name : '';
}

// ---------- 词表 ----------
const WIN_WORDS = ['窗', '牖', '扉', '棂', '绮窗', '绮疏'];
const HU = '户';
const HU_NEG = ['万户', '千户', '门户', '户户', '户部', '户口', '编户',
  '渔户', '农户', '猎户', '船户', '住户', '小户', '大户'];

const READ_WORDS = [
  // 用户指定
  '读', '吟', '诵', '诗', '书', '卷', '笔', '字',
  // 能体现窗边读诗书意境的扩展（多字词优先匹配，避免单字歧义）
  '检书', '展卷', '披卷', '把卷', '开卷', '观书', '摊书', '夜读', '书声',
  '黄卷', '残卷', '简编', '缥缃', '章句', '坟典', '五车', '六经', '青编',
  '芸编', '韦编', '铅椠', '蠹简', '青灯', '寒灯', '灯前', '灯下',
  '雪案', '萤窗', '萤雪', '临池', '笔砚', '文房', '砚', '墨', '篇', '简', '帙',
];

// ---------- 扫描 ----------
let files = 0, poems = 0, hidden = 0;
const rows = [];
const t0 = Date.now();

function hasWindowWord(s) {
  for (const w of WIN_WORDS) if (s.includes(w)) return true;
  if (s.includes(HU)) {
    for (const neg of HU_NEG) if (s.includes(neg)) return false;   // 该句只有「住户」义 → 不算
    return true;
  }
  return false;
}
function findReadWord(s) {
  // 呻吟是「哼哼」不是「吟诗」——先剥掉再匹配，防止唯一证据是呻吟的误命中
  const t = s.split('呻吟').join('□');
  for (const w of READ_WORDS) if (t.includes(w)) return w;
  return null;
}

for (const f of fs.readdirSync(POEMS_DIR)) {
  if (!f.endsWith('.json')) continue;
  files++;
  const arr = JSON.parse(fs.readFileSync(path.join(POEMS_DIR, f), 'utf8'));
  for (const p of arr) {
    if (!p || !Array.isArray(p.p) || !p.p.length) continue;
    if (p.hide) { hidden++; continue; }
    if (PROSE_COLS.has(colOf(p.i))) continue;   // 古文/鉴赏散文不算诗
    poems++;
    // 先按「。！？」切联（一联 = 上句，下句），再在联内按「，；、：」取前两句。
    // 不能跨联拼句：那样会拼出「上一联的下联 + 下一联的上联」，对不成联。
    const couples = [];
    for (const para of p.p) {
      for (const raw of String(para).split(/(?<=[。！？])/)) {
        const parts = raw.replace(/\s+/g, '').split(/(?<=[，；、：])/).filter(Boolean);
        if (parts.length < 2) continue;      // 单句（无对）不成联
        couples.push(parts[0] + parts[1]);
      }
    }
    // 一联之内两个词都在：窗词与读书词同句或分居上下句均可
    const seen = new Set();
    for (const verse of couples) {
      if ([...verse].length > 40) continue;
      if (!hasWindowWord(verse)) continue;
      if (!findReadWord(verse)) continue;
      if (seen.has(verse)) continue;
      seen.add(verse);
      rows.push([p.t || '', p.a || '', verse, p.i]);
    }
  }
}

// ---------- 写 CSV（UTF-8 BOM）----------
const esc = (v) => { const s2 = String(v == null ? '' : v); return /[",\n\r]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2; };
fs.writeFileSync(OUT, '\ufeff' + '标题,作者,诗句,id\n' + rows.map(r2 => r2.map(esc).join(',')).join('\n'), 'utf8');

console.log('扫描', files, '个文件 /', poems, '首作品（跳过下线', hidden, '），耗时', Date.now() - t0, 'ms');
console.log('命中', rows.length, '联，输出', OUT);
