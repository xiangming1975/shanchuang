// ETL 第三步：poems2/3.jsonl → site/data（分块/索引/作者/manifest/t2s/词牌）
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out';
const SITE = 'C:/Users/xiang/Downloads/poetry-site/site';
const DATA = path.join(SITE, 'data');
const CHUNK = 1000;
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

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
  { id: 'tang', name: '全唐诗', desc: '康熙朝编定，收唐五代诗', tab: '全集' },
  { id: 'song', name: '全宋诗', desc: '宋代诗歌总集', tab: '全集' },
  { id: 'songci', name: '全宋词', desc: '两宋词作总集', tab: '全集' },
  { id: 'yq', name: '元曲', desc: '元代杂剧散曲', tab: '全集' },
  { id: 'hanwei', name: '汉魏六朝诗', desc: '先秦两汉魏晋南北朝隋诗歌乐府', tab: '全集' },
  { id: 'jinyuan', name: '金元诗词', desc: '金元两代诗词', tab: '全集' },
  { id: 'mingS', name: '明代诗词', desc: '明代诗词', tab: '全集' },
  { id: 'qingS', name: '清代诗词', desc: '清代诗词', tab: '全集' },
  { id: 'xdS', name: '近现代诗词', desc: '近代以来旧体诗词', tab: '全集' },
  { id: 'gwdj', name: '古文典籍', desc: '经史子集名篇：左传·史记·汉书·家语等', tab: '古文' },
  { id: 'fu', name: '历代赋', desc: '先秦两汉魏晋南北朝唐宋元明清辞赋', tab: '古文' },
];
const collName = Object.fromEntries(COLLECTIONS.map(c => [c.id, c.name]));
// 全文搜索开放的集合（体量小、名篇多）
const FULLTEXT_SETS = new Set(['tang300', 'shijing', 'chuci', 'lunyu', 'ssxx', 'guwen', 'songci300', 'hjj', 'nt', 'cc', 'nalan', 'ymy', 'smts', 'hanwei', 'jinyuan', 'xdS', 'gwdj', 'fu', 'songci', 'yq', 'mingS', 'qingS']);
// tang/song 体量太大不进全文索引，但名篇（有译文或高star）的正文单独收录
const FULLTEXT_FAMOUS = new Set(['tang', 'song']);

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(DATA, 'poems'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'idx'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'authors'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'strains'), { recursive: true });

  // 读作者简介（本地 authors 文件在清洗阶段没带，这里直接从原始文件补）
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
  // gushiwen 作者简介（简体，优先）
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

  // 流式读 poems3 + 扩充（ingest 朝代诗词 / niu 古籍）→ 分块 + 索引
  const SRC = path.join(OUT, 'poems3.jsonl');
  const SRC2 = path.join(OUT, 'poems-ingest.jsonl');
  const SRC3 = path.join(OUT, 'poems-niu.jsonl');
  const SRC4 = path.join(OUT, 'poems-fu.jsonl');
  const extras = [SRC2, SRC3, SRC4].filter(f => fs.existsSync(f) && fs.statSync(f).size > 10);
  if (extras.length) {
    // 合并成 poems4（扩充记录排在最后，保证已有 id 稳定）
    const P4 = path.join(OUT, 'poems4.jsonl');
    fs.copyFileSync(SRC, P4);
    const w4 = fs.createWriteStream(P4, { flags: 'a' });
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
    var STREAMS = [P4];
  } else {
    var STREAMS = [SRC];
  }
  const rl = readline.createInterface({ input: fs.createReadStream(STREAMS[0], { encoding: 'utf8' }), crlfDelay: Infinity });
  const collStats = {};       // id -> {count, chunks, names[]}
  let chunkBuf = [], chunkIdx = 0, curColl = null;
  let i = 0;
  const hotPool = [];         // 候选热门（h 或有译文的精选）
  const fulltextRows = [];    // 全文搜索行
  const charFreq = new Map(); // 字频统计（供繁简双向映射）
  const addChars = s => { if (!s) return; for (const ch of String(s)) charFreq.set(ch, (charFreq.get(ch) || 0) + 1); };
  const flush = async () => {
    if (!chunkBuf.length) return;
    const file = path.join(DATA, 'poems', `${curColl}-${String(chunkIdx).padStart(3, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(chunkBuf));
    collStats[curColl].chunks.push(path.basename(file));
    chunkBuf = []; chunkIdx++;
  };
  for await (const line of rl) {
    const r = JSON.parse(line);
    if (r.i === undefined) r.i = i;
    if (r.c !== curColl) { await flush(); curColl = r.c; chunkIdx = 0; collStats[curColl] = collStats[curColl] || { count: 0, chunks: [] }; }
    collStats[r.c].count++;
    // 精简记录（i 按块内序号重建：块号*1000+块内idx 保持全局可寻址）
    const rec = { i: r.i, t: r.t, a: r.a, d: r.d, p: r.p };
    if (r.r) rec.r = r.r;
    if (r.tg && r.tg.length) rec.tg = r.tg;
    if (r.n) rec.n = r.n;
    if (r.pr) rec.pr = r.pr;
    if (r.cm) rec.cm = r.cm;
    if (r.h) rec.h = r.h;
    if (r.st) rec.st = r.st;
    if (r.f) rec.f = r.f;
    chunkBuf.push(rec);
    addChars(r.t); addChars(r.a);
    if (r.p) for (const line of r.p) addChars(line);
    if (r.f && (r.f.y || r.f.s) && r.h > 30000) hotPool.push({ i: r.i, t: r.t, a: r.a, h: r.h });
    if (FULLTEXT_SETS.has(r.c)) {
      fulltextRows.push([r.i, r.t, r.a, (r.p || []).join('\n').slice(0, 200)]);
    } else if (FULLTEXT_FAMOUS.has(r.c) && (r.f || r.jd >= 500)) {
      fulltextRows.push([r.i, r.t, r.a, (r.p || []).join('\n').slice(0, 200)]);
    }
    if (chunkBuf.length >= CHUNK) await flush();
    i++;
  }
  await flush();
  console.log(` poems 分块完成, 共 ${i} 首`);

  // 作者索引：作者名 → 作品 [{i,t}]（最多300条，供作者页直接展示）
  const authorPoems = new Map();
  const authorCounts = new Map();
  const rl2 = readline.createInterface({ input: fs.createReadStream(STREAMS[0], { encoding: 'utf8' }), crlfDelay: Infinity });
  let pos2 = 0;
  for await (const line of rl2) {
    const r = JSON.parse(line);
    if (r.i === undefined) r.i = pos2;
    pos2++;
    if (!r.a) continue;
    authorCounts.set(r.a, (authorCounts.get(r.a) || 0) + 1);
    if (!authorPoems.has(r.a)) authorPoems.set(r.a, []);
    const arr = authorPoems.get(r.a);
    if (arr.length < 300) arr.push({ i: r.i, t: r.t || '' });
  }
  // 作者数据（bio + 作品数 + 作品样本）
  const authorList = [];
  for (const [name, poems] of authorPoems) {
    const bio = allBios.get(name) || {};
    authorList.push({ name, n: authorCounts.get(name) || 0, d: bio.d || '', bio: bio.bio || '', p: poems });
  }
  authorList.sort((a, b) => b.n - a.n);
  // 分块存作者（每块 800）
  const authorChunkCount = Math.ceil(authorList.length / 800);
  for (let k = 0; k < authorChunkCount; k++) {
    fs.writeFileSync(path.join(DATA, 'authors', `a-${String(k).padStart(3, '0')}.json`), JSON.stringify(authorList.slice(k * 800, (k + 1) * 800)));
  }
  // 作者查找索引: name -> {chunk, idx}
  const authorIdx = {};
  authorList.forEach((a, k) => { authorIdx[a.name] = [Math.floor(k / 800), k % 800]; });
  fs.writeFileSync(path.join(DATA, 'idx', 'authors.json'), JSON.stringify(authorIdx));
  console.log(`作者: ${authorList.length} 位, 分块 ${authorChunkCount}`);

  // 全文搜索索引（精选集）
  fs.writeFileSync(path.join(DATA, 'idx', 'fulltext.json'), JSON.stringify(fulltextRows));
  console.log(`全文索引: ${fulltextRows.length} 行`);

    // 热门池：以 star（古诗文网点赞）为准，标题+作者去重
  const starPool = [];
  const seenHot = new Set();
  const rl4 = readline.createInterface({ input: fs.createReadStream(STREAMS[0], { encoding: 'utf8' }), crlfDelay: Infinity });
  let pos4 = 0;
  for await (const line of rl4) {
    const r = JSON.parse(line);
    if (r.i === undefined) r.i = pos4;
    pos4++;
    if (!r.jd || r.jd < 500) continue;
    const k = (r.t || '') + '|' + (r.a || '');
    if (seenHot.has(k)) continue;
    seenHot.add(k);
    starPool.push({ i: r.i, t: r.t, a: r.a, h: r.jd * 20 + (r.h || 0) });
  }
  starPool.sort((a, b) => b.h - a.h);
  fs.writeFileSync(path.join(DATA, 'idx', 'hot.json'), JSON.stringify(starPool.slice(0, 2000)));
  console.log(`热门池: ${Math.min(starPool.length, 2000)} 条 (star 去重)`);

  // 繁→简单字映射（脚注匹配用）+ 简→繁映射（搜索繁简互通）
  const t2sMap = {};
  const s2tMap = {};
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

  // 词牌索引（龙榆生《唐宋词格律》）
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

  // 标题/作者全库索引：names.json 每行 "id\t标题\t作者"
  const namesOut = fs.createWriteStream(path.join(DATA, 'idx', 'names.json'), { encoding: 'utf8' });
  const rl3 = readline.createInterface({ input: fs.createReadStream(STREAMS[0], { encoding: 'utf8' }), crlfDelay: Infinity });
  let ni = 0;
  for await (const line of rl3) {
    const r = JSON.parse(line);
    if (r.i === undefined) r.i = ni;
    namesOut.write(`${r.i}\t${r.t || ''}\t${r.a || ''}\n`);
    ni++;
  }
  await new Promise(res => namesOut.end(res));
  console.log(`names 索引: ${ni} 行`);

  // manifest（含每个集合的全局起始 id，供按 id 定位分块）
  let start = 0;
  const collManifest = COLLECTIONS.map(c => {
    const st = collStats[c.id] || { count: 0, chunks: [] };
    const entry = { ...c, count: st.count, chunks: st.chunks, start };
    start += st.count;
    return entry;
  });
  const total = collManifest.reduce((s, c) => s + c.count, 0);
  const manifest = {
    v: Date.now(), generatedAt: new Date().toISOString(), total,
    collections: collManifest,
    fulltextCount: fulltextRows.length,
    authors: authorList.length,
  };
  fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`manifest: ${total} 首, ${collManifest.length} 集合`);
  console.log('BUILD_OK');
}
main().catch(e => { console.error(e); process.exit(1); });
