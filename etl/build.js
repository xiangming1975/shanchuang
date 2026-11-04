// ETL 第三步：多源合并 → 按集合规整排序 → site/data（分块/索引/作者/manifest/t2s/词牌）
// 两遍构建：PASS A 按集合分组写临时文件；PASS B 按 COLLECTIONS 顺序编号并产出
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out';
const SITE = process.env.SITE_DIR || 'C:/Users/xiang/Downloads/poetry-site/site';
const DATA = path.join(SITE, 'data');
const CHUNK = 200;
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

// 中间产物在 2026-10-27 整理时移到 archive（3.2GB，平时用不上）。
// 重建前先把它们移回，否则这里只有一句莫名其妙的 ENOENT。
if (!fs.existsSync(OUT)) {
  console.error('✗ 找不到 ' + OUT);
  console.error('  中间产物已被归档。重建前先恢复：');
  console.error('    cd ../poetry-site-archive-20261027 && node restore.js --only etl-out --go');
  console.error('    （还需要原始数据：node restore.js --only datasets --go）');
  process.exit(1);
}


// 朝代统一归一（多来源口径不一：唐代/唐、五代/五、近现代/近现…）
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
  // 源数据粘贴错误：朝代与紧邻字粘在一起（赵秉文「金由」、张嗣纲「明远」、孙炎「明碧」）
  '金由': '金', '明远': '明', '明碧': '明',
};
const DYN_KEYS = Object.keys(DYN_MAP).sort((a, b) => b.length - a.length);
const DYN_VALUES = new Set(Object.values(DYN_MAP));

// 朝代分组（2026-10-26）：16 个细朝代并成 7 个时段，供「按朝代」浏览。
// r.d 保留细粒度（详情页照旧显示「宋」「近现代」），分组只用于索引与列表。
// 顺序即浏览顺序：按时代先后，不按篇数。
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
const dynGroup = (d) => DYN_TO_GROUP[dynNorm(d)] || String(d || '').trim();
function dynNorm(d) {
  const k = String(d || '').trim();
  if (!k) return '';
  const hit = DYN_MAP[k];
  if (hit) return hit;
  // 未登记写法：取最长的已登记前缀（「先秦至汉」→先秦、「北魏」→南北朝、
  // 以及源数据里「明碧」这类粘连脏值），拿不到就原样返回，便于抽样时发现新脏值
  for (const key of DYN_KEYS) if (k.startsWith(key)) return DYN_MAP[key];
  return k;
}
// 译文行数（非空行）：用于比较 gushiwen 块状译文与 NiuTrans 段对齐译文的覆盖度
function nonEmptyLines(s) { return String(s || '').split('\n').filter(l => l.trim()).length; }
function normKey(s) { // 标题匹配键：繁→简逐字 + 去标点空白
  let o = '';
  for (const ch of String(s || '')) o += convT2S(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
}

const COLLECTIONS = [
  { id: 'tang300', name: '唐诗三百首', desc: '蘅塘退士编选唐诗选集', tab: '精选' },
  { id: 'shijing', name: '诗经', desc: '中国最早的诗歌总集，305篇', tab: '经部' },
  { id: 'chuci', name: '楚辞', desc: '屈原为首的楚辞集，65篇', tab: '经部' },
  { id: 'lunyu', name: '论语', desc: '孔子及其弟子言行录，20篇', tab: '经部' },
  { id: 'ssxx', name: '四书五经', desc: '大学·中庸·孟子', tab: '经部' },
  { id: 'guwen', name: '古文观止', desc: '清吴楚材吴调侯编古文选本，222篇', tab: '古文' },
  { id: 'mengxue', name: '蒙学经典', desc: '三字经·千字文·弟子规·声律启蒙等', tab: '古文' },
  { id: 'qjs', name: '千家诗', desc: '唐宋名诗选本', tab: '精选' },
  { id: 'mtssb', name: '唐诗三百首(蒙学版)', desc: '蒙学版唐诗三百首', tab: '精选' },
  { id: 'songci300', name: '宋词三百首', desc: '朱祖谋编选宋词选集', tab: '精选' },
  { id: 'hjj', name: '花间集', desc: '五代后蜀赵崇祚编词集，附注释', tab: '精选' },
  { id: 'nt', name: '南唐二主词', desc: '李璟李煜词集，附注释', tab: '精选' },
  { id: 'smts', name: '水墨唐诗', desc: '176首名诗解读', tab: '精选' },
  { id: 'cc', name: '曹操诗集', desc: '魏武帝曹操诗文', tab: '精选' },
  { id: 'nalan', name: '纳兰性德词集', desc: '清词第一人纳兰容若词集', tab: '精选' },
  { id: 'ymy', name: '幽梦影', desc: '清张潮随笔小品，附评点', tab: '古文' },
  { id: 'fu', name: '历代赋', desc: '先秦两汉魏晋南北朝唐宋元明清辞赋', tab: '古文' },
  { id: 'hanwei', name: '汉魏六朝诗', desc: '先秦两汉魏晋南北朝隋诗歌乐府', tab: '全集' },
  { id: 'jinyuan', name: '金元诗词', desc: '金元两代诗词', tab: '全集' },
  { id: 'mingS', name: '明代诗词', desc: '明代诗词', tab: '全集' },
  { id: 'qingS', name: '清代诗词', desc: '清代诗词', tab: '全集' },
  { id: 'xdS', name: '近现代诗词', desc: '近代以来旧体诗词', tab: '全集' },
  { id: 'gwdj', name: '古文典籍', desc: '经史子集名篇：左传·史记·汉书·家语等', tab: '古文' },
  { id: 'tang', name: '全唐诗', desc: '康熙朝编定，收唐五代诗', tab: '全集' },
  { id: 'song', name: '全宋诗', desc: '宋代诗歌总集', tab: '全集' },
  { id: 'songci', name: '全宋词', desc: '两宋词作总集', tab: '全集' },
  { id: 'yq', name: '元曲', desc: '元代杂剧散曲', tab: '全集' },
  // 放在最后：集合顺序决定 id，插到前面会让已有收藏错位
  { id: 'keben', name: '课文名篇', desc: '中小学必背篇目（统编版口径，含日积月累/古诗词诵读）', tab: '精选' },
  // 2026-10-28：《中国文学鉴赏辞典大系》里主库没收的作品，按版面规则分三个集合（诗 / 词曲 / 古文辞赋）
  { id: 'jsshi', name: '鉴赏诗选', desc: '历代诗鉴赏辞典选目，附赏析', tab: '鉴赏' },
  { id: 'jssci', name: '鉴赏词曲', desc: '唐宋词·宋词·元明清词·元曲鉴赏辞典选目，附赏析', tab: '鉴赏' },
  { id: 'jsswen', name: '鉴赏古文', desc: '古文·历代赋鉴赏辞典选目，附赏析与注释', tab: '鉴赏' },
  { id: 'pdb_guwen', name: '诗词库·古文观止补遗', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '古文' },
  { id: 'pdb_ming', name: '诗词库·明代', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_mod', name: '诗词库·近现代', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_other', name: '诗词库·其他', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_pre', name: '诗词库·汉魏六朝及以前', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_qing', name: '诗词库·清代', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_shijing', name: '诗词库·诗经补遗', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '经部' },
  { id: 'pdb_song', name: '诗词库·宋代', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_songci', name: '诗词库·宋词补遗', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_songci300', name: '诗词库·宋词三百首补遗', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '精选' },
  { id: 'pdb_tang', name: '诗词库·唐代', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'pdb_tang300', name: '诗词库·唐诗三百首补遗', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '精选' },
  { id: 'pdb_yuan', name: '诗词库·金元', desc: 'poems-db (yxcs/poems-db) 数据库提取，去重后分类并入', tab: '全集' },
  { id: 'ershisishi', name: '二十四史', desc: '二十四史（gujilab 经史部，纯原文）', tab: '古文' },
  { id: 'zitongjian', name: '资治通鉴', desc: '资治通鉴（gujilab 经史部，纯原文）', tab: '古文' },
  { id: 'jingbu', name: '古籍经部', desc: '古籍经部（gujilab 经史部，纯原文）', tab: '经部' },
  { id: 'hanwei_new', name: '汉魏六朝诗（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'jinyuan_new', name: '金元诗词（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'mingS_new', name: '明代诗词（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'other', name: '诗词集·其他', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'qingS_new', name: '清代诗词（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'song_new', name: '全宋诗（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'tang_new', name: '全唐诗（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'xdS_new', name: '近现代诗词（新增）', desc: 'yht050511/gushiwen（古诗文网爬取，含译文及注释）（cleaned3 未在主库命中的新诗）', tab: '全集' },
  { id: 'couplets', name: '对联', desc: '历代对联集萃', tab: '对联' },
  { id: 'feihualing', name: '飞花令', desc: '飞花令诗句', tab: '飞花令' },
  { id: 'citunes', name: '词牌', desc: '词牌格式范例', tab: '词牌' },
  { id: 'rhyme', name: '韵书', desc: '韵书注音释义', tab: '韵书' },
  { id: 'shihua', name: '诗话', desc: '诗话词话批评', tab: '诗话' },
  { id: 'siku', name: '四库全书', desc: '四库全书/宋文鉴等原文', tab: '四库全书' },
  { id: 'daizhige', name: '东海渔歌', desc: '清代女词人顾春《东海渔歌》词集', tab: '清词' },
  { id: 'guyishi', name: '古逸诗', desc: '先秦古逸诗(甯封子等)', tab: '先秦' },
  { id: 'wudaici', name: '五代词', desc: '五代词选(和凝等)', tab: '五代词' },
  { id: 'songbu', name: '宋诗补遗', desc: '陆游等宋诗补遗', tab: '宋诗' },
  { id: 'tangkuo', name: '唐人诗扩', desc: '李白等唐诗扩展', tab: '唐诗' },
  { id: 'qingci', name: '清词', desc: '清词(陈维崧等)', tab: '清词' },
  { id: 'shiciku', name: '诗词杂录', desc: '诗词杂录', tab: '诗词' },
  { id: 'zhtw', name: '繁体诗词', desc: '繁体中文诗词', tab: '诗词' },
  { id: 'tangkuo2', name: '唐诗·二', desc: '高适等唐诗', tab: '唐诗' },
  { id: 'shijingbu', name: '诗经补遗', desc: '诗经异文补遗', tab: '诗经' },
  { id: 'tangkuo3', name: '唐诗·三', desc: '杜牧等唐诗', tab: '唐诗' },
  { id: 'songciku', name: '宋词·女', desc: '李清照等宋词', tab: '宋词' },
  { id: 'songciku2', name: '宋词·二', desc: '宋词选', tab: '宋词' },
  { id: 'huici', name: '回文诗词', desc: '回文诗等', tab: '诗词' },
  { id: 'tang300ext', name: '唐诗三百首补', desc: '唐诗三百首补充', tab: '唐诗' },
  { id: 'huajianji', name: '花间集补', desc: '花间集等补充', tab: '唐五代词' },
  { id: 'mengxue_cht', name: '蒙学(测)', desc: '三字经千字文等', tab: '蒙学' },
  { id: 'jingbu_cht', name: '经部(测)', desc: '中庸等经部', tab: '经部' },
];
// 全文搜索开放的集合；tang/song 全量太大，仅收名篇（有译文或高star）
// 收录口径排除表：这些记录仍占 id（保 id→分块的映射），但打 hide 标记，不进索引、列表不显示。
// 见 etl/xds-exclude.json 的 note：直接删记录会让后面 40 万首 id 前移，用户收藏全部错位。
const EXCLUDE = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'xds-exclude.json'), 'utf8')); }
  catch (e) { console.log('排除表: 无（' + e.message + '）'); return {}; }
})();
const isHidden = (cid, t) => !!(EXCLUDE[cid] && Array.isArray(EXCLUDE[cid]) && EXCLUDE[cid].includes(t));

const FULLTEXT_SETS = new Set(['tang300', 'shijing', 'chuci', 'lunyu', 'ssxx', 'guwen', 'songci300', 'hjj', 'nt', 'cc', 'nalan', 'ymy', 'smts', 'hanwei', 'jinyuan', 'xdS', 'gwdj', 'fu', 'songci', 'yq', 'mingS', 'qingS', 'jsshi', 'jssci', 'jsswen']);
const FULLTEXT_FAMOUS = new Set(['tang', 'song']);
// 允许从全唐宋诗平仄键表补格律的集合
const STRAIN_FILL = new Set(['tang300', 'qjs', 'mtssb', 'smts', 'hanwei', 'jinyuan', 'mingS', 'qingS', 'xdS', 'cc']);

async function main() {
  // 注意：这里不再 rm -rf DATA。
  // 1) 环境的安全删除shim会拦截批量删除（阈值 50 个文件），整库删除必然触发；
  // 2) 构建是幂等覆盖的：分块文件名由 collStats 决定，manifest 只引用本次生成的 chunks，
  //    残留的旧分块不会被前端加载，只会占磁盘（需要时手动清）。
  fs.mkdirSync(path.join(DATA, 'poems'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'idx'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'authors'), { recursive: true });

  // ---------- 作者简介 ----------
  const R = 'C:/Users/xiang/Downloads/chinese-poetry-master';
  const localBios = new Map();
  const addBios = (file, field, dyn) => {
    try {
      for (const a of JSON.parse(fs.readFileSync(path.join(R, file), 'utf8'))) {
        if (a.name && !localBios.has(a.name)) localBios.set(a.name, { name: a.name, d: dyn, bio: String(a[field] || '').trim() });
      }
    } catch (e) { console.log('作者文件跳过', file, e.message); }
  };
  addBios('全唐诗/authors.tang.json', 'desc', '唐');
  addBios('全唐诗/authors.song.json', 'desc', '宋');
  addBios('宋词/author.song.json', 'description', '宋');
  addBios('五代诗词/nantang/authors.json', 'desc', '五代');
  const gswBios = new Map();
  try {
    for (const a of JSON.parse(fs.readFileSync(path.join(OUT, 'authors-gsw.json'), 'utf8'))) {
      if (a.name && (a.bio || a.d)) gswBios.set(a.name, { name: a.name, d: a.d || '', bio: a.bio || '' });
    }
  } catch (e) { console.log('gushiwen作者简介缺失:', e.message); }
  const allBios = new Map(localBios);
  for (const [k, v] of gswBios) {
    if (allBios.has(k)) { const t = allBios.get(k); if (!t.bio && v.bio) { t.bio = v.bio; t.d = v.d || t.d; } }
    else allBios.set(k, v);
  }
  console.log(`作者简介: 本地 ${localBios.size}, gushiwen ${gswBios.size}, 合并后 ${allBios.size}`);

  // ---------- 论语/四书译文补充（NiuTrans，out/f-extra.json 由 niu-extras.js 生成） ----------
  // 唐诗三百首补材料（etl/fill-tang300.js 产出，键 = 作品 id）
  let fillById = {};
  try {
    fillById = JSON.parse(fs.readFileSync(path.join(__dirname, 'tang300-fill.json'), 'utf8'));
    console.log('唐诗三百首补材料: ' + Object.keys(fillById).length + ' 条');
  } catch (e) { console.log('唐诗三百首补材料: 无'); }

  let fExtra = {};
  try { fExtra = JSON.parse(fs.readFileSync(path.join(OUT, 'f-extra.json'), 'utf8')); console.log('四书译文补充: ' + Object.keys(fExtra).length + ' 条'); } catch (e) { console.log('四书译文补充: 无'); }
  // 经部逐篇字词注（本站补注）：gushiwen 只有教材节选，整篇注释需另补。
  // 键统一走 normKey（繁简归一 + 去标点），所以文件里可以写「孟子·梁惠王上」这种自然标题。
  let jingbuZhu = {};
  const zhuFiles = ['lunyu-zhu.json', 'jingbu-zhu.json'];
  for (const zf of zhuFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, zf), 'utf8'));
      let n = 0;
      for (const [k, v] of Object.entries(raw)) { jingbuZhu[normKey(k)] = v; n++; }
      console.log(`经部字词注: ${zf} ${n} 篇`);
    } catch (e) { console.log(`经部字词注: ${zf} 无（${e.message}）`); }
  }
  console.log('经部字词注合计: ' + Object.keys(jingbuZhu).length + ' 篇');

  // ---------- 源文件合并 ----------
  const SRC = path.join(OUT, 'poems3.jsonl');
  const extras = ['poems-ingest.jsonl', 'poems-niu.jsonl', 'poems-fu.jsonl', 'poems-keben.jsonl', 'poems-buchong.jsonl', 'poems-extra79.jsonl']
    .map(f => path.join(OUT, f)).filter(f => fs.existsSync(f) && fs.statSync(f).size > 10);
  const MAIN = extras.length ? path.join(OUT, 'poems4.jsonl') : SRC;
  if (extras.length) {
    fs.copyFileSync(SRC, MAIN);
    const w4 = fs.createWriteStream(MAIN, { flags: 'a' });
    await new Promise((res, rej) => {
      let i = 0;
      w4.on('error', rej);
      const next = () => {
        if (i >= extras.length) { w4.end(res); return; }
        const rs = fs.createReadStream(extras[i]);
        rs.pipe(w4, { end: false });
        rs.on('end', () => { i++; next(); });
        rs.on('error', rej);
      };
      next();
    });
  }
  console.log('源: ' + MAIN + (extras.length ? ' (+' + extras.length + ' 扩充)' : ''));

  // ---------- PASS A: 按集合分组写临时文件 + 字频 ----------
  console.time('passA');
  const charFreq = new Map();
  const strainMap = new Map(); // 全唐宋诗平仄 → 精选集映射键表
  const tmpStreams = {};
  let totalIn = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(MAIN, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const line2 = line.trim();
    if (!line2) continue;
    let r;
    try { r = JSON.parse(line2); } catch { continue; }
    if (!COLLECTIONS.find(x => x.id === r.c)) { console.log('未知集合，跳过: ' + r.c); continue; }
    if (!tmpStreams[r.c]) tmpStreams[r.c] = fs.createWriteStream(path.join(OUT, 'tmp-' + r.c + '.jsonl'), { encoding: 'utf8' });
    tmpStreams[r.c].write(line2 + '\n');
    // 平仄键表（全唐诗/全宋诗 → 供精选集映射）
    if ((r.c === 'tang' || r.c === 'song') && r.st && r.st.length) {
      const p0 = (r.p && r.p[0]) ? String(r.p[0]) : '';
      if (p0) {
        const k = normKey(r.t) + '|' + normKey(p0.slice(0, 12));
        if (!strainMap.has(k)) strainMap.set(k, r.st);
      }
    }
    const addChars = s => { if (s) for (const ch of String(s)) charFreq.set(ch, (charFreq.get(ch) || 0) + 1); };
    addChars(r.t); addChars(r.a);
    if (r.p) for (const ln of r.p) addChars(ln);
    totalIn++;
  }
  await Promise.all(Object.values(tmpStreams).map(s => new Promise(res => s.end(res))));
  console.timeEnd('passA');
  console.log('PASS A: ' + totalIn + ' 条分组完成');

  // ---------- 名句原文（提前读入：PASS B 里要按名句作者收窄候选） ----------
  let mingjuRaw = [];
  try {
    mingjuRaw = JSON.parse(fs.readFileSync('C:/Users/xiang/Downloads/poetry-site/downloads/jd-extra/mingju.json', 'utf8'));
  } catch (e) { console.log('名句数据缺失:', e.message); }
  const PUNCT_RE = /[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g;
  const stripPunct = (x) => String(x || '').replace(PUNCT_RE, '');
  const mjAuthorSet = new Set();
  for (const m of mingjuRaw) { const na = normKey(m && m.poetName || ''); if (na) mjAuthorSet.add(na); }

  // ---------- 正文覆盖（人工校勘稿） ----------
  // 键：集合id|标题|同标题序号。目前用于 ①孟子·梁惠王上（按通行本重排分段与标点）
  // ②楚辞全部（繁体版，取代数据源里的简体）。见 etl/text-override.json 的 note 字段。
  // 正文覆盖：可挂多个文件（text-override = 经部/楚辞；songci-override = 宋词三百首补字）
  let textOverride = { items: {} };
  for (const ovf of ['text-override.json', 'songci-override.json']) {
    try {
      const part = JSON.parse(fs.readFileSync(path.join(__dirname, ovf), 'utf8'));
      const n = Object.keys(part.items || {}).length;
      Object.assign(textOverride.items, part.items || {});
      console.log(`正文覆盖: ${ovf} ${n} 篇`);
    } catch (e) { console.log(`正文覆盖: ${ovf} 无（${e.message}）`); }
  }
  console.log('正文覆盖合计: ' + Object.keys(textOverride.items || {}).length + ' 篇');
  const ovSeen = new Map();
  const takeOverride = (cid, title) => {
    const base = cid + '|' + title + '|';
    const n = ovSeen.get(base) || 0;
    ovSeen.set(base, n + 1);
    return (textOverride.items || {})[base + n] || null;
  };

  // ---------- PASS B: 规范顺序编号 + 产出 ----------
  console.time('passB');
  const collStats = {};
  const hotSeen = new Set();
  const starPool = [];
  const ftByColl = new Map();   // 集合 id → 全文索引行；按集合分包，绕过单文件 25MB 的部署限制
  let ftTotal = 0;
  const authorPoems = new Map();
  const authorCounts = new Map();
  const mingjuByTitle = new Map();      // normKey(标题) → 作品 id
  const mingjuByTitleAuthor = new Map(); // normKey(标题)|normKey(作者) → 作品 id
  const mjAuthorTitles = new Map();      // normKey(作者) → [[normKey(标题), id]]，只收名句作者的
  const bodyByI = new Map();             // id → 去标点正文前 180 字（名句候选校验用）
  let gi = 0;
  let chunkBuf = [], chunkIdx = 0, curColl = null;
  const flush = () => {
    if (!chunkBuf.length) return;
    const file = path.join(DATA, 'poems', `${curColl}-${String(chunkIdx).padStart(4, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(chunkBuf));
    collStats[curColl].chunks.push(path.basename(file));
    chunkBuf = []; chunkIdx++;
  };
  for (const coll of COLLECTIONS) {
    const tmpPath = path.join(OUT, 'tmp-' + coll.id + '.jsonl');
    if (!fs.existsSync(tmpPath)) continue;
    curColl = coll.id;
    chunkIdx = 0;
    collStats[coll.id] = { count: 0, chunks: [] };
    const rlB = readline.createInterface({ input: fs.createReadStream(tmpPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rlB) {
      const r = JSON.parse(line);
      r.i = gi;
      collStats[coll.id].count++;
      // ① gushiwen 把异文校记混进正文：沁园春·雪「(余 通：馀)」「(红装 一作：银装)」、
      //    蝶恋花「(俱莫 一作：俱暮)」。这类括号里只有「某字 + 一作/原作/通 + 某字」，整体删掉。
      const stripVar = (x) => (x && /[（(][^（()）]{1,10}(?:一作|原作|通)[：:][^（()）]{1,10}[)）]/.test(x))
        ? x.replace(/\s*[（(][^（()）]{1,10}(?:一作|原作|通)[：:][^（()）]{1,10}[)）]/g, '')
        : x;
      // ② 源数据偶尔把行内脚注粘进正文（孟子·盡心上末段：「…乎？」1. 猶 : 或作「由」。《孟子正義》作「由」。）
      // ③ 源数据里混进全角/半角空格（赋最多，如「而未摅　，思比象于紫微」）：站内没有任何段落靠空格缩进
      //    （缩进走 CSS text-indent），所以直接去掉。前端 renderPoem 也有一层同样的清理，双保险。
      const stripSpaces = (x) => (x ? String(x).replace(/[ \u00a0\u3000\u200b\t]/g, '') : x);
      const cleanP = (x) => {
        x = stripVar(x);
        if (x && /\d\.\s/.test(x)) x = x.replace(/\d+\.\s*[^\s。]{1,8}\s*[:：]\s*(?:或作|一作|《)[^\n]*$/, '').trimEnd();
        return stripSpaces(x);
      };
      const hidden = isHidden(coll.id, r.t);
      const ov = takeOverride(coll.id, r.t);
      // 《古文观止》39 篇把朝代写在作者串里（「兩漢：劉向」），朝代字段是空的。
      // 救回来的同时把前缀从作者名剥掉，否则详情页会出现「汉 · 兩漢：劉向」。
      let dRaw = String(r.d || '').trim();
      let aRaw = (ov && ov.a) || r.a;
      if (!dRaw && aRaw) {
        const m = String(aRaw).match(/^([^：:]{1,6})[：:]\s*/);
        if (m) {
          const cand = dynNorm(convT2S(m[1]));
          if (DYN_VALUES.has(cand)) {
            dRaw = cand;
            aRaw = String(aRaw).slice(m[0].length).replace(/\s*(撰|著|編|编)$/, '').trim();
          }
        }
      }
      const rec = {
        i: r.i,
        t: (ov && ov.t) || r.t,
        a: aRaw,
        d: dynNorm(dRaw),
        p: ov && ov.p ? ov.p.slice() : (r.p || []).map(cleanP),
      };
      if (r.tg && r.tg.length) rec.tg = r.tg;
      if (r.n) rec.n = r.n;
      if (r.pr) rec.pr = r.pr;
      if (r.cm) rec.cm = r.cm;
      if (r.h) rec.h = r.h;
      if (hidden) { rec.hide = 1; collStats[coll.id].hidden = (collStats[coll.id].hidden || 0) + 1; }
      if (r.st) rec.st = r.st;
      else if (STRAIN_FILL.has(r.c) && r.p && r.p[0]) {
        const st2 = strainMap.get(normKey(r.t) + '|' + normKey(String(r.p[0]).slice(0, 12)));
        if (st2) rec.st = st2;
      }
      if (r.f) rec.f = r.f;
      // 名句索引键表（标题 → 作品 id；按 COLLECTIONS 顺序，首个收录的集合优先）
      if (r.t && !hidden) {
        const kt = normKey(r.t);
        if (kt && !mingjuByTitle.has(kt)) mingjuByTitle.set(kt, r.i);
        const ka = kt + '|' + normKey(r.a || '');
        if (ka && !mingjuByTitleAuthor.has(ka)) mingjuByTitleAuthor.set(ka, r.i);
      }
      // 唐诗三百首按 id 补材料：只填空缺，不覆盖已有
      const fill = fillById[r.i];
      if (fill) {
        const f = Object.assign({}, rec.f || {});
        let touched = false;
        if (fill.y && !f.y) { f.y = fill.y; touched = true; }
        if (fill.z && !f.z) { f.z = fill.z; touched = true; }
        if (fill.s && !f.s) { f.s = fill.s; touched = true; }
        if (touched) rec.f = f;
      }
      // 译文/注释补齐（论语/中庸/大学/孟子 + 诗经异体篇名补充）
      const ex = fExtra[normKey(r.t)];
      if (ex) {
        const e = (typeof ex === 'string') ? { y: ex } : ex;
        const f = Object.assign({}, rec.f || {});
        let ch = false;
        // 译文：NiuTrans 段对齐版覆盖更多段时替换（gushiwen 旧匹配常为不齐整块状文本）
        if (e.y && (!f.y || nonEmptyLines(f.y) < nonEmptyLines(e.y))) { f.y = e.y; ch = true; }
        if (e.z && !f.z) { f.z = e.z; ch = true; }
        if (e.s && !f.s) { f.s = e.s; ch = true; }
        if (ch) rec.f = f;
      }
      // 经部：补入全篇字词注（原有 gushiwen 节选注释保留在前，buildNotes 按词条去重）
      const lz = jingbuZhu[normKey(r.t)];
      if (lz) {
        const f3 = Object.assign({}, rec.f || {});
        f3.z = [f3.z, lz].filter(Boolean).join('\n');
        rec.f = f3;
      }
      chunkBuf.push(rec);
      if (hidden) { gi++; if (chunkBuf.length >= CHUNK) flush(); continue; }
      if (r.jd >= 500) {
        rec.hot = 1;      // 标记「热」：与 idx/hot.json 同一口径（JoyDraw star≥500），约千分之一
        const k = (r.t || '') + '|' + (r.a || '');
        if (!hotSeen.has(k)) { hotSeen.add(k); starPool.push({ i: r.i, t: r.t, a: r.a, h: r.jd * 20 + (r.h || 0) }); }
      }
      if (FULLTEXT_SETS.has(r.c) || (FULLTEXT_FAMOUS.has(r.c) && (r.f || r.jd >= 500))) {
        if (!ftByColl.has(r.c)) ftByColl.set(r.c, []);
        ftByColl.get(r.c).push([r.i, r.t, r.a, (r.p || []).join('\n').slice(0, 200)]);
        ftTotal++;
      }
      // 名句匹配辅助：同作者标题表 + 正文指纹（校验候选选得对不对）
      if (r.a && mjAuthorSet.size) {
        const na = normKey(r.a);
        if (mjAuthorSet.has(na)) {
          let arr = mjAuthorTitles.get(na);
          if (!arr) { arr = []; mjAuthorTitles.set(na, arr); }
          arr.push([normKey(r.t || ''), r.i]);
        }
      }
      if (r.p && r.p.length) bodyByI.set(r.i, stripPunct(r.p.join('')).slice(0, 320));
      if (r.a) {
        authorCounts.set(r.a, (authorCounts.get(r.a) || 0) + 1);
        if (!authorPoems.has(r.a)) authorPoems.set(r.a, []);
        const arr = authorPoems.get(r.a);
        if (arr.length < 300) arr.push({ i: r.i, t: r.t || '' });
      }
      gi++;
      if (chunkBuf.length >= CHUNK) flush();
    }
    flush();
    // 临时分块文件删不掉不影响产物：环境的安全删除 shim 偶尔会超时，
    // 这里用 unlink 并容错，避免整轮构建因为删一个中间文件而中断。
    try { fs.unlinkSync(tmpPath); } catch (e) { console.log('临时文件保留: ' + path.basename(tmpPath)); }
  }
  starPool.sort((a, b) => b.h - a.h);
  fs.writeFileSync(path.join(DATA, 'idx', 'hot.json'), JSON.stringify(starPool.slice(0, 2000)));
  console.log(`热门池: ${Math.min(starPool.length, 2000)} 条 (star 去重)`);
  let stFilled = 0;
  const fyByColl = {};
  for (const coll of COLLECTIONS) { const stt = collStats[coll.id]; if (stt) for (const cf of stt.chunks) { const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', cf), 'utf8')); for (const r of arr) { if (r.st) stFilled++; if (r.f && r.f.y) fyByColl[coll.id] = (fyByColl[coll.id] || 0) + 1; } } }
  console.log(`带平仄作品: ${stFilled} 首`);
  const fyTotal = Object.values(fyByColl).reduce((a, b) => a + b, 0);
  console.log(`带译文作品: ${fyTotal} 首（lunyu ${fyByColl.lunyu || 0}/${(collStats.lunyu || {}).count || 0} · ssxx ${fyByColl.ssxx || 0}/${(collStats.ssxx || {}).count || 0} · shijing ${fyByColl.shijing || 0} · guwen ${fyByColl.guwen || 0}）`);
  console.timeEnd('passB');
  console.log(` poems 分块完成, 共 ${gi} 首`);

  // ---------- 作者数据 ----------
  const authorList = [];
  for (const [name, poems] of authorPoems) {
    const bio = allBios.get(name) || {};
    authorList.push({ name, n: authorCounts.get(name) || 0, d: bio.d || '', bio: bio.bio || '', p: poems });
  }
  authorList.sort((a, b) => b.n - a.n);
  const authorChunkCount = Math.ceil(authorList.length / 800);
  for (let k = 0; k < authorChunkCount; k++) {
    fs.writeFileSync(path.join(DATA, 'authors', `a-${String(k).padStart(3, '0')}.json`), JSON.stringify(authorList.slice(k * 800, (k + 1) * 800)));
  }
  const authorIdx = {};
  authorList.forEach((a, k) => { authorIdx[a.name] = [Math.floor(k / 800), k % 800]; });
  fs.writeFileSync(path.join(DATA, 'idx', 'authors.json'), JSON.stringify(authorIdx));
  console.log(`作者: ${authorList.length} 位, 分块 ${authorChunkCount}`);

  // ---------- 全文索引（按集合分包：idx/ft/<cid>.json + idx/ft/index.json） ----------
  // 大分片切子片（2026-11-01）：单片磁盘 ~3MB 封顶（阈值/口径与 etl/split-ft.mjs 一致），
  // 正文检索才能逐片渐进落地——pdb_song 13.8MB 一片下载要几秒，第一批结果出不来。
  // 子片名 <cid>~k；order 按序展开，前端扫描顺序与结果不变。
  const ftDir = path.join(DATA, 'idx', 'ft');
  fs.mkdirSync(ftDir, { recursive: true });
  const FT_SHARD_MAX = 3 * 1024 * 1024;   // Buffer.byteLength 口径
  const ftOrder = [];
  for (const coll of COLLECTIONS) {
    const rows = ftByColl.get(coll.id);
    if (!rows || !rows.length) continue;
    let groups = [rows];
    if (Buffer.byteLength(JSON.stringify(rows)) > FT_SHARD_MAX * 1.2) {
      // 贪心装箱：行是原子单位（一首的全文不能拦腰断）
      groups = [];
      let cur = [], curB = 0;
      for (const row of rows) {
        const rb = Buffer.byteLength(JSON.stringify(row));
        if (curB + rb > FT_SHARD_MAX && cur.length) { groups.push(cur); cur = []; curB = 0; }
        cur.push(row); curB += rb;
      }
      if (cur.length) groups.push(cur);
    }
    for (let k = 0; k < groups.length; k++) {
      const id = groups.length === 1 ? coll.id : `${coll.id}~${k + 1}`;
      const buf = JSON.stringify(groups[k]);
      fs.writeFileSync(path.join(ftDir, id + '.json'), buf);
      ftOrder.push({ id, n: groups[k].length, b: buf.length });
    }
  }
  const ftMax = ftOrder.reduce((m, o) => Math.max(m, o.b), 0);
  fs.writeFileSync(path.join(ftDir, 'index.json'), JSON.stringify({ v: 1, total: ftTotal, order: ftOrder }));
  // 旧的单文件（48MB）超 Cloudflare Pages 25MB 限制，删掉避免误部署
  try { fs.unlinkSync(path.join(DATA, 'idx', 'fulltext.json')); } catch (e) {}
  console.log(`全文索引: ${ftTotal} 行 / ${ftOrder.length} 个分片，最大 ${(ftMax / 1048576).toFixed(1)}MB`);

  // ---------- names 索引（3 列）+ 首句独立文件（仅重复标题，瘦身） ----------
  console.time('names');
  // 精选快道（2026-11-01）：fast.json 只装 BONUS_COLLS 那些集合的行（与 names 同源同序，
  // 只是先挑出来，~277KB），前端首搜第一跳拉它，不用等 1.9MB 的 p00。
  // 这里是 CJS，require 不了站内 rank.js（ESM）——清单从 rank.js 源码里抠，
  // 宁可构建期报错也不让两份清单悄悄漂移（运行时事实源始终是 rank.js）。
  const rankSrc = fs.readFileSync(path.join(SITE, 'js', 'rank.js'), 'utf8');
  const bonusMatch = rankSrc.match(/BONUS_COLLS = new Set\(\[([^\]]*)\]\)/);
  if (!bonusMatch) throw new Error('rank.js 里找不到 BONUS_COLLS 定义，fast.json 清单无法同步，请检查 site/js/rank.js');
  const FAST_SET = new Set((bonusMatch[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
  if (!FAST_SET.size) throw new Error('BONUS_COLLS 解析结果为空，fast.json 不写');
  // 流式遍历所有已产出分块（避免把 214 万条全部驻留内存）
  const eachRow = (fn) => {
    for (const coll of COLLECTIONS) {
      const st = collStats[coll.id];
      if (!st) continue;
      for (const cf of st.chunks) {
        const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', cf), 'utf8'));
        for (const r of arr) fn(r, coll);
      }
    }
  };
  // 流式两遍，避免把 214 万条全部驻留内存（原 allRows 在 2.1M 时会 OOM）
  const fastBuf = [];
  const titleCnt = new Map(); // 归一键 -> 出现次数
  let rowsTotal = 0;          // 全部记录数（含 hide，等价原 allRows.length）
  // 第一遍复用 eachRow（第十轮 🟡-7，2026-11-04）：原先这里另写了一套三重循环，
  // 与 eachRow 的遍历范围完全一致（COLLECTIONS × chunks × rows），纯重复代码
  eachRow((r) => {
    rowsTotal++;
    const k = normKey(r.t);
    titleCnt.set(k, (titleCnt.get(k) || 0) + 1);
  });
  // names 也分包：单文件 19.6MB 离 Cloudflare Pages 25MB 上限太近，再加集合就会超。
  // 每片 4MB 左右，前端按清单并行取、按序拼回一整串（调用方拿到的仍是纯文本）。
  const namesDir = path.join(DATA, 'idx', 'names');
  fs.mkdirSync(namesDir, { recursive: true });
  const NAMES_PART_MAX = 4 * 1024 * 1024;
  const nameParts = [];
  let partBuf = [], partBytes = 0, partIdx = 0;
  const flushNames = () => {
    if (!partBuf.length) return;
    const id = 'p' + String(partIdx).padStart(2, '0');
    const text = partBuf.join('');
    fs.writeFileSync(path.join(namesDir, id + '.json'), text);
    nameParts.push({ id, n: partBuf.length, b: Buffer.byteLength(text) });
    partBuf = []; partBytes = 0; partIdx++;
  };
  const firstLines = {};
  for (const coll of COLLECTIONS) {
    const st = collStats[coll.id];
    if (!st) continue;
    const fastColl = FAST_SET.has(coll.id);
    for (const cf of st.chunks) {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', cf), 'utf8'));
      for (const r of arr) {
        if (fastColl && !r.hide) fastBuf.push(r);
        if (r.hide) continue;
        const line = `${r.i}\t${r.t || ''}\t${r.a || ''}\n`;
        partBuf.push(line);
        partBytes += Buffer.byteLength(line);
        if (partBytes >= NAMES_PART_MAX) flushNames();
        if (titleCnt.get(normKey(r.t)) > 1) {
          firstLines[r.i] = (r.p && r.p[0] ? String(r.p[0]) : '').replace(/\s+/g, ' ').slice(0, 24);
        }
      }
    }
  }
  flushNames();
  fs.writeFileSync(path.join(namesDir, 'index.json'),
    JSON.stringify({ v: 1, total: rowsTotal, parts: nameParts }));
  try { fs.unlinkSync(path.join(DATA, 'idx', 'names.json')); } catch (e) {}   // 旧单文件退场
  fs.writeFileSync(path.join(DATA, 'idx', 'firstlines.json'), JSON.stringify(firstLines));
  // 精选快道落地：行格式与 names 分片完全一致（id\t题\t作者\n）
  const fastText = fastBuf.map(r => `${r.i}\t${r.t || ''}\t${r.a || ''}\n`).join('');
  fs.writeFileSync(path.join(DATA, 'idx', 'fast.json'), fastText);
  console.log(`fast.json: ${fastBuf.length} 行 / ${(Buffer.byteLength(fastText) / 1024).toFixed(0)}KB（精选快道，${FAST_SET.size} 个集合）`);
  const dupCount = Object.keys(firstLines).length;
  console.timeEnd('names');
  console.log(`names 索引: ${rowsTotal} 行 (3列) / ${nameParts.length} 个分片（最大 ${(Math.max(...nameParts.map(x => x.b)) / 1048576).toFixed(1)}MB）, firstlines: ${dupCount} 条重复标题`);

  // ---------- 名句索引（JoyDraw ju 表 → 本站作品 id） ----------
  // mingju.json: [{content, poetName, poetryName}]；poetryId 是 JoyDraw 空间，必须回落到本站 id。
  // 逐级匹配（每级都尽量用作者收窄）：
  //   ① 标题+作者 精确   ② 标题 精确   ③ 词牌·副题取副题   ④ 去「其一/二首」类序号   ⑤ 去括号注
  //   ⑥ 同作者候选打分（副题命中 + 公共前缀长度），再用正文指纹确认选中的那首真的含这句
  const mjRows = [];
  const mjSeen = new Set();
  const mjHow = {};
  const CN = '一二三四五六七八九十百';
  const RE_SEQ = new RegExp(`([·・]其[${CN}]+|其[${CN}]+|[(（][${CN}]+[)）]|[${CN}]+首|[${CN}]+章)$`);
  const stripSeq = (x) => {
    let t = String(x || '').trim(), again = true;
    while (again) {
      again = false;
      const m = t.match(RE_SEQ);
      if (m && t.length > m[1].length) { t = t.slice(0, -m[1].length); again = true; }
    }
    return t;
  };
  const stripParen = (x) => String(x || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[〔\[【][^〕\]】]*[〕\]】]/g, '').trim();
  const bodyHas = (id, needle) => {
    if (!needle) return false;
    const b = bodyByI.get(id);
    return !!b && b.indexOf(needle) >= 0;
  };
  // 同作者候选：按分数降序，取第一个正文能对上的；只有一个候选时直接收（无歧义）
  function pickByAuthor(name, author, needle) {
    const arr = mjAuthorTitles.get(normKey(author));
    if (!arr || !arr.length) return null;
    const nk = normKey(name);
    const dot = name.indexOf('·');
    const base = normKey(dot > 0 ? name.slice(0, dot) : name);
    const sub = dot > 0 ? normKey(name.slice(dot + 1)) : '';
    const scored = [];
    for (const [nt, id] of arr) {
      let sc = 0;
      if (nt && nt === nk) sc = 1000;
      else if (nk && nt && (nt.startsWith(nk) || nk.startsWith(nt))) sc = 300 + Math.min(nt.length, nk.length);
      else if (base && nt.startsWith(base)) sc = 100 + (sub && nt.indexOf(sub) >= 0 ? 80 : 0) + Math.min(nt.length, base.length);
      if (sc) scored.push([sc, id]);
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (scored.length === 1) return scored[0][1];
    for (let k = 0; k < Math.min(scored.length, 8); k++) {
      if (bodyHas(scored[k][1], needle)) return scored[k][1];
    }
    return null;   // 多候选且都对不上正文 → 宁可不链，避免跳到错的作品
  }

  for (const m of mingjuRaw) {
    if (!m) continue;
    const name = String(m.poetryName || '').trim();
    const author = String(m.poetName || '');
    const content = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (!name || !content) continue;
    const needle = stripPunct(content).slice(0, 12);
    let id, how;
    const nk = normKey(name);

    if ((id = mingjuByTitleAuthor.get(nk + '|' + normKey(author))) !== undefined) how = 'title+author';
    else if ((id = mingjuByTitle.get(nk)) !== undefined) how = 'title';
    else if (name.indexOf('·') > 0 && (id = mingjuByTitle.get(normKey(name.split('·').pop()))) !== undefined) how = 'subtitle';
    if (id === undefined) {
      const s1 = stripSeq(name);
      if (s1 !== name) id = mingjuByTitleAuthor.get(normKey(s1) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s1));
      if (id !== undefined) how = 'seq';
    }
    if (id === undefined && name.indexOf('·') > 0) {
      const tail = stripSeq(name.split('·').pop());
      if (tail && tail !== name.split('·').pop()) id = mingjuByTitle.get(normKey(tail));
      if (id !== undefined) how = 'seq';
    }
    if (id === undefined) {
      const s2 = stripParen(name);
      if (s2 && s2 !== name) id = mingjuByTitleAuthor.get(normKey(s2) + '|' + normKey(author)) ?? mingjuByTitle.get(normKey(s2));
      if (id !== undefined) how = 'paren';
    }
    if (id === undefined) {
      const cand = pickByAuthor(stripSeq(stripParen(name)), author, needle)
        ?? (name.indexOf('·') > 0 ? pickByAuthor(name.split('·')[0], author, needle) : null);
      if (cand != null) { id = cand; how = 'author+fuzzy'; }
    }
    // 异题：标题完全对不上时，在该作者的作品里按正文找（同作者 + 正文命中，精度足够）
    if (id === undefined && author) {
      const arr = mjAuthorTitles.get(normKey(author));
      if (arr) {
        for (const [, cid] of arr) {
          if (bodyHas(cid, needle)) { id = cid; how = 'content'; break; }
        }
      }
    }
    if (id === undefined) { mjHow.none = (mjHow.none || 0) + 1; continue; }
    if (mjSeen.has(content)) continue;
    mjSeen.add(content);
    mjRows.push([content, author, name, id]);
    mjHow[how] = (mjHow[how] || 0) + 1;
  }
  // 给每条名句补上朝代/所属集合/标签：名句库要做「按朝代/按题材」筛选，
  // 逐条 getPoem 代价太大，这里按 id 定位到分块，一次只读用得到的块。
  try {
    const starts = [];
    let acc = 0;
    for (const c of COLLECTIONS) {
      const n = (collStats[c.id] || {}).count || 0;
      starts.push({ id: c.id, name: c.name, start: acc, count: n });
      acc += n;
    }
    const cache = new Map();
    const colOf = (id) => {
      let lo = 0, hi = starts.length - 1, hit = starts[0];
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (id >= starts[mid].start) { hit = starts[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return hit;
    };
    for (const row of mjRows) {
      const id = row[3];
      const c = colOf(id);
      const file = path.join(DATA, 'poems', `${c.id}-${String(Math.floor((id - c.start) / CHUNK)).padStart(4, '0')}.json`);
      let arr = cache.get(file);
      if (!arr) { try { arr = JSON.parse(fs.readFileSync(file, 'utf8')); cache.set(file, arr); } catch { arr = []; cache.set(file, arr); } }
      const rec = arr.find(x => x.i === id);
      row[4] = rec ? (rec.d || '') : '';
      row[5] = c.name;
      row[6] = rec && rec.tg ? rec.tg : [];
    }
    console.log(`名句元信息: ${mjRows.length} 条（读了 ${cache.size} 个分块）`);
  } catch (e) { console.log('名句元信息跳过:', e.message); }

  fs.writeFileSync(path.join(DATA, 'idx', 'mingju.json'), JSON.stringify(mjRows));
  console.log(`名句索引: ${mjRows.length}/${mingjuRaw.length} 条匹配到本站作品 ` +
    Object.entries(mjHow).map(([k, v]) => `${k}=${v}`).join(' '));
  bodyByI.clear();   // 468k 条正文指纹只在名句匹配阶段需要

  // ---------- 标签索引（详情页标签可点 → 标签聚合页 #/t/<标签>） ----------
  // 键用 normKey（繁简归一并去标点），别名表保留原始写法；每个标签记录主要来源 tab（精选/经部/古文/全集），
  // 前端据此把「列传」「本纪」这类书目篇目从首页热门标签里过滤掉。
  const idTabRanges = [];
  {
    let s = 0;
    for (const c of COLLECTIONS) {
      const st = collStats[c.id] || { count: 0 };
      idTabRanges.push([s, s + st.count, c.tab || '']);
      s += st.count;
    }
  }
  const tabOfId = (id) => {
    let lo = 0, hi = idTabRanges.length - 1, hit = '';
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (id >= idTabRanges[mid][0]) { hit = idTabRanges[mid][2]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return hit;
  };
  const tagMap = new Map();   // key -> { ids: [], t: { tab: n } }
  const tagAlias = {};        // 原始写法 -> key
  let tagRefs = 0;
  eachRow((r) => {
    const tg = r.tg;
    if (!tg || !tg.length) return;
    for (const raw of tg) {
      const key = normKey(raw);
      if (!key) continue;
      let e = tagMap.get(key);
      if (!e) { e = { ids: [], t: {} }; tagMap.set(key, e); }
      e.ids.push(r.i);
      tagRefs++;
      const tab = tabOfId(r.i);
      e.t[tab] = (e.t[tab] || 0) + 1;
      if (!(raw in tagAlias)) tagAlias[raw] = key;
    }
  });
  // 同义合并：源数据的标签是「写水 / 描写水 / 水」这种同一回事的不同写法，
  // 不合并时聚合页会被拆成好几份、首页主题也会重复。只做**明确同义**的合并，
  // 不做「写云→云」这类推导——库里的「竹子」是农桑辑要的书目标签，推导会串味。
  const TAG_MERGE = {
    描写山: '山', 写山: '山',
    描写水: '水', 写水: '水',
    写花: '花', 写雨: '雨', 写雪: '雪', 写鸟: '鸟', 写风: '风', 写马: '马',
    写物: '咏物', 咏物诗: '咏物',
    写人诗: '写人',
    带有地名: '地名',
    咏史怀古: '怀古', 咏古: '怀古',
  };
  const mergedCount = {};
  for (const [from, to] of Object.entries(TAG_MERGE)) {
    const fromKey = normKey(from), toKey = normKey(to);
    if (fromKey === toKey) continue;
    const src = tagMap.get(fromKey);
    if (!src) continue;
    let dst = tagMap.get(toKey);
    if (!dst) { dst = { ids: [], t: {} }; tagMap.set(toKey, dst); }
    dst.ids.push(...src.ids);
    for (const [tab, n] of Object.entries(src.t)) dst.t[tab] = (dst.t[tab] || 0) + n;
    tagMap.delete(fromKey);
    for (const [raw, key] of Object.entries(tagAlias)) if (key === fromKey) tagAlias[raw] = toKey;
    mergedCount[to] = (mergedCount[to] || 0) + src.ids.length;
  }
  let mergedRefs = 0;
  for (const [, e] of tagMap) {
    if (e.ids.length > 1) {
      const before = e.ids.length;
      e.ids = [...new Set(e.ids)];
      mergedRefs += before - e.ids.length;
    }
  }
  if (Object.keys(mergedCount).length) {
    console.log(`标签同义合并: ${Object.keys(TAG_MERGE).length} 条规则 → ` +
      Object.entries(mergedCount).map(([k, n]) => `${k}+${n}`).join(' ') +
      `，去重 ${mergedRefs} 条`);
  }
  const tagObj = {};
  for (const [k, e] of tagMap) {
    let mainTab = '', mainN = -1;
    for (const [tab, n] of Object.entries(e.t)) if (n > mainN) { mainTab = tab; mainN = n; }
    tagObj[k] = [mainTab, e.ids.sort((a, b) => a - b)];
  }
  fs.writeFileSync(path.join(DATA, 'idx', 'tags.json'), JSON.stringify({ v: 1, a: tagAlias, k: tagObj }));
  console.log(`标签索引: ${tagMap.size} 种标签 / ${tagRefs} 条引用 / ${Object.keys(tagAlias).length} 种写法`);

  // ---------- 标签分桶（#/tags 标签总览） ----------
  // 1042 个标签里混着四套命名：课本册次、体裁、朝代、题材。
  // 不分开时「清商曲辞」「唐风」这类书名分类会被当成题材展示，读不懂。
  const BUCKET_RULES = [
    ['textbook', /年级|册|课内|课外|必背|教材/],
    ['genre', /^(五言|七言|杂言)?(律诗|绝句|古诗|歌行|乐府)$|^(词|小令|散曲|赋)$/],
  ];
  // 选集名与书目（唐诗三百首/列传/观止…）是入口不是题材，单列一类不进题材桶
  const BOOKISH = /三百首|精选|观止|十九首|列传|本纪|世家|通鉴|国风|蒙学|千家诗/;
  const buckets = { textbook: [], genre: [], theme: [], bookish: [] };
  for (const [k, e] of tagMap) {
    const n = e.ids.length;
    const mainTab = Object.entries(e.t).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    let hit = '';
    for (const [id, re] of BUCKET_RULES) if (re.test(k)) { hit = id; break; }
    // 「史记」「左传」「黄帝内经」这类主 tab 落在古文/经部的，是书名不是题材
    if (!hit) hit = (BOOKISH.test(k) || mainTab === '古文' || mainTab === '经部') ? 'bookish' : 'theme';
    if (hit === 'theme' && n < 20) continue;   // 长尾 <20 篇不进总览
    buckets[hit].push([k, n]);
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(path.join(DATA, 'idx', 'tagbuckets.json'), JSON.stringify({ v: 1, rows: buckets }));
  console.log(`标签分桶: 课本 ${buckets.textbook.length} / 体裁 ${buckets.genre.length} / 选集 ${buckets.bookish.length} / 题材 ${buckets.theme.length}`);

  // ---------- 朝代索引（分片：idx/dyn/<序>-<页>.json + idx/dyn.json） ----------
  // 宋辽金 27.9 万篇占 60%，先秦 2604 篇；整体 id 表 2MB+ 不适合整包下发，按 2 万条分片懒加载。
  // 索引键是「分组」（先秦/汉魏六朝/…），不是细朝代，见 DYN_GROUPS。
  const DYNBUCKET = 20000;
  const dynDir = path.join(DATA, 'idx', 'dyn');
  fs.mkdirSync(dynDir, { recursive: true });
  const dynMap = new Map();
  eachRow((r) => {
    const d = dynGroup(r.d);
    if (!d) return;
    let e = dynMap.get(d);
    if (!e) { e = []; dynMap.set(d, e); }
    e.push(r.i);
  });
  const dynOrder = new Map(DYN_GROUPS.map((g, i) => [g.k, i]));
  const dynMeta = [];
  [...dynMap.entries()]
    .map(([k, ids]) => ({ k, ids }))
    // 按时代先后排，不按篇数；没登记进 DYN_GROUPS 的新脏值排到最后，便于发现
    .sort((a, b) => {
      const ia = dynOrder.has(a.k) ? dynOrder.get(a.k) : 999;
      const ib = dynOrder.has(b.k) ? dynOrder.get(b.k) : 999;
      return ia - ib || b.ids.length - a.ids.length;
    })
    .forEach(({ k, ids }, oi) => {
      const chunks = [];
      for (let p = 0; p * DYNBUCKET < ids.length; p++) {
        const name = `${String(oi).padStart(3, '0')}-${String(p).padStart(4, '0')}.json`;
        fs.writeFileSync(path.join(dynDir, name), JSON.stringify(ids.slice(p * DYNBUCKET, (p + 1) * DYNBUCKET)));
        chunks.push('dyn/' + name);
      }
      dynMeta.push({ k, c: ids.length, chunks });
    });
  fs.writeFileSync(path.join(DATA, 'idx', 'dyn.json'), JSON.stringify({ v: 1, rows: dynMeta }));
  console.log(`朝代索引: ${dynMeta.length} 个朝代 / ${dynMeta.reduce((s, d) => s + d.chunks.length, 0)} 个分片`);

  // ---------- 繁简映射 ----------
  const t2sMap = {}, s2tMap = {};
  for (const [ch] of charFreq) {
    const sv = convT2S(ch);
    if (sv !== ch) {
      t2sMap[ch] = sv;
      const cur = s2tMap[sv];
      if (!cur || charFreq.get(ch) > (charFreq.get(cur) || 0)) s2tMap[sv] = ch;
    }
  }
  fs.writeFileSync(path.join(DATA, 'idx', 't2s.json'), JSON.stringify(t2sMap));
  fs.writeFileSync(path.join(DATA, 'idx', 's2t.json'), JSON.stringify(s2tMap));
  console.log(`t2s 映射: ${Object.keys(t2sMap).length} 字, s2t 映射: ${Object.keys(s2tMap).length} 字`);

  // ---------- 词牌索引 ----------
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(OUT, 'cipai-raw.json'), 'utf8'));
    const cipai = [];
    for (const r of raw) {
      if (!r.intro) continue;
      const base = { n: r.names[0], d: r.cat || '', i: r.intro, g: r.gelv || '' };
      for (const nm of r.names) cipai.push({ ...base, n: nm });
    }
    fs.writeFileSync(path.join(DATA, 'idx', 'cipai.json'), JSON.stringify(cipai));
    console.log(`词牌索引: ${cipai.length} 条 (含别名)`);
  } catch (e) { console.log('词牌数据跳过:', e.message); }

  // ---------- manifest ----------
  let start = 0;
  const collManifest = COLLECTIONS.map(c => {
    const st = collStats[c.id] || { count: 0, chunks: [] };
    const entry = { ...c, count: st.count, visible: st.count - (st.hidden || 0), chunks: st.chunks, start };
    start += st.count;
    return entry;
  });
  const manifest = {
    v: Date.now(), generatedAt: new Date().toISOString(), total: start,
    collections: collManifest,
    fulltextCount: ftTotal,
    authors: authorList.length,
  };
  fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`manifest: ${start} 首, ${collManifest.length} 集合`);
  console.log('BUILD_OK');
}
main().catch(e => { console.error(e); process.exit(1); });
