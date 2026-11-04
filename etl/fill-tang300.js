// 给唐诗三百首里「译文/注释/赏析全无」的篇目补材料
// ① 先站内互借：同标题+同作者的其他记录若带材料，直接复制（零外部依赖）
// ② 再查 gushiwen 原始语料：标题剥掉乐府分类前缀后匹配，用正文指纹确认
// 产出 etl/tang300-fill.json：{ "<id>": { y, z, s } }，由 build.js 套用
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const OpenCC = require('opencc-js');

const DATA = path.join(__dirname, '..', 'site', 'data');
const OUT = path.join(__dirname, 'tang300-fill.json');
const GS = 'C:/Users/xiang/Downloads/poetry-site/downloads/gushiwen.jsonl';

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const t2s = (s) => (s ? conv(String(s)) : '');
const PUNCT = /[\s·・／/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]+/g;
const norm = (s) => t2s(s).replace(PUNCT, '').toLowerCase();
const baseTitle = (s) => norm(s).replace(/(其[一二三四五六七八九十百零]+|之[一二三四五六七八九十百零]+|[一二三四五六七八九十百零]+|\d+)$/, '');
// 全唐诗的乐府分类前缀（简体形态）
const LE = /^(郊庙歌辞|鼓吹曲辞|横吹曲辞|相和歌辞|清商曲辞|舞曲歌辞|琴曲歌辞|杂曲歌辞|近代曲辞|新乐府辞|乐府杂曲)\s*/;

const cleanTitle = (t) => norm(String(t || '').replace(LE, ''));

function html2text(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function splitYz(cont) {
  const marked = String(cont || '').replace(/<\s*strong\s*>/gi, '\u0001').replace(/<\s*\/\s*strong\s*>/gi, '');
  const plain = html2text(marked);
  const segs = plain.split('\u0001').map(s => s.trim()).filter(Boolean);
  let y = '', z = '';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], prev = i > 0 ? segs[i - 1].replace(/\s/g, '') : '';
    if (/^(译文及注释|译文|白话译文|翻译)$/.test(s.replace(/\s/g, ''))) continue;
    if (/^(注释|字词注释|注解|注)$/.test(s.replace(/\s/g, ''))) continue;
    if (/^(译文及注释|译文|白话译文|翻译)$/.test(prev)) y = s;
    else if (/^(注释|字词注释|注解|注)$/.test(prev)) z = s;
  }
  if (!y && !z && segs.length) {
    const whole = segs.join('\n\n');
    const zi = whole.search(/\n注释[：:|\s\n]/);
    if (zi > 0) { y = whole.slice(0, zi).trim(); z = whole.slice(zi).replace(/^\n?注释[：:]?\s*/, '').trim(); }
    else y = whole;
  }
  return { y, z };
}

function main() {
  // 1) 目标：唐诗三百首里三样全无的
  const targets = [];
  for (const f of fs.readdirSync(path.join(DATA, 'poems'))) {
    if (!f.startsWith('tang300')) continue;
    for (const p of JSON.parse(fs.readFileSync(path.join(DATA, 'poems', f), 'utf8'))) {
      const x = p.f || {};
      if (!x.y && !x.z && !x.s) targets.push(p);
    }
  }
  console.log('待补', targets.length, '篇');
  const want = new Map();   // key → [id]
  for (const p of targets) {
    const k = cleanTitle(p.t) + '|' + norm(p.a || '');
    if (!want.has(k)) want.set(k, []);
    want.get(k).push(p.i);
  }

  // 2) 站内互借
  const borrow = {};
  const need = new Set(targets.map(p => p.i));
  for (const f of fs.readdirSync(path.join(DATA, 'poems'))) {
    for (const p of JSON.parse(fs.readFileSync(path.join(DATA, 'poems', f), 'utf8'))) {
      const x = p.f || {};
      if (!x.y && !x.z && !x.s) continue;
      const k = cleanTitle(p.t) + '|' + norm(p.a || '');
      if (!want.has(k)) continue;
      for (const id of want.get(k)) {
        if (id === p.i) continue;
        borrow[id] = { y: x.y || '', z: x.z || '', s: x.s || '', src: `站内 ${p.i}` };
      }
    }
  }
  console.log('站内互借命中', Object.keys(borrow).length, '篇');

  // 3) gushiwen 兜底（只扫未被互借满足的）
  const still = targets.filter(p => !borrow[p.i]);
  console.log('待查语料', still.length, '篇');

  const found = {};
  // 标题异题太常见（渭城曲 ↔ 送元二使安西），改按正文指纹匹配：取前 10 个汉字做键
  const fpOf = (p) => norm((p.p || []).join('')).slice(0, 10);
  const byFp = new Map();                 // 指纹 → [id]
  for (const t of still) {
    const k = fpOf(t);
    if (k.length < 6) continue;
    if (!byFp.has(k)) byFp.set(k, []);
    byFp.get(k).push(t.i);
  }
  const byId = new Map(targets.map(p => [p.i, p]));
  const rl = readline.createInterface({ input: fs.createReadStream(GS), crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line) return;
    const head = line.indexOf('"cont"');
    if (head < 0) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    const g = o.tb_gushiwen; if (!g) return;
    const body = norm(g.cont || '');
    const ids = byFp.get(body.slice(0, 10));
    if (!ids) return;
    for (const id of ids) {
      if (found[id]) continue;
      const fis = (o.tb_fanyis && o.tb_fanyis.fanyis) || [];
      let y = '', z = '';
      for (const fi of fis) { const r = splitYz(fi.cont); if (r.y && !y) y = r.y; if (r.z && !z) z = r.z; }
      if (!y && g.yizhu) y = html2text(g.yizhu);
      const sx = (o.tb_shangxis && o.tb_shangxis.shangxis) || [];
      const s = sx.map(x => html2text(x.cont || x)).filter(Boolean).join('\n\n');
      if (!y && !z && !s) continue;
      found[id] = { y, z, s, src: `gushiwen ${g.nameStr} / ${g.author || ''}` };
    }
  });
  rl.on('close', () => {
    // 第二轮：开头 10 字对不上多半是异文，改用正文中段片段做包含匹配
    const rest = still.filter(t => !found[t.i]);
    if (!rest.length) return finish();
    const frag = new Map();          // 片段 → [id]
    for (const t of rest) {
      const whole = norm((t.p || []).join(''));
      for (const part of [whole.slice(0, 12), whole.slice(8, 20), whole.slice(Math.max(0, whole.length - 14), whole.length - 2)]) {
        if (part.length < 8) continue;
        if (!frag.has(part)) frag.set(part, []);
        if (!frag.get(part).includes(t.i)) frag.get(part).push(t.i);
      }
    }
    const rl2 = readline.createInterface({ input: fs.createReadStream(GS), crlfDelay: Infinity });
    rl2.on('line', (line) => {
      if (!line.includes('"cont"')) return;
      let o; try { o = JSON.parse(line); } catch { return; }
      const g = o.tb_gushiwen; if (!g) return;
      const body = norm(g.cont || '');
      if (body.length < 12) return;
      for (const [part, ids] of frag) {
        if (!body.includes(part)) continue;
        for (const id of ids) {
          if (found[id]) continue;
          const fis = (o.tb_fanyis && o.tb_fanyis.fanyis) || [];
          let y = '', z = '';
          for (const fi of fis) { const r = splitYz(fi.cont); if (r.y && !y) y = r.y; if (r.z && !z) z = r.z; }
          if (!y && g.yizhu) y = html2text(g.yizhu);
          const sx = (o.tb_shangxis && o.tb_shangxis.shangxis) || [];
          const s = sx.map(x => html2text(x.cont || x)).filter(Boolean).join('\n\n');
          if (!y && !z && !s) continue;
          found[id] = { y, z, s, src: `gushiwen(宽松) ${g.nameStr} / ${g.author || ''}` };
        }
      }
    });
    rl2.on('close', finish);

    function finish() {
    const all = Object.assign({}, borrow, found);
    fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
    const n = Object.keys(all).length;
    console.log(`语料命中 ${Object.keys(found).length} 篇；合计补 ${n}/${targets.length} 篇 → ${OUT}`);
    const stillMiss = targets.filter(p => !all[p.i]).map(p => `${p.i} ${p.t}`);
    console.log('仍未补上：', stillMiss.length ? stillMiss.join(' | ') : '无');
    }
  });
}
main();
