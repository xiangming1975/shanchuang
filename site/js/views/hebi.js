// 页面：合璧（#/hb）——出上句，接下句。
// 「合璧」取「珠联璧合」之意（《汉书·律历志》）：上句下句本是一璧之两半，接上即合璧。
// 题库：idx/mingju.json（与名句页同一份数据），只收能拆成上/下句的成对名句；
//   四选一，干扰项从别的名句下句里挑（字数相近优先，越像越好）。
// 记分：连对即时判定，接错归零；最高连对存偏好 hbbest，随备份导出。
// 得星（2026-10-31 调整）：连对十合得一星（starsFor），此后每多合一星，即记即存偏好 hbstars；
//   连对断（接错）即一局终了，至少合过一次的局计入 hbrounds。首页行令卡展示。
// 出题节奏（2026-10-31）：读者答题后点「下一合」，山窗沉吟一秒（HB_BEAT_MS）再出题。
import { app, topbar, emptyHtml, splitMingjuPair, quizOptions } from '../vcommon.js';
import { pref, getMingju } from '../store.js';
import { esc } from '../py.js';
import { zhShow } from '../fn.js';

const RECENT = 24;   // 最近出过的题不重出（题库上千对，够转一阵）
const HB_BEAT_MS = 1000;  // 出下一合前停这一拍——读者刚答完，给口气（2026-10-31）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function hebiView() {
  app.innerHTML = topbar('合璧', { back: true }) + '<div class="loading"></div>';
  let rows = null;
  try { rows = await getMingju(); } catch { rows = null; }
  if (!Array.isArray(rows) || !rows.length) {
    app.innerHTML = topbar('合璧', { back: true }) + emptyHtml('璧', '名句索引未就绪<br>请刷新重试');
    return;
  }
  const bank = [];
  for (const r of rows) {
    const pair = splitMingjuPair(r[0]);
    if (pair) bank.push({ up: pair[0], down: pair[1], a: r[1], t: r[2], id: r[3] });
  }
  if (!bank.length) {
    app.innerHTML = topbar('合璧', { back: true }) + emptyHtml('璧', '题库拆解失败<br>请刷新重试');
    return;
  }
  const downs = bank.map(b => b.down);

  let streak = 0;
  let best = parseInt(pref('hbbest') || '0', 10) || 0;
  let stars = parseInt(pref('hbstars') || '0', 10) || 0;    // 累计星数，即得即存
  let rounds = parseInt(pref('hbrounds') || '0', 10) || 0;  // 连对断过多少回（合过至少一次的局）
  const recent = [];

  app.innerHTML = topbar('合璧', { back: true }) + `
    <div class="card">
      <h2>合璧</h2>
      <div class="section-tip" style="margin:4px 0 0">出上句，接下句——上句下句本是一璧之两半，接上即「合璧」（珠联璧合，《汉书·律历志》）。共 ${bank.length} 合。</div>
      <div class="game-score" id="hb-score"></div>
    </div>
    <div id="hb-round"><div class="loading"></div></div>`;

  const scoreEl = document.getElementById('hb-score');
  const roundEl = document.getElementById('hb-round');
  const paintScore = () => { scoreEl.innerHTML = `连对 <b>${streak}</b> · 最高 <b>${best}</b>` + (stars ? ` · ★ <b>${stars}</b>` : ''); };
  paintScore();

  let q = null;
  let answered = false;

  const nextRound = () => {
    let k = 0;
    do { k = Math.floor(Math.random() * bank.length); } while (recent.includes(k) && bank.length > RECENT);
    recent.push(k);
    if (recent.length > RECENT) recent.shift();
    q = bank[k];
    q.opts = quizOptions(q.down, downs, 4);
    answered = false;
    roundEl.innerHTML = `
      <div class="card">
        <div class="hb-up">${esc(zhShow(q.up))}<span class="hb-comma">，</span></div>
        <div class="hb-hint" id="hb-hint"></div>
        <div class="opt-list" id="hb-opts">
          ${q.opts.map((o, i) => `<button type="button" class="opt-btn" data-i="${i}">${esc(zhShow(o))}</button>`).join('')}
        </div>
        <div class="game-foot">
          <button type="button" class="set-toggle" id="hb-hintbtn">看提示</button>
        </div>
      </div>`;
    document.getElementById('hb-hintbtn').onclick = () => {
      document.getElementById('hb-hint').innerHTML = esc(zhShow(q.a)) + '《' + esc(zhShow(q.t)) + '》';
    };
    for (const btn of roundEl.querySelectorAll('.opt-btn')) {
      btn.onclick = () => {
        if (answered) return;
        answered = true;
        const good = q.opts[+btn.dataset.i] === q.down;
        btn.classList.add(good ? 'good' : 'bad');
        if (!good) {
          const ci = q.opts.indexOf(q.down);
          const right = roundEl.querySelector(`.opt-btn[data-i="${ci}"]`);
          if (right) right.classList.add('good');
        }
        for (const b of roundEl.querySelectorAll('.opt-btn')) b.disabled = true;
        if (good) {
          streak++;
          if (streak >= 10) { stars++; pref('hbstars', String(stars)); }  // 连对十合得一星，此后每合一星
        } else {
          if (streak >= 1) { rounds++; pref('hbrounds', String(rounds)); } // 接错＝连对断，一局终了
          streak = 0;
        }
        if (streak > best) { best = streak; pref('hbbest', String(best)); }
        paintScore();
        // 出处 + 下一合（接错时绿色的就是原句）
        roundEl.querySelector('.game-foot').innerHTML =
          `<span class="hb-src">${esc(zhShow(q.a))}《<a href="#/p/${q.id}">${esc(zhShow(q.t))}</a>》</span>` +
          `<button type="button" class="set-toggle" id="hb-next">下一合</button>`;
        document.getElementById('hb-next').onclick = async () => {
          const nb = document.getElementById('hb-next');
          if (!nb || nb.disabled) return;
          nb.disabled = true;
          nb.textContent = '沉吟…';
          await sleep(HB_BEAT_MS);            // 出题前停一秒，留个缓冲（2026-10-31）
          if (!roundEl.isConnected) return;   // 缓冲期间读者已离开本页：别往摘掉的节点里画
          nextRound();
        };
      };
    }
  };
  nextRound();
}

export { hebiView };
