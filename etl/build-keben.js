// ETL：中小学必背篇目（etl/keben.csv）→ 集合 keben
// 用法：node etl/build-keben.js
// 产出：etl/out/poems-keben.jsonl（喂给 build.js 的 extras）、etl/keben-unmatched.csv、控制台报告
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const SITE = path.join(__dirname, '..', 'site');
const DATA = path.join(SITE, 'data');
const OUT = path.join(__dirname, 'out');
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

const normKey = (s) => {
  let o = '';
  for (const ch of String(s || '')) o += convT2S(ch);
  return o.replace(/[\s·・\/、，。：:；!！?？（）()【】\[\]「」『』《》〈〉""''"'—\-_～~.…∙]/g, '').toLowerCase();
};

// 作者别名：源数据里的写法不一
const AUTHOR_ALIAS = {
  '佚名': ['佚名', '无名氏', '不详', ''],
  '北朝民歌': ['佚名', '无名氏', '北朝民歌'],
  '孔子及其弟子': ['孔子', '孔丘', '佚名', ''],
  '刘义庆': ['刘义庆', '佚名'],
  '礼记': ['礼记', '佚名', '戴圣'],
  '战国策': ['战国策', '佚名', '刘向'],
  '左传': ['左传', '左丘明'],
  '孟子': ['孟子', '孟轲', '孟子及其弟子'],
  '列子': ['列子', '列御寇'],
  '庄子': ['庄子', '庄周'],
  '吕不韦': ['吕不韦', '吕氏春秋'],
  '司马光': ['司马光', '资治通鉴'],
  '司马迁': ['司马迁', '史记'],
};

// 精简的 CSV 解析（支持双引号包裹与转义）
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// 组诗写法差异：库里有「悯农（之二）」「惠崇春江晚景二首 其一」这类，
// 课本只写「悯农（其二）」。剥掉“其X / 之X / 节选 / 二首”再匹配，最后用首句确认。
const baseTitle = (s) => normKey(String(s || '')
  .replace(/[（(]\s*(其|之)[一二三四五六七八九十百\d]+\s*[)）]/g, '')
  .replace(/[（(]\s*节选\s*[)）]/g, '')
  .replace(/([一二三四五六七八九十百\d]+首)\s*(其|之)[一二三四五六七八九十百\d]+/, '$1'));

const firstOk = (rec, hint) => {
  const h = normKey(hint).slice(0, 4);
  if (!h) return true;
  return normKey((rec.p && rec.p[0]) || '').startsWith(h);
};

function main() {
  const csvPath = path.join(__dirname, 'keben.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
  const head = rows.shift().map(h => h.trim());
  console.log('表头:', head.join(' / '), '| 数据行', rows.length);

  const items = rows.map(r => {
    const o = {};
    head.forEach((h, k) => { o[h] = (r[k] || '').trim(); });
    return o;
  });

  // 建索引：标题 → 记录；标题|作者 → 记录
  const byTitle = new Map();
  const byTitleAuthor = new Map();
  const byFirst = new Map();
  const byBaseAuthor = new Map();
  let totalRecs = 0;

  // 集合优先级：精选类优先（带译文/注释的次数多）
  const PREFER = ['tang300', 'songci300', 'shijing', 'chuci', 'qjs', 'mengxue', 'guwen', 'lunyu', 'ssxx'];
  const rankOf = (id) => { const k = PREFER.indexOf(id); return k < 0 ? 99 : k; };
  // 用分块文件名推断集合 id：keben-0000.json → keben
  for (const f of fs.readdirSync(path.join(DATA, 'poems'))) {
    const cid = f.replace(/-\d+\.json$/, '');
    if (cid === 'keben') continue;   // 不拿自己当匹配源
    const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'poems', f), 'utf8'));
    for (const r of arr) {
      totalRecs++;
      const tKey = normKey(r.t);
      const aKey = normKey(r.a);
      const rec = { ...r, _cid: cid, _rank: rankOf(cid) };
      const t1 = byTitle.get(tKey);
      if (!t1 || rec._rank < t1._rank) byTitle.set(tKey, rec);
      const taKey = tKey + '|' + aKey;
      const t2 = byTitleAuthor.get(taKey);
      if (!t2 || rec._rank < t2._rank) byTitleAuthor.set(taKey, rec);
      const fKey = normKey((r.p && r.p[0]) || '').slice(0, 6);
      if (fKey.length >= 5) {
        const t3 = byFirst.get(fKey);
        if (!t3 || rec._rank < t3._rank) byFirst.set(fKey, rec);
      }
      // 组诗基名索引（同基名的候选一组，供首句确认）
      const bKey = baseTitle(r.t);
      if (bKey && bKey.length >= 2) {
        let arr2 = byBaseAuthor.get(bKey + '|' + aKey);
        if (!arr2) { arr2 = []; byBaseAuthor.set(bKey + '|' + aKey, arr2); }
        if (arr2.length < 40) arr2.push(rec);
      }
    }
  }
  console.log('索引完成:', byTitle.size, '个标题 /', totalRecs, '条记录');

  const hits = [];
  const miss = [];
  for (const it of items) {
    const tKey = normKey(it.标题);
    const aliases = AUTHOR_ALIAS[it.作者] || [it.作者];
    let rec = null, how = '';
    for (const a of aliases) {
      const r = byTitleAuthor.get(tKey + '|' + normKey(a));
      if (r && firstOk(r, it.首句)) { rec = r; how = '标题+作者'; break; }
    }
    if (!rec) {
      const r = byTitle.get(tKey);
      if (r && firstOk(r, it.首句)) { rec = r; how = '仅标题'; }
    }
    if (!rec && it.首句) {
      const hint = normKey(it.首句).slice(0, 6);
      if (hint.length >= 5) {
        const r = byFirst.get(hint);
        // 首句可能撞车，必须作者也对得上
        const okAuthor = r && aliases.some(a => normKey(a) === normKey(r.a));
        if (r && okAuthor) { rec = r; how = '首句+作者'; }
      }
    }
    if (!rec) {
      // 组诗：基名 + 作者 → 候选里按首句确认
      const bKey = baseTitle(it.标题);
      const hint = normKey(it.首句).slice(0, 6);
      for (const a of aliases) {
        const cands = byBaseAuthor.get(bKey + '|' + normKey(a));
        if (!cands || !cands.length) continue;
        if (hint.length >= 4) {
          const hit = cands.find(c => normKey((c.p && c.p[0]) || '').startsWith(hint));
          if (hit) { rec = hit; how = '组诗+首句'; break; }
        }
        if (!rec && cands.length === 1) { rec = cands[0]; how = '组诗唯一'; break; }
      }
    }
    if (!rec) { miss.push(it); continue; }
    hits.push({ it, rec, how });
  }

  // 输出 jsonl（保持 CSV 顺序＝册次顺序）
  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, 'poems-keben.jsonl');
  const w = fs.createWriteStream(outPath, { encoding: 'utf8' });
  for (const { it, rec } of hits) {
    const t2s = (x) => (typeof x === 'string' ? [...x].map(c => convT2S(c)).join('') : x);
    const row = {
      c: 'keben',
      t: it.标题,
      a: it.作者,
      d: rec.d || '',
      p: (rec.p || []).map(t2s),
      f: rec.f || {},
      st: rec.st || undefined,
      tg: [it.册次].filter(Boolean),
      kb: { b: it.册次, u: it.单元, l: it.栏目, src: rec.i },
    };
    w.write(JSON.stringify(row) + '\n');
  }
  w.end();

  const byHow = {};
  for (const h of hits) byHow[h.how] = (byHow[h.how] || 0) + 1;
  console.log(`命中 ${hits.length}/${items.length}`, byHow);
  if (miss.length) {
    const mp = path.join(__dirname, 'keben-unmatched.csv');
    fs.writeFileSync(mp, '\uFEFF' + '册次,栏目,标题,作者,首句\n' +
      miss.map(m => [m.册次, m.栏目, m.标题, m.作者, m.首句].join(',')).join('\n'), 'utf8');
    console.log(`未命中 ${miss.length} 条 → ${mp}`);
    console.log('未命中示例:', miss.slice(0, 8).map(m => m.标题).join(' / '));
  }
  console.log('KEBEN_OK');
}

main();
