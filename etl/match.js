// ETL 第二步：解析 gushiwen.jsonl（译文/注释/赏析/背景/作者简介），与本地 poems.jsonl 匹配
// 两遍流式：pass1 建键索引（只存键+行号），pass2 只解析命中行，控制内存
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const JSONL = 'C:/Users/xiang/Downloads/poetry-site/downloads/gushiwen.jsonl';
const IN = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems.jsonl';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems2.jsonl';
const OUTDIR = 'C:/Users/xiang/Downloads/poetry-site/etl/out';

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const convMemo = new Map();
function t2s(s) {
  if (!s) return '';
  let v = convMemo.get(s);
  if (v !== undefined) return v;
  v = conv(s);
  if (convMemo.size < 300000) convMemo.set(s, v);
  return v;
}
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙\u0001]+/g;
function norm(s) { return t2s(String(s || '')).replace(PUNCT, '').toLowerCase(); }
function baseTitle(s) { return norm(s).replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+|\d+)$/, ''); }
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
// 拆 译文/注释 组合块：<strong>译文</strong>正文<strong>注释</strong>正文
function splitYz(cont) {
  const marked = String(cont).replace(/<\s*strong\s*>/gi, '\u0001').replace(/<\s*\/\s*strong\s*>/gi, '');
  const plain = html2text(marked);
  const segs = plain.split('\u0001').map(s => s.trim()).filter(Boolean);
  let y = '', z = '';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (/^(译文及注释|译文|白话译文|翻译)$/.test(s.replace(/\s/g, ''))) continue;
    if (/^(注释|字词注释|注解|注)$/.test(s.replace(/\s/g, ''))) continue;
    const prevLabel = i > 0 ? segs[i - 1].replace(/\s/g, '') : '';
    if (/^(译文及注释|译文|白话译文|翻译)$/.test(prevLabel)) y = s;
    else if (/^(注释|字词注释|注解|注)$/.test(prevLabel)) z = s;
  }
  if (!y && !z && segs.length) { // 没有标记的整块
    const whole = segs.join('\n\n');
    const zIdx = whole.search(/\n注释[：:|\s\n]/);
    if (zIdx > 0) { y = whole.slice(0, zIdx).trim(); z = whole.slice(zIdx).replace(/^\n?注释[：:]?\s*/, '').trim(); }
    else y = whole;
  }
  return { y, z };
}

async function pass1() {
  console.time('pass1');
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL, { encoding: 'utf8' }), crlfDelay: Infinity });
  const m1 = new Map(), m2 = new Map(), m3 = new Map(), m4 = new Map(), m5 = new Map();
  const flags = new Map(); // lineNo -> 有无 fanyi/赏析
  const authorLines = new Map(); // 作者名 -> 首个行号
  let ln = 0, withF = 0;
  for await (const line of rl) {
    if (!line.trim()) { ln++; continue; }
    let root = null;
    try { root = JSON.parse(line); } catch { ln++; continue; }
    const poem = root.tb_gushiwen || root.gushiwen || root.poem || root;
    const title = poem.nameStr || poem.title || poem.name || '';
    const author = poem.author || '';
    const cont = poem.cont || poem.content || '';
    const fanyis = (root.tb_fanyis && root.tb_fanyis.fanyis) || root.fanyis || [];
    const shangxis = (root.tb_shangxis && root.tb_shangxis.shangxis) || root.shangxis || [];
    const hasF = (Array.isArray(fanyis) && fanyis.some(b => b && b.cont)) || (Array.isArray(shangxis) && shangxis.some(b => b && b.cont));
    if (hasF) withF++;
    if (author && !authorLines.has(author)) authorLines.set(author, ln);
    const t = norm(title), a = norm(author);
    const c24 = norm(html2text(cont)).slice(0, 24);
    if (t && a) { const k = t + '|' + a; if (!m1.has(k)) m1.set(k, []); m1.get(k).push(ln); }
    const tb = baseTitle(title), ab = baseTitle(author);
    if (tb && ab) { const k = tb + '|' + ab; if (!m2.has(k)) m2.set(k, []); m2.get(k).push(ln); }
    if (c24 && a) { const k = a + '|' + c24; if (!m3.has(k)) m3.set(k, []); m3.get(k).push(ln); }
    if (c24.length >= 12) { if (!m4.has(c24)) m4.set(c24, []); m4.get(c24).push(ln); }
    // 词牌前缀键：'念奴娇·赤壁怀古' → '念奴娇|作者'
    if (/[·・]/.test(String(title))) {
      const tp = norm(String(title).split(/[·・]/)[0]);
      if (tp && a) { const k = tp + '|' + a; if (!m5.has(k)) m5.set(k, []); m5.get(k).push(ln); }
    }
    flags.set(ln, hasF ? 1 : 0);
    ln++;
  }
  console.timeEnd('pass1');
  console.log(`gushiwen 总行数 ${ln}, 带译文/赏析 ${withF}, 键索引 m1=${m1.size} m2=${m2.size} m3=${m3.size} m4=${m4.size} m5=${m5.size}, 作者 ${authorLines.size}`);
  return { m1, m2, m3, m4, m5, flags, authorLines };
}

async function pass2(idx) {
  console.time('pass2');
  // 先算出我们的键集合 → 需要的行号
  const rl0 = readline.createInterface({ input: fs.createReadStream(IN, { encoding: 'utf8' }), crlfDelay: Infinity });
  const needK1 = new Set(), needK2 = new Set(), needK3 = new Set(), needK4 = new Set(), needK5 = new Set();
  const ourAuthors = new Set();
  let ourN = 0;
  for await (const line of rl0) {
    const r = JSON.parse(line); ourN++;
    const t = norm(r.t), a = norm(r.a), tb = baseTitle(r.t), ab = baseTitle(r.a);
    const c24 = norm((r.p || []).join('')).slice(0, 24);
    const tp = norm(String(r.t || '').split(/[·・]/)[0]);
    if (t && a) needK1.add(t + '|' + a);
    if (tb && ab) needK2.add(tb + '|' + ab);
    if (c24 && a) needK3.add(a + '|' + c24);
    if (c24.length >= 12) needK4.add(c24);
    if (tp && a) needK5.add(tp + '|' + a);
    if (r.a) ourAuthors.add(r.a);
  }
  console.log(`我们的记录 ${ourN}, 键: k1=${needK1.size} k2=${needK2.size} k3=${needK3.size} k4=${needK4.size} k5=${needK5.size}, 作者 ${ourAuthors.size}`);
  const needed = new Set();
  const pick = (map, set) => { for (const k of set) { const arr = map.get(k); if (arr) for (const x of arr) needed.add(x); } };
  pick(idx.m1, needK1); pick(idx.m2, needK2); pick(idx.m3, needK3); pick(idx.m4, needK4); pick(idx.m5, needK5);
  for (const [name, l] of idx.authorLines) if (ourAuthors.has(name)) needed.add(l);
  console.log(`需要二次解析的行 ${needed.size}`);

  // 解析所需行
  const en = new Map(); // lineNo -> {t,a,c24,y,z,s,b}
  const bio = new Map(); // 作者名 -> {d, bio}
  const rl2 = readline.createInterface({ input: fs.createReadStream(JSONL, { encoding: 'utf8' }), crlfDelay: Infinity });
  let ln2 = 0, got = 0;
  for await (const line of rl2) {
    if (needed.has(ln2)) {
      let root = null;
      try { root = JSON.parse(line); } catch {}
      if (root) {
        const poem = root.tb_gushiwen || root.gushiwen || root.poem || root;
        const fanyis = (root.tb_fanyis && root.tb_fanyis.fanyis) || root.fanyis || [];
        const shangxis = (root.tb_shangxis && root.tb_shangxis.shangxis) || root.shangxis || [];
        const blocks = [...(Array.isArray(fanyis) ? fanyis : []), ...(Array.isArray(shangxis) ? shangxis : [])];
        let y = '', z = '', s = '', b = '';
        for (const blk of blocks) {
          if (!blk || !blk.cont) continue;
          const label = String(blk.nameStr || '').replace(/\s/g, '');
          if (/译文|翻译|白话/.test(label)) { const r2 = splitYz(blk.cont); if (r2.y) y = r2.y; if (r2.z) z = r2.z; }
          else if (/注释|注解|^注$/.test(label)) { if (!z) z = html2text(blk.cont); }
          else if (/赏析|赏析/.test(label)) { if (!s) s = html2text(blk.cont); }
          else if (/背景|创作背景|背景及注释/.test(label)) { if (!b) b = html2text(blk.cont); }
        }
        const t = norm(poem.nameStr || poem.title || ''), a = norm(poem.author || '');
        const c24 = norm(html2text(poem.cont || '')).slice(0, 24);
        en.set(ln2, { t, a, c24, y, z, s, b });
        got++;
        const au = root.tb_author || root.author || null;
        const aname = poem.author;
        if (au && aname && !bio.has(aname) && (au.cont || au.chaodai)) {
          bio.set(aname, { d: html2text(au.chaodai || ''), bio: html2text(au.cont || '') });
        }
      }
    }
    ln2++;
  }
  console.timeEnd('pass2');
  console.log(`已解析 ${got} 行, 作者简介 ${bio.size}`);
  return { en, bio };
}

function choose(cands, en, ourC24) {
  if (!cands || !cands.length) return null;
  for (const x of cands) { const e = en.get(x); if (e && ourC24 && e.c24 === ourC24) return e; }
  if (cands.length === 1) { const e = en.get(cands[0]); if (e) return e; }
  return null;
}

async function merge(idx, en) {
  console.time('merge');
  const rl = readline.createInterface({ input: fs.createReadStream(IN, { encoding: 'utf8' }), crlfDelay: Infinity });
  const w = fs.createWriteStream(OUT, { encoding: 'utf8' });
  const stats = {};
  let n = 0;
  for await (const line of rl) {
    const r = JSON.parse(line); n++;
    const t = norm(r.t), a = norm(r.a), tb = baseTitle(r.t), ab = baseTitle(r.a);
    const tp = norm(String(r.t || '').split(/[·・]/)[0]);
    const c24 = norm((r.p || []).join('')).slice(0, 24);
    let e = null;
    if (t && a) e = choose(idx.m1.get(t + '|' + a), en, c24);
    if (!e && tp && a) e = choose(idx.m5.get(tp + '|' + a), en, c24);
    if (!e && tb && ab) e = choose(idx.m2.get(tb + '|' + ab), en, c24);
    if (!e && c24 && a) e = choose(idx.m3.get(a + '|' + c24), en, c24);
    if (!e && c24.length >= 12) e = choose(idx.m4.get(c24), en, c24);
    const st = stats[r.c] = stats[r.c] || { total: 0, m: 0, y: 0, z: 0, s: 0, b: 0 };
    st.total++;
    if (e && (e.y || e.z || e.s || e.b)) {
      st.m++;
      const f = {};
      if (e.y) { f.y = e.y; st.y++; }
      if (e.z) { f.z = e.z; st.z++; }
      if (e.s) { f.s = e.s; st.s++; }
      if (e.b) { f.b = e.b; st.b++; }
      r.f = f;
    }
    w.write(JSON.stringify(r) + '\n');
  }
  await new Promise(res => w.end(res));
  console.timeEnd('merge');
  console.log('匹配统计:');
  const tot = { total: 0, m: 0 };
  for (const [c, v] of Object.entries(stats)) {
    tot.total += v.total; tot.m += v.m;
    console.log(`  ${c}: ${v.total} 首, 命中 ${v.m} (${(v.m / v.total * 100).toFixed(1)}%), 译文 ${v.y}, 注释 ${v.z}, 赏析 ${v.s}, 背景 ${v.b}`);
  }
  console.log(`合计: ${tot.total} 首, 命中 ${tot.m} (${(tot.m / tot.total * 100).toFixed(1)}%)`);
  fs.writeFileSync(path.join(OUTDIR, 'match-stats.json'), JSON.stringify({ stats, tot }, null, 2));
  return { stats };
}

(async () => {
  const idx = await pass1();
  const { en, bio } = await pass2(idx);
  await merge(idx, en);
  fs.writeFileSync(path.join(OUTDIR, 'authors-gsw.json'), JSON.stringify([...bio.entries()].map(([name, v]) => ({ name, ...v })), null, 0));
  console.log('DONE authors-gsw.json');
})();
