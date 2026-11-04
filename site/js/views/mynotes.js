// 页面：我的眉批（#/n）—— 设置页进来的集中管理页
// 与历史页同一套路（分组列表 + 懒加载 + 行内删除 + 底部清空），只是分组维度不同：
// 历史按时间倒序平铺，眉批按「哪一篇」聚拢，组内按行号顺序——批注属于某一篇的某一处。
import { app, popupConfirm, rowMeta, emptyHtml } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { getAllNotes, removeNote, clearUserData, noteTotal } from '../store.js';
import { loadRowsByIds } from './list.js';
import { pagedList } from './paged.js';
import { esc } from '../py.js';

const PAGE = 40;                 // 每批 40 篇（不是 40 条：一篇可能有好几条批语）
const rowCache = new Map();      // poemId → 记录，翻回来不重取

// 分组：按「最近写过」倒序；组内按行号
function groupList() {
  const all = getAllNotes();
  const out = [];
  for (const pid of Object.keys(all)) {
    const arr = Array.isArray(all[pid]) ? all[pid] : null;
    if (!arr || !arr.length) continue;
    let latest = 0;
    for (const n of arr) if ((n.ts || 0) > latest) latest = n.ts || 0;
    out.push({ pid, latest, notes: arr.slice().sort((a, b) => (a.li || 0) - (b.li || 0)) });
  }
  out.sort((a, b) => b.latest - a.latest);
  return out;
}

// 组头：题名（截断）+「朝代 · 作者」（rowMeta，2026-10-29 复用收敛）
const headOf = (pid) => rowMeta(rowCache.get(String(pid)), pid);

async function myNotesView(seg, seq = currentRenderSeq()) {
  const groups = groupList();
  const total = groups.reduce((s, g) => s + g.notes.length, 0);

  setAppHTML(seq, `
    <div class="section-tip" id="n-tip"></div>
    <div id="n-list"></div>
    <div class="h-end" id="n-end"></div>
    <div class="h-foot">
      <button class="set-toggle" id="n-more">加载更多</button>
      <button class="set-toggle" id="n-clear">清空眉批</button>
    </div>`);

  const listEl = document.getElementById('n-list');
  const tipEl = document.getElementById('n-tip');
  const moreBtn = document.getElementById('n-more');
  const clearBtn = document.getElementById('n-clear');

  if (!total) {
    moreBtn.classList.add('hidden');
    clearBtn.classList.add('hidden');
    listEl.outerHTML = emptyHtml('批', `还没有眉批<br>
      在作品正文里点 ☰，再点「写眉批」，给任意一句写下批语<br>
      <a href="#/" style="color:var(--accent);font-size:0.86rem">去读一首</a>`);
    return;
  }

  tipEl.textContent = `共 ${total} 条 · 分布在 ${groups.length} 篇 · 点批语回到原文那一行`;

  const groupHtml = (g) => {
    const h = headOf(g.pid);
    return `<div class="ng" data-pid="${g.pid}">
      <a class="ng-head" href="#/p/${g.pid}">
        <span class="ng-t">${esc(h.t)}</span>
        ${h.m ? `<span class="ng-m">${esc(h.m)}</span>` : ''}
        <span class="ng-n">${g.notes.length} 条</span>
      </a>
      ${g.notes.map(n => `<div class="hrow" data-pid="${g.pid}" data-nid="${n.id}">
        <a class="hrow-main" href="#/p/${g.pid}?n=${encodeURIComponent(n.id)}">
          <div class="nq">${esc(n.t || '（原句缺失）')}</div>
          <div class="ns">${esc(n.s)}</div>
        </a>
        <button class="hrow-del" data-del="${esc(n.id)}" data-pid="${g.pid}" aria-label="删除这条眉批">×</button>
      </div>`).join('')}
    </div>`;
  };

  const { more } = pagedList({
    listEl,
    moreBtn,
    items: () => groups,
    total: () => groups.length,
    batchSize: PAGE,
    fetchBatch: async (batch) => {
      const need = batch.map(g => g.pid).filter(pid => !rowCache.has(String(pid)));
      if (need.length) {
        try {
          const rows = await loadRowsByIds(need.map(Number));
          for (const r of rows) if (r && r.i != null) rowCache.set(String(r.i), r);
        } catch {}
      }
      return batch;
    },
    itemHtml: groupHtml,
    endEl: document.getElementById('n-end'),
  });
  moreBtn.onclick = more;
  await more();

  if (!isCurrent(seq)) return;

  // 删单条：原地移除，不住回顶部
  listEl.addEventListener('click', (ev) => {
    const d = ev.target.closest('[data-del]');
    if (!d) return;
    ev.preventDefault();
    const pid = d.dataset.pid;
    const nid = d.dataset.del;
    if (!removeNote(pid, nid)) return;
    const row = d.closest('.hrow');
    const grp = d.closest('.ng');
    if (row) row.remove();
    // 这一篇的批语删空了，整组一起撤
    if (grp && !grp.querySelector('.hrow')) grp.remove();
    const left = noteTotal();
    if (!left) { myNotesView(); return; }
    const g = grp && grp.querySelector('.ng-n');
    if (g) {
      const n = grp.querySelectorAll('.hrow').length;
      if (n) g.textContent = n + ' 条';
    }
    const alive = document.querySelectorAll('#n-list .ng').length;
    const allLoaded = moreBtn.classList.contains('hidden');
    tipEl.textContent = `共 ${left} 条 · 分布在 ${alive} 篇${allLoaded ? '' : '（已加载部分）'} · 点批语回到原文那一行`;
  });

  // 清空
  clearBtn.onclick = () => {
    popupConfirm('清空全部眉批？', `共 ${total} 条，删除后不可恢复。建议先导出备份。`, '清空', () => {
      clearUserData('notes');
      myNotesView();
    });
  };
}

export { myNotesView };
