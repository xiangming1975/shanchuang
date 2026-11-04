// 重建 idx/dyn/ 按朝代浏览索引（只读现有 manifest+分片，只写 idx/dyn/，不动别的索引、不动分片）
// 移植自 etl/build.js 的朝代索引段（DYN_MAP / DYN_GROUPS / dynGroup 一字不改，保证格式一致）
// 用法：node reindex-dyn.cjs          （dry-run，仅统计各分组条数）
//       node reindex-dyn.cjs --apply  （先备份 idx/dyn/，清空后重建，改写 idx/dyn.json）

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'site', 'data');
const MAIN_MANIFEST = path.join(DATA, 'manifest.json');
const POEMS = path.join(DATA, 'poems');
const DYN_DIR = path.join(DATA, 'idx', 'dyn');
const DYN_JSON = path.join(DATA, 'idx', 'dyn.json');
const DYNBUCKET = 20000;

// ---------- 朝代归一（与 etl/build.js 一致） ----------
const DYN_MAP = {
  '夏': '先秦', '商': '先秦', '周': '先秦', '春秋': '先秦', '战国': '先秦', '先秦': '先秦', '商周': '先秦',
  '秦': '秦',
  '汉': '汉', '两汉': '汉', '西汉': '汉', '东汉': '汉', '汉末': '汉',
  '魏晋': '魏晋', '三国': '魏晋', '晋': '魏晋', '西晋': '魏晋', '东晋': '魏晋', '魏': '魏晋',
  '三国魏': '魏晋', '三国吴': '魏晋', '三国蜀': '魏晋', '曹魏': '魏晋',
  '南北朝': '南北朝', '南北': '南北朝', '南朝': '南北朝', '北朝': '南北朝', '南朝宋': '南北朝', '南朝梁': '南北朝',
  '南朝齐': '南北朝', '南朝陈': '南北朝', '北魏': '南北朝', '东魏': '南北朝', '西魏': '南北朝', '北齐': '南北朝', '北周': '南北朝',
  '隋': '隋', '隋代': '隋',
  '唐': '唐', '唐代': '唐', '唐未': '唐',
  '五代': '五代', '五': '五代', '五代十国': '五代', '十国': '五代',
  '后梁': '五代', '后唐': '五代', '后晋': '五代', '后汉': '五代', '后周': '五代',
  '宋': '宋', '北宋': '宋', '南宋': '宋', '宋代': '宋',
  '辽': '辽', '辽朝': '辽', '辽代': '辽',
  '金': '金', '金朝': '金',
  '元': '元', '元代': '元',
  '明': '明', '明代': '明', '明高': '明', '明清': '明清',
  '清': '清', '清代': '清',
  '近现代': '近现代', '近代': '近现代', '现代': '近现代', '当代': '近现代', '民国': '近现代', '近现': '近现代',
  '金由': '金', '明远': '明', '明碧': '明',
};
const DYN_KEYS = Object.keys(DYN_MAP).sort((a, b) => b.length - a.length);

const DYN_GROUPS = [
  { k: '先秦',     m: ['先秦', '秦'] },
  { k: '汉魏六朝', m: ['汉', '魏晋', '南北朝'] },
  { k: '隋唐五代', m: ['隋', '唐', '五代'] },
  { k: '宋辽金',   m: ['宋', '辽', '金'] },
  { k: '元',       m: ['元'] },
  { k: '明清',     m: ['明', '清', '明清'] },
  { k: '近现代',   m: ['近现代'] },
];
const DYN_TO_GROUP = (() => {
  const o = {};
  for (const g of DYN_GROUPS) for (const d of g.m) o[d] = g.k;
  return o;
})();
// 注意：先经 dynNorm（DYN_MAP 归一）再查分组，否则「近代/金朝/两汉/晋/春秋…」等已在 DYN_MAP 归好的别名会被白名单漏掉变成脏值
const dynGroup = (d) => DYN_TO_GROUP[dynNorm(d)] || String(d || '').trim();
function dynNorm(d) {
  const k = String(d || '').trim();
  if (!k) return '';
  const hit = DYN_MAP[k];
  if (hit) return hit;
  for (const key of DYN_KEYS) if (k.startsWith(key)) return DYN_MAP[key];
  return k;
}

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// ---------- 读主库全部分片，按 dynGroup 分组 ----------
const m = JSON.parse(fs.readFileSync(MAIN_MANIFEST, 'utf8'));
const dynMap = new Map();
let total = 0, missing = 0, emptyD = 0;
for (const c of m.collections) {
  for (const fn of c.chunks) {
    const fp = path.join(POEMS, fn);
    if (!fs.existsSync(fp)) { missing++; continue; }
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const r of arr) {
      const g = dynGroup(r.d);
      if (!g) { emptyD++; continue; }
      let e = dynMap.get(g);
      if (!e) { e = []; dynMap.set(g, e); }
      e.push(r.i);
      total++;
    }
  }
}

// 排序：按 DYN_GROUPS 时代顺序，脏值（未登记）排最后；同序按条数降序
const dynOrder = new Map(DYN_GROUPS.map((g, i) => [g.k, i]));
const sorted = [...dynMap.entries()]
  .map(([k, ids]) => ({ k, ids }))
  .sort((a, b) => {
    const ia = dynOrder.has(a.k) ? dynOrder.get(a.k) : 999;
    const ib = dynOrder.has(b.k) ? dynOrder.get(b.k) : 999;
    return ia - ib || b.ids.length - a.ids.length;
  });

console.log('主库 total =', m.total, '| collections =', m.collections.length);
console.log('dyn 覆盖 i 条数 =', total, '| 跳过空 d =', emptyD, '| 缺失分片 =', missing);
console.log('\n========== 各分组条数（' + sorted.length + ' 个） ==========');
for (const { k, ids } of sorted) {
  const isDirty = !dynOrder.has(k);
  console.log((isDirty ? '*' : ' ') + k.padEnd(10) + ' c=' + String(ids.length).padStart(8) + ' 分片=' + Math.ceil(ids.length / DYNBUCKET) + (isDirty ? '  [脏值/未登记朝代]' : ''));
}
const dirty = sorted.filter(x => !dynOrder.has(x.k));
console.log('\n正常分组 ' + (sorted.length - dirty.length) + ' 个，脏值分组 ' + dirty.length + ' 个');
console.log('脏值明细:', dirty.map(x => x.k + '(' + x.ids.length + ')').join(', ') || '无');

if (DRY) {
  console.log('\n[DRY-RUN] 未写入。加 --apply 执行（自动备份 idx/dyn/ 后清空重建）。');
  process.exit(0);
}

// ---------- 备份 + 清空 + 重建 ----------
const ts = Date.now();
const bakDir = DYN_DIR + '.bak.' + ts;
fs.cpSync(DYN_DIR, bakDir, { recursive: true });
console.log('\n已备份 idx/dyn/ -> ' + path.basename(bakDir));

fs.rmSync(DYN_DIR, { recursive: true, force: true });
fs.mkdirSync(DYN_DIR, { recursive: true });

const dynMeta = [];
sorted.forEach(({ k, ids }, oi) => {
  const chunks = [];
  for (let p = 0; p * DYNBUCKET < ids.length; p++) {
    const name = String(oi).padStart(3, '0') + '-' + String(p).padStart(4, '0') + '.json';
    fs.writeFileSync(path.join(DYN_DIR, name), JSON.stringify(ids.slice(p * DYNBUCKET, (p + 1) * DYNBUCKET)));
    chunks.push('dyn/' + name);
  }
  dynMeta.push({ k, c: ids.length, chunks });
});
fs.writeFileSync(DYN_JSON, JSON.stringify({ v: 1, rows: dynMeta }));
console.log('已重建 ' + dynMeta.length + ' 个分组 / ' + dynMeta.reduce((s, d) => s + d.chunks.length, 0) + ' 个分片');
console.log('写入完成：idx/dyn.json + idx/dyn/*.json');
