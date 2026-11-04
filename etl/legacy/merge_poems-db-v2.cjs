// poems-db 精确去重 + 分类合并（v2）
// ---------------------------------------------------------------
// 输入：data_2026-10-29/cleaned2/{manifest.json, poems/*.json}
// 输出：把去重后的内容，按「集合/朝代」分类，以【新集合】形式
//       追加到 site/data 主库末尾（不改动既有 31 个集合的 i 区间）。
//
// 为什么只能尾部新增集合：
//   主库 i 是全局连续分区，store.js 用 col.start 二分定位集合，
//   在已有集合区间插入会与下一个集合的 start 重叠，破坏索引。
//   因此本脚本为 poems-db 建立若干新集合（补遗/按朝代），
//   start 从 manifest.total 之后顺延，保证分区不重叠。
//
// 用法：
//   node merge_poems-db-v2.cjs            # 默认 dry-run，只打印计划
//   node merge_poems-db-v2.cjs --apply    # 真正写入（先备份 manifest）
// ---------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CLEANED2 = path.join(ROOT, 'data_2026-10-29', 'cleaned2');
const MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const POEMS_DIR = path.join(ROOT, 'site', 'data', 'poems');
const PER_CHUNK = 200;
const APPLY = process.argv.includes('--apply');

// ---------- 工具：归一化 ----------
function normText(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/[\u3000\s]+/g, '')
    .replace(/[《》「」『』“”"''()（）·•·.。，、：:；;！!?？—\-_~|｜]/g, '');
}
function normFirstLine(p) {
  if (!Array.isArray(p) || !p.length) return '';
  return normText(p[0]).slice(0, 16);
}
// 朝代归一（单字），修复 poems-db 里 "宋代/唐代" 等双字写法
function normDynasty(d) {
  const s = String(d || '').trim();
  const map = {
    '唐': '唐', '唐代': '唐', '唐五代': '唐', '五代': '五代',
    '宋': '宋', '宋代': '宋', '北宋': '宋', '南宋': '宋',
    '元': '元', '元代': '元', '金': '金', '金代': '金', '辽': '辽', '辽代': '辽',
    '明': '明', '明代': '明', '清': '清', '清代': '清',
    '汉': '汉', '汉代': '汉', '魏': '魏', '魏晋': '魏', '西晋': '晋', '东晋': '晋', '晋': '晋',
    '南北朝': '南北朝', '隋': '隋', '隋代': '隋', '秦': '秦', '先秦': '先秦',
    '近现代': '近现代', '现代': '近现代', '当代': '近现代',
  };
  return map[s] || s || '';
}
// 清洗作者：去掉包裹括号/方括号（数据 doc 警告过的挂错人风险）
function cleanAuthor(a) {
  let s = String(a || '').trim();
  s = s.replace(/^[（(［\[]/, '').replace(/[）)］\]]$/, '');
  return s.trim();
}
// 清洗正文：去全角空格、行尾空格
function cleanPara(p) {
  if (!Array.isArray(p)) return [];
  return p
    .map(s => String(s).replace(/\u3000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s+$/g, '').trim())
    .filter(Boolean);
}
// 判断 f.y 是否被误填成原文（与主库 doc 规则一致：重合>0.6 视为污染）
function fyIsPollution(f, p) {
  const y = (f && f.y) ? String(f.y).replace(/\s+/g, '') : '';
  if (!y) return false;
  const body = (Array.isArray(p) ? p.join('') : '').replace(/\s+/g, '');
  if (!body) return false;
  let same = 0, len = Math.min(y.length, body.length);
  for (let i = 0; i < len; i++) if (y[i] === body[i]) same++;
  return (same / Math.max(1, y.length)) > 0.6;
}
// 生成去重指纹（作者|标题|首句）
function keyOf(r) {
  return normText(r.a) + '\u0001' + normText(r.t) + '\u0001' + normFirstLine(r.p);
}

// ---------- 分类目标表 ----------
// 既有精选/经部/古文集合 → 对应「补遗」新集合；other 大杂烩 → 按朝代拆
const TARGETS = {
  tang300:   { id: 'pdb_tang300',   name: '诗词库·唐诗三百首补遗', tab: '精选' },
  shijing:   { id: 'pdb_shijing',   name: '诗词库·诗经补遗',     tab: '经部' },
  songci:    { id: 'pdb_songci',    name: '诗词库·宋词补遗',     tab: '全集' },
  songci300: { id: 'pdb_songci300', name: '诗词库·宋词三百首补遗', tab: '精选' },
  guwen:     { id: 'pdb_guwen',     name: '诗词库·古文观止补遗',  tab: '古文' },
};
// other 按朝代 → 新集合
const DYN_TARGET = {
  '宋':   { id: 'pdb_song', name: '诗词库·宋代',   tab: '全集' },
  '唐':   { id: 'pdb_tang', name: '诗词库·唐代',   tab: '全集' },
  '明':   { id: 'pdb_ming', name: '诗词库·明代',   tab: '全集' },
  '清':   { id: 'pdb_qing', name: '诗词库·清代',   tab: '全集' },
  '元':   { id: 'pdb_yuan', name: '诗词库·金元',   tab: '全集' },
  '金':   { id: 'pdb_yuan', name: '诗词库·金元',   tab: '全集' },
  '辽':   { id: 'pdb_yuan', name: '诗词库·金元',   tab: '全集' },
  '五代': { id: 'pdb_tang', name: '诗词库·唐代',   tab: '全集' },
  '汉':   { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '魏':   { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '晋':   { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '南北朝': { id: 'pdb_pre', name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '隋':   { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '秦':   { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '先秦': { id: 'pdb_pre',  name: '诗词库·汉魏六朝及以前', tab: '全集' },
  '近现代': { id: 'pdb_mod', name: '诗词库·近现代', tab: '全集' },
};
const OTHER_FALLBACK = { id: 'pdb_other', name: '诗词库·其他', tab: '全集' };

// ---------- 1. 读主库 manifest + 建立去重指纹 ----------
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
console.log('主库现有:', manifest.total, '条,', manifest.collections.length, '集合');

const mainKeys = new Set();
for (const col of manifest.collections) {
  for (const fn of col.chunks) {
    const fp = path.join(POEMS_DIR, fn);
    if (!fs.existsSync(fp)) continue;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const r of arr) mainKeys.add(keyOf(r));
  }
}
console.log('主库去重指纹:', mainKeys.size);

// ---------- 2. 读 cleaned2，分类 + 去重 ----------
const cm = JSON.parse(fs.readFileSync(path.join(CLEANED2, 'manifest.json'), 'utf8'));

const out = new Map();          // targetId -> { meta, records: [] }
const acceptedKeys = new Set(); // poems-db 内部已接受指纹（防跨集合重复）
function ensureTarget(meta) {
  if (!out.has(meta.id)) out.set(meta.id, { meta: { ...meta }, records: [] });
  return out.get(meta.id);
}

let srcTotal = 0, dupMain = 0, dupSelf = 0, emptyDrop = 0;
const srcStat = {};

for (const col of cm.collections) {
  srcStat[col.id] = { in: 0, dupMain: 0, dupSelf: 0, empty: 0, out: 0 };
  const target = TARGETS[col.id] || null; // other 为 null，逐条按朝代
  for (const ci of col.chunks) {
    const fp = path.join(CLEANED2, 'poems', `${col.id}-${String(ci).padStart(4, '0')}.json`);
    if (!fs.existsSync(fp)) continue;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const raw of arr) {
      srcTotal++; srcStat[col.id].in++;

      const a = cleanAuthor(raw.a);
      const d = normDynasty(raw.d);
      const p = cleanPara(raw.p);
      if (!p.length) { emptyDrop++; srcStat[col.id].empty++; continue; }

      const f = raw.f || {};
      const cleanF = {};
      if (f.y && !fyIsPollution(f, p)) cleanF.y = String(f.y).trim();
      if (f.z) cleanF.z = String(f.z).trim();
      if (f.s) cleanF.s = String(f.s).trim();
      if (f.b) cleanF.b = String(f.b).trim();

      const rec = { a, d, p };
      if (raw.t) rec.t = String(raw.t).trim();
      if (Object.keys(cleanF).length) rec.f = cleanF;
      if (Array.isArray(raw.tg) && raw.tg.length) rec.tg = raw.tg.slice(0, 8);

      const k = keyOf(rec);
      if (mainKeys.has(k)) { dupMain++; srcStat[col.id].dupMain++; continue; }
      if (acceptedKeys.has(k)) { dupSelf++; srcStat[col.id].dupSelf++; continue; }

      const tgt = target || (DYN_TARGET[d] || OTHER_FALLBACK);
      ensureTarget(tgt).records.push(rec);
      acceptedKeys.add(k);
      srcStat[col.id].out++;
    }
  }
}

// ---------- 3. 分配 i 并分片（dry-run 也计算，便于报告） ----------
let nextId = manifest.total;
const newCols = [];
for (const [id, bucket] of [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const recs = bucket.records;
  const start = nextId;
  for (let i = 0; i < recs.length; i++) recs[i].i = start + i;
  nextId += recs.length;
  const chunks = [];
  for (let i = 0; i < recs.length; i += PER_CHUNK) {
    const idx = Math.floor(i / PER_CHUNK);
    chunks.push(`${id}-${String(idx).padStart(4, '0')}.json`);
  }
  newCols.push({ meta: bucket.meta, count: recs.length, start, chunks, recs });
}

const totalAdded = nextId - manifest.total;

// ---------- 4. 报告 ----------
console.log('\n========== 来源 → 去重统计 ==========');
console.log('src'.padEnd(10) + 'in'.padStart(8) + 'dupMain'.padStart(9) +
  'dupSelf'.padStart(9) + 'empty'.padStart(7) + 'kept'.padStart(8));
for (const [cid, st] of Object.entries(srcStat)) {
  console.log(cid.padEnd(10) + String(st.in).padStart(8) + String(st.dupMain).padStart(9) +
    String(st.dupSelf).padStart(9) + String(st.empty).padStart(7) + String(st.out).padStart(8));
}
console.log('-'.repeat(52));
console.log('合计'.padEnd(10) + String(srcTotal).padStart(8) + String(dupMain).padStart(9) +
  String(dupSelf).padStart(9) + String(emptyDrop).padStart(7) + String(totalAdded).padStart(8));

console.log('\n========== 将新增的分类集合 ==========');
console.log('id'.padEnd(12) + 'name'.padEnd(22) + 'tab'.padEnd(5) + 'count'.padStart(8) + '   start / 片数');
for (const nc of newCols) {
  console.log(nc.meta.id.padEnd(12) + nc.meta.name.padEnd(22) + nc.meta.tab.padEnd(5) +
    String(nc.count).padStart(8) + '   ' + nc.start + ' / ' + nc.chunks.length);
}
console.log('-'.repeat(60));
console.log('新增集合数:', newCols.length, '| 净新增条数:', totalAdded);
console.log('主库将变为:', manifest.total, '+', totalAdded, '=', manifest.total + totalAdded, '条,',
  manifest.collections.length + newCols.length, '集合');

if (!APPLY) {
  console.log('\n[DRY-RUN] 未写入任何文件。加 --apply 执行。');
  process.exit(0);
}

// ---------- 5. 真正写入 ----------
// 备份 manifest
fs.copyFileSync(MANIFEST, MANIFEST + '.bak.' + Date.now());
// 写分片
for (const nc of newCols) {
  for (let i = 0; i < nc.recs.length; i += PER_CHUNK) {
    const idx = Math.floor(i / PER_CHUNK);
    const fn = `${nc.meta.id}-${String(idx).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(POEMS_DIR, fn), JSON.stringify(nc.recs.slice(i, i + PER_CHUNK)), 'utf8');
  }
  manifest.collections.push({
    id: nc.meta.id,
    name: nc.meta.name,
    tab: nc.meta.tab,
    count: nc.count,
    visible: nc.count,
    start: nc.start,
    chunks: nc.chunks,
    desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入',
  });
}
manifest.total += totalAdded;
manifest.v = Date.now();
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');
console.log('\n[APPLY] 已写入', newCols.length, '个新集合，', totalAdded, '条。manifest 已备份并更新。');
console.log('下一步：重建索引 + 上传（用户说「上传」时执行）。');
