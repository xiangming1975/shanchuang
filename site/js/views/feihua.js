// 页面：飞花令（#/fh）——「春城无处不飞花」（韩翃《寒食》），唐人酒令「飞花」自此得名。
// 定一字为令，山窗与你轮流出句，句中须含令字；休息即收局，单局最高应令数存偏好 fhbest。
// 得星（2026-10-31 调整）：本局连续接上十句才得一星（starsFor），此后每多接一句再加一星，
//   即记即存偏好 fhstars；正式收过一局的次数记 fhrounds。两者随备份导出，首页行令卡展示。
// 答后缓冲（2026-10-31 调整）：应令命中后先亮出你这句（出处可读），山窗停随机二到四秒
//   （FH_BEAT_MIN_MS–FH_BEAT_MAX_MS）才回句；停的这口气里随机念叨夸你厉害 / 自承压力大、
//   快要输了（FH_QUIPS）。缓冲期间应令、收局、换令都按下不动。
// 序号（2026-10-31）：令来令往里各自的应令带序号（中文数字，cnNum）——你那句在左、山窗那句在右。
// 判负（2026-10-31）：应令全库未检得＝接不上，即输掉这一局、就地收局（此前只是不计、可继续）。
// 不重出（2026-11-01）：本局双方出过的句都不能再应——应令先与本局已出的句从宽比对
//   （fhVerifyHit 同口径：整句/半句/连背，简繁互通），重出即拦下提示换句，不计分也不判负；
//   山窗出句同样避开双方出过的句（旧版只避开自己出过的，且「另起一局」忘了清账，上一局的句也误记成出过）。
//
// 语料（2026-10-31 v2）：data/idx/fh/<令字>.json —— etl/build-fhsents.cjs 构建期从
// 全部集合的正文块（含《全唐诗》《全宋诗》全量 64 万首）抽出含令字的分句（3–24 字，
// 与 fhSentences 同规则），按 20 令字分文件。出句与应令查验都只用当前令字这一份：
//   一次下载约 1–4MB（IndexedDB 缓存，同令字只取一次），不再逐个扫 41 个 ft 分片。
//   旧版扫 ft 全文语料：ft 对全唐宋诗只收名家子集（全唐诗 56255 首只收 5062 首），
//   「我寄愁心与明月」这类只见于《全唐诗》的句子永远查不到（用户实测反馈）。
// 简繁：句库存原文写法（繁简并存），输入经 queryVariants 补出另一写法，
//   双方去句尾标点后按 fhVerifyHit 从宽比对（整句相等 / 半句 / 两句连背都算中）。
import { app, topbar, emptyHtml, popupMsg, fhBare, fhVerifyHit, starsFor, cnNum, sleep } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { pref, cachedText, getPoem } from '../store.js';
import { esc } from '../py.js';
import { zhShow, queryVariants } from '../fn.js';

const FEI_CHARS = ['花', '月', '风', '雪', '春', '秋', '云', '雨', '山', '水', '江', '天', '夜', '酒', '人', '心', '情', '愁', '梦', '寒'];
const HIST_SHOW = 10;   // 令来令往只显示最近这些，再往上翻不到了（比分另记，不受影响）
const FH_R = 3;         // 句库数据版本：重跑 etl/build-fhsents.cjs 后 +1（绕开 IndexedDB 旧缓存）
const FH_BEAT_MIN_MS = 2000;  // 山窗回句前停的下限（2026-10-31：随机二到四秒，先前固定一秒）
const FH_BEAT_MAX_MS = 4000;  // 上限
// 缓冲期山窗的念叨：夸对方厉害 / 诗词量大，自承压力大 / 快要输掉——四类混着随机出
const FH_QUIPS = [
  '好句！接得又快又稳', '这句都接得上，失敬失敬', '厉害，一字不差',
  '你这一肚子诗，怕不是背完了《全唐诗》？', '好大的诗词量，山窗自愧不如', '这储量，输得不冤',
  '容我缓缓……压力陡增', '山窗额头见汗了', '这口气接得我心惊肉跳',
  '再接下去，我怕是要输了', '不好，山窗快顶不住了', '眼看要败，容我挣扎一番'
];

// 令字 → Promise<[[句, id], ...]>，同一令字整页会话只取一次
// 发布瘦身（2026-11-03）：<令字>.json 曾单文件 75.9MB（超托管方 25MiB 上限），现拆成
//   ① <令字>-seed.json   等距抽的 3 万句，只供「山窗出句」——进页面先拿它，秒开；
//   ② <令字>-pN.json     全量分片（每片 <=18MB），只供「应令查验」；
//   ③ index.json         sizes[令字] = {n, parts, seed}。
// 查验仍扫全量，判定口径与拆分前完全一致；seed 只影响随机出句的取样池。
const fhCache = new Map();
let fhIdx = null;
let warmTimer = null;   // 预热 setTimeout 的 id（换令 / 视图卸载时 clearTimeout，v192）
async function getFhIndex() {
  if (!fhIdx) fhIdx = JSON.parse(await cachedText('data/idx/fh/index.json?r=' + FH_R));
  return fhIdx;
}
function loadFhSeed(ch) {
  const k = 's:' + ch;
  let p = fhCache.get(k);
  if (!p) {
    p = cachedText('data/idx/fh/' + encodeURIComponent(ch) + '-seed.json?r=' + FH_R)
      .then(t => JSON.parse(t))
      .catch(() => { fhCache.delete(k); return null; });
    fhCache.set(k, p);
  }
  return p;
}
function loadFhAll(ch) {
  const k = 'a:' + ch;
  let p = fhCache.get(k);
  if (!p) {
    p = (async () => {
      const idx = await getFhIndex();
      const meta = (idx.sizes || {})[ch];
      const parts = (meta && meta.parts) || 1;
      const arrs = await Promise.all(Array.from({ length: parts }, (_, i) =>
        cachedText('data/idx/fh/' + encodeURIComponent(ch) + '-p' + i + '.json?r=' + FH_R).then(t => JSON.parse(t))));
      return arrs.reduce((a, b) => a.concat(b), []);
    })().catch(() => { fhCache.delete(k); return null; });
    fhCache.set(k, p);
  }
  return p;
}

// 出句：从当前令字的句库里随机抽一句本局没出过的（双方出过的都避开，2026-11-01）
async function aiMove(ch, isPlayed) {
  const rows = await loadFhSeed(ch);
  if (!rows || !rows.length) return null;
  for (let k = 0; k < 40; k++) {
    const r = rows[Math.floor(Math.random() * rows.length)];
    if (r && r[0] && !isPlayed(r[0])) return { s: r[0], id: r[1] };
  }
  return null;
}

// 应令查验：句库行与输入简繁变体从宽比对（fhVerifyHit），命中返回出处
async function verifyMove(input, ch) {
  const rows = await loadFhAll(ch);
  if (!rows || !rows.length) return null;
  const bare = fhBare(input);
  if (!bare) return null;
  const vs = new Set([bare, ...queryVariants(bare)]);
  const variants = [...vs].filter(Boolean);
  const hit = fhVerifyHit(rows, variants);
  return hit ? { s: input, id: hit[1] } : null;
}

async function feihuaView(seg, seq = currentRenderSeq()) {
  if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }   // 重新进入视图：撤掉上一次的预热
  setAppHTML(seq, topbar('飞花令', { back: true }) + '<div class="loading"></div>');
  let ch = FEI_CHARS[Math.floor(Math.random() * FEI_CHARS.length)];
  const warm = await loadFhSeed(ch);   // 只等样本（约 1MB），全量分片留给后台
  if (!isCurrent(seq)) return;
  if (!warm) {
    setAppHTML(seq, topbar('飞花令', { back: true }) + emptyHtml('令', '句库未就绪<br>请刷新重试'));
    return;
  }
  // 应令要扫全量（与拆分前同一口径）：页面一出来就在后台预热，等你打出第一句时多半已就位
  warmTimer = setTimeout(() => { warmTimer = null; if (isCurrent(seq)) loadFhAll(ch).catch(() => {}); }, 1200);

  let my = 0, ai = 0;
  let over = false;
  let gameSeq = 0;          // 局号：换令/重开 +1，飞行中的旧局出句/查验回来发现对不上就丢弃
  let best = parseInt(pref('fhbest') || '0', 10) || 0;
  let stars = parseInt(pref('fhstars') || '0', 10) || 0;    // 累计星数（跨局），即得即存
  let rounds = parseInt(pref('fhrounds') || '0', 10) || 0;  // 正式收过局的次数
  const hist = [];          // 令来令往：{ who, s, t, a, id } 或 { pending: true }
  // 本局已出过的句（双方）：从 hist 现算，与查验同一口径（fhBare 去句尾标点 + queryVariants
  // 补简繁 + fhVerifyHit 从宽比对）——半句/连背的重出同样算重。
  // 换令/另起一局清了 hist 即自动重置，不再有旧版「另起一局忘清账」的残留。
  const playedRows = () => hist.filter(h => !h.pending && !h.fail && h.s).map(h => [h.s, h.id]);
  const isPlayed = (input) => {
    const bare = fhBare(input);
    if (!bare) return false;
    const rows = playedRows();
    if (!rows.length) return false;
    return !!fhVerifyHit(rows, [...new Set([bare, ...queryVariants(bare)])].filter(Boolean));
  };
  const busy = { v: false };
  // 一局终了：真接过句（my ≥ 1）才算局——只点开看看、随手换令不算
  const closeRound = () => { if (my >= 1) { rounds++; pref('fhrounds', String(rounds)); } };

  setAppHTML(seq, topbar('飞花令', { back: true }) + `
    <div class="card">
      <h2>飞花令</h2>
      <div class="section-tip" style="margin:4px 0 0">「春城无处不飞花」——韩翃《寒食》，唐人酒令「飞花」自此得名。定一字为令，句句须含令字，山窗与你轮流出句。</div>
      <div class="group-title">拈令</div>
      <div class="tagrow" id="fh-chars">${FEI_CHARS.map(c => `<button type="button" data-ch="${c}"${c === ch ? ' class="on"' : ''}>${c}</button>`).join('')}</div>
      <div class="game-score" id="fh-score"></div>
    </div>
    <div id="fh-board"><div class="loading"></div></div>`);

  const scoreEl = document.getElementById('fh-score');
  const board = document.getElementById('fh-board');
  const paintScore = () => {
    scoreEl.innerHTML = `你 <b>${my}</b> · 山窗 <b>${ai}</b>` + (best ? ` · 单局最高 <b>${best}</b>` : '') + (stars ? ` · ★ <b>${stars}</b>` : '');
  };
  paintScore();

  // 应令序号：各自的第几句，中文数字——缀在卡片两端，你在左、山窗在右（2026-10-31）
  const ord = (h) => h.k ? `<span class="fh-ord fh-ord-${h.who === '你' ? 'l' : 'r'}">${cnNum(h.k)}</span>` : '';
  // 对局卡片一左一右（2026-11-01）：山窗在左、你在右，像对坐行令；短句随内容缩窄（CSS fit-content）
  const verseCard = (h) => {
    const side = h.who === '你' ? 'fh-right' : 'fh-left';
    return h.pending
      ? `<div class="card fh-left"><div class="fh-who">山窗</div><div class="fh-sent fh-dim">${h.q || '拈句中…'}</div></div>`
      : h.fail
        ? `<div class="card ${side}"><div class="fh-who">${h.who}</div>` +
          `<div class="fh-sent fh-dim">${ord(h)}${esc(zhShow(h.s))}</div>` +
          `<div class="fh-src">此句全库未检得——接不上，输了这一局</div></div>`
        : `<div class="card ${side}"><div class="fh-who">${h.who}</div>` +
          `<div class="fh-sent">${ord(h)}${esc(zhShow(h.s))}</div>` +
          (h.t ? `<div class="fh-src">——《${esc(zhShow(h.t))}》${esc(zhShow(h.a || ''))}${h.id != null ? ` <a href="#/p/${encodeURIComponent(String(h.id))}">读全诗</a>` : ''}</div>` : '') +
          `</div>`;
  };

  const inputHtml = () => `
    <div class="card">
      <div class="fh-input">
        <input id="fh-in" placeholder="出一句含「${ch}」的诗" autocomplete="off">
        <button type="button" class="lucky" id="fh-go">应令</button>
      </div>
      <div class="section-tip" id="fh-status" style="margin:6px 0 0">句中须含令字、本局没出过；山窗全库查验，检得记分，未检得即输掉本局。</div>
      <div class="game-foot"><button type="button" class="set-toggle" id="fh-stuck">休息一下，收局</button></div>
    </div>`;

  // 收局报告：不比分数，只夸你这一局连出的句数、再鼓劲（2026-10-31）
  const reportHtml = () => `
    <div class="card">
      <div class="hb-up">${my >= 1
        ? `这一局你连续对出了 <b>${my}</b> 句，句句有来历，好身手，山窗佩服！`
        : '开句未接上不打紧，腹笥仍在，缓口气再来。'}</div>
      <div class="section-tip" style="text-align:center">歇口气，缓过神来再接再厉，山窗候着。</div>
      <div class="game-foot"><button type="button" class="set-toggle" id="fh-again">另起一局</button></div>
    </div>`;

  const renderBoard = () => {
    // 重画会重建输入框：读者先打进去、还没提交的字别丢（山窗回句重画时保得住）
    const keepInp = (!over && document.getElementById('fh-in')) || null;
    const keep = keepInp ? keepInp.value : '';
    board.innerHTML = hist.slice(-HIST_SHOW).map(verseCard).join('') + (over ? reportHtml() : inputHtml());
    if (keep) { const ki = document.getElementById('fh-in'); if (ki) ki.value = keep; }
    if (over) {
      const again = document.getElementById('fh-again');
      if (again) again.onclick = () => { my = 0; ai = 0; over = false; gameSeq++; hist.length = 0; paintScore(); aiTurn(); };
      return;
    }
    const inp = document.getElementById('fh-in');
    const go = document.getElementById('fh-go');
    const stuck = document.getElementById('fh-stuck');
    if (go) go.onclick = answer;
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') answer(); };
    if (stuck) stuck.onclick = () => {
      if (busy.v) return;
      over = true;
      closeRound();
      if (my > best) { best = my; pref('fhbest', String(best)); }
      paintScore();
      renderBoard();
    };
  };

  async function answer() {
    if (busy.v || over) return;
    const seq = gameSeq;
    const inp = document.getElementById('fh-in');
    const raw = (inp && inp.value ? inp.value : '').trim();
    if ([...raw].length < 2) { popupMsg('句太短，不像一句诗'); return; }
    const cs = [...new Set(queryVariants(ch))];
    if (!cs.some(c => raw.includes(c))) { popupMsg('句中须含令字「' + ch + '」'); return; }
    // 不重出：本局双方出过的句都不能再应（重出不算输，换一句再来）
    if (isPlayed(raw)) { popupMsg('这句这一局已经出过了——双方出过的句都不能再应，换一句吧'); return; }
    busy.v = true;
    if (inp) inp.value = '';   // 三关都过才算提交：先清空，山窗回句重画后不残留
    const go = document.getElementById('fh-go');
    const status = document.getElementById('fh-status');
    if (go) go.textContent = '查验中…';
    if (status) status.textContent = '句库查验中…';
    const v = await verifyMove(raw, ch);
    busy.v = false;
    if (seq !== gameSeq) return;    // 查验期间已换令/重开：这一句属旧局，丢弃
    if (go) go.textContent = '应令';
    if (status) status.textContent = '句中须含令字、本局没出过；山窗全库查验，检得记分，未检得即输掉本局。';
    if (!v) {
      // 接不上＝输：亮出没接上的这句，就地终了本局（2026-10-31，此前未检得只是不计）
      over = true;
      closeRound();
      hist.push({ who: '你', s: raw, k: my + 1, fail: true });
      paintScore();
      renderBoard();
      return;
    }
    my++;
    if (my > best) { best = my; pref('fhbest', String(best)); }
    if (my >= 10) { stars++; pref('fhstars', String(stars)); }   // 连续接上十句得一星，此后每句一星
    const p = await getPoem(v.id).catch(() => null);
    if (seq !== gameSeq) return;    // 取出处期间换令/另起：这句属旧局，不进新局
    hist.push({ who: '你', s: v.s, t: p ? p.t : '', a: p ? p.a : '', id: v.id, k: my });
    paintScore();
    renderBoard();                  // 先亮出你这句，缓冲这几秒正好读读出处
    // 缓冲随机二到四秒：山窗先随机念叨一句（夸你 / 诉苦），长一点的中途还换一句，然后才回句
    busy.v = true;                  // 缓冲期间应令、收局、换令都按下不动（2026-10-31）
    const beatMs = FH_BEAT_MIN_MS + Math.floor(Math.random() * (FH_BEAT_MAX_MS - FH_BEAT_MIN_MS + 1));
    const qi = hist.length;
    hist.push({ pending: true, who: '山窗', q: FH_QUIPS[Math.floor(Math.random() * FH_QUIPS.length)] });
    renderBoard();
    setTimeout(() => {   // 念叨别挂满全场：一秒二后换下一句（仍在缓冲内才换）
      if (seq !== gameSeq || over || !hist[qi] || !hist[qi].pending || qi !== hist.length - 1) return;
      let next = hist[qi].q;
      while (next === hist[qi].q) next = FH_QUIPS[Math.floor(Math.random() * FH_QUIPS.length)];
      hist[qi].q = next;
      renderBoard();
    }, Math.min(1200, beatMs - 200));
    await sleep(beatMs);
    busy.v = false;
    if (seq !== gameSeq || over) return;
    hist.splice(qi, 1);   // 念叨完撤下，轮到山窗出句
    aiTurn();
  }

  async function aiTurn() {
    const seq = gameSeq;
    hist.push({ pending: true, who: '山窗' });
    renderBoard();
    const v = await aiMove(ch, isPlayed);
    if (seq !== gameSeq) return;    // 换令/重开后旧局作废：不 pop、不 push、不重画
    hist.pop();
    if (v) {
      const p = await getPoem(v.id).catch(() => null);
      if (seq !== gameSeq) return;
      ai++;
      hist.push({ who: '山窗', s: v.s, t: p ? p.t : '', a: p ? p.a : '', id: v.id, k: ai });
    }
    paintScore();
    renderBoard();
  }

  for (const b of document.querySelectorAll('#fh-chars button')) {
    b.onclick = async () => {
      if (busy.v || b.dataset.ch === ch) return;
      if (!over) closeRound();    // 打到一半换令＝弃局：也算终了一局（没接过句则不计）
      ch = b.dataset.ch;
      gameSeq++;
      if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }   // 换令：撤掉上一个令字的预热
      warmTimer = setTimeout(() => { warmTimer = null; if (isCurrent(seq)) loadFhAll(ch).catch(() => {}); }, 1200);
      for (const x of document.querySelectorAll('#fh-chars button')) x.classList.toggle('on', x === b);
      my = 0; ai = 0; over = false;
      hist.length = 0;   // 双方出过的句随 hist 一并清账
      paintScore();
      aiTurn();
    };
  }

  aiTurn();
}

export { feihuaView };
