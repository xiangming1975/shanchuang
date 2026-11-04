// 页面：名句库（#/m）
// 数据：idx/mingju.json → [名句, 作者, 题, 作品id, 朝代, 集合名, 标签[]]
// 筛选：朝代（按 7 个时段）/ 作者（出现最多的 12 位）/ 题材（标签里命中题材桶的）
import { app, topbar, emptyHtml } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { getMingju, getTagBuckets, setNavCtx } from '../store.js';
import { pagedList } from './paged.js';
import { esc } from '../py.js';
import { zhShow } from '../fn.js';

const DYN_GROUPS = [
  ['先秦', ['先秦', '秦']],
  ['汉魏六朝', ['汉', '魏晋', '南北朝']],
  ['隋唐五代', ['隋', '唐', '五代']],
  ['宋辽金', ['宋', '辽', '金']],
  ['元', ['元']],
  ['明清', ['明', '清', '明清']],
  ['近现代', ['近现代']],
];
const DYN_OF = (() => {
  const m = {};
  for (const [g, list] of DYN_GROUPS) for (const d of list) m[d] = g;
  return m;
})();

const PAGE = 40;

async function mingjuView(seg, seq = currentRenderSeq()) {
  setAppHTML(seq, topbar('名句', { back: true }) + '<div class="loading"></div>');
  let rows = null;
  try { rows = await getMingju(); } catch { rows = null; }
  if (!isCurrent(seq)) return;
  if (!Array.isArray(rows) || !rows.length) {
    setAppHTML(seq, topbar('名句', { back: true }) + emptyHtml('句', '名句索引未就绪，请刷新重试'));
    return;
  }

  // 题材白名单：取标签总览里「题材」桶的前 14 个，避免把书名当题材
  let themeTags = [];
  try {
    const b = await getTagBuckets();
    themeTags = (b.rows.theme || []).slice(0, 14).map(x => x[0]);
  } catch {}
  if (!isCurrent(seq)) return;

  // 作者频次（只留出现 ≥3 次的，否则一屏全是只出现一次的人）
  const authorCount = new Map();
  for (const r of rows) authorCount.set(r[1], (authorCount.get(r[1]) || 0) + 1);
  const topAuthors = [...authorCount.entries()]
    .filter(([a, n]) => a && n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(x => x[0]);

  const state = { dyn: '', author: '', tag: '' };

  setAppHTML(seq, topbar('名句', { back: true, extra: `<span class="act">${rows.length} 条</span>` }) + `
    <div class="card">
      <h2>名句</h2>
      <div class="section-tip" style="margin:4px 0 0">共 ${rows.length} 条，点任意一句可跳到整首</div>
    </div>
    <div class="group-title">朝代</div>
    <div class="tagrow" id="f-dyn">
      <button type="button" data-dyn="" class="on" aria-pressed="true">全部</button>
      ${DYN_GROUPS.map(([g]) => `<button type="button" data-dyn="${g}" aria-pressed="false">${g}</button>`).join('')}
    </div>
    <div class="group-title">诗人</div>
    <div class="tagrow" id="f-author">
      ${topAuthors.map(a => `<button type="button" data-author="${esc(a)}" aria-pressed="false">${esc(zhShow(a))}</button>`).join('')}
    </div>
    ${themeTags.length ? `<div class="group-title">题材</div>
    <div class="tagrow" id="f-tag">
      ${themeTags.map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="false">${esc(zhShow(t))}</button>`).join('')}
    </div>` : ''}
    <div class="group-title" id="mj-count"></div>
    <div id="mj-list"></div>
    <div style="text-align:center;margin:14px 0"><button class="set-toggle hidden" id="mj-more">加载更多</button></div>`);

  const listEl = document.getElementById('mj-list');
  const countEl = document.getElementById('mj-count');
  const moreBtn = document.getElementById('mj-more');
  let filtered = rows;

  const matches = (r) => {
    if (state.dyn && DYN_OF[r[4]] !== state.dyn) return false;
    if (state.author && r[1] !== state.author) return false;
    if (state.tag && !(r[6] || []).includes(state.tag)) return false;
    return true;
  };

  const itemHtml = (r) => `<a class="mj-item" href="#/p/${r[3]}?v=${encodeURIComponent(r[0])}">
      <div class="mj-t">${esc(zhShow(r[0]))}</div>
      <div class="mj-s">—— ${esc(zhShow(r[1] || '佚名'))}${r[2] ? '　《' + esc(zhShow(r[2])) + '》' : ''}</div>
    </a>`;

  const pager = pagedList({
    listEl, moreBtn,
    items: () => filtered,
    total: () => filtered.length,
    batchSize: PAGE,
    itemHtml,
    countUnit: '条',
  });

  const applyFilter = () => {
    filtered = rows.filter(matches);
    // 阅读队列：当前筛选下的名句对应整首；指示条 label 带筛选摘要（第九轮 🟡-1）
    const fq = [state.dyn, state.author, state.tag].filter(Boolean).join(' · ');
    setNavCtx(filtered.map(r => r[3]), '名句' + (fq ? ' · ' + fq : '')).catch(() => {});
    countEl.textContent = filtered.length ? `结果 ${filtered.length} 条` : '';
    if (!filtered.length) {
      listEl.innerHTML = emptyHtml('空', '这个组合下没有名句<br><button class="set-toggle" id="mj-reset" style="color:var(--accent)">清空筛选</button>');
      const r = document.getElementById('mj-reset');
      if (r) r.onclick = () => { state.dyn = state.author = state.tag = ''; syncChips(); applyFilter(); };
      moreBtn.classList.add('hidden');
      return;
    }
    pager.reset();
    pager.more();
  };

  const syncChips = () => {
    const mark = (sel, isOn) => {
      for (const b of document.querySelectorAll(sel)) {
        const on = isOn(b);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    mark('#f-dyn button', b => (b.dataset.dyn || '') === state.dyn);
    mark('#f-author button', b => b.dataset.author === state.author);
    mark('#f-tag button', b => b.dataset.tag === state.tag);
  };

  document.getElementById('f-dyn').onclick = (e) => {
    const a = e.target.closest('button'); if (!a) return;
    state.dyn = a.dataset.dyn || '';
    syncChips(); applyFilter();
  };
  document.getElementById('f-author').onclick = (e) => {
    const a = e.target.closest('button'); if (!a) return;
    state.author = state.author === a.dataset.author ? '' : a.dataset.author;
    syncChips(); applyFilter();
  };
  const tagBox = document.getElementById('f-tag');
  if (tagBox) tagBox.onclick = (e) => {
    const a = e.target.closest('button'); if (!a) return;
    state.tag = state.tag === a.dataset.tag ? '' : a.dataset.tag;
    syncChips(); applyFilter();
  };

  moreBtn.onclick = pager.more;
  applyFilter();
}

export { mingjuView };
