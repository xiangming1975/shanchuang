// 页面：补字（#/bz）——名句挖去一字，四选一补回原句。
// 题库：idx/mingju.json 拆出的上下半句（与合璧同源）；挖字位只取汉字位（bzHolePositions），
//   干扰字从「同长度句同一位置」出现过的字里挑（quizOptions）——同位字才像真的，
//   池子不够时兜底全库字表。
// 记分：同合璧——连对即时判定，选错归零断局；连续十对得一星（starsFor），此后每对一星，
//   即记即存 bzstars；最高连对 bzbest、收局次数 bzrounds。随备份导出，首页行令卡展示。
// 节奏：同合璧——答完看出处，点「下一题」，山窗沉吟一秒（BZ_BEAT_MS）再出题。
import { app, topbar, emptyHtml, splitMingjuPair, quizOptions, starsFor, bzHolePositions } from '../vcommon.js';
import { pref, getMingju } from '../store.js';
import { esc } from '../py.js';
import { zhShow } from '../fn.js';

const RECENT = 24;   // 最近出过的题不重出
const BZ_BEAT_MS = 1000;
const HAN = /[\u3400-\u9fff]/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function bzView() {
  app.innerHTML = topbar('补字', { back: true }) + '<div class="loading"></div>';
  let rows = null;
  try { rows = await getMingju(); } catch { rows = null; }
  if (!Array.isArray(rows) || !rows.length) {
    app.innerHTML = topbar('补字', { back: true }) + emptyHtml('字', '名句索引未就绪<br>请刷新重试');
    return;
  }
  const bank = [];
  for (const r of rows) {
    const pair = splitMingjuPair(r[0]);
    if (pair) { bank.push({ s: pair[0], a: r[1], t: r[2], id: r[3] }, { s: pair[1], a: r[1], t: r[2], id: r[3] }); }
  }
  if (!bank.length) {
    app.innerHTML = topbar('补字', { back: true }) + emptyHtml('字', '题库拆解失败<br>请刷新重试');
    return;
  }
  // 同位字池：`长度:位置` -> 字集合；另有全库字表兜底
  const posChars = new Map();
  const allChars = new Set();
  for (const b of bank) {
    const a = [...b.s];
    for (let i = 0; i < a.length; i++) {
      if (!HAN.test(a[i])) continue;
      allChars.add(a[i]);
      const k = a.length + ':' + i;
      let st = posChars.get(k);
      if (!st) { st = new Set(); posChars.set(k, st); }
      st.add(a[i]);
    }
  }

  let streak = 0;
  let best = parseInt(pref('bzbest') || '0', 10) || 0;
  let stars = parseInt(pref('bzstars') || '0', 10) || 0;
  let rounds = parseInt(pref('bzrounds') || '0', 10) || 0;
  const recent = [];

  app.innerHTML = topbar('补字', { back: true }) + `
    <div class="card">
      <h2>补字成诗</h2>
      <div class="section-tip" style="margin:4px 0 0">名句缺一字，四选一补回原句——出处是提示，记性是本事。共 ${bank.length} 句。</div>
      <div class="game-score" id="bz-score"></div>
    </div>
    <div id="bz-round"><div class="loading"></div></div>`;

  const scoreEl = document.getElementById('bz-score');
  const roundEl = document.getElementById('bz-round');
  const paintScore = () => { scoreEl.innerHTML = `连对 <b>${streak}</b> · 最高 <b>${best}</b>` + (stars ? ` · ★ <b>${stars}</b>` : ''); };
  paintScore();

  let q = null;
  let answered = false;

  // 展示：挖空的句（hole 处画虚线空位；reveal 时填回原字）
  const verseHtml = (s, hole, reveal) => [...s].map((c, i) =>
    i === hole
      ? `<span class="bz-blank">${reveal ? esc(zhShow(c)) : '□'}</span>`
      : esc(zhShow(c))
  ).join('');

  const nextRound = () => {
    let k = 0;
    do { k = Math.floor(Math.random() * bank.length); } while (recent.includes(k) && bank.length > RECENT);
    recent.push(k);
    if (recent.length > RECENT) recent.shift();
    const v = bank[k];
    const holes = bzHolePositions(v.s);
    if (!holes.length) { nextRound(); return; }
    const hole = holes[Math.floor(Math.random() * holes.length)];
    const a = [...v.s];
    const correct = a[hole];
    const pool = [...(posChars.get(a.length + ':' + hole) || [])];
    const opts = quizOptions(correct, pool.length >= 4 ? pool : [...pool, ...allChars], 4);
    q = { v, hole, correct, opts };
    answered = false;
    roundEl.innerHTML = `
      <div class="card">
        <div class="bz-verse" id="bz-verse">${verseHtml(v.s, hole, false)}</div>
        <div class="hb-hint" id="bz-hint"></div>
        <div class="opt-list" id="bz-opts">
          ${q.opts.map((o, i) => `<button type="button" class="opt-btn" data-i="${i}">${esc(zhShow(o))}</button>`).join('')}
        </div>
        <div class="game-foot">
          <button type="button" class="set-toggle" id="bz-hintbtn">看提示</button>
        </div>
      </div>`;
    document.getElementById('bz-hintbtn').onclick = () => {
      document.getElementById('bz-hint').innerHTML = esc(zhShow(v.a)) + '《' + esc(zhShow(v.t)) + '》';
    };
    for (const btn of roundEl.querySelectorAll('.opt-btn')) {
      btn.onclick = () => {
        if (answered) return;
        answered = true;
        const good = q.opts[+btn.dataset.i] === q.correct;
        btn.classList.add(good ? 'good' : 'bad');
        if (!good) {
          const ci = q.opts.indexOf(q.correct);
          const right = roundEl.querySelector(`.opt-btn[data-i="${ci}"]`);
          if (right) right.classList.add('good');
        }
        for (const b of roundEl.querySelectorAll('.opt-btn')) b.disabled = true;
        document.getElementById('bz-verse').innerHTML = verseHtml(q.v.s, q.hole, true);
        if (good) {
          streak++;
          if (streak >= 10) { stars++; pref('bzstars', String(stars)); }  // 连续十对得一星，此后每对一星
        } else {
          if (streak >= 1) { rounds++; pref('bzrounds', String(rounds)); } // 选错＝连对断，一局终了
          streak = 0;
        }
        if (streak > best) { best = streak; pref('bzbest', String(best)); }
        paintScore();
        roundEl.querySelector('.game-foot').innerHTML =
          `<span class="hb-src">${esc(zhShow(q.v.a))}《<a href="#/p/${q.v.id}">${esc(zhShow(q.v.t))}</a>》</span>` +
          `<button type="button" class="set-toggle" id="bz-next">下一题</button>`;
        document.getElementById('bz-next').onclick = async () => {
          const nb = document.getElementById('bz-next');
          if (!nb || nb.disabled) return;
          nb.disabled = true;
          nb.textContent = '沉吟…';
          await sleep(BZ_BEAT_MS);
          if (!roundEl.isConnected) return;   // 沉吟期间已离开本页：别往摘掉的节点里画
          nextRound();
        };
      };
    }
  };
  nextRound();
}

export { bzView };
