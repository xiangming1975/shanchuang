// CanvaChen/llm-dataset-chinese-poetry → 主库格式转换
// 输入：data_2026-10-29/canva_*.json（纯正文，无译文注释）
// 输出：data_2026-10-29/cleaned4/{poems/, manifest.json}
const fs = require('fs');
const path = require('path');

const IN_DIR = path.join(__dirname, 'data_2026-10-29');
const OUT_DIR = path.join(__dirname, 'data_2026-10-29', 'cleaned4');
const OUT_POEMS = path.join(OUT_DIR, 'poems');
const PER_CHUNK = 200;

// 目录 → 集合ID, 朝代
const FILE_MAP = [
  ['canva_五代诗词__huajianji', 'wudaishici', '五代'],
  ['canva_五代诗词__nantang', 'wudaishici', '五代'],
  ['canva_全唐诗__poet.tang', 'tang_canva', '唐'],
  ['canva_全唐诗__poet.song', 'song_canva', '宋'],
  ['canva_全唐诗__唐诗三百首', 'tang300_canva', '唐'],
  ['canva_御定全唐诗__御定全唐诗', 'yudingtang_canva', '唐'],
  ['canva_宋词__ci.song', 'songci_canva', '宋'],
  ['canva_宋词__宋词三百首', 'songci300_canva', '宋'],
  ['canva_四书五经__daxue', 'sishuwujing_canva', '先秦'],
  ['canva_四书五经__mengzi', 'sishuwujing_canva', '先秦'],
  ['canva_四书五经__zhongyong', 'sishuwujing_canva', '先秦'],
  ['canva_幽梦影__youmengying', 'ym_canva', '清'],
  ['canva_曹操诗集__caocao', 'caocao_canva', '汉魏'],
  ['canva_楚辞__chuci', 'chuci_canva', '先秦'],
  ['canva_水墨唐诗__shuimotangshi', 'shuimotangshi_canva', '唐'],
  ['canva_纳兰性德__纳兰性德诗集', 'nalan_canva', '清'],
  ['canva_蒙学__baijiaxing', 'mengxue_canva', '多朝代'],
  ['canva_蒙学__dizigui', 'mengxue_canva', '清'],
  ['canva_蒙学__qianziwen', 'mengxue_canva', '南朝'],
  ['canva_蒙学__sanzijing-new', 'mengxue_canva', '宋'],
  ['canva_蒙学__sanzijing-traditional', 'mengxue_canva', '宋'],
  ['canva_蒙学__zengguangxianwen', 'mengxue_canva', '明'],
  ['canva_蒙学__zhuzijiaxun', 'mengxue_canva', '清'],
  ['canva_论语__lunyu', 'lunyu_canva', '先秦'],
  ['canva_诗经__shijing', 'shijing_canva', '先秦'],
];

function contentToParas(content) {
  return String(content || '').split('\n').map(x => x.trim()).filter(Boolean);
}

const byCid = new Map();
let skipped = 0;
for (const [file, cid, dynasty] of FILE_MAP) {
  const filePath = path.join(IN_DIR, file + '.json');
  if (!fs.existsSync(filePath)) { console.log('跳过(不存在):', file); continue; }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data)) { console.log('跳过(非数组):', file); continue; }
    if (!byCid.has(cid)) byCid.set(cid, []);
    for (const o of data) {
      if (!o.title || !o.content) { skipped++; continue; }
      byCid.get(cid).push({ ...o, _dynasty: dynasty, _file: file });
    }
    console.log(file + ': ' + data.length + ' 条 → ' + cid);
  } catch (e) { console.log(file + ': 解析失败 ' + e.message); }
}
console.log('按集合分组:', [...byCid.entries()].map(([k, v]) => k + ':' + v.length).join(', '));
console.log('跳过:', skipped);

fs.mkdirSync(OUT_POEMS, { recursive: true });
const manifest = { v: Date.now(), collections: [] };
let globalStart = 0;

const CID_NAME = {
  wudaishici: '五代诗词',
  tang_canva: '全唐诗(补)', song_canva: '全宋诗(补)', tang300_canva: '唐诗三百首(补)',
  yudingtang_canva: '御定全唐诗(补)', songci_canva: '宋词(补)', songci300_canva: '宋词三百首(补)',
  sishuwujing_canva: '四书五经', ym_canva: '幽梦影', caocao_canva: '曹操诗集',
  chuci_canva: '楚辞', shuimotangshi_canva: '水墨唐诗', nalan_canva: '纳兰性德',
  mengxue_canva: '蒙学', lunyu_canva: '论语', shijing_canva: '诗经',
};

const cidList = [...byCid.keys()].sort();
for (const cid of cidList) {
  const records = byCid.get(cid);
  if (!records.length) continue;
  const typeRecords = records.map((o, idx) => {
    return {
      i: globalStart + idx,
      t: o.title || '',
      a: o.author || '',
      d: o._dynasty || '',
      p: contentToParas(o.content),
      tg: [],
      f: { y: '', z: '', s: '' },
    };
  });
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
    tab: '全集',
    count: typeRecords.length,
    visible: typeRecords.length,
    start: globalStart,
    chunks,
    desc: 'CanvaChen/llm-dataset-chinese-poetry（纯正文，无译文注释）',
  });
  globalStart += typeRecords.length;
  console.log(`${cid} (${CID_NAME[cid] || cid}): ${typeRecords.length} 条`);
}

manifest.total = globalStart;
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('---');
console.log('总计:', globalStart, '条,', cidList.length, '集合');
console.log('输出:', OUT_DIR);
