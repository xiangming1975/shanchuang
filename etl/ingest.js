// ETL 第五步：扩充朝代覆盖 — 收编 gushiwen.jsonl 中本地库没有的诗词条目
// （两汉/魏晋/南北朝/隋 → hanwei；金/元 → jinyuan；明 → mingS；清 → qingS；近代/现代 → xdS）
// 输出: out/poems-ingest.jsonl + out/authors-extra.json
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const JSONL = 'C:/Users/xiang/Downloads/poetry-site/downloads/gushiwen.jsonl';
const IN = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems3.jsonl';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems-ingest.jsonl';

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const memo = new Map();
function t2s(s) {
  if (!s) return '';
  let v = memo.get(s);
  if (v !== undefined) return v;
  v = conv(s);
  if (memo.size < 400000) memo.set(s, v);
  return v;
}
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g;
function norm(s) { return t2s(String(s || '')).replace(PUNCT, '').toLowerCase(); }
function html2text(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function splitYz(cont) {
  const marked = String(cont).replace(/<\s*strong\s*>/gi, '\u0001').replace(/<\s*\/\s*strong\s*>/gi, '');
  const plain = html2text(marked);
  const segs = plain.split('\u0001').map(s => s.trim()).filter(Boolean);
  let y = '', z = '';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const label = s.replace(/\s/g, '');
    if (/^(译文及注释|译文|白话译文|翻译|注释|字词注释|注解|注)$/.test(label)) continue;
    const prevLabel = i > 0 ? segs[i - 1].replace(/\s/g, '') : '';
    if (/^(译文及注释|译文|白话译文|翻译)$/.test(prevLabel)) y = s;
    else if (/^(注释|字词注释|注解|注)$/.test(prevLabel)) z = s;
  }
  if (!y && !z && segs.length) {
    const whole = segs.join('\n\n');
    const zIdx = whole.search(/\n注释[：:|\s\n]/);
    if (zIdx > 0) { y = whole.slice(0, zIdx).trim(); z = whole.slice(zIdx).replace(/^\n?注释[：:]?\s*/, '').trim(); }
    else y = whole;
  }
  return { y, z };
}

const BUCKETS = [
  [/先秦|夏|商|周|春秋|战国/, 'hanwei'],
  [/两汉|西汉|东汉|汉|魏晋|三国|南北朝|北朝|南朝|隋|晋|五代|辽/, 'hanwei'],
  [/金|元/, 'jinyuan'], [/明/, 'mingS'], [/清/, 'qingS'], [/近代|现代|当代|民国/, 'xdS'],
];
function bucket(chaodai) {
  const c = String(chaodai || '');
  for (const [re, id] of BUCKETS) if (re.test(c)) return id;
  return null;
}

(async () => {
  console.time('ingest');
  // 1. 本地已有键集合
  const haveTA = new Set(), haveC = new Set();
  const rl0 = readline.createInterface({ input: fs.createReadStream(IN, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl0) {
    const r = JSON.parse(line);
    const t = norm(r.t), a = norm(r.a);
    if (t && a) haveTA.add(t + '|' + a);
    const c24 = norm((r.p || []).join('')).slice(0, 24);
    if (c24.length >= 12) haveC.add(c24);
  }
  console.log(`已有键: t|a ${haveTA.size}, c24 ${haveC.size}`);

  // 2. 扫描 gushiwen.jsonl，收编未覆盖条目
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL, { encoding: 'utf8' }), crlfDelay: Infinity });
  const w = fs.createWriteStream(OUT, { encoding: 'utf8' });
  const seenTA = new Set(), seenC = new Set();
  const bios = new Map();
  const stats = {};
  let idx = 0, scanned = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let root = null;
    try { root = JSON.parse(line); } catch { continue; }
    const poem = root.tb_gushiwen || root;
    const title = String(poem.nameStr || '').trim();
    const author = String(poem.author || '').trim();
    const cont = poem.cont || '';
    const type = String(poem.type || '');
    const chaodai = String(poem.chaodai || '');
    if (!title || !cont) continue;
    if (!/^(诗|词|文)$/.test(type)) continue;
    // 赋类作品统一归入「历代赋」集合（fu-extract.js 收编），此处跳过
    if (!/[·・]/.test(title) && /^(.+)?(赋|賦)(并序|有序)?$/.test(title) && title.length <= 24) continue;
    // 文（经史子集古籍名篇）→ gwdj 古文典籍；诗/词按朝代分桶
    const b = type === '文' ? 'gwdj' : bucket(chaodai);
    if (!b) continue;
    scanned++;
    const fanyis = (root.tb_fanyis && root.tb_fanyis.fanyis) || [];
    const shangxis = (root.tb_shangxis && root.tb_shangxis.shangxis) || [];
    const blocks = [...fanyis, ...shangxis];
    const plain = html2text(cont);
    const t = norm(title), a = norm(author);
    const c24 = norm(plain).slice(0, 24);
    const kTA = (t && a) ? t + '|' + a : null;
    if (kTA && (haveTA.has(kTA) || seenTA.has(kTA))) continue;
    if (c24.length >= 12 && (haveC.has(c24) || seenC.has(c24))) continue;
    // 收编
    if (kTA) seenTA.add(kTA);
    if (c24.length >= 12) seenC.add(c24);
    const rec = {
      c: b, t: html2text(title), a: author || '佚名', d: chaodai.replace(/代$/, ''),
      p: plain.split('\n').map(s => s.trim()).filter(Boolean),
    };
    if (type === '词') rec.r = title.split(/[·・]/)[0].trim();
    const tag = String(poem.tag || '').trim();
    if (tag) rec.tg = tag.split(/[，,、\s]+/).filter(Boolean).slice(0, 6);
    let y = '', z = '', s = '', bg = '';
    for (const blk of blocks) {
      if (!blk || !blk.cont) continue;
      const label = String(blk.nameStr || '').replace(/\s/g, '');
      if (/译文|翻译|白话/.test(label)) { const r2 = splitYz(blk.cont); if (r2.y) y = r2.y; if (r2.z) z = r2.z; }
      else if (/注释|注解|^注$/.test(label)) { if (!z) z = html2text(blk.cont); }
      else if (/赏析/.test(label)) { if (!s) s = html2text(blk.cont); }
      else if (/背景/.test(label)) { if (!bg) bg = html2text(blk.cont); }
    }
    if (y || z || s || bg) {
      rec.f = {};
      if (y) rec.f.y = y;
      if (z) rec.f.z = z;
      if (s) rec.f.s = s;
      if (bg) rec.f.b = bg;
    }
    rec.oi = idx++;
    w.write(JSON.stringify(rec) + '\n');
    stats[b] = (stats[b] || 0) + 1;
    if (author && !bios.has(author)) {
      const au = root.tb_author;
      if (au && au.cont) bios.set(author, { name: author, d: html2text(au.chaodai || chaodai), bio: html2text(au.cont) });
    }
  }
  await new Promise(res => w.end(res));
  console.timeEnd('ingest');
  console.log(`扫描 ${scanned} 条候选, 收编新作品 ${idx} 首`);
  console.log(JSON.stringify(stats, null, 1));
  fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/etl/out/ingest-stats.json', JSON.stringify({ stats, total: idx }, null, 2));
  // 合并作者简介到 authors-gsw.json
  const bioPath = 'C:/Users/xiang/Downloads/poetry-site/etl/out/authors-gsw.json';
  let old = [];
  try { old = JSON.parse(fs.readFileSync(bioPath, 'utf8')); } catch {}
  const map = new Map(old.map(a => [a.name, a]));
  for (const [k, v] of bios) if (!map.has(k)) map.set(k, v);
  fs.writeFileSync(bioPath, JSON.stringify([...map.values()]));
  console.log(`作者简介合并后: ${map.size}`);
  console.log('INGEST_OK');
})();
