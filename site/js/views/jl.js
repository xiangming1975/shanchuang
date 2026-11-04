// 页面：接龙（#/jl）——你一句山窗一句，下句首字接上句尾字。
// 句库（2026-11-01）：data/idx/jl/<首字>.json —— etl/build-jl.mjs 构建期从全库
// 214.59 万首正文中抽分句（2–20 字、首字为汉字），按首字分文件；名句（mingju）优先
// 收录，其余蓄水池采样补足，每字上限 4000。接续与查验都只取「链字」这一份文件，
// IndexedDB 缓存，同字只取一次。jl-meta.json 载全部链字表（起句/续链择字用）。
// 规则：山窗以名句起链。你接的句须以链字（简繁变体均可）起头、且句库检得
//   （fhVerifyHit 从宽比对：整句相等 / 半句 / 两句连背）；未检得＝接不上，判负收局。
//   你接上后山窗接——句库接不上你句的尾字，山窗认输，这一链是你的。
// 得星：同飞花令/合璧——本局连续接上十句得一星（starsFor），此后每句一星，即记即存
//   jlstars；最高连对 jlbest、收局次数 jlrounds。随备份导出，首页行令卡展示。
import { app, topbar, emptyHtml, popupMsg, fhBare, fhVerifyHit, starsFor, sleep, HAN } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { pref, cachedText, getPoem, getMingju } from '../store.js';
import { esc } from '../py.js';
import { zhShow, queryVariants } from '../fn.js';

const JL_R = 3;              // 句库数据版本：重跑 etl/build-jl.mjs 后 +1（绕开 IndexedDB 旧缓存）
const JL_BEAT_MIN_MS = 1200; // 山窗接句前停的下限
const JL_BEAT_MAX_MS = 2600; // 上限
const HIST_SHOW = 10;        // 链上只显示最近这些（连对另记，不受影响）

// 首字 -> Promise<[[句, 作者, 题, id], ...]>，同字整页会话只取一次
// 发布瘦身（2026-11-03）：17,547 个字里 >=100KB 的 2,445 个仍是独立文件，其余 15,102 个
// 装进 64 个桶（桶号 = 字码 % 64）。meta.own 给出独立字清单，不在其中的去桶里按字取。
// 桶文件约 2MB，冷僻首字首次要多取一次；取过就走 IndexedDB。见 etl/pack-deploy-20261103.mjs。
const jlCache = new Map();
let jlOwn = null, jlBuckets = 64;
function loadJl(ch) {
  let p = jlCache.get(ch);
  if (p) return p;
  const alone = !jlOwn || jlOwn.has(ch);
  const url = alone
    ? 'data/idx/jl/' + encodeURIComponent(ch) + '.json?r=' + JL_R
    : 'data/idx/jl-b/' + ((ch.codePointAt(0) || 0) % jlBuckets) + '.json?r=' + JL_R;
  p = cachedText(url).then(t => {
    if (alone) return JSON.parse(t);
    const all = JSON.parse(t);
    return all[ch] || [];
  }).catch(() => { jlCache.delete(ch); return null; });
  jlCache.set(ch, p);
  return p;
}

// 句尾字（最后一个字；汉字才要，防标点/字母尾巴）
const tailChar = (s) => {
  const a = [...String(s || '')].filter(c => HAN.test(c));
  return a.length ? a[a.length - 1] : '';
};

async function jlView(seg, seq = currentRenderSeq()) {
  setAppHTML(seq, topbar('接龙', { back: true }) + '<div class="loading"></div>');
  // 链字表 + 名句库（起句用）
  let meta = null, mjRows = null;
  try {
    meta = JSON.parse(await cachedText('data/idx/jl-meta.json?r=' + JL_R));
  } catch { meta = null; }
  if (meta && meta.own) { jlOwn = new Set(meta.own); jlBuckets = meta.buckets || 64; }
  try { mjRows = await getMingju(); } catch { mjRows = null; }
  if (!isCurrent(seq)) return;
  if (!meta || !Array.isArray(meta.chars) || !meta.chars.length || !Array.isArray(mjRows) || !mjRows.length) {
    setAppHTML(seq, topbar('接龙', { back: true }) + emptyHtml('链', '句库未就绪<br>请刷新重试'));
    return;
  }
  const charSet = new Set(meta.chars);
  // 起句候选：名句半句，尾字得是可接的链字
  const starts = [];
  for (const r of mjRows) {
    for (const half of String(r[0] || '').split(/[，？！；]/)) {
      const s = half.trim();
      const t = tailChar(s);
      if ([...s].length >= 4 && t && charSet.has(t)) starts.push({ s, a: r[1], t: r[2], id: r[3] });
    }
  }
  if (!starts.length) {
    setAppHTML(seq, topbar('接龙', { back: true }) + emptyHtml('链', '起句题库拆解失败<br>请刷新重试'));
    return;
  }

  let streak = 0;          // 你本局连对（接上）的句数
  let over = false;
  let gameSeq = 0;
  let chainChar = '';      // 当前要接的字（上一句的尾字）
  let best = parseInt(pref('jlbest') || '0', 10) || 0;
  let stars = parseInt(pref('jlstars') || '0', 10) || 0;
  let rounds = parseInt(pref('jlrounds') || '0', 10) || 0;
  const used = new Set();  // 山窗接过的句不重出（本页会话内）
  const hist = [];         // 链：{ who, s, a, t, id } 或 { pending: true }
  const busy = { v: false };
  // 一局终了：真接过句（streak ≥ 1）才算局——只点开看看、随手重开不算
  const closeRound = () => { if (streak >= 1) { rounds++; pref('jlrounds', String(rounds)); } };

  setAppHTML(seq, topbar('接龙', { back: true }) + `
    <div class="card">
      <h2>诗词接龙</h2>
      <div class="section-tip" style="margin:4px 0 0">你一句山窗一句，下句首字接上句尾字。接不上链就断——拼的是谁的储备厚。共 ${meta.chars.length} 个起头字。</div>
      <div class="game-score" id="jl-score"></div>
    </div>
    <div id="jl-board"><div class="loading"></div></div>`);

  const scoreEl = document.getElementById('jl-score');
  const board = document.getElementById('jl-board');
  const paintScore = () => {
    scoreEl.innerHTML = `接字 <b>${chainChar}</b> · 连对 <b>${streak}</b> · 最高 <b>${best}</b>` + (stars ? ` · ★ <b>${stars}</b>` : '');
  };

  const verseCard = (h) => h.pending
    ? `<div class="card"><div class="fh-who">山窗</div><div class="fh-sent fh-dim">${h.q || '拈句中…'}</div></div>`
    : h.fail
      ? `<div class="card"><div class="fh-who">${h.who}</div>` +
        `<div class="fh-sent fh-dim">${esc(zhShow(h.s))}</div>` +
        `<div class="fh-src">句库未检得——接不上，输了这一局</div></div>`
      : `<div class="card"><div class="fh-who">${h.who}</div>` +
        `<div class="fh-sent">${esc(zhShow(h.s))}</div>` +
        `<div class="fh-src">——${h.a ? esc(zhShow(h.a)) + ' ' : ''}《${esc(zhShow(h.t))}》${h.id != null ? ` <a href="#/p/${encodeURIComponent(String(h.id))}">读全诗</a>` : ''}</div></div>`;

  // 收局报告：不判胜负，只夸你连出的句数、再鼓劲（同飞花令，2026-11-01）
  const reportHtml = (extra) => `
    <div class="card">
      ${extra ? `<div class="hb-up">${extra}</div>` : ''}
      <div class="hb-up">${streak >= 1
        ? `这一链你连出了 <b>${streak}</b> 句，句句相扣，好身手，山窗佩服！`
        : '这一句还没接上不打紧，腹笥仍在，缓口气再来。'}</div>
      <div class="section-tip" style="text-align:center">歇口气，缓过神来再接再厉，山窗候着。</div>
      <div class="game-foot"><button type="button" class="set-toggle" id="jl-again">另起一链</button></div>
    </div>`;

  const inputHtml = () => `
    <div class="card">
      <div class="fh-input">
        <input id="jl-in" placeholder="以「${chainChar}」起头接一句" autocomplete="off">
        <button type="button" class="lucky" id="jl-go">接链</button>
      </div>
      <div class="section-tip" id="jl-status" style="margin:6px 0 0">下句以「${chainChar}」起头。山窗全库查验；检得记分，未检得即输掉本局。</div>
      <div class="game-foot"><button type="button" class="set-toggle" id="jl-stuck">休息一下，收局</button></div>
    </div>`;

  const renderBoard = () => {
    // 重画会重建输入框：读者先打进去、还没提交的字别丢
    const keepInp = (!over && document.getElementById('jl-in')) || null;
    const keep = keepInp ? keepInp.value : '';
    board.innerHTML = hist.slice(-HIST_SHOW).map(verseCard).join('') + (over ? reportHtml(reportExtra) : inputHtml());
    if (keep) { const ki = document.getElementById('jl-in'); if (ki) ki.value = keep; }
    if (over) {
      const again = document.getElementById('jl-again');
      if (again) again.onclick = () => {
        streak = 0; over = false; gameSeq++; hist.length = 0; used.clear();
        reportExtra = '';
        paintScore();
        openChain();
      };
      return;
    }
    const inp = document.getElementById('jl-in');
    const go = document.getElementById('jl-go');
    const stuck = document.getElementById('jl-stuck');
    if (go) go.onclick = answer;
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') answer(); };
    if (stuck) stuck.onclick = () => {
      if (busy.v) return;
      over = true;
      closeRound();
      paintScore();
      renderBoard();
    };
  };

  let reportExtra = '';

  // 山窗认输 / 接不上时的收局
  const endRound = (extra) => {
    over = true;
    closeRound();
    reportExtra = extra || '';
    paintScore();
    renderBoard();
  };

  async function answer() {
    if (busy.v || over) return;
    const seq = gameSeq;
    const inp = document.getElementById('jl-in');
    const raw = (inp && inp.value ? inp.value : '').trim();
    if ([...raw].length < 2) { popupMsg('句太短，不像一句诗'); return; }
    // 首字须接上链字（简繁变体均可）
    const first = [...raw][0];
    const chainOk = [chainChar, ...queryVariants(chainChar)].includes(first);
    if (!chainOk) { popupMsg('接句须以「' + chainChar + '」起头'); return; }
    busy.v = true;
    if (inp) inp.value = '';
    const go = document.getElementById('jl-go');
    const status = document.getElementById('jl-status');
    if (go) go.textContent = '查验中…';
    if (status) status.textContent = '句库查验中…';
    const bare = fhBare(raw);
    const vs = [...new Set([bare, ...queryVariants(bare)])].filter(Boolean);
    const rows = await loadJl(chainChar);
    const hit = rows && rows.length ? fhVerifyHit(rows, vs) : null;
    busy.v = false;
    if (seq !== gameSeq) return;    // 查验期间已重开：这一句属旧局，丢弃
    if (go) go.textContent = '接链';
    if (status) status.textContent = `下句以「${chainChar}」起头。山窗全库查验；检得记分，未检得即输掉本局。`;
    if (!hit) {
      // 接不上＝输：亮出没接上的这句，就地终了本局
      endRound('');
      hist.push({ who: '你', s: raw, fail: true });
      renderBoard();
      return;
    }
    streak++;
    if (streak > best) { best = streak; pref('jlbest', String(best)); }
    if (streak >= 10) { stars++; pref('jlstars', String(stars)); }   // 连续接上十句得一星，此后每句一星
    hist.push({ who: '你', s: raw, a: hit[1], t: hit[2], id: hit[3] });
    paintScore();
    renderBoard();                  // 先亮出你这句，缓冲这会儿正好读读出处
    aiTurn(tailChar(raw), seq);
  }

  // 山窗接句：接 tail 字（你这句的尾字）；接不上＝认输
  async function aiTurn(tail, seq) {
    busy.v = true;                  // 缓冲期间接链、收局都按下不动
    const qi = hist.length;
    hist.push({ pending: true, who: '山窗' });
    renderBoard();
    const beatMs = JL_BEAT_MIN_MS + Math.floor(Math.random() * (JL_BEAT_MAX_MS - JL_BEAT_MIN_MS + 1));
    const rows = await loadJl(tail);
    await sleep(beatMs);
    busy.v = false;
    if (seq !== gameSeq || over) return;    // 缓冲期间已重开/收局：旧局作废
    hist.splice(qi, 1);
    if (!rows || !rows.length) {
      // 山窗接不上这一字：这一链是你的
      endRound('连到山窗接不上——这一链又长又稳，山窗认了！');
      return;
    }
    let pick = null;
    for (let k = 0; k < 40; k++) {
      const r = rows[Math.floor(Math.random() * rows.length)];
      if (!r || !r[0] || used.has(r[0])) continue;
      if (!charSet.has(tailChar(r[0]))) continue;   // 挑尾字可续的，别把链引向死角
      pick = r;
      break;
    }
    if (!pick) { endRound('连到山窗接不上——这一链又长又稳，山窗认了！'); return; }
    used.add(pick[0]);
    hist.push({ who: '山窗', s: pick[0], a: pick[1], t: pick[2], id: pick[3] });
    chainChar = tailChar(pick[0]);
    paintScore();
    renderBoard();
  }

  // 起链：名句里挑一句没起过的
  function openChain() {
    let st = null;
    for (let k = 0; k < 60; k++) {
      const c = starts[Math.floor(Math.random() * starts.length)];
      if (c && !used.has(c.s)) { st = c; break; }
    }
    if (!st) st = starts[Math.floor(Math.random() * starts.length)];
    used.add(st.s);
    chainChar = tailChar(st.s);
    hist.push({ who: '山窗', s: st.s, a: st.a, t: st.t, id: st.id });
    paintScore();
    renderBoard();
  }

  openChain();
}

export { jlView };
