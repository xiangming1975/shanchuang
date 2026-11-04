// ETL 第四步：JoyDraw/poetry-1 补充匹配（补译文/赏析/背景 + star 人气分）
// 输入: out/poems2.jsonl + downloads/joydraw/LCPoetry*.json  输出: out/poems3.jsonl
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const P1 = 'C:/Users/xiang/Downloads/poetry-site/downloads/joydraw';
const IN = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems2.jsonl';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems3.jsonl';

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const memo = new Map();
function t2s(s) {
  if (!s) return '';
  let v = memo.get(s);
  if (v !== undefined) return v;
  v = conv(s);
  if (memo.size < 300000) memo.set(s, v);
  return v;
}
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g;
function norm(s) { return t2s(String(s || '')).replace(PUNCT, '').toLowerCase(); }
function stripHeader(txt, re) {
  return String(txt || '').replace(re, '').trim();
}

// JoyDraw fanyi 文本拆分：'译文\n…\n\n注释\n…'
function splitFanyi(txt) {
  const s = String(txt || '').trim();
  if (!s) return { y: '', z: '' };
  let y = '', z = '';
  const m = s.match(/\n\s*注释[:：]?\s*\n?/);
  if (m && s.slice(0, m.index).trim()) {
    y = s.slice(0, m.index).trim();
    z = s.slice(m.index + m[0].length).trim();
  } else if (/^注释/.test(s)) {
    z = s.replace(/^注释[:：]?\s*/, '').trim();
  } else {
    y = s;
  }
  y = stripHeader(y, /^译文[:：]?\s*/);
  return { y, z };
}

async function main() {
  const files = fs.readdirSync(P1).filter(f => /^LCPoetry\d+\.json$/.test(f) && fs.statSync(path.join(P1, f)).size > 100000);
  console.log('poetry-1 数据文件:', files.length);

  const m1 = new Map(), m2 = new Map(), m3 = new Map(), m4 = new Map();
  // m1: 标题|作者, m2: 仅标题→[rec], m3: 作者|正文前缀, m4: 仅正文前缀
  let total = 0, withF = 0;
  for (const file of files) {
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(P1, file), 'utf8')); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      const name = r.name || r.title || '';
      if (!name) continue;
      const fanyi = r.fanyi || '', shangxi = r.shangxi || '', about = r.about || '';
      const star = r.star || 0;
      if (!fanyi && !shangxi && star < 300) continue;
      const poet = typeof r.poet === 'object' && r.poet ? (r.poet.name || '') : (r.poet || '');
      const author = r.author || poet || '';
      total++;
      const sp = splitFanyi(fanyi);
      const rec = {
        y: stripHeader(sp.y, /^\s*/),
        z: sp.z,
        s: stripHeader(shangxi, /^赏析[:：]?\s*/),
        b: stripHeader(about, /^创作背景[:：]?\s*/),
        star,
      };
      if (rec.y || rec.z || rec.s || rec.b) withF++;
      else if (star < 300) continue;
      const t = norm(name), a = norm(author);
      const c24 = norm(String(r.content || '')).slice(0, 24);
      if (t && a) { const k = t + '|' + a; if (!m1.has(k)) m1.set(k, rec); }
      if (t) { if (!m2.has(t)) m2.set(t, []); m2.get(t).push(rec); }
      if (c24 && a) { const k = a + '|' + c24; if (!m3.has(k)) m3.set(k, rec); }
      if (c24.length >= 12 && !m4.has(c24)) m4.set(c24, rec);
    }
  }
  console.log(`poetry-1 记录 ${total} (带译文赏析 ${withF}), 键 m1=${m1.size} m2=${m2.size} m3=${m3.size} m4=${m4.size}`);

  const rl = readline.createInterface({ input: fs.createReadStream(IN, { encoding: 'utf8' }), crlfDelay: Infinity });
  const w = fs.createWriteStream(OUT, { encoding: 'utf8' });
  const stats = {};
  let n = 0, addedF = 0, addedStar = 0;
  for await (const line of rl) {
    const r = JSON.parse(line); n++;
    const st = stats[r.c] = stats[r.c] || { total: 0, fin: 0, add: 0, star: 0 };
    st.total++;
    const t = norm(r.t), a = norm(r.a);
    const c24 = norm((r.p || []).join('')).slice(0, 24);
    let jd = null;
    if (t && a) jd = m1.get(t + '|' + a) || null;
    if (!jd && c24.length >= 12) jd = m4.get(c24) || null;            // 仅正文前缀（最可靠）
    if (!jd && c24 && a) jd = m3.get(a + '|' + c24) || null;
    if (!jd && t) {
      const cands = m2.get(t);
      if (cands && cands.length === 1) jd = cands[0];                  // 仅标题且唯一
    }
    if (jd) {
      if (jd.star && jd.star > (r.jd || 0)) { r.jd = jd.star; addedStar++; }
      r.f = r.f || {};
      if (!r.f.y && jd.y) { r.f.y = jd.y; }
      if (!r.f.z && jd.z) { r.f.z = jd.z; }
      if (!r.f.s && jd.s) { r.f.s = jd.s; }
      if (!r.f.b && jd.b) { r.f.b = jd.b; }
      if (Object.keys(r.f).length === 0) delete r.f;
    }
    if (r.f && (r.f.y || r.f.z || r.f.s || r.f.b)) st.fin++;
    if (r.jd && r.jd >= 300) st.star++;
    w.write(JSON.stringify(r) + '\n');
  }
  await new Promise(res => w.end(res));
  const tot = { total: 0, final: 0 };
  console.log(`star 命中 ${addedStar} 条`);
  for (const [c, v] of Object.entries(stats)) {
    tot.total += v.total; tot.final += v.fin;
    console.log(`  ${c}: ${v.total} 首, 最终带译文注释 ${v.fin} (${(v.fin / v.total * 100).toFixed(1)}%), 高star ${v.star}`);
  }
  console.log(`合计: ${tot.final}/${tot.total} (${(tot.final / tot.total * 100).toFixed(1)}%)`);
  fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/etl/out/match2-stats.json', JSON.stringify({ stats, tot, addedF, addedStar }, null, 2));
  console.log('MATCH2_OK');
}
main().catch(e => { console.error(e); process.exit(1); });
