// poems-db (yxcs/poems-db) → 主库格式转换 v2
// 输入：data_2026-10-29/poems-db_poems{1..4}.json（JSONL，21万+首，含注释/译文/赏析）
// 输出：data_2026-10-29/cleaned2/{poems/, manifest.json}
// v2 修复：① 跳过「作者/词牌」等元数据条目 ② 跳过内容为空的条目
// 用法：node convert_poems-db.cjs
const fs = require('fs');
const path = require('path');

const IN_DIR = path.join(__dirname, 'data_2026-10-29');
const OUT_DIR = path.join(__dirname, 'data_2026-10-29', 'cleaned2');
const OUT_POEMS = path.join(OUT_DIR, 'poems');
const PER_CHUNK = 200;
const FILES = ['poems1', 'poems2', 'poems3', 'poems4'];

// ---------- 读取所有 JSONL 行 ----------
const allRecords = [];
let totalLines = 0, parseErrors = 0;

for (const fname of FILES) {
  const fpath = path.join(IN_DIR, `poems-db_${fname}.json`);
  const content = fs.readFileSync(fpath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  totalLines += lines.length;
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      allRecords.push(o);
    } catch (e) {
      parseErrors++;
    }
  }
  console.log(`${fname}: ${lines.length} lines`);
}

console.log('Parsed:', allRecords.length, '| errors:', parseErrors);

// ---------- 去重 ----------
const seen = new Set();
const unique = [];
for (const o of allRecords) {
  const key = (o.onlyId || (o.name + o.author + JSON.stringify(o.content).slice(0, 80)));
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(o);
}
console.log('After dedup:', unique.length);

// ---------- 过滤：跳过内容为空的条目 ----------
// type=词牌/作者 的条目其实是真诗（词牌名·词），不能跳过
const poems = [];
let skippedNoContent = 0;
for (const o of unique) {
  const content = Array.isArray(o.content) ? o.content.filter(s2 => s2.trim()) : String(o.content || '').split('\n').map(s2 => s2.trim()).filter(Boolean);
  if (!content.length) { skippedNoContent++; continue; }
  poems.push({ o, content });
}
console.log('After content filter:', poems.length, '| skipped no-content:', skippedNoContent);

// ---------- 朝代映射 ----------
function normDynasty(d) {
  const s = String(d || '').trim();
  const map = {
    '唐': '唐', '唐五代': '唐', '五代': '五代',
    '宋': '宋', '北宋': '宋', '南宋': '宋', '辽': '辽', '金': '金',
    '元': '元', '明': '明', '清': '清',
    '汉': '汉', '魏': '魏', '晋': '晋', '南北朝': '南北朝',
    '隋': '隋', '秦': '秦', '先秦': '先秦',
    '近现代': '近现代', '现代': '近现代', '当代': '近现代',
  };
  return map[s] || s || '';
}

// ---------- 类型 → 集合映射 ----------
const TYPE_TO_CID = {
  '唐诗三百首': 'tang300',
  '宋词三百首': 'songci300',
  '千家诗': 'qjs',
  '古诗三百首': 'tang300',
  '宋词': 'songci',
  '宋诗': 'song',
  '明诗': 'mingS',
  '清诗': 'qingS',
  '金元诗词': 'jinyuan',
  '元曲': 'yq',
  '诗经': 'shijing',
  '楚辞': 'chuci',
  '论语': 'lunyu',
  '古文观止': 'guwen',
  '古文': 'guwen',
  '赋': 'fu',
  '蒙学': 'mengxue',
  '蒙学经典': 'mengxue',
  '课文': 'keben',
  '曹操诗集': 'cc',
  '南唐二主词': 'nt',
  '花间集': 'hjj',
  '纳兰性德': 'nalan',
  '水墨唐诗': 'smts',
  // 原数据标记不规范：type=词牌/作者 的条目实际都是真诗
  '词牌': 'songci',
  '作者': 'other',
  '诗文': 'guwen',
};

// ---------- 按集合分组 ----------
const byCid = new Map();
for (const { o, content } of poems) {
  const t = String(o.type || '').trim();
  // 尝试直接映射
  let cid = TYPE_TO_CID[t];
  // 若未匹配，尝试前缀匹配（处理 GBK 乱码的 type，如"诗经 鍥介路鍛ㄥ崡"）
  if (!cid) {
    const prefixes = ['唐诗三百首', '宋词三百首', '古诗三百首', '古文观止', '诗经', '楚辞', '宋词'];
    for (const p of prefixes) {
      if (t.startsWith(p)) {
        cid = { '唐诗三百首': 'tang300', '宋词三百首': 'songci300', '古诗三百首': 'tang300', '古文观止': 'guwen', '诗经': 'shijing', '楚辞': 'chuci', '宋词': 'songci' }[p];
        break;
      }
    }
  }
  if (!cid) cid = 'other';
  if (!byCid.has(cid)) byCid.set(cid, []);
  byCid.get(cid).push({ o, content });
}

const CID_NAME = {
  tang300: '唐诗三百首', songci300: '宋词三百首', qjs: '千家诗',
  songci: '全宋词', song: '全宋诗', mingS: '明代诗词', qingS: '清代诗词',
  jinyuan: '金元诗词', yq: '元曲', shijing: '诗经', chuci: '楚辞',
  lunyu: '论语', guwen: '古文观止', fu: '历代赋', mengxue: '蒙学经典',
  keben: '课文名篇', cc: '曹操诗集', nt: '南唐二主词', hjj: '花间集',
  nalan: '纳兰性德词集', smts: '水墨唐诗', other: '诗词集·其他',
};
const CID_TAB = {
  tang300: '精选', songci300: '精选', qjs: '精选', keben: '精选',
  shijing: '经部', chuci: '经部', lunyu: '经部', mengxue: '经部',
  guwen: '古文', fu: '古文',
  songci: '全集', song: '全集', mingS: '全集', qingS: '全集',
  jinyuan: '全集', yq: '全集', cc: '全集', nt: '全集', hjj: '全集',
  nalan: '全集', smts: '全集', other: '全集',
};

// ---------- 写主库格式 ----------
fs.mkdirSync(OUT_POEMS, { recursive: true });
const manifest = { v: Date.now(), collections: [] };
let globalStart = 0;

const cidList = [...byCid.keys()].sort();
for (const cid of cidList) {
  const records = byCid.get(cid);
  if (!records.length) continue;
  const typeRecords = records.map(({ o, content }, idx) => ({
    i: globalStart + idx,
    t: o.name || '',
    a: o.author || '',
    d: normDynasty(o.dynasty),
    p: content.map(s2 => s2.replace(/\n/g, '')).filter(Boolean),
    tg: (o.tags || []).slice(0, 8),
    f: {
      y: Array.isArray(o.translate) ? o.translate.join('\n') : String(o.translate || ''),
      z: Array.isArray(o.notes) ? o.notes.join('\n') : String(o.notes || ''),
      s: Array.isArray(o.appreciation) ? o.appreciation.join('\n') : String(o.appreciation || ''),
    },
  }));
  const chunks = [];
  for (let i = 0; i < typeRecords.length; i += PER_CHUNK) {
    const chunkIdx = Math.floor(i / PER_CHUNK);
    const chunkFile = `${cid}-${String(chunkIdx).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(OUT_POEMS, chunkFile), JSON.stringify(typeRecords.slice(i, i + PER_CHUNK)), 'utf8');
    chunks.push(chunkIdx);
  }
  manifest.collections.push({
    id: cid,
    name: CID_NAME[cid] || cid,
    tab: CID_TAB[cid] || '全集',
    count: typeRecords.length,
    visible: typeRecords.length,
    start: globalStart,
    chunks,
  });
  globalStart += typeRecords.length;
  console.log(`${cid} (${CID_NAME[cid] || cid}): ${typeRecords.length} 条`);
}

manifest.total = globalStart;
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('---');
console.log('总计:', globalStart, '条,', cidList.length, '集合');
console.log('输出:', OUT_DIR);
