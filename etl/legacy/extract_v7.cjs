// EPUB -> 网站格式 提取脚本 (v7)
// 修复: 1) h3.calibre3 总是作品标题 2) h3.center 歧义消解(后跟作者块=标题,否则=作者) 3) 更多词牌名/标题模式
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + fnLen).toString('utf8');
    entries[name] = { compMethod, compSize, localOffset };
    p += 46 + fnLen + extraLen + commentLen;
  }
  return { buf, entries };
}

function extractEntry(zip, name) {
  const e = zip.entries[name];
  if (!e) return null;
  const { buf } = zip;
  let p = e.localOffset;
  const fnLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + fnLen + extraLen;
  const compData = buf.slice(dataStart, dataStart + e.compSize);
  if (e.compMethod === 0) return compData;
  if (e.compMethod === 8) return zlib.inflateRawSync(compData);
  return null;
}

function parseHtmlBlocks(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : html;
  const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  function decodeEntities(s) {
    return s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(parseInt(n))).replace(/&[a-z]+;/g,'');
  }
  function cleanText(s) {
    return decodeEntities(s).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').replace(/\r/g,'').replace(/\n/g,'').trim();
  }
  const blocks = [];
  const tagRegex = /<(\/?)(\w+)([^>]*)>/g;
  let m;
  while ((m = tagRegex.exec(body)) !== null) {
    const [full, slash, tag, attrs] = m;
    const tagLower = tag.toLowerCase();
    if (!slash && BLOCK_TAGS.has(tagLower)) {
      const clsMatch = attrs.match(/class="([^"]*)"/);
      const cls = clsMatch ? clsMatch[1] : '';
      let depth = 1;
      const contentStart = tagRegex.lastIndex;
      const innerRegex = /<(\/?)(\w+)([^>]*)>/g;
      innerRegex.lastIndex = contentStart;
      let m2 = null;
      while (depth > 0 && (m2 = innerRegex.exec(body)) !== null) {
        const [, slash2, tag2] = m2;
        const tag2Lower = tag2.toLowerCase();
        if (!slash2 && BLOCK_TAGS.has(tag2Lower)) depth++;
        else if (slash2 && BLOCK_TAGS.has(tag2Lower)) { depth--; if (depth === 0) break; }
      }
      if (m2) {
        const contentEnd = innerRegex.lastIndex - m2[0].length;
        const content = body.slice(contentStart, contentEnd);
        blocks.push({ tag: tagLower, cls, text: cleanText(content) });
        tagRegex.lastIndex = innerRegex.lastIndex;
      }
    }
  }
  return blocks;
}

function inferDynasty(bookId) {
  const map = {
    'tang300': '唐', 'tang': '唐', 'song': '宋', 'songci': '宋', 'songci300': '宋',
    'jinyuan': '金元', 'yq': '元', 'yuanqu': '元', 'hanwei': '汉魏六朝',
    'chuci': '先秦', 'shijing': '先秦', 'xianqin': '先秦', 'yuanmingqing': '元明清',
    'mingqing': '明清', 'guwen': '唐宋', 'xds': '近现代', 'nalan': '清', 'cc': '汉魏',
    'yuanmingqingci': '元明清', 'zhiguai': '古代', 'tangsongxiaoshuo': '唐宋',
    'mingqingxiaoshuo': '明清', 'mingqingchuanqi': '明清', 'lidaifu': '历代',
    'nvxing': '历代', 'xinshi': '现代',
  };
  return map[bookId] || '未知';
}

const BOOK_DEFS = [
  { marker: '唐诗鉴赏辞典', id: 'tang300', name: '唐诗鉴赏辞典', desc: '上海辞书出版社唐诗鉴赏辞典', tab: '精选' },
  { marker: '唐宋词鉴赏辞典', id: 'songci', name: '唐宋词鉴赏辞典', desc: '唐宋词鉴赏辞典', tab: '词曲' },
  { marker: '元明清词鉴赏辞典', id: 'yuanmingqingci', name: '元明清词鉴赏辞典', desc: '元明清词鉴赏辞典', tab: '词曲' },
  { marker: '古代志怪小说鉴赏辞典', id: 'zhiguai', name: '古代志怪小说鉴赏辞典', desc: '古代志怪小说鉴赏辞典', tab: '小说' },
  { marker: '唐宋小说鉴赏辞典', id: 'tangsongxiaoshuo', name: '唐宋小说鉴赏辞典', desc: '唐宋小说鉴赏辞典', tab: '小说' },
  { marker: '明清小说鉴赏辞典', id: 'mingqingxiaoshuo', name: '明清小说鉴赏辞典', desc: '明清小说鉴赏辞典', tab: '小说' },
  { marker: '明清传奇鉴赏辞典', id: 'mingqingchuanqi', name: '明清传奇鉴赏辞典', desc: '明清传奇鉴赏辞典', tab: '戏曲' },
  { marker: '历代赋鉴赏辞典', id: 'lidaifu', name: '历代赋鉴赏辞典', desc: '历代赋鉴赏辞典', tab: '辞赋' },
  { marker: '历代女性诗词鉴赏辞典', id: 'nvxing', name: '历代女性诗词鉴赏辞典', desc: '历代女性诗词鉴赏辞典', tab: '精选' },
  { marker: '宋词鉴赏辞典', id: 'songci300', name: '宋词鉴赏辞典', desc: '宋词鉴赏辞典', tab: '词曲' },
  { marker: '古文鉴赏辞典', id: 'guwen', name: '古文鉴赏辞典', desc: '古文鉴赏辞典', tab: '古文' },
  { marker: '元曲鉴赏辞典', id: 'yuanqu', name: '元曲鉴赏辞典', desc: '元曲鉴赏辞典', tab: '词曲' },
  { marker: '先秦诗鉴赏辞典', id: 'xianqin', name: '先秦诗鉴赏辞典', desc: '先秦诗鉴赏辞典', tab: '经部' },
  { marker: '汉魏六朝诗鉴赏辞典', id: 'hanwei', name: '汉魏六朝诗鉴赏辞典', desc: '汉魏六朝诗鉴赏辞典', tab: '诗' },
  { marker: '宋诗鉴赏辞典', id: 'song', name: '宋诗鉴赏辞典', desc: '宋诗鉴赏辞典', tab: '诗' },
  { marker: '元明清诗鉴赏辞典', id: 'yuanmingqing', name: '元明清诗鉴赏辞典', desc: '元明清诗鉴赏辞典', tab: '诗' },
  { marker: '新诗鉴赏辞典', id: 'xinshi', name: '新诗鉴赏辞典', desc: '新诗鉴赏辞典', tab: '新诗' },
];

// v7: h3.center 歧义消解 — 后跟作者块(p.right/p.center/p.shuming) = 作品标题;否则可能是作者名
function isWorkTitle(block, nextBlock) {
  if (block.cls.includes('title-poem')) return true;
  if (block.cls.includes('title-poem-k-zhong')) return true;
  if (block.cls.includes('title-poem-f-zhong')) return true;
  // h3.center / h2.center — 歧义
  if (block.tag === 'h3' && block.cls.includes('center')) {
    // 如果是《...》格式,是章节标题,不是作品
    if (/^《.+》$/.test(block.text)) return false;
    // 如果后跟 p.right/p.center/p.shuming/yinwen/kai_long -> 作品标题
    if (nextBlock && (nextBlock.cls.includes('right') || nextBlock.cls.includes('center') ||
        nextBlock.cls.includes('shuming') || nextBlock.cls.includes('shuming1') ||
        nextBlock.cls.includes('yinwen') || nextBlock.cls.includes('kai_long') ||
        nextBlock.cls.includes('yinwen-fs') || nextBlock.cls.includes('yinwen-kt-c'))) {
      return true;
    }
    // 如果后跟 h2/h3 (另一个标题) -> 可能是作者名
    if (nextBlock && (nextBlock.tag === 'h2' || nextBlock.tag === 'h3')) return 'maybe';
    // 默认视为作品标题
    return true;
  }
  if (block.tag === 'h2' && block.cls.includes('center')) {
    if (/^《.+》$/.test(block.text)) return false;
    if (nextBlock && (nextBlock.cls.includes('right') || nextBlock.cls.includes('center') ||
        nextBlock.cls.includes('shuming') || nextBlock.cls.includes('shuming1') ||
        nextBlock.cls.includes('yinwen') || nextBlock.cls.includes('kai_long'))) {
      return true;
    }
    if (nextBlock && (nextBlock.tag === 'h2' || nextBlock.tag === 'h3')) return 'maybe';
    return true;
  }
  // h3.calibre3 — v7: 总是作品标题
  if (block.tag === 'h3' && block.cls.includes('calibre3')) return true;
  // h3.calibre4 (元曲)
  if (block.tag === 'h3' && block.cls.includes('calibre4')) return true;
  // h4.calibre5 (先秦诗)
  if (block.tag === 'h4' && block.cls.includes('calibre5')) return true;
  // h3.calibre2 (新诗) — 歧义
  if (block.tag === 'h3' && block.cls.includes('calibre2') && block.text.length <= 30) return 'maybe';
  // h2.calibre2 — 歧义
  if (block.tag === 'h2' && block.cls.includes('calibre2') && block.text.length <= 30) return 'maybe';
  return false;
}

function isAuthorHeader(block) {
  if (block.tag === 'h1' && block.cls.includes('calibre1')) return true;
  if (block.tag === 'h2' && block.cls.includes('calibre3')) return true;
  if (block.text.includes('作者小传') || block.text.includes('诗人小传')) return true;
  if (block.cls.includes('btling')) return true;
  return false;
}

const CI_NAMES = new Set(['梦江南','谒金门','望江南','河传','天仙子','朝中措','鹧鸪天','一丛花','瑞鹤仙','临江仙','念奴娇','瑞鹧鸪','木兰花','西江月','清平乐','满江红','寿楼春','沁园春','浣溪沙','齐天乐','雨中花','洞仙歌','水调歌头','水龙吟','暗香','一萼红','太常引','二郎神','淡黄柳','感皇恩','点绛唇','虞美人','踏莎行','思远人','小桃红','醉中天','采莲女']);
// v7: 更多标题模式字符
const TITLE_CHARS = /[词曲赋歌行吟诵曲调诗篇章作记传志论说序跋疏铭碑诔哀吊颂赞引古谣谚拟效和答寄赠题感怀忆思别送杂]/;
function looksLikePersonName(text) {
  if (!text || text.length > 10) return false;
  if (CI_NAMES.has(text)) return false;
  if (text.includes('：') || text.includes(':')) return false;
  // 如果有标题字符且长度>=3,不是人名
  if (text.length >= 3 && TITLE_CHARS.test(text)) return false;
  // 2-4 chars, all Chinese, no title chars — likely person name
  return text.length >= 2 && text.length <= 8;
}

function isWorkText(block) {
  if (block.cls.includes('kai_long')) return true;
  if (block.cls.includes('yinwen') && !block.cls.includes('yinwen1') && !block.cls.includes('yinwen2') && !block.cls.includes('yinwen_first')) return true;
  if (block.tag === 'div' && block.cls.includes('yinwen')) return true;
  if (block.cls.includes('yinwen-fs')) return true;
  if (block.cls.includes('yinwen-kt-c')) return true;
  if (block.cls.includes('yinwen-fs-n')) return true;
  if (block.cls.includes('yinwen1')) return 'maybe';
  return false;
}

function isAnnotation(block) {
  if (block.text.includes('〔注〕') || block.text.includes('【注】')) return true;
  if (block.cls.includes('yinwen1') && /^\[?\d+\]/.test(block.text)) return true;
  return false;
}

function isAppreciation(block) {
  if (block.cls.includes('normaltext')) return true;
  if (block.cls.includes('normaltext_top')) return true;
  if (block.cls.includes('normaltext1')) return true;
  return false;
}

function isAppreciationAuthor(block) {
  if (block.cls.includes('luokuan')) return true;
  return false;
}

function extractWorksFromHtml(html, bookId, startId) {
  const blocks = parseHtmlBlocks(html);
  const works = [];
  let currentWork = null;
  let currentAuthor = '';
  let inAuthorBio = false;
  let currentAnnotation = [];
  let currentAppreciation = [];
  let currentText = [];
  let workNum = startId;
  let seenAppreciationMarker = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];

    if (isAuthorHeader(block)) {
      if (currentWork) {
        finalizeWork(currentWork, currentAnnotation, currentAppreciation, currentText);
        works.push(currentWork);
        currentWork = null;
      }
      currentAnnotation = [];
      currentAppreciation = [];
      currentText = [];
      seenAppreciationMarker = false;

      if (block.text.includes('作者小传') || block.text.includes('诗人小传') || block.cls.includes('btling')) {
        inAuthorBio = true;
      } else {
        currentAuthor = block.text.replace(/【.*?】/g, '').replace(/\s+/g, '').trim();
        inAuthorBio = false;
      }
      continue;
    }

    if (inAuthorBio) {
      if (block.text && block.text.length >= 2 && block.text.length <= 10 && block.cls.includes('normaltext') && !currentAuthor) {
        currentAuthor = block.text.trim();
        continue;
      }
      if (block.text && block.text.length > 10 && !isWorkTitle(block, nextBlock)) {
        continue;
      }
      if (isWorkTitle(block, nextBlock) || (nextBlock && (nextBlock.cls.includes('shuming') || nextBlock.cls.includes('shuming1') || nextBlock.cls.includes('yinwen') || nextBlock.cls.includes('kai_long') || nextBlock.cls.includes('center') || nextBlock.cls.includes('right') || nextBlock.cls.includes('yinwen-fs') || nextBlock.cls.includes('yinwen-kt-c')))) {
        inAuthorBio = false;
      } else if (block.text.length < 10) {
        continue;
      } else {
        inAuthorBio = false;
      }
    }

    const titleCheck = isWorkTitle(block, nextBlock);
    if (titleCheck) {
      if (currentWork) {
        finalizeWork(currentWork, currentAnnotation, currentAppreciation, currentText);
        works.push(currentWork);
      }
      let titleText = block.text.replace(/\[\d+\]/g, '').replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '').trim();
      if (titleCheck === 'maybe' && looksLikePersonName(titleText)) {
        currentAuthor = titleText;
        currentAnnotation = [];
        currentAppreciation = [];
        currentText = [];
        seenAppreciationMarker = false;
        continue;
      }
      currentWork = {
        i: workNum++,
        t: titleText,
        a: currentAuthor,
        d: inferDynasty(bookId),
        p: [],
        tg: [],
        f: { y: '', z: '', s: '' }
      };
      currentAnnotation = [];
      currentAppreciation = [];
      currentText = [];
      seenAppreciationMarker = false;
      continue;
    }

    if (currentWork) {
      // v7: p.right / p.center 短文本 -> 作者
      if ((block.cls.includes('right') || block.cls.includes('center')) && block.text.length > 0 && block.text.length <= 15 && !block.cls.includes('normaltext') && !block.cls.includes('left')) {
        const name = block.text.replace(/\s+/g, '').trim();
        if (name && name.length <= 8) {
          currentWork.a = name;
          continue;
        }
      }

      if (block.cls.includes('shuming') || block.cls.includes('shuming1')) {
        currentWork.a = block.text.replace(/\s+/g, '').trim();
        continue;
      }

      if (block.cls.includes('left')) {
        if (block.text.includes('【赏析】') || block.text.includes('〔赏析〕')) {
          seenAppreciationMarker = true;
          const content = block.text.replace(/【赏析】/g, '').replace(/〔赏析〕/g, '').trim();
          if (content.length > 0) currentAppreciation.push(content);
          continue;
        }
        if (!block.text || block.text.length < 2) continue;
        if (seenAppreciationMarker || currentText.length > 0) {
          currentAppreciation.push(block.text);
        } else {
          currentText.push(block.text);
        }
        continue;
      }

      const textCheck = isWorkText(block);
      if (textCheck) {
        if (block.text) currentText.push(block.text);
        continue;
      }

      if (isAnnotation(block) && block.text) {
        currentAnnotation.push(block.text);
        continue;
      }

      if (isAppreciation(block) && block.text) {
        currentAppreciation.push(block.text);
        continue;
      }

      if (isAppreciationAuthor(block) && block.text) {
        currentAppreciation.push('（' + block.text + '）');
        continue;
      }
    }
  }

  if (currentWork) {
    finalizeWork(currentWork, currentAnnotation, currentAppreciation, currentText);
    works.push(currentWork);
  }

  return { works, nextId: workNum };
}

function finalizeWork(work, annotations, appreciations, texts) {
  work.p = texts;
  work.f.y = texts.join('\n');
  work.f.z = annotations.join('\n');
  work.f.s = appreciations.join('\n');
}

// ============ 主流程 ============
const d = 'C:/Users/xiang/Downloads';
const epubPath = fs.readdirSync(d).find(f => f.toLowerCase().endsWith('.epub') && f.includes('中国文学鉴赏辞典'));
const epubFull = path.join(d, epubPath);
console.log('EPUB:', path.basename(epubPath));

const zip = readZip(epubFull);

const tocData = extractEntry(zip, 'OEBPS/toc.ncx').toString('utf8');
const navPointRegex = /<navPoint\b[^>]*id="([^"]*)"[^>]*playOrder="([^"]*)"[^>]*>([\s\S]*?)<\/navPoint>/g;
const navPoints = [];
let m;
while ((m = navPointRegex.exec(tocData)) !== null) {
  const inner = m[3];
  const labelMatch = inner.match(/<navLabel>\s*<text[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>/);
  const contentMatch = inner.match(/<content\s+src="([^"]*)"/);
  navPoints.push({ id: m[1], playOrder: m[2], label: labelMatch ? labelMatch[1].trim() : '', src: contentMatch ? contentMatch[1] : '' });
}

const books = [];
let currentBook = null;
for (const np of navPoints) {
  let matched = null;
  for (const bd of BOOK_DEFS) {
    if (np.label.includes(bd.marker) && !np.label.startsWith('《')) { matched = bd; break; }
  }
  if (matched) {
    if (currentBook) books.push(currentBook);
    currentBook = { def: matched, navPoints: [] };
  }
  if (currentBook) currentBook.navPoints.push(np);
}
if (currentBook) books.push(currentBook);

console.log('Books:', books.length);
books.forEach((b, i) => console.log(`  [${i}] ${b.def.name} (${b.navPoints.length} entries)`));

const OUT_DIR = 'C:/Users/xiang/Downloads/buchong';
const poemsDir = path.join(OUT_DIR, 'poems');
const authorsDir = path.join(OUT_DIR, 'authors');
fs.mkdirSync(poemsDir, { recursive: true });
fs.mkdirSync(authorsDir, { recursive: true });

for (const sub of ['poems', 'authors']) {
  const dir = path.join(OUT_DIR, sub);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
    }
  }
}
const mf = path.join(OUT_DIR, 'manifest.json');
if (fs.existsSync(mf)) fs.unlinkSync(mf);

const allAuthors = {};
let globalId = 1;
const manifest = [];

for (let bi = 0; bi < books.length; bi++) {
  const book = books[bi];
  const bd = book.def;
  console.log(`\n=== [${bi}] ${bd.name} (${book.navPoints.length} entries) ===`);

  const allWorks = [];
  let prevFile = '';
  let processedFiles = 0;

  for (let ni = 0; ni < book.navPoints.length; ni++) {
    const np = book.navPoints[ni];
    const fileName = np.src.split('#')[0];
    if (!fileName || !fileName.endsWith('.html')) continue;
    if (fileName === prevFile) continue;
    prevFile = fileName;

    const html = extractEntry(zip, 'OEBPS/' + fileName);
    if (!html) continue;
    const htmlStr = html.toString('utf8');

    if (htmlStr.includes('sgc-toc')) continue;
    if (htmlStr.length < 300) continue;

    processedFiles++;
    const { works, nextId } = extractWorksFromHtml(htmlStr, bd.id, globalId);
    if (works.length > 0) {
      allWorks.push(...works);
      globalId = nextId;
      if (works.length > 0 && (ni % 100 === 0 || ni < 3)) {
        console.log(`  ${fileName}: ${works.length} works (label="${np.label}")`);
      }
    }
  }

  console.log(`  Processed: ${processedFiles} files`);

  const filtered = allWorks.filter(w => w.t && w.t.length > 0);
  console.log(`  Total: ${allWorks.length} (filtered: ${filtered.length})`);

  const chunkSize = 200;
  const chunks = [];
  for (let i = 0; i < filtered.length; i += chunkSize) {
    const chunkFile = `${bd.id}-${String(Math.floor(i / chunkSize)).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(poemsDir, chunkFile), JSON.stringify(filtered.slice(i, i + chunkSize), null, 2), 'utf8');
    chunks.push(chunkFile);
  }

  for (const w of filtered) {
    if (w.a && !allAuthors[w.a]) allAuthors[w.a] = { name: w.a, desc: '' };
  }

  manifest.push({
    id: bd.id, name: bd.name, desc: bd.desc, tab: bd.tab,
    count: filtered.length, visible: filtered.length,
    chunks, start: globalId - filtered.length
  });
}

const authorList = Object.values(allAuthors);
const authorChunkSize = 500;
for (let i = 0; i < authorList.length; i += authorChunkSize) {
  const chunkFile = `a-${String(Math.floor(i / authorChunkSize)).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(authorsDir, chunkFile), JSON.stringify(authorList.slice(i, i + authorChunkSize), null, 2), 'utf8');
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n=== DONE ===`);
console.log(`Total works: ${manifest.reduce((s, m) => s + m.count, 0)}`);
console.log(`Total authors: ${authorList.length}`);
console.log(`Output: ${OUT_DIR}`);
