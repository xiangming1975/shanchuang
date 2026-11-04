// 页面：detail

import { PROSE_SET, PAIR_SET, CI_SET, layoutParagraph, layoutSentences, makeLineFits, app, topbar, popupMsg, popHost, toggleTheme, LE_PREFIX, COLLECT_URL, safeDecode, closePopup, rememberPopupFocus } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { getPoem, isFav, toggleFav, pushHistory, pref, addRecite, removeRecite, getRecites, addExcerpt, getPingze, getCitpl, getGenre, luckyPoemId, markRead, readStats, isRead, getNotes, addNote, updateNote, removeNote, getMingju, navCtxOf, getChunkMap, chunkIndexOf } from '../store.js';
import { placeNotes, normLine } from '../notes.js';
import { detectRegulated, buildPingze, detectCi, buildCiPingze, buildToneOnly, guessGuTi } from '../regu.js';
import { rubyHTML, annotHTML, esc, hasPinyinLib, ensurePinyinLib } from '../py.js';
import { loadCharMap, buildNotes, locateTerms, zhShow, simpStr } from '../fn.js';

// 断行方案开关（2026-10-31），两套代码都在，随时切回：
//   true  = CSS 断行（layoutSentences）：整句一个 <p class="line">，分句各成一个
//           <span class="cl">（CSS 里 nowrap），块间 <wbr>——装得下就并成一行、
//           放不下在块间掉行，位置由浏览器排版引擎现场决定，转屏/换字号/字体
//           加载完成都自动重排；JS 只预拆超宽的单个长分句（fits）防 nowrap 溢出。
//   false = 旧的 JS 预测量断行（layoutParagraph + packLines + makeLineFits）：
//           渲染前 canvas 量宽、贪心装箱，结果在渲染时定死。
const LINE_BY_CSS = true;

let maskState = null;   // 背诵模式: null | {level:'half'|'all'}

let readTeardown = null;   // 上一次渲染的「读完」监听清理（renderPoem 每次先拆旧的，防泄漏）
let pyLibKicking = false;  // 拼音库按需加载的去重开关（renderPoem 可能连发）

let tagsFold = false, fnFold = false;   // 详情页「标签」「功能」折叠区状态（默认收起）

let readState = null;   // 朗诵状态 { poemId, poem, queue:[{text,li}], idx, voice }
let readLines = [];     // 每次 renderPoem 写入：[{ t, li }]，与正文 .line[data-li] 一一对应
let curPoemId = null;   // 当前渲染的详情页作品 id（名句卡异步插入时防串台）

async function detailView(seg, seq = currentRenderSeq()) {
  const id = parseInt(seg[0]);
  if (isNaN(id)) { setAppHTML(seq, topbar('错误') + '<div class="empty-state">无效的编号</div>'); return; }
  // 加载中不再画一条「诗词详情」横栏：版面重构后详情页本来就没有顶栏，一闪而过的横栏很跳
  setAppHTML(seq, '<div class="loading dv-loading"></div>');
  maskState = null;
  const poem = await getPoem(id).catch(() => null);
  if (!isCurrent(seq)) return;
  if (!poem) { setAppHTML(seq, topbar('未找到', { back: true }) + '<div class="empty-state">作品不存在或数据缺失</div>'); return; }
  if (poem.hide) {
    // 下线记录（etl/xds-exclude.json 打了 hide:1，列表与索引里都不可见）：直链/旧历史
    // 回跳到这里时给明确的空态，不再当正常作品渲染——否则下线的新诗/散文会混进
    // 诗词集的口径里（近现代集 268 条里有 30 篇，顺序浏览必然撞上）。
    setAppHTML(seq, topbar('已下线') + '<div class="empty-state"><div class="big">隐</div>该篇已下线，不在收录范围<br><a style="color:var(--accent)" href="#/">回首页</a></div>');
    return;
  }
  await loadCharMap();
  if (!isCurrent(seq)) return;
  // 2026-11-02：12 个新集合分块不按 200 对齐，集合链接页码走 chunkmap 二分；
  // 表缺失回退旧公式（老集合均匀 200 仍成立）。renderPoem 是同步函数，这里预计算好。
  try {
    const col0 = poem._col;
    if (col0) {
      const cm = await getChunkMap();
      const fi = cm[col0.id];
      poem._colPage = (Array.isArray(fi) && fi.length === col0.chunks.length)
        ? chunkIndexOf(poem.i, fi) : Math.floor((poem.i - col0.start) / 200);
    }
  } catch {}
  if (!isCurrent(seq)) return;
  // 体裁判定 + 无平仄时的推定。体裁标签每首都给，所以这里总要跑一次。
  try {
    {
      const table = await getPingze();
      const colId = (poem._col && poem._col.id) || '';
      const genreMap = await getGenre();
      const noSt = !(poem.st && poem.st.length);
      let done = false;
      if (PROSE_SET.has(colId)) {
        poem._genre = colId === 'fu' ? '赋' : '古文';
        done = true;
      }
      if (CI_SET.has(colId)) {
        // 题名可能是「别名・正名」或「词牌 题注」（pdb_songci 曾用空格分隔）：
        // 按 ·・ 与空白一起拆，取 genre 索引里有的那一段
        const segs = String(poem.t || '').split(/[・·\s　]+/).map(x => x.trim()).filter(Boolean);
        const cn = segs.find(s => genreMap['词·' + s]) || segs[0] || '词';
        poem._genre = genreMap['词·' + cn] ? '词·' + cn : '词';
        const ci = noSt ? detectCi(poem, await getCitpl(), table) : null;
        if (!ci && noSt) {
          // 该词牌同调样本不足，推不出格律；词的字音照样能标
          poem._estSt = buildToneOnly(poem, table);
          poem._estKind = 'ci-tone';
          poem._regName = '字音';
        }
        if (ci) {
          poem._estSt = buildCiPingze(poem, table, ci);
          poem._estKind = 'ci';
          poem._regName = `词牌「${ci.name}」· 同调 ${ci.sample} 首统计 · 固定位 ${Math.round(ci.ratio * 100)}%`;
          done = true;
        }
      } else if (!done) {
        const reg = detectRegulated(poem, table);
        if (reg) {
          poem._genre = (reg.len === 5 ? '五' : '七') + (reg.kind === '律诗' ? '律' : '绝');
          if (noSt) {
            poem._estSt = buildPingze(poem, table, reg);
            poem._estKind = 'shi';
            poem._regName = reg.formName;
          }
        } else {
          poem._genre = guessGuTi(poem);
          // 古体、乐府、杂言没有固定格律，但字音平仄照样能标——只标不校
          if (noSt) {
            poem._estSt = buildToneOnly(poem, table);
            poem._estKind = 'tone';
            poem._regName = '字音';
          }
        }
      }
    }
  } catch {}
  if (!isCurrent(seq)) return;
  // 相邻导航跳过 hide:1 的下线记录：邻位通常在同一分块，getPoem 走内存/IDB 缓存，循环几乎不跑。
  // 结果挂在 poem 上（_prev/_next），renderPoem 的重渲染直接复用，不用变 async。
  // 2026-11-01（第七轮 P0-1 修复）：边界从 count（存活条数）改为 span（id 跨度）——
  // 集合尾区记录（如 tang 的 181104 之后 1,315 条）此前被整批挡掉，/#/p/181105 两头都没按钮。
  // 2026-11-01（阅读队列）：navCtxOf 命中（搜索/标签/体裁/名句/作者页挂的队列）时，
  // 上/下一篇改为在队列里走前后项——队列 id 已是 remap 后的保留正文，逐位 getPoem 只为滤 hide。
  async function neighborVisible(dir, navq) {
    if (navq) {
      const { q, pos } = navq;
      for (let p = pos + dir; p >= 0 && p < q.ids.length; p += dir) {
        const id = q.ids[p];
        const pp = await getPoem(id).catch(() => null);
        if (pp && !pp.hide) return pp.i != null ? pp.i : id;
      }
      return null;
    }
    const col = poem._col;
    const span = col.span != null ? col.span : col.count;   // 旧 manifest 无 span 时退回 count
    let i = poem.i;
    for (let k = 0; k < 40; k++) {
      i += dir;
      if (i < col.start || i >= col.start + span) return null;
      const p = await getPoem(i).catch(() => null);
      if (p && !p.hide) return i;
    }
    return null;
  }
  const navq = navCtxOf(poem.i);
  poem._navq = navq ? { label: navq.q.label, pos: navq.pos, total: navq.q.ids.length } : null;
  poem._prev = await neighborVisible(-1, navq);
  poem._next = await neighborVisible(1, navq);
  pushHistory(id);
  if (!isCurrent(seq)) return;
  renderPoem(poem, seq);
}

// ---------------- 摘录本：划选正文 → 悬浮按钮保存 ----------------

let excFab = null, excBound = false, excCurPoem = null, excReposition = null, excPendingText = '';

function ensureExcFab() {
  if (excFab && excFab.isConnected) return excFab;
  // 防御：清掉可能重复的实例（模块重复求值等异常场景），保证全局唯一
  document.querySelectorAll('#excerpt-fab').forEach(e => e.remove());
  excFab = document.createElement('button');
  excFab.id = 'excerpt-fab';
  excFab.className = 'hidden';
  excFab.textContent = '摘录此句';
  document.body.appendChild(excFab);
  return excFab;
}

function hideExcFab() { if (excFab) excFab.classList.add('hidden'); excPendingText = ''; }
// 选区文本净化：剔除平仄逐字下标(.pzw)、拼音 ruby 注音(rt/rp)与脚注上标(.fnn)，只留正文

function cleanSelectionText(range) {
  try {
    const frag = range.cloneContents();
    if (frag.querySelectorAll) frag.querySelectorAll('.strain-line, rt, rp, .pzw, .fnn').forEach(el => el.remove());
    return (frag.textContent || '').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}
// 路由切换时一律隐藏（hashchange 不触发 selectionchange，FAB 会残留到别的页面）
window.addEventListener('hashchange', () => { hideExcFab(); closeNoteEditor(); });
// 每次渲染绑定到当次 #poem-body（元素重建，旧监听随垃圾回收）；document 级只绑一次

function bindExcerptCapture(poem) {
  excCurPoem = poem;
  const body = document.getElementById('poem-body');
  if (!body) return;
  const fab = ensureExcFab();
  const showForSelection = () => {
    excReposition = showForSelection;
    const b = document.getElementById('poem-body');
    const sel = window.getSelection();
    if (!b || !sel || sel.isCollapsed || !sel.rangeCount) { hideExcFab(); return; }
    const range = sel.getRangeAt(0);
    if (!b.contains(range.commonAncestorContainer)) { hideExcFab(); return; }
    const text = cleanSelectionText(range);
    if (text.length < 2) { hideExcFab(); return; }
    // 记住待摘录文本：点击按钮时浏览器可能已清掉选区，不能等 click 时再读
    excPendingText = text;
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideExcFab(); return; }
    fab.style.left = Math.max(8, Math.min(window.innerWidth - 100, rect.left + rect.width / 2 - 50)) + 'px';
    fab.style.top = Math.max(8, rect.top - 46) + 'px';
    fab.classList.remove('hidden');
  };
  const onChange = () => { clearTimeout(bindExcerptCapture._t); bindExcerptCapture._t = setTimeout(showForSelection, 150); };
  if (!excBound) {
    excBound = true;
    document.addEventListener('selectionchange', onChange);
    // 页面滚动时让 FAB 跟随选区（选区在文档中，FAB 是 fixed）
    window.addEventListener('scroll', () => { if (excFab && !excFab.classList.contains('hidden') && excReposition) excReposition(); }, { passive: true });
    // 按住 FAB 不清选区（桌面）：否则 click 时视觉上选区会先消失；
    // 触屏上点按本身可能解散选区——所以待摘录文本在显示 FAB 时就已存好（excPendingText）
    fab.addEventListener('mousedown', (ev) => ev.preventDefault());
    fab.onclick = (ev) => {
      ev.stopPropagation();
      const text = excPendingText;
      const poem2 = excCurPoem;
      if (text && poem2) {
        const rec = addExcerpt(poem2.i, text);
        popupMsg(rec ? '已摘录到摘录本 ✓\n「' + (text.length > 40 ? text.slice(0, 40) + '…' : text) + '」' : '未能摘录：句子太短、过长或已存在', '好的');
      }
      excPendingText = '';
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      hideExcFab();
    };
  }
  // 触屏长按选词后 mouseup 不触发，补 touchend
  body.addEventListener('touchend', onChange);
  body.addEventListener('mouseup', onChange);
}

// ---------------- 摘录本页 ----------------

function maskHTML(line, level) {
  let out = '', cjk = 0;
  for (const ch of String(line)) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch)) {
      const hide = level === 'all' || (cjk % 3 !== 2);
      cjk++;
      out += hide ? `<span class="mask" tabindex="0">${esc(ch)}</span>` : esc(ch);
    } else out += esc(ch);
  }
  return out;
}


// 脚注弹窗：app 级一次性委托绑定

let fnPopupBound = false;

let popDismissBound = false;

let __fnNotes = null;

// 点击浮窗外部 → 关闭（注释浮窗、卡片浮窗、各类提示共用同一个 #fn-pop）
// 用 pointerdown 在捕获阶段处理，手指按下即关，比 click 更跟手；
// 浮窗内部（.fn-card）点击、以及点另一处脚注词条（.fn）时不关——后者由下面的委托换成新内容。

function bindPopupDismiss() {
  if (popDismissBound) return;
  popDismissBound = true;
  document.addEventListener('pointerdown', (e) => {
    const pop = document.getElementById('fn-pop');
    if (!pop || pop.classList.contains('hidden')) return;
    if (e.target.closest && (e.target.closest('.fn-card') || e.target.closest('.fn'))) return;
    closePopup(pop);
  }, true);
}
// 模块加载即生效，保证设置页、摘录页、收藏页的浮窗也能点外部关闭
bindPopupDismiss();

function bindFnPopup() {
  if (fnPopupBound) return;
  fnPopupBound = true;
  bindPopupDismiss();
  app.addEventListener('click', (e) => {
    const fnEl = e.target.closest('.fn');
    const pop = document.getElementById('fn-pop');
    if (!pop || !fnEl) return;
    const note = (window.__fnNotes || [])[+fnEl.dataset.n];
    if (!note) return;
    pop.innerHTML = `<div class="fn-card">
      <div class="fn-term">${esc(note.display || note.term)}</div>
      <div class="fn-expl">${esc(note.expl)}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <a class="fn-close" style="text-decoration:none;display:inline-block" href="#/s/${encodeURIComponent(note.display || note.term)}" id="fn-rel">相关诗词</a>
        <button class="fn-close" id="fn-ok">关闭</button>
      </div>
    </div>`;
    rememberPopupFocus();
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.classList.remove('hidden');
    // 关闭键要绑 <button>，不能绑首个 .fn-close（那是「相关诗词」链接，绑错会导致关闭失效）
    const fnOk = pop.querySelector('#fn-ok');
    if (fnOk) fnOk.onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
    const fnRel = pop.querySelector('#fn-rel');
    if (fnRel) fnRel.onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
  });
}

function renderPoem(poem, seq = currentRenderSeq()) {
  if (!isCurrent(seq)) return;
  curPoemId = poem.i;
  // rawPoem：未做简繁转换的原件。链接（作者 / 体裁 / 标签）必须用它——索引键是
  // 原文的写法，转换后的名字查不到；显示一律走转换副本。
  const rawPoem = poem;
  // 数据源里混进的全角/半角空格（6107 条正文、多数在赋里，如「而未摵　，思比象于紫微」），
  // 显示出来就是一句中间突兀的空隙。站内没有任何段落用空格缩进（缩进走 CSS text-indent），
  // 所以整体清掉最省事：正文、译文、注释、赏析、结构化注释一起清，保证行文本与注释定位仍是同一份。
  const SP = /[ \u00a0\u3000\u200b\t]/g;
  const strip = (v) => (typeof v === 'string' ? v.replace(SP, '') : v);
  // 简繁显示（2026-10-29）：zhShow 逐字等长转换，眉批/摘录偏移与注释定位不受影响；
  // tg/_genre/_regName/_col 等链接与推定元数据不转，显示处单独 zhShow。
  const zs = (v) => zhShow(strip(v));
  const zsArr = (a) => Array.isArray(a) ? a.map(x => zs(x)) : a;
  const cleanF = (ff) => {
    if (!ff) return ff;
    const o = {};
    for (const k of Object.keys(ff)) o[k] = Array.isArray(ff[k]) ? zsArr(ff[k]) : zs(ff[k]);
    return o;
  };
  poem = Object.assign({}, poem, {
    t: zs(poem.t), a: zs(poem.a), d: zs(poem.d), r: zs(poem.r),
    pr: zs(poem.pr), cm: zs(poem.cm),
    p: zsArr(poem.p || []),
    f: cleanF(poem.f),
    n: Array.isArray(poem.n) ? poem.n.map(x => {
      if (!x || typeof x !== 'object') return zs(x);
      const o = {};
      for (const k of Object.keys(x)) o[k] = zs(x[k]);
      return o;
    }) : zs(poem.n),
  });
  const col = poem._col || {};
  const f = poem.f || {};
  const hasAnyAnnot = f.y || f.z || f.s || f.b || (poem.n && poem.n.length) || poem.pr || poem.cm;
  // 拼音库按需加载：用户开过「拼音」但本会话还没拉过库 → 静默拉一次，到了就重渲染
  const pyWanted = pref('py') === '1';
  if (pyWanted && !hasPinyinLib() && !pyLibKicking) {
    pyLibKicking = true;
    ensurePinyinLib().then(ok => {
      if (!isCurrent(seq) || curPoemId !== poem.i || !document.getElementById('poem-body')) return;
      pyLibKicking = false;
      if (ok) renderPoem(poem, seq);
    });
  }
  const pyOn = pyWanted && hasPinyinLib();
  // 平仄来源：源数据优先；没有时用格律推定（仅近体诗，且模板匹配度够）
  const stSrc = (poem.st && poem.st.length) ? poem.st : (poem._estSt || null);
  const stOn = pref('st') === '1' && !!stSrc;
  const notes = buildNotes(poem);
  const fnOn = pref('fn') === '1' && notes.length > 0 && !maskState;
  const maskOn = !!maskState;
  const isProse = PROSE_SET.has(col.id);
  // 译文：散文/赋只要有译文就给开关。段数与正文一致时逐段贴；不一致（如《师说》4 段对 8 段）整篇缀在正文后
  const ySegs = f.y
    ? String(f.y).replace(/^\s*(白话)?译文[:：]?\s*\n?/, '')
      .split(/\n+/).map(x => x.trim()).filter(x => x && x !== '译文')
    : [];
  const hasY = isProse && ySegs.length > 0;

  // 译文段数与正文段数对不上时，按「字数比例」把译文段分配到正文段。
  // 段数相等就直接一一对应；差太多（超过正文段数一半）或长度比例离谱就放弃，退回整篇显示。
  // 《深虑论》就是 3 段正文对 4 段译文，原先只能整篇堆在文末。
  function alignY(pSegs, ys) {
    const hz = (s2) => { let n = 0; for (const ch of String(s2)) if (/[\u3400-\u9fff]/.test(ch)) n++; return n; };
    if (!pSegs.length || !ys.length) return null;
    if (pSegs.length === ys.length) return ys.map(x => [x]);
    if (Math.abs(pSegs.length - ys.length) > Math.max(2, Math.floor(pSegs.length / 2))) return null;
    const pl = pSegs.map(hz), yl = ys.map(hz);
    const P = pl.reduce((a, b) => a + b, 0), Y = yl.reduce((a, b) => a + b, 0);
    if (!P || !Y) return null;
    const out = pSegs.map(() => []);
    let acc = 0;
    for (let i = 0; i < ys.length; i++) {
      const mid = (acc + yl[i] / 2) / Y;       // 这段译文的"中点"落在全文的哪个位置
      acc += yl[i];
      let pos = 0, k = 0;
      for (; k < pl.length; k++) { pos += pl[k] / P; if (mid <= pos + 1e-9) break; }
      out[Math.min(k, pl.length - 1)].push(ys[i]);
    }
    // 兜底校验：正文每段都得有译文，且译文/正文字数比不离谱（0.35~2.5 倍），否则宁可整篇显示
    for (let i = 0; i < out.length; i++) {
      if (!out[i].length) return null;
      const yLen = out[i].reduce((a, b) => a + hz(b), 0);
      const r = yLen / Math.max(1, pl[i]);
      if (r < 0.35 || r > 2.5) return null;
    }
    return out;
  }
  const yAligned = hasY ? alignY(poem.p || [], ySegs) : null;
  const canInlineY = !!yAligned;
  const tyOn = hasY && pref('ty') !== '0' && !maskState;   // 默认开
  // 与列表一致：剥掉全唐诗的乐府分类前缀（「橫吹曲辭 出塞」→「出塞」）
  const cleanT = String(poem.t || '').replace(LE_PREFIX, '');
  const title = poem.r && poem.r !== poem.t ? `${poem.r}·${cleanT}` : cleanT || '无题';
  // 吸顶条只有 250px 宽：题名越长收一档字号（配 CSS 的 3 行上限），43 字以内能完整显示
  const titleLen = [...title].length;
  const titleCls = titleLen > 45 ? ' t-xs' : titleLen > 33 ? ' t-sm' : '';
  const authorHtml = poem.a ? `<a href="#/a/${encodeURIComponent(rawPoem.a || poem.a)}">${esc(poem.a)}</a>` : '佚名';
  const rec = getRecites()[poem.i];

  const usedTerms = new Set();
  const titleFns = fnOn ? locateTerms(title, notes, usedTerms) : null;
  const mode = maskOn ? 'sentence' : (PROSE_SET.has(col.id) ? 'prose' : (PAIR_SET.has(col.id) ? 'pair' : (CI_SET.has(col.id) ? 'ci' : 'sentence')));
  // 行宽实测判定器：CSS 断行下只服务「超宽长分句预拆」这一个兜底；
  // 旧 JS 断行（LINE_BY_CSS=false）用它做全部装箱判据。
  // 拼音 ruby 撑宽每个字、脚注上标占位，开着时容量先扣掉。
  const fits = mode === 'prose' ? null : makeLineFits(pyOn && !maskOn, fnOn);
  const displayLines = [];
  (poem.p || []).forEach((line, k) => {
    const strain = stSrc && stSrc[k];
    if (LINE_BY_CSS) {
      for (const seg of layoutSentences(line, strain, mode, fits)) displayLines.push(seg);
    } else {
      for (const seg of layoutParagraph(line, strain, mode, fits)) displayLines.push(seg);
    }
  });
  // 朗诵按"显示行"切块，所以行表与页面上的 .line 同序（换模式/换字号都跟着变）
  readLines = displayLines.map((seg, i) => ({ t: seg.t, li: i }));
  let li = 0;
  const lines = displayLines.map((seg, segIdx) => {
    let content, stFallback = '';
    if (maskOn) {
      content = maskHTML(seg.t, maskState.level);
    } else if (seg.cls) {
      // CSS 断行：分句各成一块（span.cl，CSS 里 nowrap），块间 <wbr>；
      // 放不放得下、在哪掉行由浏览器现场排版。平仄/拼音按块内偏移对齐。
      if (stOn && seg.st && !seg.pzs) stFallback = '<p class="strain-line">' + esc(seg.st) + '</p>';
      let off = 0;
      const spans = [];
      for (const c of seg.cls) {
        const n = [...c].length;
        const fns = fnOn ? locateTerms(c, notes, usedTerms) : null;
        // 平仄关闭时必须传 null pzs，否则 .pzw 下标仍会被渲染出来
        const pzs = stOn && seg.pzs ? seg.pzs.slice(off, off + n) : null;
        spans.push('<span class="cl">' + (pyOn ? rubyHTML(c, fns, true, pzs) : annotHTML(c, fns, pzs)) + '</span>');
        off += n;
      }
      content = spans.join('<wbr>');
    } else {
      const fns = fnOn ? locateTerms(seg.t, notes, usedTerms) : null;
      if (stOn && seg.st && !seg.pzs) stFallback = '<p class="strain-line">' + esc(seg.st) + '</p>';
      // 平仄关闭时必须不传 pzs，否则 .pzw 下标仍会被渲染出来
      const pzs = stOn ? seg.pzs : null;
      content = pyOn ? rubyHTML(seg.t, fns, true, pzs) : annotHTML(seg.t, fns, pzs);
    }
    const trHtml = (tyOn && yAligned && yAligned[segIdx])
      ? '<div class="tr-p">' + yAligned[segIdx].map(x => esc(x)).join('<br>') + '</div>' : '';
    return '<p class="line' + (mode === 'prose' ? ' prose' : '') + '" data-li="' + (li++) + '">' + content + '</p>' + stFallback + trHtml;
  }).join('');

  const stripHdr = (s, re) => s ? s.replace(re, '').trim() : s;
  // 释文（题解/译文/注释/赏析/创作背景）默认展开，可在设置里关掉；顶部标签与功能条不受影响。
  const annotOpen = pref('ao') !== '0';
  const annotCard = (titleText, contentHtml) =>
    `<div class="card card--soft${annotOpen ? ' fold-open' : ''}" data-fold><button type="button" class="fold-head" aria-expanded="${annotOpen ? 'true' : 'false'}">${titleText}<span class="fold-btn">${annotOpen ? '−' : '+'}</span></button><div class="annotate fold-body">${contentHtml}</div></div>`;

  let cards = '';
  if (!maskOn) {
    if (poem.pr) cards += annotCard('题解', esc(poem.pr));
    if (f.y && !tyOn) cards += annotCard('译文', esc(stripHdr(f.y, /^\s*(白话)?译文[:：]?\s*\n?/)));
    // f.z（文本注释）与 n（结构化注释）常常是同一套注释的两个来源（全库 297 首两者都有），
    // 一起渲染就会出现两张「注释」卡；只留条目更多的那一份。
    const zText = f.z ? String(f.z) : '';
    const zLines = zText ? zText.split('\n').filter(x => x.trim()).length : 0;
    const nArr = (poem.n && poem.n.length) ? poem.n : [];
    if (zLines && zLines >= nArr.length) cards += annotCard('注释', esc(stripHdr(zText, /^\s*(字词)?注释[:：]?\s*\n?/)));
    else if (nArr.length) cards += annotCard('注释', nArr.map(esc).join('\n'));
    if (f.s) cards += annotCard('赏析', esc(stripHdr(f.s, /^\s*(赏析|评析)[:：]?\s*\n?/)));
    if (f.b) cards += annotCard('创作背景', esc(stripHdr(f.b, /^\s*创作背景[:：]?\s*\n?/)));
    if (poem.cm) cards += annotCard('评点', esc(poem.cm));

  }

  // tg 两代形态：旧集合是数组（题材标签），2026-11 新集合是字符串（集合 id 标记，如 'couplets'），
  // 字符串上调 .filter 会直接 TypeError 崩掉新集合详情页——只认数组。
  const tags = (Array.isArray(poem.tg) ? poem.tg : []).filter(t => t && t !== '唐诗三百首').slice(0, 8);

  // 眉批：正文里是「夹批」（挂在对应行下面），这里再给一份通览，折叠着，需要时才展开。
  // 背诵模式下不给——正文都遮了，留着批注等于漏底。
  const notesCard = maskOn ? '' : notesCardMarkup(poem);

  // 相邻导航已在 detailView 里跳过下线记录（_prev/_next 挂在 poem 上）；兜底旧算法防裸调
  // 边界同 neighborVisible 用 span（2026-11-01 P0-1），hole id 由 getPoem 的 remap 兜底
  const colSpan = col.span != null ? col.span : col.count;
  const prevId = poem._prev !== undefined ? poem._prev : (poem.i - 1 >= col.start ? poem.i - 1 : null);
  const nextId = poem._next !== undefined ? poem._next : (poem.i + 1 < col.start + colSpan ? poem.i + 1 : null);
  const ttsOn = readState && readState.poemId === poem.i;

  const scrollTop = window.scrollY;
  setAppHTML(seq, `
    <header class="dv-head" id="dv-head">
    ${isRead(poem.i) ? '<span class="rd-seal" title="这一篇读过了"><i>字字珠玑</i><i>尽收眼底</i></span>' : ''}
      <div class="dv-top">
        <span class="dv-pad" aria-hidden="true"></span>
        <h1 class="pt${titleCls}">${titleFns && titleFns.length ? annotHTML(title, titleFns) : esc(title)}</h1>
        <button class="act menu-trigger" id="poem-menu-btn" aria-haspopup="true" aria-expanded="false" title="更多操作">☰</button>
      </div>
      <div class="poem-head">
        <div class="pa">${poem.d ? esc(poem.d) + ' · ' : ''}${authorHtml}${poem._genre ? ` <a class="badge" href="#/g/${encodeURIComponent(poem._genre)}" title="体裁介绍">${esc(zhShow(poem._genre.replace('词·', '')))}</a>` : ''}${col.name ? ` <a class="badge" href="#/c/${col.id}/${poem._colPage != null ? poem._colPage : Math.floor((poem.i - col.start) / 200)}?cur=${poem.i}" title="收录于《${esc(col.name)}》，点此查看该选本">${esc(col.name)}</a>` : ''}</div>
      </div>
    <div class="poem-menu hidden" id="poem-menu">
      <button class="pm-item ${isFav(poem.i) ? 'on' : ''}" id="fav-btn">${isFav(poem.i) ? '★ 已收藏' : '☆ 收藏'}</button>
      <button class="pm-item ${rec ? 'on' : ''}" id="recite-btn">${rec ? '✓ 已背诵 ' + rec.n + ' 次' : '○ 记录背诵'}</button>
      <button class="pm-item" id="share-btn">▤ 制作卡片</button>
      <button class="pm-item" id="note-btn">＋ 写眉批</button>
      <a class="pm-item" id="report-link" href="${COLLECT_URL}" target="_blank" rel="noopener">✎ 勘误</a>
    </div>
      <div class="tool-row">
      <div class="tr-main">
        <button id="py-btn" class="${pyOn ? 'on' : ''}"${maskOn ? ' disabled' : ''}>拼音</button>
        ${stSrc ? `<button id="st-btn" class="${stOn ? 'on' : ''}"${maskOn ? ' disabled' : ''}>平仄</button>` : ''}
        ${notes.length && !maskOn ? `<button id="fn-btn" class="${fnOn ? 'on' : ''}">注释</button>` : ''}
        ${hasY ? `<button id="ty-btn" class="${tyOn ? 'on' : ''}"${maskOn ? ' disabled' : ''}>译文</button>` : ''}
        <button id="theme-btn" title="临时切换日间/夜间，不改动设置里的「自动 / 跟随系统」">${document.documentElement.getAttribute('data-theme') === 'dark' ? '日间' : '夜间'}</button>
      </div>
      <button class="tr-more${fnFold ? ' on' : ''}" id="tr-more" aria-expanded="${fnFold ? 'true' : 'false'}" aria-label="更多功能">⋯</button>
    </div>
    <div class="tr-panel${fnFold ? ' open' : ''}" id="tr-panel">
      <div class="poem-toolbar">
        <button id="tts-btn" class="${ttsOn ? 'on' : ''}">${ttsOn ? '■ 停止' : '♪ 朗诵'}</button>
        <button id="auto-btn" class="${pref('autoplay') === '1' ? 'on' : ''}">连播</button>
        <button id="fs-dec">A−</button><button id="fs-inc">A＋</button>
      </div>
      </div>
    </header>
    ${maskOn ? `<div class="poem-toolbar">
      <button id="mask-level">隐藏：${maskState.level === 'half' ? '三分之二' : '全部'}</button>
      <button id="mask-reveal">全部显示</button>
    </div>` : ''}
    <div class="poem-body ${(pyOn && !maskOn) ? 'with-py ' : ''}${(stOn && !maskOn) ? 'with-st ' : ''}${(fnOn && !maskOn) ? 'fnopen' : ''}" id="poem-body">${lines}</div>
    <div id="rd-sentinel" class="rd-sentinel"></div>
    ${tags.length ? `<div class="ptags ptags-block">${tags.map(t => `<a class="ptag" href="#/t/${encodeURIComponent(t)}">${esc(zhShow(t))}</a>`).join('')}</div>` : ''}
    ${(tyOn && !canInlineY) ? `<div class="tr-block">${ySegs.map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
    ${!hasAnyAnnot && !maskOn ? '<div class="st-note">本站暂缺此篇的译文、注释与赏析。</div>' : ''}
    ${stOn && !(poem.st && poem.st.length) && poem._regName ? `<div class="st-note">${
      poem._estKind === 'ci'
        ? `平仄依同调作品推定（${esc(poem._regName)}），非格律书原谱；多音字以模板为准，与各家词谱或有出入。`
        : poem._estKind === 'shi'
          ? `平仄依格律推定（${esc(poem._regName)}），拗救未校；多音字以格律为准，与诵读习惯或有出入。`
          : poem._estKind === 'ci-tone'
            ? '该词牌同调作品太少，推不出格律，此处只标字音平仄；多音字取常用读音，或有出入。'
            : `古体作品无固定格律，此处只标字音平仄，不作格律校验；多音字取常用读音，或有出入。`}</div>` : ''}
    ${fnOn && notes.length ? `<div class="section-tip" style="text-align:center">点击文中带 <sup class="fnn">注</sup> 标记的词语查看注释</div>` : ''}
    ${cards}
    ${notesCard}
    <div class="read-done" id="read-done">
      <div class="rd-stat" id="rd-stat">${(() => { const r = readStats(); return r.total > 0 ? `今日已读 ${r.today} 篇 · 累计读完 ${r.total} 篇` : '读完这一篇，记第一笔'; })()}</div>
      <div class="rd-acts">
        <button type="button" id="rd-mask">${maskOn ? '退出背诵' : '尝试背诵'}</button>
        <button type="button" id="rd-recite"${rec ? ' disabled' : ''}>${rec ? '✓ 已记下' : '我能背诵'}</button>
      </div>
    </div>
    <div class="poem-nav">
      ${prevId !== null ? `<a href="#/p/${prevId}">上一篇</a>` : '<a style="visibility:hidden">—</a>'}
      <a href="#" id="nav-lucky">随便看看</a>
      ${nextId !== null ? `<a href="#/p/${nextId}">下一篇</a>` : '<a style="visibility:hidden">—</a>'}
    </div>
    ${poem._navq ? `<div class="navq">${esc(zhShow(poem._navq.label))} · 第 ${poem._navq.pos + 1} / ${poem._navq.total} 篇</div>` : ''}

    <div id="fn-pop" class="hidden"></div>
    <div id="note-pop" class="hidden"></div>`);

  // 题名折行时，左边界对齐工具栏「拼音」按钮（10px）；单行时仍保持居中。
  // 用实测行高判断而不是数字符——字号分了三档，字符数换算不准。
  try {
    const ptEl = app.querySelector('.dv-top .pt');
    const topEl = app.querySelector('.dv-top');
    if (ptEl && topEl) {
      const lh = parseFloat(getComputedStyle(ptEl).lineHeight) || 22;
      if (ptEl.getBoundingClientRect().height > lh * 1.45) topEl.classList.add('wrap');
    }
  } catch (e) {}

  // ---------- 折叠区：标签 / 功能（默认收起，状态跨重渲染保留） ----------
  // 三点按钮：其余功能（背诵模式/朗诵/连播/字号/夜间）收在面板里
  // 盖上「已读」印章：只在读到末尾那一刻才盖
  function sealIt() {
    if (document.querySelector('.rd-seal')) return;
    const el = document.createElement('span');
    el.className = 'rd-seal';
    el.title = '这一篇读过了';
    el.innerHTML = '<i>字字珠玑</i><i>尽收眼底</i>';
    el.style.animationDelay = '.78s';            // 先看花开，再盖章
    const head = document.querySelector('.dv-head');
    if (head) head.appendChild(el);
  }

  // 礼花：十几个朱/墨色小点散开再淡出。纯 DOM + CSS 动画，不用 canvas、不占渲染帧
  function burst() {
    const box = document.createElement('div');
    box.className = 'rd-burst';
    const N = 16;
    for (let i = 0; i < N; i++) {
      const dot = document.createElement('i');
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.5;
      const dist = 40 + Math.random() * 70;
      const dx = Math.cos(ang) * dist;
      // 先向上抛，再受「重力」下坠：纵向用 sin 摊薄，再统一加一段落距
      const dy = Math.sin(ang) * dist * 0.7 - 14;
      dot.style.setProperty('--dx', dx.toFixed(1) + 'px');
      dot.style.setProperty('--dy', dy.toFixed(1) + 'px');
      dot.style.setProperty('--dy2', (dy + 26).toFixed(1) + 'px');
      dot.style.setProperty('--dl', (Math.random() * 160 | 0) + 'ms');
      dot.style.setProperty('--sz', (4 + Math.random() * 4.5).toFixed(1) + 'px');
      if (i % 3 === 1) dot.classList.add('ink');
      box.appendChild(dot);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2400);
  }

  // 一朵朱色小花在正文末尾标签行上方绽开：花苞鼓起 → 五瓣张开 → 散落，留一瓣停在原处。
  // 2026-10-30「读完了」块移到页底后，花仍留在读完的地方开——标签行就在正文末尾。
  // 全程纯 CSS 动画（每片花瓣一条 animation，靠 --i 分角度），不起 JS 动画循环。
  function bloom() {
    // 挂载点优先级：正文末尾的标签行 → 正文最后一行的句尾（无标签的篇，如 pdb 库无 tg 数据，
    // 花就在最后一个字旁绽开）→ 末尾哨兵兜底。三个位置都在「读完的地方」。
    const lineEls = document.querySelectorAll('#poem-body p.line');
    const lastLine = lineEls.length ? lineEls[lineEls.length - 1] : null;
    const host = document.querySelector('.ptags.ptags-block') || lastLine || document.getElementById('rd-sentinel');
    if (!host || host.querySelector('.rd-bloom')) return;
    const ANG = [0, 72, 144, 216, 288];
    const box = document.createElement('span');
    box.className = 'rd-bloom';
    // 位置：花要落在句尾往回数约四个字的地方，但不能用负 margin —— 那会把行盒宽度改小，
    // 居中时整句话会被带偏（2026-10-28 踩过：文字整体右移）。占位盒子保持 0 宽不动，
    // 只把绝对定位的 SVG 往左挪 4em，排版完全不受影响。
    box.style.cssText = 'display:inline-block;position:relative;width:0;height:0;margin-left:7px;vertical-align:middle';
    // 内联 SVG：五个椭圆瓣 + 一个花心。形状固定，只做整体缩放与单瓣淡出，最不容易"看不见"
    box.innerHTML =
      '<svg class="rd-flower" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true" ' +
      'style="position:absolute;left:calc(-15px - 4em);top:-24px;overflow:visible;transform-origin:50% 50%;' +
      'transform:scale(.12) rotate(-50deg);opacity:0;' +
      'transition:transform .55s cubic-bezier(.2,.9,.3,1.3),opacity .3s ease">' +
      ANG.map(a => `<ellipse cx="20" cy="10.6" rx="5.1" ry="8.8" fill="var(--accent,#a3372f)" transform="rotate(${a} 20 20)"/>`).join('') +
      '<circle cx="20" cy="20" r="2.6" fill="var(--card-solid,#f6f2e9)"/>' +
      '</svg>';
    host.appendChild(box);                  // 先挂进文档树，后续的 transition 才会真的跑

    const fl = box.querySelector('.rd-flower');
    const petals = fl.querySelectorAll('ellipse');
    // 花苞紧 → 一瞬撑开（微微过冲）→ 落定
    setTimeout(() => { fl.style.opacity = '.95'; fl.style.transform = 'scale(1.15) rotate(10deg)'; }, 150);
    setTimeout(() => { fl.style.transform = 'scale(1) rotate(0deg)'; }, 480);
    // 散落：四瓣飘走，留最后一片淡在纸上
    petals.forEach((p2, i) => {
      if (i === petals.length - 1) {
        setTimeout(() => { p2.style.transition = 'opacity .9s ease'; p2.style.opacity = '.3'; }, 2400);
      } else {
        setTimeout(() => {
          p2.style.transition = 'opacity .9s ease, transform 1s ease-in';
          p2.style.transformBox = 'view-box';
          p2.style.transformOrigin = '20px 20px';
          p2.style.transform = `rotate(${ANG[i]}deg) scale(.86)`;
          p2.style.opacity = '0';
        }, 2350 + i * 110);
      }
    });
  }

  // 读完反馈：滚到正文末尾的哨兵就算读完（一次），记一次已读并显示今日进度。
  // 监听治理（踩过）：①fire 时要移除的必须是真正注册的那个函数，否则监听永远留在 window
  //   上；②旧页面的 sentinel 已脱离 DOM，getBoundingClientRect 恒为 0，会被误判「已在触发
  //   线内」——之后任何页面滚一下就把上一篇误记成已读（污染 shici-read）。所以每次渲染先
  //   teardown 上一次的监听，判定处再加 isConnected 守卫，双保险。
  {
    if (readTeardown) { readTeardown(); readTeardown = null; }
    const sentinel = document.getElementById('rd-sentinel');
    const doneBox = document.getElementById('read-done');
    if (sentinel && doneBox) {
      const TRIGGER = 0.75;                      // 正文末尾进视口下四分之一才算读完
      const ARMS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];
      let fired = false, armed = false, ticking = false;
      function teardown() {
        window.removeEventListener('scroll', onScroll);
        for (const t of ARMS) window.removeEventListener(t, arm);
      }
      function fire() {
        if (fired) return;
        fired = true;
        teardown();
        markRead(poem.i);
        sealIt();
        const st = readStats();
        // 重读旧作且今天尚未读新篇时 today 为 0，直说「第 0 篇」很怪
        const bits = [st.today > 0 ? '今天第 ' + st.today + ' 篇' : '今日尚未读新篇', '累计读完 ' + st.total + ' 篇'];
        if (st.streak > 1) bits.push('连续 ' + st.streak + ' 天');
        document.getElementById('rd-stat').textContent = '读完了 · ' + bits.join(' · ');
        doneBox.classList.add('is-read');          // 本来就在，读完才亮起来
        bloom();   // 想换回烟花：把 bloom() 改成 burst()（函数与样式都留着）
      }
      function check() {
        // isConnected：页面已换（sentinel 脱离 DOM）就再也不能触发，rect 全 0 也不行
        if (fired || !sentinel.isConnected) return;
        if (sentinel.getBoundingClientRect().top <= window.innerHeight * TRIGGER) fire();
      }
      // 不用 IntersectionObserver：快速滑/按 End 一步到底时，哨兵是"穿过"视口而不是"交叉"，
      // observer 不会回调。改成"只要滚到过它就算读完"，快慢都算。
      function onScroll() {
        if (!armed || fired || ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; check(); });
      }
      // 必须先有「人的动作」才判定：浏览器恢复滚动位置、字体加载引起的高度变化都会自己发
      // scroll，短篇一进来就"读完了"。滚动类动作（滚轮/触摸/按键）在开闸的同一刻立即判一次
      // ——一屏放得下的短诗页面不可滚、永远等不到 scroll 事件，只有这里能接住"轻轻划一下"。
      // pointerdown 只开闸不判定：点按钮（切拼音等）不该算读完。
      function arm(ev) {
        if (ev && ev.type === 'pointerdown') { armed = true; return; }
        if (!armed) { armed = true; check(); }
      }
      for (const t of ARMS) window.addEventListener(t, arm, { passive: true, once: true });
      window.addEventListener('scroll', onScroll, { passive: true });
      readTeardown = teardown;
    }
    document.getElementById('rd-recite').onclick = (ev) => {
      const rec2 = addRecite(poem.i);
      ev.currentTarget.textContent = '✓ 已记下';
      ev.currentTarget.disabled = true;
      // ☰ 菜单徽标同步：不重渲染，直接改（否则要滚回顶部重新渲染一遍）
      const rb = document.getElementById('recite-btn');
      if (rb) { rb.textContent = '✓ 已背诵 ' + rec2.n + ' 次'; rb.classList.add('on'); }
    };
    // 「再读一首」按钮已去掉：与页底「随便看看」重复（2026-10-30）
  }

  // 「随便看看」：全库随机跳一首（滤掉残句断章），给冷门作品一点出场机会
  const navLucky = document.getElementById('nav-lucky');
  if (navLucky) navLucky.onclick = async (ev) => {
    ev.preventDefault();
    if (navLucky.dataset.busy) return;
    navLucky.dataset.busy = '1';
    // 摇到当前这一篇时 hash 不变，页面不会重绘，看着就像「点了没反应」。
    // 所以要求必须换一篇：最多重摇 5 次（同一个 id 连中 5 次的概率可忽略）。
    let nid = null;
    for (let k = 0; k < 5; k++) {
      const t = await luckyPoemId().catch(() => null);
      if (t != null && t !== poem.i) { nid = t; break; }
    }
    delete navLucky.dataset.busy;
    if (nid != null) location.hash = '#/p/' + nid;
  };

  // 预热下一篇：空闲时把它的分块取进内存（一块 39KB gzip），点「下一篇」就不用再等一次往返。
  // 只预取 1 篇——预取太多会跟当前页抢带宽，收益也递减。
  if (nextId !== null) {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => { getPoem(nextId).catch(() => {}); });
  }

  const trMore = document.getElementById('tr-more');
  const trPanel = document.getElementById('tr-panel');
  if (trMore && trPanel) {
    trMore.onclick = (ev) => {
      ev.stopPropagation();
      const open = trPanel.classList.toggle('open');
      fnFold = open;
      trMore.classList.toggle('on', open);
      trMore.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    // 面板开着时，点功能栏与面板以外的任何地方（正文 / 标题 / 空白）就地收起——不用再回头点一次 ⋯。
    // 与 ☰ 菜单同一套做法：document 级监听只绑一次，每次现查当前 DOM。
    if (!window.__trPanelBound) {
      window.__trPanelBound = true;
      document.addEventListener('click', (e) => {
        const p = document.getElementById('tr-panel');
        if (!p || !p.classList.contains('open')) return;
        const t = e.target;
        if (p.contains(t) || (t.closest && t.closest('.tool-row'))) return;   // 面板与功能栏本身不触发
        p.classList.remove('open');
        fnFold = false;
        const b = document.getElementById('tr-more');
        if (b) { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }
      });
    }
  }
  // ---------- 右上角三横菜单：收藏 / 已背诵 / 制作卡片 ----------
  const menuBtn = document.getElementById('poem-menu-btn');
  const menu = document.getElementById('poem-menu');
  const openMenu = (on) => {
    menu.classList.toggle('hidden', !on);
    menuBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    menuBtn.classList.toggle('on', on);
  };
  menuBtn.onclick = (ev) => { ev.stopPropagation(); openMenu(menu.classList.contains('hidden')); };
  if (!window.__poemMenuBound) {
    window.__poemMenuBound = true;
    document.addEventListener('click', (e) => {
      const m2 = document.getElementById('poem-menu');
      const b2 = document.getElementById('poem-menu-btn');
      if (!m2 || m2.classList.contains('hidden')) return;
      if (m2.contains(e.target) || (b2 && b2.contains(e.target))) return;
      m2.classList.add('hidden');
      if (b2) { b2.setAttribute('aria-expanded', 'false'); b2.classList.remove('on'); }
    });
  }
  // 勘误：一次点击做两件事——后台写剪贴板，浏览器同时开问卷（交给默认行为，target=_blank）。
  // 关键是不 preventDefault、不 await：只要用户手势没被打断，新标签就不会被弹窗策略拦。
  // 腾讯问卷的 URL 预填是商业版功能（免费版实测不生效），剪贴板是替代：
  // 读者到第 1 题长按粘贴，作者、篇名、编号一次带进去。
  document.getElementById('report-link').onclick = () => {
    const who = [poem.d, poem.a].filter(Boolean).join(' · ');
    const key = `${who ? who + ' ' : ''}《${poem.t}》（#/p/${poem.i}）`;
    navigator.clipboard.writeText(key).catch(() => {});   // 失败也不拦着开问卷
    popupMsg('作品信息已复制，第 1 题长按粘贴即可');
  };

  document.getElementById('fav-btn').onclick = () => {
    const on = toggleFav(poem.i);
    const b = document.getElementById('fav-btn');
    b.textContent = on ? '★ 已收藏' : '☆ 收藏';
    b.classList.toggle('on', on);
    openMenu(false);
  };
  document.getElementById('recite-btn').onclick = () => {
    openMenu(false);
    const pop = document.getElementById('fn-pop');
    const cur = getRecites()[poem.i];
    if (!cur) {
      const r = addRecite(poem.i);
      pop.innerHTML = `<div class="fn-card"><div class="fn-term">已记录背诵 ✓</div><div class="fn-expl">今日已打卡！可到「背诵」页查看热力图与复习计划。</div><button class="fn-close" id="rc-ok">好的</button></div>`;
      pop.classList.remove('hidden');
      pop.querySelector('#rc-ok').onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
      renderPoem(poem, seq);
      window.scrollTo(0, scrollTop);
    } else {
      pop.innerHTML = `<div class="fn-card">
        <div class="fn-term">背诵管理</div>
        <div class="fn-expl">首次背诵：${new Date(cur.t).toLocaleDateString('zh-CN')} · 已背 ${cur.n} 次</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="fn-close" id="rc-add">再记一次</button>
          <button class="fn-close" id="rc-del" style="color:var(--accent)">取消背诵</button>
          <button class="fn-close" id="rc-ok">关闭</button>
        </div></div>`;
      pop.classList.remove('hidden');
      pop.querySelector('#rc-add').onclick = (ev) => { ev.stopPropagation(); addRecite(poem.i); renderPoem(poem, seq); };
      pop.querySelector('#rc-del').onclick = (ev) => { ev.stopPropagation(); removeRecite(poem.i); renderPoem(poem, seq); };
      pop.querySelector('#rc-ok').onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
    }
  };
  document.getElementById('share-btn').onclick = () => { openMenu(false); import('../card.js').then(m => { if (!isCurrent(seq) || curPoemId !== poem.i || !document.getElementById('poem-body')) return; m.makeShareCard(poem, displayLines, title); }); };
  // 「＋ 写眉批」：进出选点模式（模式内点任意行开编辑器）
  const noteBtn = document.getElementById('note-btn');
  if (noteBtn) noteBtn.onclick = () => {
    const body = document.getElementById('poem-body');
    const on = !(body && body.classList.contains('note-mode'));
    openMenu(false);
    setNoteMode(on);
  };
  const pyBtn = document.getElementById('py-btn');
  pyBtn.onclick = () => {
    const want = pref('py') !== '1';
    if (want && !hasPinyinLib()) {
      // 库还没加载（按需加载策略，约 500KB）：拉到了再开；断网给明确提示而非红条
      popupMsg('拼音库加载中，稍候即开…', '好的');
      pyLibKicking = true;
      ensurePinyinLib().then(ok => {
        if (!isCurrent(seq) || curPoemId !== poem.i || !document.getElementById('poem-body')) return;
        pyLibKicking = false;
        if (!ok) { popupMsg('拼音库加载失败，请联网后重试。', '好的'); return; }
        pref('py', '1');
        renderPoem(poem, seq);
        window.scrollTo(0, scrollTop);
      });
      return;
    }
    pref('py', want ? '1' : '0');
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  const stBtn = document.getElementById('st-btn');
  if (stBtn) stBtn.onclick = () => {
    pref('st', pref('st') === '1' ? '0' : '1');
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  const tyBtn = document.getElementById('ty-btn');
  if (tyBtn) tyBtn.onclick = () => {
    pref('ty', pref('ty') !== '0' ? '0' : '1');
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  const fnBtn = document.getElementById('fn-btn');
  if (fnBtn) fnBtn.onclick = () => {
    pref('fn', pref('fn') === '1' ? '0' : '1');
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  // 尝试背诵：从 ☰ 面板挪到正文末尾的操作条，跟「我能背诵」并排（2026-10-28）
  document.getElementById('rd-mask').onclick = () => {
    maskState = maskState ? null : { level: 'half' };
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  const maskLevelBtn = document.getElementById('mask-level');
  if (maskLevelBtn) maskLevelBtn.onclick = () => {
    maskState.level = maskState.level === 'half' ? 'all' : 'half';
    renderPoem(poem, seq);
    window.scrollTo(0, scrollTop);
  };
  const maskRevealBtn = document.getElementById('mask-reveal');
  if (maskRevealBtn) maskRevealBtn.onclick = () => {
    document.querySelectorAll('#poem-body .mask').forEach(el => el.classList.add('reveal'));
  };
  document.getElementById('tts-btn').onclick = () => toggleRead(poem, title);
  document.getElementById('fs-dec').onclick = () => stepFs(-1);
  document.getElementById('fs-inc').onclick = () => stepFs(1);
  document.getElementById('theme-btn').onclick = () => { toggleTheme(); renderPoem(poem, seq); };
  const autoBtn = document.getElementById('auto-btn');
  if (autoBtn) autoBtn.onclick = () => {
    pref('autoplay', pref('autoplay') === '1' ? '0' : '1');
    autoBtn.classList.toggle('on', pref('autoplay') === '1');
  };
  // 连播跳转进来的：渲染完自动开始朗诵
  if (window.__autoPlayId === poem.i && !readState) {
    window.__autoPlayId = null;
    setTimeout(() => { const b = document.getElementById('tts-btn'); if (b) b.click(); }, 350);
  }


  // 背诵模式：点击隐藏字揭示
  if (maskOn) {
    hideExcFab();
    const pb = document.getElementById('poem-body');
    pb.addEventListener('click', (e) => {
      const m = e.target.closest('.mask');
      if (m) m.classList.add('reveal');
    });
    // 键盘用户：Enter / Space 揭示当前聚焦的隐藏字（v192 可访问性）
    pb.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const m = e.target.closest && e.target.closest('.mask');
      if (m) { e.preventDefault(); m.classList.add('reveal'); }
    });
    return; // 背诵模式不绑脚注
  }

  // 脚注弹窗：app 级委托，标题与正文通用
  window.__fnNotes = fnOn ? notes : null;
  bindFnPopup();
  // 划选摘录：详情页可用
  bindExcerptCapture(poem);
  // 眉批：正文夹批 + 通览卡 + ☰「写眉批」的选点模式
  mountNotes(poem);
  // 本篇名句：mingju.json 反查（R9），异步插入，不阻塞首屏
  mountMingju(poem);
}

// ---------------- 眉批夹批：行下批语 + 逐行选点 ----------------
// 数据在 store 的 shici-notes 里（只存本机）；锚点是「净文 + 行号提示」，解析见 js/notes.js。
// 两个入口：
//   ① 行下已有的朱色「批」条 —— 点它改/删
//   ② ☰ 菜单「＋ 写眉批」进选点模式 —— 点任意一行新写
// 不用长按：长按在手机上会触发系统选词，和「划选摘录」直接打架。

let notePoemRef = null;      // 当前页的 poem（编辑器回调用）
let noteDismissBound = false;

function notesCardMarkup(poem) {
  const list = getNotes(poem.i);
  if (!list.length) return '';
  return '<div class="card" id="my-notes-card" data-fold>' +
    '<button type="button" class="fold-head" aria-expanded="false">我写的眉批<span class="gnum">' + list.length + '</span><span class="fold-btn">+</span></button>' +
    '<div class="fold-body">' + noteItemsHTML(poem) + '</div></div>';
}

function noteItemsHTML(poem) {
  const list = getNotes(poem.i);
  if (!list.length) return '';
  return list.map(n => '<button type="button" class="note-item" data-nid="' + n.id + '">' +
    '<span class="nq">' + esc(n.t) + '</span><span class="ns">' + esc(n.s) + '</span></button>').join('');
}

// 正文里的夹批：每条批注挂到它那一行下面（行号可能因字号/断句变化而漂，placeNotes 负责找回）
function paintNotes(poem) {
  const body = document.getElementById('poem-body');
  if (!body) return;
  body.querySelectorAll('.note-inline').forEach(e => e.remove());
  const notes = getNotes(poem.i);
  if (!notes.length) return;
  const { placed } = placeNotes(readLines, notes);
  const byLi = new Map();
  for (const p of placed) {
    const arr = byLi.get(p.li);
    if (arr) arr.push(p.note); else byLi.set(p.li, [p.note]);
  }
  for (const [li, arr] of byLi) {
    const line = body.querySelector('.line[data-li="' + li + '"]');
    if (!line) continue;
    line.insertAdjacentHTML('afterend', arr.map(n =>
      '<button type="button" class="note-inline" data-nid="' + n.id + '"><i>批</i><span>' + esc(n.s) + '</span></button>').join(''));
  }
}

function refreshNotes(poem) {
  paintNotes(poem);
  const list = getNotes(poem.i);
  const card = document.getElementById('my-notes-card');
  if (card) {
    if (!list.length) { card.remove(); return; }
    const g = card.querySelector('.gnum');
    if (g) g.textContent = list.length;
    const fb = card.querySelector('.fold-body');
    if (fb) fb.innerHTML = noteItemsHTML(poem);
    return;
  }
  // 本来是「还没有眉批」的页面：写完第一条要把通览卡补上
  if (list.length) {
    const nav = app.querySelector('.poem-nav');
    if (nav) nav.insertAdjacentHTML('beforebegin', notesCardMarkup(poem));
  }
}

function closeNoteEditor() {
  const pop = document.getElementById('note-pop');
  if (pop) { pop.classList.add('hidden'); pop.innerHTML = ''; }
}

function openNoteEditor(poem, target) {
  const pop = document.getElementById('note-pop');
  if (!pop) return;
  notePoemRef = poem;
  const list = getNotes(poem.i);
  const editing = target.id ? list.find(n => n.id === target.id) : null;
  if (target.id && !editing) return;                        // 批注已被别处删掉
  const li = editing ? editing.li : target.li;
  const t = editing ? editing.t : (target.t || '');
  pop.innerHTML =
    '<div class="np-card">' +
      '<div class="np-head">' + (editing ? '改这条眉批' : '写一条眉批') + '</div>' +
      '<div class="np-quote">' + (t ? '「' + esc(t) + '」' : '（这一行是空的）') + '</div>' +
      '<textarea id="np-ta" maxlength="500" placeholder="写一句批语，只存本机…">' + (editing ? esc(editing.s) : '') + '</textarea>' +
      '<div class="np-acts">' +
        (editing ? '<button type="button" class="np-del" id="np-del">删除</button>' : '') +
        '<button type="button" id="np-cancel">取消</button>' +
        '<button type="button" class="np-save" id="np-save">保存</button>' +
      '</div>' +
    '</div>';
  pop.classList.remove('hidden');
  const ta = document.getElementById('np-ta');
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 60);

  const save = () => {
    const s = ta.value.trim();
    if (!s) { closeNoteEditor(); return; }                   // 清空即放弃，不写空批
    if (editing) updateNote(poem.i, editing.id, s);
    else if (!addNote(poem.i, { li, t }, s)) {
      popupMsg('这一篇的眉批已满 60 条，删掉几条再写。', '好的');
      return;
    }
    closeNoteEditor();
    refreshNotes(poem);
  };
  document.getElementById('np-save').onclick = save;
  document.getElementById('np-cancel').onclick = closeNoteEditor;
  if (editing) {
    document.getElementById('np-del').onclick = () => {
      removeNote(poem.i, editing.id);
      closeNoteEditor();
      refreshNotes(poem);
    };
  }
  // Ctrl/⌘ + Enter 保存（手机上是「完成」键之外的补充）
  ta.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } };
}

function mountNotes(poem) {
  const body = document.getElementById('poem-body');
  if (!body) return;
  notePoemRef = poem;
  paintNotes(poem);

  // 从「我的眉批」页跳进来：#/p/123?n=<批注 id> —— 滚到那一条并闪一下
  const hit = (location.hash.match(/[?&]n=([^&]+)/) || [])[1];
  if (hit) {
    const nid = safeDecode(hit).replace(/["\\]/g, '');
    const el = [...body.querySelectorAll('.note-inline')].find(e => e.dataset.nid === nid) || null;
    if (el) {
      setTimeout(() => {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1800);
      }, 90);
    }
  }

  // 名句深链：#/p/123?v=<句> —— 滚到含该句的行并闪一下（R9，?n= 的同款机制）
  flashVerse();

  // 正文里的交互：点夹批 → 改；选点模式下点行 → 新写
  body.addEventListener('click', (e) => {
    const mk = e.target && e.target.closest ? e.target.closest('.note-inline') : null;
    if (mk) {
      e.preventDefault(); e.stopPropagation();
      openNoteEditor(poem, { id: mk.dataset.nid });
      return;
    }
    if (!body.classList.contains('note-mode')) return;
    const ln = e.target && e.target.closest ? e.target.closest('.line') : null;
    if (!ln) return;
    const li = parseInt(ln.dataset.li, 10);
    if (!Number.isFinite(li)) return;
    // 选点模式下点一行就是「写眉批」，别同时弹脚注浮窗（带「注」标记的句子会两个一起冒出来）
    e.stopPropagation();
    const fnPop = document.getElementById('fn-pop');
    if (fnPop) fnPop.classList.add('hidden');
    const seg = readLines[li];
    openNoteEditor(poem, { li, t: (seg && seg.t) || '' });
  }, true);

  // 通览卡里的条目：点开同一条
  const card = document.getElementById('my-notes-card');
  if (card) {
    card.addEventListener('click', (e) => {
      const it = e.target && e.target.closest ? e.target.closest('.note-item') : null;
      if (!it) return;
      openNoteEditor(poem, { id: it.dataset.nid });
    });
  }

  // 点浮层外面关掉
  if (!noteDismissBound) {
    noteDismissBound = true;
    document.addEventListener('pointerdown', (e) => {
      const pop = document.getElementById('note-pop');
      if (!pop || pop.classList.contains('hidden')) return;
      if (e.target && e.target.closest && e.target.closest('.np-card')) return;
      closeNoteEditor();
    });
  }
}

// ?v= 名句深链的定位（R9）：匹配两侧都过 normLine（去空白标点）+ simpStr（繁→简归一），
// 与眉批跨简繁锚定同款。一句名句可能横跨多个显示行（对句模式一行半句），
// 用 1~3 行滑窗拼接判包含；都不是再退回「行是句子的连续片段」（≥4 字才算，防误中短行）。
function flashVerse() {
  const hit = (location.hash.match(/[?&]v=([^&]+)/) || [])[1];
  if (!hit) return;
  const v = simpStr(normLine(safeDecode(hit)));
  if (!v) return;
  const body = document.getElementById('poem-body');
  if (!body) return;
  const nrm = readLines.map(r => simpStr(normLine(r && r.t)));
  let li = -1;
  for (let w = 1; w <= 3 && li < 0; w++) {
    for (let i = 0; i + w <= nrm.length; i++) {
      const joined = nrm.slice(i, i + w).join('');
      if (joined && joined.includes(v)) { li = i; break; }
    }
  }
  if (li < 0) {
    for (let i = 0; i < nrm.length; i++) {
      if (nrm[i].length >= 4 && v.includes(nrm[i])) { li = i; break; }
    }
  }
  if (li < 0) return;
  const el = body.querySelector('.line[data-li="' + li + '"]');
  if (!el) return;
  setTimeout(() => {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2400);
  }, 90);
}

// ---------------- 本篇名句（R9 反查）：标签块上方一张可复制小卡 ----------------
// mingju.json（约 1,884 条）按作品 id 建索引一次，之后内存复用；
// 首次进详情页才加载（KB 级 gzip），不阻塞首屏。

let mjByPoem = null;        // Map<id, rows[]>
let mjByPoemPromise = null;

function ensureMjByPoem() {
  if (mjByPoem) return Promise.resolve(mjByPoem);
  if (!mjByPoemPromise) {
    mjByPoemPromise = getMingju().then(rows => {
      mjByPoem = new Map();
      for (const r of rows) {
        if (!Array.isArray(r) || r[3] == null) continue;
        const arr = mjByPoem.get(r[3]);
        if (arr) arr.push(r); else mjByPoem.set(r[3], [r]);
      }
      return mjByPoem;
    }).catch(() => { mjByPoem = new Map(); mjByPoemPromise = null; return mjByPoem; });
  }
  return mjByPoemPromise;
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  } catch (e) { popupMsg('复制失败，请长按句子手动复制。', '好的'); }
}

function mountMingju(poem) {
  ensureMjByPoem().then(map => {
    // 异步回来时可能已翻到别的篇/别的页：id 对不上就不插
    if (curPoemId !== poem.i || !document.getElementById('read-done') || document.getElementById('poem-mj-card')) return;
    const rows = map.get(poem.i) || [];
    if (!rows.length) return;
    // 插在「读完了」块上方（读完了块与上一首/下一篇导航贴在最底部，别插到它们中间去）
    const anchor = document.getElementById('read-done');
    anchor.insertAdjacentHTML('beforebegin',
      '<div class="card" id="poem-mj-card" data-fold>' +
      '<button type="button" class="fold-head" aria-expanded="false">本篇名句<span class="gnum">' + rows.length + '</span><span class="fold-btn">+</span></button>' +
      '<div class="fold-body">' +
      rows.map(r => '<button type="button" class="mj-copy" data-v="' + esc(r[0]) + '">「' + esc(zhShow(r[0])) + '」</button>').join('') +
      '<div class="section-tip">点句子复制，分享给朋友。</div>' +
      '</div></div>');
    document.getElementById('poem-mj-card').addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.mj-copy') : null;
      if (!b) return;
      const text = b.dataset.v || '';
      const done = () => popupMsg('已复制\n「' + (text.length > 40 ? text.slice(0, 40) + '…' : text) + '」', '好的');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else fallbackCopy(text, done);
    });
  }).catch(() => {});
}

function setNoteMode(on) {
  const body = document.getElementById('poem-body');
  const btn = document.getElementById('note-btn');
  if (!body) return;
  body.classList.toggle('note-mode', !!on);
  if (btn) btn.classList.toggle('on', !!on);
  if (on && pref('nh') !== '1') {
    pref('nh', '1');
    popupMsg('点任意一行，写下这一句的批语。写完再点一次「写眉批」退出。', '知道了');
  }
}

// ---------------- 朗诵（Web Speech API → 手机系统 TTS） ----------------
// 朗读（服务端预生成 MP3 / `/api/tts` 队列）已下线，现在只用 speechSynthesis 说话。
// 三个平台坑（都实际踩过）：
//   ① iOS Safari 必须在本手势的同步栈里调用 speak()，异步回调里再 speak 会被静默拒绝
//      → 点击时先同步读一个空格「解锁」引擎，真正的正文随后排队。
//   ② 安卓 Chrome 单条超过约 15 秒会被截断 → 按句切成 ≤40 字的小块，句与句之间自然停顿。
//   ③ 首次 getVoices() 往往返回空数组，要等 voiceschanged；无中文嗓音时仍用默认嗓音 + lang='zh-CN'，
//      真不支持中文会在 onerror 里报 language-unavailable，那时才弹提示。
const READ_MAX = 40;
const SENT_RE = /[^。！？；：!?;:…]+[。！？；：!?;:…]*/g;

function readChunks(text) {
  const out = [];
  const parts = String(text || '').match(SENT_RE) || [];
  let buf = '';
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (buf && buf.length + t.length > READ_MAX) { out.push(buf); buf = ''; }
    buf += t;
    while (buf.length > READ_MAX) { out.push(buf.slice(0, READ_MAX)); buf = buf.slice(READ_MAX); }
  }
  if (buf) out.push(buf);
  return out;
}

function pickZhVoice() {
  const synth = window.speechSynthesis;
  if (!synth || !synth.getVoices) return null;
  const vs = synth.getVoices() || [];
  const lang = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  return vs.find(v => lang(v) === 'zh-cn')
      || vs.find(v => lang(v).startsWith('zh-hans'))
      || vs.find(v => lang(v).startsWith('zh'))
      || null;
}

// 正在读的那一行高亮（li < 0 表示标题/作者那一段，不对应正文行）
function markReading(li) {
  const bodyEl = document.getElementById('poem-body');
  if (!bodyEl) return;
  bodyEl.querySelectorAll('.line.reading').forEach(el => el.classList.remove('reading'));
  if (li == null || li < 0) return;
  const el = bodyEl.querySelector('.line[data-li="' + li + '"]');
  if (el) el.classList.add('reading');
}

function stopRead() {
  readState = null;
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  markReading(null);
  const btn = document.getElementById('tts-btn');
  if (btn) { btn.textContent = '♪ 朗诵'; btn.classList.remove('on'); }
}

function toggleRead(poem, title) {
  const btn = document.getElementById('tts-btn');
  const setBtn = (on) => { if (btn) { btn.textContent = on ? '■ 停止' : '♪ 朗诵'; btn.classList.toggle('on', on); } };
  if (readState && readState.poemId === poem.i) { stopRead(); return; }

  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) {
    hintRead('这个浏览器没有语音合成接口（speechSynthesis）。请改用 Chrome / Edge / Safari，或用系统的「朗读屏幕」功能。');
    return;
  }
  stopRead();

  // 队列：标题+作者 → 每行按句切块
  const queue = [];
  const head = [title, [poem.d, poem.a].filter(Boolean).join('·')].filter(Boolean).join('，');
  if (head) queue.push({ text: head, li: -1 });
  for (const seg of readLines) for (const c of readChunks(seg.t)) queue.push({ text: c, li: seg.li });
  if (!queue.length) return;

  readState = { poemId: poem.i, poem, queue, idx: 0, voice: null, spokenAny: false };
  setBtn(true);

  // ① iOS 解锁：必须在点击的同步栈里说一句
  try { synth.speak(new SpeechSynthesisUtterance(' ')); } catch (e) {}

  // 给 cancel() 一点收尾时间（Chrome 里 cancel 后立刻 speak 偶发被吞）
  const kickoff = () => setTimeout(() => { if (readState) speakNext(); }, 60);

  const voice = pickZhVoice();
  if (voice) { readState.voice = voice; kickoff(); return; }

  // ③ 语音表还没加载好：等 voiceschanged，最多 1.2 秒后照读
  let started = false;
  const start = () => {
    if (started || !readState) return;
    started = true;
    const v = pickZhVoice();
    if (v) readState.voice = v;
    kickoff();
  };
  const vs0 = synth.getVoices ? synth.getVoices() : [];
  if (vs0 && vs0.length) { start(); return; }
  if (synth.addEventListener) synth.addEventListener('voiceschanged', start, { once: true });
  else synth.onvoiceschanged = start;
  setTimeout(start, 1200);
}

function speakNext() {
  const st = readState;
  if (!st) return;
  const synth = window.speechSynthesis;
  if (!synth) { stopRead(); return; }
  if (st.idx >= st.queue.length) { finishRead(); return; }

  const item = st.queue[st.idx];
  const u = new SpeechSynthesisUtterance(item.text);
  if (st.voice) u.voice = st.voice;
  u.lang = 'zh-CN';
  u.rate = 0.82;        // 朗诵稍慢，句读更清楚
  u.pitch = 1;
  markReading(item.li);

  u.onend = () => {
    if (readState !== st) return;
    st.spokenAny = true;
    st.idx++;
    setTimeout(() => { if (readState === st) speakNext(); }, 110);   // 句间轻停
  };
  u.onerror = (ev) => {
    if (readState !== st) return;
    const err = ev && ev.error;
    if (err === 'interrupted' || err === 'canceled') return;
    // 一句都没读出来就失败 → 多半是这台机器的语音引擎没装好，给提示而不是静默跳过
    if (!st.spokenAny) { stopRead(); hintRead(readErrText(err)); return; }
    if (err === 'not-allowed') { stopRead(); hintRead('系统拒绝了语音播放，通常是页面没有拿到交互授权。请再点一次「朗诵」。'); return; }
    st.idx++;          // 读到一半的单块失败就跳过，别把整首中断
    setTimeout(() => { if (readState === st) speakNext(); }, 80);
  };
  try { synth.speak(u); } catch (e) { stopRead(); }
}

function finishRead() {
  const st = readState;
  stopRead();
  if (!st || pref('autoplay') !== '1') return;
  if (!st.spokenAny) return;      // 一句都没读出来（引擎坏了）就别连播，否则会一路空跳到下一篇
  if (st.poem && st.poem._navq) {
    // 连播跟队列（2026-11-01）：在阅读队列里向后走，走到头自然停
    (async () => {
      const cur = navCtxOf(st.poem.i);
      if (!cur) return;
      for (let p = cur.pos + 1; p < cur.q.ids.length; p++) {
        const pp = await getPoem(cur.q.ids[p]).catch(() => null);
        if (pp && !pp.hide) {
          const nid = pp.i != null ? pp.i : cur.q.ids[p];
          window.__autoPlayId = nid;
          location.hash = '#/p/' + nid;    // 连播：跳下一篇，渲染完自动接着读
          return;
        }
      }
    })();
    return;
  }
  const col = st.poem && st.poem._col;
  if (!col) return;
  // 连播跳过 hide:1 的下线记录（邻块多半已被空闲预取，代价近零）
  // 上界用 span（2026-11-01 P0-1）：尾区记录也要能连播，越界由 getPoem 返回 null 拦住
  (async () => {
    const span = col.span != null ? col.span : col.count;   // 旧 manifest 无 span 时退回 count
    let nid = st.poem.i + 1;
    for (let k = 0; k < 40 && nid < col.start + span; k++) {
      const p = await getPoem(nid).catch(() => null);
      if (p && !p.hide) {
        window.__autoPlayId = nid;
        location.hash = '#/p/' + nid;    // 连播：跳下一篇，渲染完自动接着读
        return;
      }
      nid++;
    }
  })();
}

// 不同浏览器的错误码不一样，翻成用户看得懂的下一步
function readErrText(err) {
  if (err === 'language-unavailable' || err === 'voice-unavailable') return undefined;   // 走默认文案（装中文语音）
  if (err === 'not-allowed') return '系统拒绝了语音播放，通常是页面没有拿到交互授权。请再点一次「朗诵」。';
  if (err === 'audio-busy') return '音频设备被其他应用占用，先关掉正在播放音乐/通话的应用再试。';
  if (err === 'synthesis-failed' || err === 'synthesis-unavailable' || err === 'audio-hardware') {
    return '系统语音引擎没有正常出声（' + (err || 'unknown') + '）。安卓：设置 → 系统 → 语言和输入法 → 文字转语音，选一个中文引擎；iPhone：设置 → 辅助功能 → 朗读内容，确认已下载中文嗓音。桌面浏览器若无音频设备也会这样。';
  }
  return undefined;
}

function hintRead(msg) {
  const text = msg || '没有可用的中文语音。安卓：设置 → 系统 → 语言和输入法 → 文字转语音，安装并选用中文引擎（如「语音服务」「Google 文字转语音」）；iPhone：设置 → 辅助功能 → 朗读内容 → 声音 → 中文，先下载一个中文嗓音。';
  const pop = popHost();       // 全站懒创建，任何页面都有浮窗可用
  pop.innerHTML = '<div class="fn-card"><div class="fn-term">朗诵不可用</div><div class="fn-expl">' + esc(text) + '</div><button class="fn-close">知道了</button></div>';
  pop.classList.remove('hidden');
  const close = pop.querySelector('.fn-close');
  if (close) close.onclick = (ev) => { ev.stopPropagation(); closePopup(pop); };
}

function stepFs(d) {
  const cur = parseInt(pref('fs') || '17');
  const next = Math.max(14, Math.min(24, cur + d));
  pref('fs', String(next));
  document.documentElement.style.setProperty('--fs', next + 'px');
}

// ---------------- 作者页 ----------------

export { maskState, tagsFold, readState, readLines, detailView, excFab, ensureExcFab, hideExcFab, cleanSelectionText, bindExcerptCapture, maskHTML, fnPopupBound, popDismissBound, __fnNotes, bindPopupDismiss, bindFnPopup, renderPoem, stopRead, toggleRead, stepFs };
