// gujilab 语料 → 四个新集合的源文件 etl/out/poems-gujilab.jsonl
// 2026-10-29。cleaned/ 那版 convert_gujilab.cjs 有五处硬伤，本脚本是重做：
//   1) 说文解字：字头（char）被丢掉，9,831 条全部同名「说文解字」→ t=字头
//   2) 大学/中庸：与主库 ssxx（四书五经）重复 → 整源不收（诗经/论语/孟子同理）
//   3) 与主库 gwdj 内容级重叠约 410 条（尚书/礼记/孝经/南史/汉书…，gwdj 侧分段更好）
//      → 按内容头 c24 撞车逐条剔除，弃新保旧
//   4) 资治通鉴：四库本页眉「钦定四库全书／资治通鉴巻N／宋 司马光 撰／胡三省 音注」混进正文 → 剥掉
//   5) 无换行结构的源（尚书/尔雅/左传…）被压成单段巨块 → 　　/句号兜底分段
// 集合（追加在主库 COLLECTIONS 末尾，id 不前移）：
//   shuowen 说文解字 / ershisishi 正史十五部 / zitongjian 资治通鉴 / jingbu 古籍经部
// 用法：node etl/gujilab-prep.js
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data_2026-10-29', 'gujilab_corpus.jsonl');
const OUT = path.join(__dirname, 'out', 'poems-gujilab.jsonl');
const POEMS = path.join(ROOT, 'site', 'data', 'poems');

const conv = OpenCC.Converter({ from: 't', to: 'cn' });
const PUNCT = /[\s·•／/、，。：:；!！?？（）()【】[\]「」『』《》〈〉“”‘’"'—\-_～~.…∙○◎〔〕〔]/g;
const norm = (s) => conv(String(s || '')).replace(PUNCT, '').toLowerCase();

// ---------- 来源 → 集合 ----------
const SKIP_SRC = new Set(['诗经', '论语', '孟子', '大学', '中庸']); // 主库 shijing/lunyu/ssxx 已有更好的版本
const SRC2CID = {
  说文解字: 'shuowen',
  史记: 'ershisishi', 汉书: 'ershisishi', 后汉书: 'ershisishi', 三国志: 'ershisishi',
  晋书: 'ershisishi', 宋书: 'ershisishi', 南齐书: 'ershisishi', 梁书: 'ershisishi',
  陈书: 'ershisishi', 魏书: 'ershisishi', 北齐书: 'ershisishi', 周书: 'ershisishi',
  隋书: 'ershisishi', 北史: 'ershisishi', 南史: 'ershisishi',
  资治通鉴: 'zitongjian',
  周易: 'jingbu', 尚书: 'jingbu', 礼记: 'jingbu', 尔雅: 'jingbu', 孝经: 'jingbu',
  春秋左传: 'jingbu', 春秋公羊传: 'jingbu', 春秋穀梁传: 'jingbu',
};

// 朝代与主库口径对齐（build.js DYN_MAP 的子集；prep 先归一，build 再兜底）
const DYN_MAP = { 周: '先秦', 先秦: '先秦', 西汉: '汉', 东汉: '汉', 汉: '汉', 魏晋: '魏晋', 南北朝: '南北朝', 唐: '唐', 五代: '五代', 宋: '宋', 元: '元', 明: '明', 清: '清' };

// 中文数字（卷号用，1-294 足够）
const CN = '零一二三四五六七八九';
function cnNum(n) {
  n = Number(n) || 0;
  const ds = String(n).split('').map(Number);
  if (n < 10) return CN[n];
  const units = ['', '十', '百'];
  let out = '';
  ds.forEach((d, i) => {
    const u = units[ds.length - 1 - i];
    if (d === 0) { if (out && !out.endsWith('零')) out += '零'; return; }
    if (u === '十' && d === 1) out += '十';   // 十一/一百一十 不写「一十」
    else out += CN[d] + u;
  });
  return out.replace(/零+$/, '');
}

// 史书卷内的体例分类（gwdj 先例：tg = [书名, 本纪/列传/志/世家/表]）
function shiCat(chapter) {
  const c = String(chapter || '');
  if (/帝纪|本纪/.test(c)) return '本纪';
  if (/列传/.test(c)) return '列传';
  if (/志第|志第/.test(c)) return '志';
  if (/世家/.test(c)) return '世家';
  if (/表第/.test(c)) return '表';
  return '';
}

// ---------- 分段 ----------
const PURE_PUNCT = /^[\s　，。、；：！？“”‘’（）【】〔〕《》〈〉…·—\-○◎]+$/;
function splitParas(content) {
  let out = [];
  for (const block of String(content || '').split(/\n\n+/)) {
    for (const line of block.split('\n')) {
      for (const cell of line.split(/[　]{2,}/)) {
        const s = cell.trim();
        if (s && !PURE_PUNCT.test(s)) out.push(s);
      }
    }
  }
  // 无结构的长文（尚书/周易整块）：按句号切成一句一段，与 gwdj 的经部分段风格一致
  if (out.length === 1 && out[0].length > 1800) {
    const s = out[0];
    const parts = s.split(/(?<=。)/).map((x) => x.trim()).filter((x) => x && !PURE_PUNCT.test(x));
    if (parts.length > 1) out = parts;
  }
  // 周易的 OCR 分节符：整段罗马数字（ⅰ/ⅱ…）丢弃；「ⅰ（乾下乾上）」剥罗马数字留卦画说明
  out = out
    .filter((x) => !/^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+$/.test(x))
    .map((x) => x.replace(/^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+[　\s]*（/, '（'));
  return out;
}

// 通鉴：剥四库页眉（首行「钦定四库全书」时，其后的撰者/音注行一并剥）
function stripSikuHeader(content) {
  let lines = String(content || '').split('\n');
  if (!/^钦定四库全书/.test((lines[0] || '').trim())) return content;
  lines = lines.slice(1);
  while (lines.length && /^[　\s]*$/.test(lines[0])) lines = lines.slice(1);
  // 「资治通鉴巻N」「宋　司马光　撰」「胡三省　音注」这类版权/整理行
  while (lines.length && /^[　\s]*(资治通鉴巻|资治通鉴卷|宋.+司马光.+撰|胡三省.+音注)/.test(lines[0])) {
    lines = lines.slice(1);
    while (lines.length && /^[　\s]*$/.test(lines[0])) lines = lines.slice(1);
  }
  return lines.join('\n');
}

// 通鉴：段级版式残留——页脚「资治通鉴巻N」、分类标记「<史部,编年类,资治通鉴>」
const TZ_JUNK = /^(资治通鉴|通鉴)[　\s]*[巻卷][一二三四五六七八九十百零]+$|^<[^>]{0,20}>$/;
function stripTzJunk(paras) {
  return paras.filter((x) => !TZ_JUNK.test(x.trim()));
}

// 作者：剥掉「佚名（先秦）」这类括号注（括号内是朝代，d 字段已有）
function cleanAuthor(a) {
  let s = String(a || '').trim();
  s = s.replace(/（[^）]*）$/, '').replace(/\([^)]*\)$/, '').trim();
  return s || '佚名';
}

(async () => {
  console.time('gujilab-prep');
  // 1) 主库内容头键（c24）：撞车即弃（ingest.js 同款口径）
  const haveC = new Set();
  const files = fs.readdirSync(POEMS).filter((x) => x.endsWith('.json'));
  for (const f of files) {
    for (const r of JSON.parse(fs.readFileSync(path.join(POEMS, f), 'utf8'))) {
      const c24 = norm((r.p || []).join('')).slice(0, 24);
      if (c24.length >= 10) haveC.add(c24);
    }
  }
  console.log(`主库内容头键: ${haveC.size}`);

  // 2) 扫描语料
  const out = fs.createWriteStream(OUT + '.tmp', { encoding: 'utf8' });
  const stat = {};
  const st = (src) => stat[src] || (stat[src] = { total: 0, kept: 0, dup: 0, skip: 0, empty: 0 });
  const count = {};
  const seen = new Set(); // 集合内 c24 去重
  const seenTitle = new Set();
  const rl = require('readline').createInterface({ input: fs.createReadStream(IN, 'utf8'), crlfDelay: Infinity });
  let wrote = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    const src = o.source;
    const s = st(src);
    s.total++;
    const cid = SRC2CID[src];
    if (!cid) { s.skip++; continue; }        // SKIP_SRC 等未映射源
    if (SKIP_SRC.has(src)) { s.skip++; continue; }

    let t = '', a = '', d = '', body = '', tg = [];
    if (src === '说文解字') {
      const ch = String(o.char || '').trim();
      if (!ch || ch.includes('□')) { s.skip++; continue; }               // 无字头 / OCR 占位
      const c = String(o.content || '').trim();
      if (!c || c.length < 2) { s.empty++; continue; }
      t = ch; a = '许慎'; d = '汉'; body = c; tg = ['说文解字'];
      // 反切（fanqie）是注音：主库已去全部注音数据（2026-11-01），不再入 sp
    } else if (src === '资治通鉴') {
      body = stripSikuHeader(o.content);
      t = `${o.period || '资治通鉴'}·卷${cnNum(o.volume || 0)}`;
      a = cleanAuthor(o.author); d = DYN_MAP[o.era] || o.era || '';
      tg = ['资治通鉴'];
    } else {
      body = String(o.content || '');
      t = String(o.chapter || '').replace(/[　\s]+/g, ' ').trim();
      // 周易章题的「01. 」序号前缀是版式不是篇名
      if (src === '周易') t = t.replace(/^\d+[.、]\s*/, '');
      if (!t) { s.skip++; continue; }
      a = cleanAuthor(o.author);
      d = DYN_MAP[o.era] || o.era || '';
      tg = [src];
      const cat = shiCat(t);
      if (cid === 'ershisishi' && cat) tg.push(cat);
    }

    // 说文释文本就一段，不走 splitParas（　　在字典条目里不是段界）
    let paras = src === '说文解字' ? [body.trim()].filter((x) => x) : splitParas(body);
    if (src === '资治通鉴') paras = stripTzJunk(paras);
    if (!paras.length) { s.empty++; continue; }

    // 内容头撞主库 → 弃新保旧（gwdj 侧分段/标题更好）。
    // 注意：史书各卷常共享同一枚「某某撰」衔名开头，内容头撞主库按整卷正文判断没问题，
    // 但**集内**去重不能只用内容头（同衔名的不同卷会互杀），必须 标题+内容头 联合。
    const c24 = norm(paras.join('')).slice(0, 24);
    if (c24.length >= 10 && haveC.has(c24)) { s.dup++; continue; }
    const ik = norm(t) + '|' + c24;
    if (c24.length >= 10 && seen.has(ik)) { s.dup++; continue; }
    if (c24.length >= 10) seen.add(ik);
    if (cid === 'shuowen') {
      const tk = ik;
      if (seenTitle.has(tk)) { s.dup++; continue; }
      seenTitle.add(tk);
    }

    const rec = { c: cid, t, a, d, p: paras, tg };
    out.write(JSON.stringify(rec) + '\n');
    wrote++;
    s.kept++;
    count[cid] = (count[cid] || 0) + 1;
  }
  await new Promise((res) => out.end(res));
  fs.renameSync(OUT + '.tmp', OUT);

  console.timeEnd('gujilab-prep');
  console.log(`写出 ${wrote} 条 → ${OUT}`);
  console.log('按集合:', Object.entries(count).map(([k, v]) => k + ' ' + v).join(' · '));
  for (const [src, s] of Object.entries(stat).sort((a, b) => b[1].kept - a[1].kept)) {
    console.log(`${src}: 收 ${s.kept}/${s.total}${s.dup ? '，撞主库/集内重复弃 ' + s.dup : ''}${s.skip ? '，源级跳过 ' + s.skip : ''}${s.empty ? '，空 ' + s.empty : ''}`);
  }
  console.log('GUJILAB_PREP_OK');
})().catch((e) => { console.error(e); process.exit(1); });
