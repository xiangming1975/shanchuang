// 页面：历史（浏览 / 搜索 两个 tab）
// #/h    浏览历史（倒序，每批 60 条懒加载）
// #/h/s  搜索历史（倒序纯列表）
// 数据都是纯 id / 纯词条，没有时间戳——故意的：存时间会让体积翻几倍，
// 而这里只需要「最近读过什么」，不需要「哪天读的」。
import { app, topbar, popupConfirm, LE_PREFIX, displayTitle, snippetOf, rowMeta, emptyHtml } from '../vcommon.js';
import { getHistory, getSearchHist, removeHistory, removeSearchHist, clearUserData, HIS_MAX, readIdSet } from '../store.js';
import { loadRowsByIds } from './list.js';
import { pagedList } from './paged.js';
import { esc } from '../py.js';

const PAGE = 60;
const rowCache = new Map();     // id → 记录，切 tab 回来不重取

// 标题：剥掉全唐诗的乐府分类前缀（「鼓吹曲辭 將進酒」→「將進酒」）
function titleOf(r) {
  const raw = String((r && r.t) || '').replace(LE_PREFIX, '');
  if (!r) return '';
  return r.r && r.r !== r.t ? r.r + '·' + raw : raw;
}

async function historyView(seg) {
  const isSearch = seg[0] === 's';
  const ids = isSearch ? [] : getHistory();
  const words = isSearch ? getSearchHist() : [];
  const total = isSearch ? words.length : ids.length;
  // 已读集合一次取好：列表上万行时，逐行 isRead() 会把 localStorage 重解析上万遍
  const rset = isSearch ? null : readIdSet();
  const readN = rset ? ids.filter(id => rset.has(id)).length : 0;

  // 历史也不用顶部横条
  app.innerHTML = `
    <div class="seg" id="h-seg">
      <a href="#/h" class="${isSearch ? '' : 'on'}">浏览历史</a>
      <a href="#/h/s" class="${isSearch ? 'on' : ''}">搜索历史</a>
    </div>
    <div class="section-tip" id="h-tip"></div>
    <div class="list" id="h-list"></div>
    <div class="h-end" id="h-end"></div>
    <div class="h-foot">
      <button class="set-toggle" id="h-more">加载更多</button>
      <button class="set-toggle" id="h-clear">清空${isSearch ? '搜索' : '浏览'}历史</button>
    </div>`;

  const listEl = document.getElementById('h-list');
  const tipEl = document.getElementById('h-tip');
  const moreBtn = document.getElementById('h-more');
  const clearBtn = document.getElementById('h-clear');

  if (!total) {
    tipEl.textContent = '';
    moreBtn.classList.add('hidden');
    listEl.outerHTML = emptyHtml('迹', isSearch
      ? '还没有搜索记录<br>搜过的词会留在这里，方便一键重搜'
      : '还没有浏览记录<br>读过的作品会按时间倒序排在这里');
    clearBtn.classList.add('hidden');
    return;
  }

  tipEl.textContent = isSearch
    ? '倒序排列，点词重搜；× 只删这一条。'
    : `倒序排列 · 读完 ${readN} / ${total} · 同一作品只计一次`;

  // ---------- 搜索历史：纯文字行 ----------
  if (isSearch) {
    moreBtn.classList.add('hidden');
    listEl.innerHTML = words.map(q => `<div class="hrow" data-q="${esc(q)}">
        <a class="hrow-main" href="#/s/${encodeURIComponent(q)}"><div class="hrow-t">${esc(q)}</div></a>
        <button class="hrow-del" data-delq="${esc(q)}" aria-label="删除这条搜索记录">×</button>
      </div>`).join('');
  } else {
    // ---------- 浏览历史：分批取记录 ----------
    const rowHtml = (id) => {
      const r = rowCache.get(id);
      const full = r ? displayTitle(r) : '';
      const { t, m: meta } = rowMeta(r, id);
      // 词的首句已经并进标题（「瑞鹤仙·湿云黏雁影」），下面就不重复了
      const line = r && full === titleOf(r) ? snippetOf(r.p && r.p[0]) : '';
      const sub = [meta, line].filter(Boolean).join('　');
      return `<div class="hrow" data-i="${id}">
        <a class="hrow-main" href="#/p/${id}">
          <div class="hrow-t">${esc(t)}${rset && rset.has(id) ? '<i class="hdot" title="这一篇读完了"></i>' : ''}</div>
          <div class="hrow-s">${sub ? esc(sub) : '<span class="hrow-x">已下线或数据缺失</span>'}</div>
        </a>
        <button class="hrow-del" data-del="${id}" aria-label="从浏览历史中删除">×</button>
      </div>`;
    };

    const { more } = pagedList({
      listEl,
      moreBtn,
      items: () => ids,
      total: () => ids.length,
      batchSize: PAGE,
      fetchBatch: async (batch) => {
        const need = batch.filter(id => !rowCache.has(id));
        if (need.length) {
          try {
            const rows = await loadRowsByIds(need);
            for (const r of rows) if (r && r.i != null) rowCache.set(r.i, r);
          } catch {}
        }
        return batch;
      },
      itemHtml: rowHtml,
      endEl: document.getElementById('h-end'),
    });
    moreBtn.onclick = more;
    await more();
  }

  // ---------- 删单条（列表内原地删，不动滚动位置） ----------
  listEl.addEventListener('click', (ev) => {
    const dq = ev.target.closest('[data-delq]');
    if (dq) {
      const q = dq.dataset.delq;
      if (removeSearchHist(q)) {
        dq.closest('.hrow').remove();
        if (!getSearchHist().length) historyView(seg);
      }
      return;
    }
    const d = ev.target.closest('[data-del]');
    if (!d) return;
    const id = Number(d.dataset.del);
    if (removeHistory(id)) {
      d.closest('.hrow').remove();
      const left = getHistory();
      if (!left.length) { historyView(seg); return; }
      // 旧版头部计数条（.topbar .act）已随 topbar 一起下线（2026-10-27），实时计数改刷这条提示
      tipEl.textContent = `倒序排列 · 读完 ${rset ? left.filter(x => rset.has(x)).length : 0} / ${left.length} · 同一作品只计一次`;
    }
  });

  // ---------- 清空 ----------
  clearBtn.onclick = () => {
    popupConfirm(`清空${isSearch ? '搜索' : '浏览'}历史？`,
      `共 ${isSearch ? words.length : ids.length} 条，删除后不可恢复。`, '清空', () => {
        clearUserData(isSearch ? 'searchhist' : 'history');
        historyView(seg);
      });
  };
}

export { historyView };
