// ETL 第一步：清洗本地 chinese-poetry 全量数据 → out/poems.jsonl（统一记录）
const fs = require('fs');
const path = require('path');

const R = 'C:/Users/xiang/Downloads/chinese-poetry-master';
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out';
fs.mkdirSync(OUT, { recursive: true });

// ---------- 缺字映射 ----------
const bmRaw = JSON.parse(fs.readFileSync(path.join(R, '全唐诗/表面结构字.json'), 'utf8'));
const bmMap = new Map();
for (const [k, v] of Object.entries(bmRaw)) {
  const font = Array.isArray(v) && v[0] && v[0].font;
  if (font) bmMap.set(k, font); // k 形如 "{上休下鳥}"
}
let bmHits = 0, bmMiss = 0;
function fixComposite(s) {
  if (!s || s.indexOf('{') === -1) return s;
  return s.replace(/\{[^{}]{1,12}\}/g, m => {
    const rep = bmMap.get(m);
    if (rep) { bmHits++; return rep; }
    bmMiss++; return '';
  });
}
function cleanStr(s) {
  if (typeof s !== 'string') return s;
  s = fixComposite(s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  return s;
}
function cleanArr(a) {
  if (!Array.isArray(a)) return undefined;
  const out = a.map(x => typeof x === 'string' ? cleanStr(x) : x).filter(x => x && x.length);
  return out.length ? out : undefined;
}

// ---------- 输出 ----------
const w = fs.createWriteStream(path.join(OUT, 'poems.jsonl'), { encoding: 'utf8' });
let idx = 0;
const stats = {};
const issues = [];
function emit(rec) {
  rec.i = idx++;
  w.write(JSON.stringify(rec) + '\n');
  stats[rec.c] = (stats[rec.c] || 0) + 1;
}
function readJSON(rel) { return JSON.parse(fs.readFileSync(path.join(R, rel), 'utf8')); }
function dynFromAuthor(a, fallback) {
  const m = typeof a === 'string' && a.match(/^([先秦两汉魏晋南北朝隋唐宋代宋金元明清]{2,4})[）)：:／/]\s*(.+)$/);
  if (m) return { d: m[1], a: m[2].trim() };
  const m2 = typeof a === 'string' && a.match(/^[（(]([^）)]{1,4})[）)]\s*(.+)$/);
  if (m2) return { d: m2[1], a: m2[2].trim() };
  return { d: fallback, a: typeof a === 'string' ? a.trim() : a };
}

// ---------- 1. 唐诗三百首（全唐诗目录版） ----------
for (const r of readJSON('全唐诗/唐诗三百首.json')) {
  emit({ c: 'tang300', t: cleanStr(r.title), a: cleanStr(r.author || '佚名'), d: '唐', p: cleanArr(r.paragraphs) || [], tg: r.tags && r.tags.map(cleanStr) });
}

// ---------- 2. 诗经 ----------
for (const r of readJSON('诗经/shijing.json')) {
  emit({ c: 'shijing', t: cleanStr(r.title), a: '佚名', d: '先秦', p: cleanArr(r.content) || [], tg: [cleanStr(r.chapter), cleanStr(r.section)].filter(Boolean) });
}

// ---------- 3. 楚辞 ----------
for (const r of readJSON('楚辞/chuci.json')) {
  emit({ c: 'chuci', t: cleanStr(r.title), a: cleanStr(r.author || '佚名'), d: '先秦', p: cleanArr(r.content) || [], tg: [cleanStr(r.section)].filter(Boolean) });
}

// ---------- 4. 论语 ----------
for (const r of readJSON('论语/lunyu.json')) {
  emit({ c: 'lunyu', t: cleanStr(r.chapter), a: '孔子及弟子', d: '先秦', p: cleanArr(r.paragraphs) || [], tg: ['论语'] });
}

// ---------- 5. 四书五经（大学/中庸/孟子） ----------
const dx = readJSON('四书五经/daxue.json');
emit({ c: 'ssxx', t: '大学', a: '曾子', d: '先秦', p: cleanArr(dx.paragraphs) || [], tg: ['四书'] });
const zy = readJSON('四书五经/zhongyong.json');
emit({ c: 'ssxx', t: '中庸', a: '子思', d: '先秦', p: cleanArr(zy.paragraphs) || [], tg: ['四书'] });
for (const r of readJSON('四书五经/mengzi.json')) {
  emit({ c: 'ssxx', t: '孟子·' + cleanStr(r.chapter), a: '孟子', d: '战国', p: cleanArr(r.paragraphs) || [], tg: ['四书'] });
}

// ---------- 6. 古文观止（12卷展平） ----------
const gwg = readJSON('蒙学/guwenguanzhi.json');
for (const juan of gwg.content || []) {
  for (const pian of juan.content || []) {
    const { d, a } = dynFromAuthor(pian.author, '');
    emit({ c: 'guwen', t: cleanStr(pian.chapter), a: a || '佚名', d: d || '', p: cleanArr(pian.paragraphs) || [], tg: [cleanStr(juan.title), cleanStr(pian.source)].filter(Boolean) });
  }
}

// ---------- 7. 蒙学其余 ----------
const szi = readJSON('蒙学/sanzijing-new.json');
emit({ c: 'mengxue', t: cleanStr(szi.title), a: cleanStr(szi.author || '王应麟'), d: '宋', p: cleanArr(szi.paragraphs) || [], tg: ['蒙学'] });
const qzw = readJSON('蒙学/qianziwen.json');
emit({ c: 'mengxue', t: cleanStr(qzw.title), a: cleanStr(qzw.author || '周兴嗣'), d: '南北朝', p: cleanArr(qzw.paragraphs) || [], tg: ['蒙学'] });
const bjx = readJSON('蒙学/baijiaxing.json');
emit({ c: 'mengxue', t: cleanStr(bjx.title), a: '佚名', d: '北宋', p: cleanArr(bjx.paragraphs) || [], tg: ['蒙学'] });
const zzj = readJSON('蒙学/zhuzijiaxun.json');
emit({ c: 'mengxue', t: cleanStr(zzj.title), a: cleanStr(zzj.author || '朱柏庐'), d: '清', p: cleanArr(zzj.paragraphs) || [], tg: ['蒙学'] });
const dzg = readJSON('蒙学/dizigui.json');
for (const ch of dzg.content || []) {
  emit({ c: 'mengxue', t: `${cleanStr(dzg.title)}·${cleanStr(ch.chapter)}`, a: cleanStr(dzg.author || '李毓秀'), d: '清', p: cleanArr(ch.paragraphs) || [], tg: ['蒙学'] });
}
const slqm = readJSON('蒙学/shenglvqimeng.json');
for (const juan of slqm.content || []) {
  for (const pian of juan.content || []) {
    emit({ c: 'mengxue', t: `${cleanStr(pian.chapter)}`, a: cleanStr(slqm.author || '车万育'), d: '清', p: cleanArr(pian.paragraphs) || [], tg: ['蒙学', cleanStr(slqm.title), cleanStr(juan.title)].filter(Boolean) });
  }
}
const yxql = readJSON('蒙学/youxueqionglin.json');
for (const juan of yxql.content || []) {
  for (const pian of juan.content || []) {
    emit({ c: 'mengxue', t: `幼学琼林·${cleanStr(pian.chapter)}`, a: '程登吉', d: '明', p: cleanArr(pian.paragraphs) || [], tg: ['蒙学', cleanStr(juan.title)].filter(Boolean) });
  }
}
const zgx = readJSON('蒙学/zengguangxianwen.json');
for (const ch of zgx.content || []) {
  emit({ c: 'mengxue', t: `${cleanStr(zgx.title)}·${cleanStr(ch.chapter)}`, a: '佚名', d: '明', p: cleanArr(ch.paragraphs) || [], tg: ['蒙学'] });
}

// ---------- 8. 千家诗 ----------
const qjs = readJSON('蒙学/qianjiashi.json');
for (const part of qjs.content || []) {
  for (const poem of part.content || []) {
    const { d, a } = dynFromAuthor(poem.author, '');
    emit({ c: 'qjs', t: cleanStr(poem.chapter || poem.title), a: a || '佚名', d: d || '', p: cleanArr(poem.paragraphs) || [], tg: ['千家诗', cleanStr(part.type)].filter(Boolean) });
  }
}

// ---------- 9. 蒙学唐诗三百首 ----------
const mtssb = readJSON('蒙学/tangshisanbaishou.json');
for (const part of mtssb.content || []) {
  for (const poem of part.content || []) {
    emit({ c: 'mtssb', t: cleanStr(poem.chapter || poem.title), a: cleanStr(poem.author || '佚名'), d: '唐', p: cleanArr(poem.paragraphs) || [], tg: ['唐诗三百首', cleanStr(part.type)].filter(Boolean) });
  }
}

// ---------- 10. 宋词三百首 ----------
for (const r of readJSON('宋词/宋词三百首.json')) {
  emit({ c: 'songci300', t: cleanStr(r.rhythmic || r.title), a: cleanStr(r.author || '佚名'), d: '宋', p: cleanArr(r.paragraphs) || [], r: cleanStr(r.rhythmic), tg: r.tags && r.tags.map(cleanStr) });
}

// ---------- 11. 花间集 ----------
const hjjDir = path.join(R, '五代诗词/huajianji');
for (const f of fs.readdirSync(hjjDir).filter(f => f.endsWith('.json')).sort()) {
  for (const r of JSON.parse(fs.readFileSync(path.join(hjjDir, f), 'utf8'))) {
    emit({ c: 'hjj', t: cleanStr(r.title || r.rhythmic), a: cleanStr(r.author || '佚名'), d: '五代', p: cleanArr(r.paragraphs) || [], r: cleanStr(r.rhythmic), n: cleanArr(r.notes) });
  }
}

// ---------- 12. 南唐二主词 ----------
const ntIntro = JSON.parse(fs.readFileSync(path.join(R, '五代诗词/nantang/intro.json'), 'utf8'));
emit({ c: 'nt', t: cleanStr(ntIntro.title || '南唐二主词·简介'), a: '', d: '五代', p: cleanArr(ntIntro.desc) || [], tg: ['南唐二主词'] });
for (const r of JSON.parse(fs.readFileSync(path.join(R, '五代诗词/nantang/poetrys.json'), 'utf8'))) {
  emit({ c: 'nt', t: cleanStr(r.title || r.rhythmic), a: cleanStr(r.author), d: '五代', p: cleanArr(r.paragraphs) || [], r: cleanStr(r.rhythmic), n: cleanArr(r.notes) });
}

// ---------- 13. 水墨唐诗 ----------
for (const r of readJSON('水墨唐诗/shuimotangshi.json')) {
  emit({ c: 'smts', t: cleanStr(r.title), a: cleanStr(r.author), d: '唐', p: cleanArr(r.paragraphs) || [], pr: cleanStr(r.prologue) });
}

// ---------- 14. 曹操 ----------
for (const r of readJSON('曹操诗集/caocao.json')) {
  emit({ c: 'cc', t: cleanStr(r.title), a: '曹操', d: '汉', p: cleanArr(r.paragraphs) || [] });
}

// ---------- 15. 纳兰性德 ----------
for (const r of readJSON('纳兰性德/纳兰性德诗集.json')) {
  emit({ c: 'nalan', t: cleanStr(r.title), a: '纳兰性德', d: '清', p: cleanArr(r.para || r.paragraphs) || [] });
}

// ---------- 16. 幽梦影 ----------
const ymyArr = readJSON('幽梦影/youmengying.json');
ymyArr.forEach((r, k) => {
  const content = cleanStr(r.content);
  emit({ c: 'ymy', t: `幽梦影·第${k + 1}则`, a: '张潮', d: '清', p: [content], cm: cleanArr(r.comment) });
});

// ---------- 17/18. 全唐诗 + 全宋诗（含 strains 按 uuid join、rank 按位置 join） ----------
function extractDynasty(dirName, collId, dynasty) {
  const mainFiles = fs.readdirSync(path.join(R, dirName)).filter(f => new RegExp(`^poet\\.${collId}\\.(\\d+)\\.json$`).test(f))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
  for (const f of mainFiles) {
    const num = f.match(/(\d+)/)[1];
    const poems = JSON.parse(fs.readFileSync(path.join(R, dirName, f), 'utf8'));
    // strains: 按 uuid
    let strainMap = null;
    const sPath = path.join(R, 'strains/json', `poet.${collId}.${num}.json`);
    if (fs.existsSync(sPath)) {
      strainMap = new Map();
      for (const s of JSON.parse(fs.readFileSync(sPath, 'utf8'))) strainMap.set(s.id, s.strains);
    }
    // rank: 按位置
    let ranks = null;
    const rPath = path.join(R, 'rank/poet', `poet.${collId}.rank.${num}.json`);
    if (fs.existsSync(rPath)) {
      ranks = JSON.parse(fs.readFileSync(rPath, 'utf8'));
      if (ranks.length !== poems.length) { issues.push(`rank长度不匹配 ${f}: ${ranks.length} vs ${poems.length}`); ranks = null; }
    }
    poems.forEach((r, k) => {
      const rec = { c: collId, t: cleanStr(r.title), a: cleanStr(r.author || '佚名'), d: dynasty, p: cleanArr(r.paragraphs) || [] };
      // 赋类标题（含繁体賦）移交「历代赋」集合
      if (fuWriter && /^(.+)?(赋|賦)(并序|有序)?$/.test(rec.t) && rec.t.length <= 24 && !/[·・]/.test(rec.t)) {
        rec.c = 'fu';
        if (r.tags) rec.tg = r.tags.map(cleanStr);
        if (strainMap && strainMap.has(r.id)) rec.st = strainMap.get(r.id);
        if (ranks) {
          const rk = ranks[k];
          const h = (rk.baidu || 0) + (rk.so360 || 0) + (rk.google || 0) + (rk.bing || 0) + (rk.bing_en || 0);
          if (h > 0) rec.h = h;
        }
        rec.oi = fuIdx++;
        fuWriter.write(JSON.stringify(rec) + '\n');
        return;
      }
      if (r.tags) rec.tg = r.tags.map(cleanStr);
      if (strainMap && strainMap.has(r.id)) rec.st = strainMap.get(r.id);
      if (ranks) {
        const rk = ranks[k];
        const h = (rk.baidu || 0) + (rk.so360 || 0) + (rk.google || 0) + (rk.bing || 0) + (rk.bing_en || 0);
        if (h > 0) rec.h = h;
      }
      emit(rec);
    });
  }
}
// 赋迁移输出流（全唐诗/全宋词里的赋标题）
const fuWriter = fs.createWriteStream(path.join(OUT, 'poems-fu-local.jsonl'), { encoding: 'utf8' });
let fuIdx = 0;
extractDynasty('全唐诗', 'tang', '唐');
extractDynasty('全唐诗', 'song', '宋');

// ---------- 19. 全宋词 ----------
const ciDir = path.join(R, '宋词');
const ciFiles = fs.readdirSync(ciDir).filter(f => /^ci\.song\.\d+\.json$/.test(f))
  .sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]));
ciFiles.forEach((f, fi) => {
  const poems = JSON.parse(fs.readFileSync(path.join(ciDir, f), 'utf8'));
  let ranks = null;
  const rPath = path.join(R, 'rank/ci', `ci.song.rank.${f.match(/(\d+)/)[1]}.json`);
  if (fs.existsSync(rPath)) {
    ranks = JSON.parse(fs.readFileSync(rPath, 'utf8'));
    if (ranks.length !== poems.length) { issues.push(`ci rank长度不匹配 ${f}`); ranks = null; }
  }
  poems.forEach((r, k) => {
    const rec = { c: 'songci', t: cleanStr(r.rhythmic || r.title || '词'), a: cleanStr(r.author || '佚名'), d: '宋', p: cleanArr(r.paragraphs) || [] };
    if (r.rhythmic) rec.r = cleanStr(r.rhythmic);
    if (r.prologue) rec.pr = cleanStr(r.prologue);
    if (r.tags) rec.tg = r.tags.map(cleanStr);
    if (ranks) {
      const rk = ranks[k];
      const h = (rk.baidu || 0) + (rk.so360 || 0) + (rk.google || 0) + (rk.bing || 0) + (rk.bing_en || 0);
      if (h > 0) rec.h = h;
    }
    emit(rec);
  });
});

// ---------- 20. 元曲 ----------
for (const r of readJSON('元曲/yuanqu.json')) {
  emit({ c: 'yq', t: cleanStr(r.title), a: cleanStr(r.author || '佚名'), d: '元', p: cleanArr(r.paragraphs) || [] });
}

// ---------- 收尾 ----------
(async () => {
  await new Promise(res => w.end(res));
  console.log('总记录数:', idx);
  console.log('各集合统计:', JSON.stringify(stats, null, 2));
  console.log('缺字命中:', bmHits, '未命中:', bmMiss);
  if (issues.length) console.log('问题:\n' + issues.slice(0, 20).join('\n'));
  fs.writeFileSync(path.join(OUT, 'extract-stats.json'), JSON.stringify({ total: idx, stats, bmHits, bmMiss, issues }, null, 2));
})();
