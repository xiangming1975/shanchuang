// 共用小工具

const COLLECT_URL = 'https://wj.qq.com/s2/28381363/yimk/';

import { pref, colIdOf, dayKey } from './store.js';
import { esc } from './html.js';
import { zipStrain } from './py.js';
import { zhShow } from './fn.js';

// ---------- 共用小工具（第十一轮下沉，供各视图 import 复用） ----------
// URL 边界兜底：非法 % 序列会让 decodeURIComponent 抛 URIError，统一退回原串。
export function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const PAD = '<div class="page-pad"></div>';

// PROSE/CI 两张表是「新增集合必须手工登记」的版面规则（HANDOFF §6.5）——
// 2026-11-01 补登记 pdb_* 补遗：pdb_guwen 古文（此前被当诗渲染、徽章判成古体）、
// pdb_songci/pdb_songci300/pdb_yuan 词曲（词牌徽章与韵句断行此前全部失效）
// 2026-11-02 补登记主库更新的新集合：shihua 词话/siku 四库/rhyme 韵书/mengxue_cht/jingbu_cht 繁体蒙学经部 为散文；
// citunes 词牌例词/daizhige 东海渔歌/zhtw 花间词/wudaici/qingci/songciku2/huajianji 为词曲
const PROSE_SET = new Set(['guwen', 'gwdj', 'ssxx', 'lunyu', 'mengxue', 'ymy', 'fu', 'jsswen', 'ershisishi', 'zitongjian', 'jingbu', 'pdb_guwen', 'shihua', 'siku', 'rhyme', 'mengxue_cht', 'jingbu_cht']);

const PAIR_SET = new Set(['shijing', 'shijingbu']); // 四言：两句一行

const CI_SET = new Set(['songci', 'songci300', 'hjj', 'nt', 'nalan', 'yq', 'jssci', 'pdb_songci', 'pdb_songci300', 'pdb_yuan', 'citunes', 'daizhige', 'zhtw', 'wudaici', 'qingci', 'songciku2', 'huajianji']); // 词曲：韵句一行
// 按标点切句（保留标点）

function splitSentences(s) {
  return String(s).split(/(?<=[，。？！；：])/).map(x => x.trim()).filter(x => x.length);
}
// 词的行长：按「一行能放几个汉字」算，不按固定字数。
// 原来是「正文超 16 字按逗号补断」——手机窄屏 + 大字号下一行只放得下 13 字，
// 16 字的长句被浏览器硬折，尾部剩一两个字，就是那些难看的断头行。
export const HAN = /[㐀-鿿]/;
const hanCount = (s) => { let n = 0; for (const ch of String(s)) if (HAN.test(ch)) n++; return n; };

function ciMaxChars() {
  const body = document.querySelector('.poem-body');
  const appEl = document.getElementById('app');
  let w = body && body.clientWidth ? body.clientWidth : (appEl ? appEl.clientWidth - 28 : 320);
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 17;
  const per = fs * 1.28 + 1;            // 正文字号（1.28rem）+ 字距 1px
  return Math.max(7, Math.floor((w - 4) / per));
}

// 词的断行（按字数估宽）：句读（，。？！；、）都断；碎片与四字以内的短句互相合并，
// 避免一行只有一两个字。现在只有**卡片**用它——阅读页改用 packLines 按实测宽度断行
// （2026-10-31），骨架规则一致（能并就并、句末收行），只是「放不放得下」的判据
// 从字数估算换成了 canvas 量出来的真实宽度。
export function ciSegments(text, maxChars) {
  const raw = String(text).split(/(?<=[，。？！；、：])/).map(x => x.trim()).filter(Boolean);
  const END = /[。！？；]$/;            // 句末：到这儿就是一个韵句，不再往下并
  const out = [];
  for (const r of raw) {
    const n = hanCount(r);
    const prev = out[out.length - 1];
    // ① 一个韵句一行：只要不和句末标点打架、合起来放得下，就并进上一行
    if (prev && !END.test(prev) && hanCount(prev) + n <= maxChars) {
      out[out.length - 1] = prev + r;
      continue;
    }
    // ② 光一个分句就超长（多半是没标点的长句）：按字数均分，尽量避免留下孤字
    if (n > maxChars) {
      const parts = Math.ceil(n / maxChars);
      const per = Math.ceil(n / parts);
      let buf = '', cnt = 0;
      for (const ch of r) {
        buf += ch;
        if (HAN.test(ch)) cnt++;
        if (cnt >= per) { out.push(buf); buf = ''; cnt = 0; }
      }
      if (buf.trim()) out.push(buf);
      continue;
    }
    out.push(r);
  }
  return out;
}

// ---------- 正文断行（2026-10-31 重写）：先实测行宽，再决定一行放几句 ----------
// 旧算法按「汉字数 × 估算字宽」算容量，估不准就把断头行留给浏览器硬折。
// 新算法用 canvas measureText 量出这行字的真实宽度（同字体、同字号、同字距）：
// 整句（以句末标点收尾）放得下就整句一行；放不下退到中间的逗号处断；
// 连一个分句都放不下就按实测宽度逐字切——宁可切在字间，也不让浏览器折出断头行。

let measureCtx = null;
let measureTried = false;
let measureFont = '';
function measureCtx2d() {
  if (!measureTried) {
    measureTried = true;
    try { measureCtx = document.createElement('canvas').getContext('2d') || null; } catch (e) { measureCtx = null; }
  }
  return measureCtx;
}
function textWidth(s, fontCss) {
  const g = measureCtx2d();
  if (!g) return NaN;
  if (fontCss !== measureFont) { g.font = fontCss; measureFont = fontCss; }
  return g.measureText(s).width;
}

const LINE_BREAK = /[，、：。？！；…—]/;   // 分句边界：一个标点算一句
const LINE_END = /[。！？；]/;              // 句末：一行到此收尾，不与下一句同行

// 正文行宽的实测判定器：返回 fits(text)，判定这行字在当前屏宽下放不放得下。
// pyOn/fnOn 会往行里加宽度（ruby 注音撑宽每个字、脚注上标占位），容量先扣掉。
// 换页渲染发生在 innerHTML 赋值之前，旧页面的 .poem-body 还在 DOM 里，宽度直接
// 可量；首屏没有旧正文时按 #app 推算同一宽度（两者只差 poem-body 自己的 20px padding）。
export function makeLineFits(pyOn, fnOn) {
  const bodyEl = document.querySelector('.poem-body');
  const appEl = document.getElementById('app');
  // poem-body 左右各 10px padding，#app 左右各 14px；留 2px 余量
  let avail = (bodyEl && bodyEl.clientWidth ? bodyEl.clientWidth - 22 : (appEl ? appEl.clientWidth - 50 : 278));
  if (fnOn) avail -= 28;      // 脚注上标：一行通常一两个「注」标，一个约 14px
  avail = Math.max(120, avail);
  const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 17;
  const kai = (getComputedStyle(document.documentElement).getPropertyValue('--kai') || 'serif').trim();
  const fontCss = (rootFs * 1.28).toFixed(2) + 'px ' + kai;
  const CJK = /[\u3400-\u9fff]/;
  // 没有 canvas 2d（测试垫片等环境）：退回按字数估算，断行规则不变形
  if (!measureCtx2d()) {
    const maxN = Math.max(2, Math.floor(avail / (rootFs * 1.28 + 1)));
    return (s) => [...s].filter(ch => CJK.test(ch)).length <= maxN;
  }
  return (s) => {
    const w = textWidth(s, fontCss) + Math.max(0, [...s].length - 1);   // 字距 1px
    return pyOn ? w + 8 * [...s].filter(ch => CJK.test(ch)).length <= avail : w <= avail;
  };
}

// 断行主算法（诗/词/曲共用；赋与文章走 prose，不进这里）：
// ① 一个标点算一句；② 句内分句能并就并，一行以句末标点收尾（句号结尾的完整句）；
// ③ 整句放不下时从最近的分句边界断开；④ 单个分句本身超宽（多见于衬字多的曲）
//    就按实测宽度逐字切。拼回来的文字与原文一字不差（平仄/拼音按偏移对齐靠这个）。
export function packLines(text, fits) {
  const parts = [];
  let buf = '';
  for (const ch of String(text)) {
    buf += ch;
    if (LINE_BREAK.test(ch)) { parts.push({ t: buf, end: LINE_END.test(ch) }); buf = ''; }
  }
  if (buf) parts.push({ t: buf, end: true });   // 尾段没标点也当句末收行，别悬着
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && fits(cur + p.t)) {
      cur += p.t;                                // 能并就并：小字号下两句一行
    } else if (fits(p.t)) {
      if (cur) out.push(cur);
      cur = p.t;
    } else {
      // 单个分句都超宽：按实测逐字累加，满了就切
      if (cur) out.push(cur);
      let seg = '';
      for (const ch of [...p.t]) {
        if (seg && !fits(seg + ch)) { out.push(seg); seg = ch; }
        else seg += ch;
      }
      cur = seg;
    }
    if (p.end && cur) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

// 段落 → 显示行（含对应平仄片段）

function layoutParagraph(text, strain, mode, fits) {
  if (mode === 'prose') return [{ t: text, st: strain || null }];
  // 「中」是词谱里"可平可仄"的占位，只为保持逐字对齐，渲染时不显示
  const clean = (a) => (a ? a.map(x => (x === '中' ? null : x)) : null);
  const segs = packLines(text, fits || makeLineFits(false, false));
  // 整段逐字 zip 平仄（跳过平仄串标点），失败则段尾整行式；词曲的整行式平仄不显示
  const pzsAll = strain ? zipStrain(text, strain) : null;
  const stRaw = strain && !pzsAll ? (mode === 'ci' ? null : strain) : null;
  let off = 0;
  return segs.map((s, i) => {
    const n = [...s].length;
    const o = { t: s, pzs: pzsAll ? clean(pzsAll.slice(off, off + n)) : null, st: i === segs.length - 1 ? stRaw : null };
    off += n;
    return o;
  });
}

// ---------- CSS 断行（2026-10-31）：分句 nowrap 成块 + 整句父块，浏览器排版引擎当尺子 ----------
// 与上面的 JS 预测量（packLines + makeLineFits）二选一，detail.js 的 LINE_BY_CSS 开关控制，
// 两套并存，随时切回。这里只做**结构切分**，不决定断行位置：
//   按句末标点切「句」→ 一个 <p class="line">（句号收行，绝不跨句）；
//   句内按标点切「分句」→ 各自 <span class="cl">（CSS 里 nowrap，块间 <wbr>）。
// 装得下就并成一行、放不下在块间掉行，全由浏览器现场排版——转屏、换字号、
// 字体加载完成都自动重排，canvas 量宽的时机误差从根上消失。
// fits 只服务一个兜底：单个分句本身超宽（元曲衬字）时预拆成几段，防 nowrap 横向溢出；
// 多拆无害（段与段相邻排布，放得下就不断行），漏拆才会溢出，所以宁可多拆。

export function layoutSentences(text, strain, mode, fits) {
  if (mode === 'prose') return [{ t: text, cls: null, pzs: null, st: strain || null }];
  const clean = (a) => (a ? a.map(x => (x === '中' ? null : x)) : null);
  const src = String(text);
  const sents = [];
  let buf = '';
  for (const ch of src) {
    buf += ch;
    if (LINE_END.test(ch)) { sents.push(buf); buf = ''; }
  }
  if (buf) sents.push(buf);
  const pzsAll = strain ? zipStrain(src, strain) : null;
  const stRaw = strain && !pzsAll ? (mode === 'ci' ? null : strain) : null;
  let off = 0;
  return sents.map((s, i) => {
    const n = [...s].length;
    const o = {
      t: s,
      cls: clausePieces(s, fits),
      pzs: pzsAll ? clean(pzsAll.slice(off, off + n)) : null,
      st: i === sents.length - 1 ? stRaw : null
    };
    off += n;
    return o;
  });
}

// 句内按标点切分句；给了 fits 且单个分句放不下时，按 fits 逐字累加预拆。
// 拼接不变式与 packLines 相同：块拼回来与原文一字不差（平仄/拼音按偏移对齐靠它）。
function clausePieces(s, fits) {
  const parts = [];
  let buf = '';
  for (const ch of String(s)) {
    buf += ch;
    if (LINE_BREAK.test(ch)) { parts.push(buf); buf = ''; }
  }
  if (buf) parts.push(buf);
  if (!fits) return parts;
  const out = [];
  for (const p of parts) {
    if (fits(p)) { out.push(p); continue; }
    let seg = '';
    for (const ch of [...p]) {
      if (seg && !fits(seg + ch)) { out.push(seg); seg = ch; }
      else seg += ch;
    }
    if (seg) out.push(seg);
  }
  return out;
}

const app = document.getElementById('app');
// ---------- 行令小游戏（2026-10-31）：飞花令 / 合璧 共用的纯函数 ----------
// 出题、判卷都在这里，视图只管交互：好测试，也好换玩法。

// 合璧：拆名句对「上句，下句。」为 [上句, 下句]。
// 只收上句 ≥2 字、下句以句末标点收尾、整对 8–34 字的对子；不合式的
// （多逗号长联、单句、残对）返回 null，题库构建时直接跳过。
// 第一个「，？？！；」即切割点——「问君能有几多愁？恰似一江春水向东流。」这类
// 以问句作上句的对子也收。
export function splitMingjuPair(s) {
  if (typeof s !== 'string') return null;
  const m = /[，？！；]/.exec(s);
  if (!m || m.index < 2) return null;
  const up = s.slice(0, m.index);
  const down = s.slice(m.index + 1);
  if (!down || down.includes('，')) return null;
  if (!/[。！？；]$/.test(down)) return null;
  const n = [...s].length;
  if (n < 8 || n > 34) return null;
  return [up, down];
}

// 飞花令：从一段正文里取出所有含令字的「分句」（到逗号/句号等句读为止，含标点）。
// 分片正文是繁体原文，令字须把简繁写法都给到（chars 传数组或字符串均可）；
// 3–24 字的才收：更短的多是残句断章，更长的是整段古文，都不像「一句」。
export function fhSentences(content, chars) {
  const set = new Set(typeof chars === 'string' ? [...chars] : (chars || []));
  const out = [];
  let buf = '';
  for (const c of String(content || '')) {
    if (c === '\n' || c === '\r') { buf = ''; continue; }
    buf += c;
    if (!LINE_BREAK.test(c)) continue;
    const s = buf.trim();
    const n = [...s].length;
    if (n >= 3 && n <= 24 && [...s].some(ch => set.has(ch))) out.push(s);
    buf = '';
  }
  return out;
}

// 合璧四选一：干扰项从题库挑，字数越接近越像真的；等距时随机。
// rng 可注入（测试要确定性），默认 Math.random。返回 count 个选项（含正确答案，已洗牌）。
export function quizOptions(correct, pool, count, rng) {
  const r = rng || Math.random;
  const target = [...String(correct)].length;
  const cand = [...new Set((pool || []).filter(x => x && x !== correct))]
    .map(s => ({ s, k: r() }))
    .sort((a, b) => (Math.abs([...a.s].length - target) - Math.abs([...b.s].length - target)) || (a.k - b.k));
  const opts = [correct, ...cand.slice(0, count - 1).map(x => x.s)];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

// 行令得星（2026-10-31 调整）：连续接上十句才得一星，此后每多接一句再加一星——飞花令按应令数、
// 合璧按连对数，同一把尺子。0–9 句无星，10 句 1 星，11 句 2 星……
export function starsFor(n) {
  const m = parseInt(n, 10) || 0;
  return m >= 10 ? m - 9 : 0;
}

// 序号转中文数字（2026-10-31）：行令对局里各自的应令序号用「一、二……十一、二十一」，
// 上限 999——真接上千句再用阿拉伯数字也不迟。坏值兜底「零」。
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function cnNum(n) {
  const m = Math.max(0, parseInt(n, 10) || 0);
  if (m <= 10) return CN_DIGITS[m];
  if (m < 20) return '十' + CN_DIGITS[m - 10];
  if (m < 100) return CN_DIGITS[Math.floor(m / 10)] + '十' + (m % 10 ? CN_DIGITS[m % 10] : '');
  if (m < 1000) {
    const r = m % 100;
    return CN_DIGITS[Math.floor(m / 100)] + '百' + (r === 0 ? '' : (r < 10 ? '零' + CN_DIGITS[r] : cnNum(r)));
  }
  return String(m);
}

// 补字挖字位（2026-11-01）：句中汉字的下标集合——标点/字母位不挖，挖了没法选字。
export function bzHolePositions(s) {
  const out = [];
  const a = [...String(s || '')];
  for (let i = 0; i < a.length; i++) if (/[\u3400-\u9fff]/.test(a[i])) out.push(i);
  return out;
}

// 飞花令应令比对（2026-10-31）：句库行 [句(原文含句读), id] 对「输入的简繁变体集合」。
// 输入变体由 queryVariants 补齐简繁后传入；比对前双方都先去掉句尾标点（fhBare）——
// 用户带句读输入也能命中。三种命中形态（酒令从宽）：
//   整句相等 / 句库句包含输入（只背了半句也算）/ 输入包含句库句（两句连着背）。
// 连背方向要求句库句 ≥4 字，防止随口短语误吞两三字的短句。
export function fhBare(s) {
  return String(s || '').replace(/[\s，、：。？！；…—]+$/u, '');
}
export function fhVerifyHit(rows, variants) {
  for (const r of rows) {
    if (!r || !r[0]) continue;
    const b = fhBare(r[0]);
    const bl = [...b].length;
    for (const v of variants) {
      if (b === v || b.includes(v) || (bl >= 4 && v.includes(b))) return r;
    }
  }
  return null;
}

// 折叠卡全局委托（首页/搜索/详情统一）

let __foldDelegated = false;
if (!__foldDelegated && app) {
  __foldDelegated = true;
  app.addEventListener('click', (e) => {
    const head = e.target.closest('.card[data-fold] .fold-head');
    if (!head) return;
    const card = head.closest('.card');
    const open = card.classList.toggle('fold-open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    const fb = card.querySelector('.fold-btn');
    if (fb) fb.textContent = open ? '−' : '+';
  });
}

// 顶部横条全线取消（2026-10-27 晚）：底部 tab 与正文本身已经说明"你在哪"，
// 再顶一条标题是重复。统一退化成一点留白，调用处不必逐个改。
// 参数已废弃：顶部横条已全线取消，调用处传入的 title / opts 一律忽略，
// 保留原签名仅为兼容旧调用，传任何参数都无效（不要改调用处，避免大范围回归）。
function topbar(title, opts = {}) {
  return '<div class="page-pad"></div>';
}

// 热度角标（.row.hot 的「热」）：开关已从设置里隐藏，功能暂时下线，此处恒为关。
// 数据全部保留（作品上的 hot 标记、idx/hot.json、store.getHot）。
// 恢复两步：①这里改回 pref('hot') === '1' ②在 settingsView 加回 toggleBtn('hot', '热标')。
const hotOn = () => false;

// 全唐诗把乐府分类写进标题（「鼓吹曲辭 將進酒」），列表里只显示后半，链接不变
const LE_PREFIX = /^(郊廟歌辭|郊庙歌辞|鼓吹曲辭|鼓吹曲辞|橫吹曲辭|横吹曲辞|相和歌辭|相和歌辞|清商曲辭|清商曲辞|舞曲歌辭|舞曲歌辞|琴曲歌辭|琴曲歌辞|雜曲歌辭|杂曲歌辞|近代曲辭|近代曲辞|新樂府辭|新乐府辞|樂府雜曲|乐府杂曲)\s+/;

// 词在列表里只显示词牌（「瑞鹤仙」），同名太多认不出，补上首句（「瑞鹤仙·湿云黏雁影」）。
// 元曲不补：它的标题本就是「剧名・曲牌」，再缀首句会变长串。
const CI_TITLE_SETS = new Set(['songci', 'songci300', 'hjj', 'nt', 'nalan', 'jssci']);

function ciFirstSeg(p) {
  const s0 = String((p && p.p && p.p[0]) || '').replace(/\s+/g, '');
  return s0.split(/[，。！？；、：,]/)[0] || s0;
}

// 标题里已经带了可消歧的副题（「长相思·山一程」「渡江云三犯・渡江云」）就不再补；
// 「菩萨蛮 其一」这种只有编号的不算——同名词牌多，编号不足以消歧，照样补首句。
function hasSubtitle(t) {
  const parts = String(t).split(/[·・]/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  return !!tail && [...tail].length >= 3 && !/^其[一二三四五六七八九十]/.test(tail);
}

// 列表里显示的完整题名（未截断）：词补首句、剥乐府分类前缀、拼词牌别名
export function displayTitle(p, colId) {
  const cid = colId || colIdOf(p && p.i);
  const raw = String((p && p.t) || '').replace(LE_PREFIX, '');
  let full = p && p.r && p.r !== p.t ? `${p.r}·${raw}` : raw;
  if (CI_TITLE_SETS.has(cid) && !hasSubtitle(full)) {
    const f = ciFirstSeg(p);
    if (f) full += '·' + f;
  }
  return zhShow(full);
}

// 列表行题名：元曲放宽到 26 字（剧名・曲牌，20 字会切掉曲牌），其余 20 字。
export function titleMax(colId) { return colId === 'yq' ? 26 : 20; }

// 列表行题名：超过 max 个字就截断并加省略号。
// 20 字 ≈ 手机上一整行（390px 宽、0.95rem 字号一行约 19 字），所以「满 20 字」就是「排满一行」。
// 放不下时 CSS 的 nowrap + ellipsis 再兜一层（窄屏或大字模式）。
export function cutTitle(s, max = 20) {
  const chars = [...String(s || '')];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}

// 首句摘要：去空白，超 26 字截断加省略号。搜索补首句 / 浏览历史 / 体裁名篇同一口径
// （2026-10-29 复用收敛，原先 3 处重复）。
export function snippetOf(s) {
  const t = zhShow(String(s || '')).replace(/\s+/g, '');
  return t.length > 26 ? t.slice(0, 26) + '…' : t;
}

// 行元信息：题名（按集合宽度截断）+「朝代 · 作者」。浏览历史 / 眉批 / 眉批导出共用
// （2026-10-29 复用收敛）。记录缺失时退回「作品 <pid>」。
export function rowMeta(r, pid) {
  if (!r) return { t: '作品 ' + pid, m: '' };
  return {
    t: cutTitle(displayTitle(r), titleMax(colIdOf(r.i != null ? r.i : Number(pid)))),
    m: [r.d, r.a].filter(Boolean).map(x => zhShow(x)).join(' · '),
  };
}

// 空态占位：统一「大字 + 说明」的版式（2026-10-29 复用收敛，原先各页手写标记）。
export function emptyHtml(big, html) {
  return `<div class="empty-state">${big ? `<div class="big">${big}</div>` : ''}${html || ''}</div>`;
}

function rowLink(p) {
  const cid = colIdOf(p.i);
  const full = displayTitle(p, cid);
  const meta = [p.d, p.a].filter(Boolean).map(x => zhShow(x)).join(' · ');
  const hot = hotOn() && p.hot;
  return `<a class="row${hot ? ' hot' : ''}" href="#/p/${p.i}" title="${esc(full)}">
    <span class="rt">${esc(cutTitle(full, titleMax(cid)))}</span><span class="ra">${esc(meta)}</span>
  </a>`;
}

// ---------------- 首页 ----------------

function hl(text, q) {
  // 显示文本已按简繁设置转换，查询词可能还是另一套写法：两种形式都试一次
  let hit = '', i = -1;
  for (const cand of [q, zhShow(q)]) {
    if (!cand) continue;
    i = text.toLowerCase().indexOf(cand.toLowerCase());
    if (i >= 0) { hit = cand; break; }
  }
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + hit.length)) + '</b>' + esc(text.slice(i + hit.length));
}

// ---------------- 收藏页（收藏 + 摘录 两个分段，摘录入口提到显眼处） ----------------

const REC_INTERVALS = [1, 2, 4, 7, 15, 30]; // 第 n 次背诵后的复习间隔（天）

const DAY = 864e5;

// 今日待复习：遗忘曲线到期（now - last - interval*DAY >= 0）即算，逾期最久的排最前。
// 纯函数：背诵页与首页复习卡共用（R4），node 里可测。
function reciteDue(recites, now) {
  const due = [];
  if (!recites) return due;
  for (const id of Object.keys(recites)) {
    const r = recites[id];
    if (!r || !r.last || !r.n) continue;
    const interval = REC_INTERVALS[Math.min(r.n - 1, REC_INTERVALS.length - 1)];
    const overdue = now - r.last - interval * DAY;
    if (overdue >= 0) due.push({ id: Number(id), overdue });
  }
  due.sort((a, b) => b.overdue - a.overdue);
  return due;
}

function fmtDate(t) {
  const d = new Date(t);
  const now = new Date();
  const diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (diff === 0) return '今天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (diff === 1) return '昨天';
  if (diff < 7) return diff + ' 天前';
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

// 状态消息同时写进 #sr-status，供读屏播报（#app 已不再整页 aria-live）
function announce(msg) {
  const el = document.getElementById('sr-status');
  if (!el) return;
  el.textContent = '';
  // 清空再写，确保同样的文案重复出现时也会被播报
  setTimeout(() => { el.textContent = String(msg || ''); }, 30);
}

// 只有一个全站浮窗 #fn-pop，但只在详情页与「我的」系页面里写过 DOM。
// 搜索页等没有它的页面一旦调 popupMsg/popupConfirm 就会掉进 alert/confirm——
// 原生模态框会阻塞页面（实测点「清空历史」后整页僵住）。这里改成缺了就懒创建。
// 浮窗可访问性（v192）：全站唯一的 #fn-pop 一律声明为模态对话框；
// Esc 关闭、关闭时把焦点还给打开它的控件。detail.js 的 bindFnPopup 也复用 closePopup。
let popReturnFocus = null;
export function rememberPopupFocus() { popReturnFocus = document.activeElement; }
export function closePopup(pop) {
  if (!pop) return;
  pop.classList.add('hidden');
  pop.innerHTML = '';
  const t = popReturnFocus;
  popReturnFocus = null;
  if (t && t.isConnected && typeof t.focus === 'function') {
    try { t.focus(); } catch (e) {}
  }
}
let popEscBound = false;
function bindPopupEsc() {
  if (popEscBound) return;
  popEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    const pop = document.getElementById('fn-pop');
    if (pop && !pop.classList.contains('hidden')) closePopup(pop);
  });
}
bindPopupEsc();

function popHost() {
  let pop = document.getElementById('fn-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'fn-pop';
    pop.className = 'hidden';
    // 挂在 #app 内：路由切换时会随页面一起清掉，不会和详情页自己插的那个撞 id
    (document.getElementById('app') || document.body).appendChild(pop);
  }
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  rememberPopupFocus();
  return pop;
}

function popupMsg(msg, btnText) {
  announce(msg);
  const pop = popHost();
  pop.innerHTML = '<div class="fn-card"><div class="fn-expl">' + esc(msg) + '</div><button class="fn-close">' + esc(btnText || '好的') + '</button></div>';
  pop.classList.remove('hidden');
  pop.querySelector('.fn-close').onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
}

// 二次确认：破坏性操作（清空历史等）统一走这里
function popupConfirm(msg, sub, okLabel, onOk) {
  const pop = popHost();
  pop.innerHTML = '<div class="fn-card"><div class="fn-term">' + esc(msg) + '</div>'
    + (sub ? '<div class="fn-expl">' + esc(sub) + '</div>' : '')
    + '<div style="display:flex;gap:8px;margin-top:10px">'
    + '<button class="fn-close" id="pc-yes" style="color:var(--accent)">' + esc(okLabel || '确认') + '</button>'
    + '<button class="fn-close" id="pc-no">取消</button></div></div>';
  pop.classList.remove('hidden');
  pop.querySelector('#pc-yes').onclick = (ev) => { ev.stopPropagation(); closePopup(pop); onOk(); };
  pop.querySelector('#pc-no').onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
}

// 主题四种取值：'light' | 'dark' | 'auto'（按时段）| 空（跟随系统）。
// 「自动」的时间窗：18:00 起算夜间，次日 06:00 起算日间。不按季节调整——天色误差最多半小时，
// 但规则一句话说得清，用户也不会被"今天几点变黑"搞糊涂。
const AUTO_NIGHT_FROM = 18;
const AUTO_NIGHT_TO = 6;

export function autoDark(d) {
  const h = (d || new Date()).getHours();
  return h >= AUTO_NIGHT_FROM || h < AUTO_NIGHT_TO;
}

function syncThemeMeta(dark) {
  const meta = document.querySelector('meta[name=theme-color]');
  if (!meta) return;
  // 水墨屏模式：纸色顶到灰阶两端，地址栏跟着纯白 / 纯黑
  if (pref('ink') === '1') meta.content = dark ? '#000000' : '#ffffff';
  else meta.content = dark ? '#16130f' : '#a3372f';
}

// 工具栏「日间 / 夜间」是**临时翻转**：只写 sessionStorage，不动 shici-theme。
// 这样设置里的「自动」「跟随系统」不会被一次临时切换悄悄改掉（2026-10-28 用户要求）。
// 关了标签页就回到设置里的模式；同一次浏览里翻来覆去也不会累积。
const THEME_FLIP = 'shici-theme-flip';
function getThemeFlip() {
  try { return sessionStorage.getItem(THEME_FLIP); } catch (e) { return null; }
}
function setThemeFlip(v) {
  try { if (v) sessionStorage.setItem(THEME_FLIP, v); else sessionStorage.removeItem(THEME_FLIP); } catch (e) {}
}

// 返回当前是否夜间，设置页据此同步按钮状态
function applyTheme() {
  const t = pref('theme');
  let dark;
  if (t === 'dark') dark = true;
  else if (t === 'light') dark = false;
  else if (t === 'auto') dark = autoDark();
  else dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const flip = getThemeFlip();
  if (flip === 'dark') dark = true;
  else if (flip === 'light') dark = false;
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  // 水墨屏模式（2026-10-31）：显示设置的一级模式，只写 <html data-ink>，
  // CSS 里灰阶调色盘跟着换；日间/夜间等二级选项照常走上面的 data-theme。
  if (pref('ink') === '1') document.documentElement.setAttribute('data-ink', '1');
  else document.documentElement.removeAttribute('data-ink');
  syncThemeMeta(dark);
  return dark;
}

// 楷体子集开关（2026-10-28）：只切 <html data-kai>，CSS 里 --kai 变量跟着换。
// 关掉时没有任何元素用到 "LXGW WenKai"，@font-face 就不会被请求——4.1MB 一分不花。
function applyKaiFont() {
  const off = pref('kai') === '0';
  if (off) document.documentElement.setAttribute('data-kai', '0');
  else document.documentElement.removeAttribute('data-kai');
  return !off;
}

// 工具栏那一下：显式选过日间/夜间的人，直接改那个选择（设置页仍对得上）；
// 用「自动 / 跟随系统」的人，只在本次浏览里翻转，设置原样不动。
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark';
  const t = pref('theme');
  if (t === 'light' || t === 'dark') {
    setThemeFlip(null);
    pref('theme', cur ? 'light' : 'dark');
  } else {
    setThemeFlip(cur ? 'light' : 'dark');
  }
  applyTheme();
  return !cur;
}

// 设置页选中某个模式时要把临时翻转清掉，否则刚点的「日间」会被旧翻转盖回去
function clearThemeFlip() { setThemeFlip(null); }

export { LE_PREFIX, PROSE_SET, PAIR_SET, CI_SET, splitSentences, ciMaxChars, layoutParagraph, app, __foldDelegated, topbar, rowLink, hl, REC_INTERVALS, DAY, reciteDue, dayKey, fmtDate, popupMsg, popupConfirm, popHost, COLLECT_URL, applyTheme, toggleTheme, clearThemeFlip, applyKaiFont };
