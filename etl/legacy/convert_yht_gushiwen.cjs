// yht050511/gushiwen → 主库格式转换
// 输入：data_2026-10-29/yht_gushiwen.json.gz（108,197 条，含 sons.译文及注释）
// 输出：data_2026-10-29/cleaned3/{poems/, manifest.json}
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN = path.join(__dirname, 'data_2026-10-29', 'yht_gushiwen.json.gz');
const OUT_DIR = path.join(__dirname, 'data_2026-10-29', 'cleaned3');
const OUT_POEMS = path.join(OUT_DIR, 'poems');
const PER_CHUNK = 200;

function normDynasty(d) {
  let s = String(d || '').trim();
  const map = {
    '唐': '唐', '唐五代': '唐', '五代': '五代',
    '宋': '宋', '北宋': '宋', '南宋': '宋', '辽': '辽', '金': '金',
    '元': '元', '明': '明', '清': '清',
    '汉': '汉', '两汉': '汉', '魏': '魏', '晋': '晋', '魏晋': '晋', '南北朝': '南北朝',
    '隋': '隋', '秦': '秦', '先秦': '先秦',
    '近现代': '近现代', '现代': '近现代', '当代': '近现代',
  };
  // 先查原名
  if (map[s]) return map[s];
  // 再剥离 代/朝/时 后缀后重查
  s = s.replace(/(代|朝|时)$/, '');
  return map[s] || s || '';
}

function dynastyToCid(dyn) {
  const s = normDynasty(dyn);
  if (s === '宋') return 'song';
  if (s === '明') return 'mingS';
  if (s === '清') return 'qingS';
  if (s === '唐') return 'tang';
  if (s === '金' || s === '元' || s === '辽' || s === '五代') return 'jinyuan';
  if (s === '汉' || s === '魏' || s === '晋' || s === '南北朝' || s === '隋' || s === '先秦' || s === '秦') return 'hanwei';
  if (s === '近现代') return 'xdS';
  return 'other';
}

function parseSons(sons) {
  let y = '', z = '', s = '';
  if (!sons) return { y, z, s };
  for (const [key, val] of Object.entries(sons)) {
    const content = val && val.content ? String(val.content) : '';
    if (key === '译文及注释' || key.startsWith('译文')) {
      // 格式：译文<br/>译文内容<br/>注释&nbsp;<br/>注释内容
      // 在「注释」标记处拆分
      const parts = content.split(/注释\s*&nbsp;|注释<br\s*\/?>|注释\s*<br\s*\/?>/i);
      y = parts[0] || '';
      z = parts.length > 1 ? parts.slice(1).join('\n') : '';
      // 清掉开头残留的「译文」标记
      y = y.replace(/^译文\s*&nbsp;?|^译文\s*<br\s*\/?>/i, '').trim();
    } else if (key === '赏析' || key === '鉴赏' || key === '简析') {
      if (!s) s = content;
    } else if (key === '创作背景') {
      // 创作背景暂不单独存，可合并到赏析
      if (s) s += '\n\n【创作背景】' + content;
    }
  }
  return { y, z, s };
}

function htmlToParas(html) {
  const s = String(html || '');
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  return text.split('\n').map(x => x.replace(/\s+/g, '')).filter(Boolean);
}

const buf = fs.readFileSync(IN);
const text = zlib.gunzipSync(buf, { charset: 'utf8' }).toString('utf8');
const data = JSON.parse(text);
console.log('读入:', data.length, '条');

const byCid = new Map();
let skipped = 0;
for (const o of data) {
  if (!o.title || !o.content) { skipped++; continue; }
  const cid = dynastyToCid(o.dynasty);
  if (!byCid.has(cid)) byCid.set(cid, []);
  byCid.get(cid).push(o);
}
console.log('按集合分组:', [...byCid.entries()].map(([k, v]) => k + ':' + v.length).join(', '));
console.log('跳过:', skipped);

fs.mkdirSync(OUT_POEMS, { recursive: true });
const manifest = { v: Date.now(), collections: [] };
let globalStart = 0;

const CID_NAME = {
  song: '全宋诗', mingS: '明代诗词', qingS: '清代诗词', tang: '全唐诗',
  jinyuan: '金元诗词', hanwei: '汉魏六朝诗', xdS: '近现代诗词', other: '诗词集·其他',
};

const cidList = [...byCid.keys()].sort();
for (const cid of cidList) {
  const records = byCid.get(cid);
  if (!records.length) continue;
  const typeRecords = records.map((o, idx) => {
    const { y, z, s } = parseSons(o.sons);
    const yp = htmlToParas(y);
    const zp = htmlToParas(z);
    const sp = htmlToParas(s);
    return {
      i: globalStart + idx,
      t: o.title || '',
      a: o.author || '',
      d: normDynasty(o.dynasty),
      p: htmlToParas(o.content),
      tg: [],
      f: { y: yp.join('\n'), z: zp.join('\n'), s: sp.join('\n') },
    };
  });
  const chunks = [];
  for (let i = 0; i < typeRecords.length; i += PER_CHUNK) {
    const chunkIdx = Math.floor(i / PER_CHUNK);
    const chunkFile = `${cid}-${String(chunkIdx).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(OUT_POEMS, chunkFile), JSON.stringify(typeRecords.slice(i, i + PER_CHUNK)), 'utf8');
    chunks.push(chunkFile);
  }
  manifest.collections.push({
    id: cid,
    name: CID_NAME[cid] || cid,
    tab: '全集',
    count: typeRecords.length,
    visible: typeRecords.length,
    start: globalStart,
    chunks,
    desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）',
  });
  globalStart += typeRecords.length;
  console.log(`${cid} (${CID_NAME[cid] || cid}): ${typeRecords.length} 条`);
}

manifest.total = globalStart;
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('---');
console.log('总计:', globalStart, '条,', cidList.length, '集合');
console.log('输出:', OUT_DIR);
