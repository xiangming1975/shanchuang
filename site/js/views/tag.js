// 页面：tag
import { app, topbar, rowLink, emptyHtml } from '../vcommon.js';
import { loadRowsByIds, dedupeRows } from './list.js';
import { getTags, prefetchPoems, setNavCtx } from '../store.js';
import { pagedList } from './paged.js';
import { esc } from '../py.js';
import { normZh, zhShow } from '../fn.js';

const BOOKISH_TAGS = new Set(['列传', '本纪', '世家', '表', '战国策', '国语', '左传', '孟子', '资治通鉴',
  '明史', '宋史', '史记', '汉书', '太平广记', '容斋随笔', '智囊选录', '围炉夜话', '千家诗', '古诗三百首',
  '唐诗三百首', '宋词三百首', '乐府', '国风', '古文观止', '五言律诗', '七言律诗', '五言绝句', '七言绝句',
  '五言古诗', '七言古诗', '宋词精选', '宋诗', '元曲', '诗经', '楚辞', '论语', '蒙学', '小学古诗', '初中古诗', '高中古诗']);

const tagIsTheme = (tags, k) => {
  const e = tags.k[k];
  if (!e || !e[1] || e[1].length < 12) return false;
  if (BOOKISH_TAGS.has(k)) return false;
  if (/^(卷|第)[一二三四五六七八九十百零\d]{1,3}$/.test(k)) return false;  // 「卷三」之类篇目
  return true;
};

// tags.json 的键是归一化写法（繁→简、去标点）；详情页链接传原始标签，
// 因此先按原样查，再查别名表，最后退回 normZh。

function tagKeyOf(tags, raw) {
  if (tags.k[raw]) return raw;
  if (tags.a && tags.a[raw]) return tags.a[raw];
  const n = normZh(raw);
  return tags.k[n] ? n : '';
}

async function tagView(seg) {
  let raw = '';
  try { raw = decodeURIComponent(seg[0] || ''); } catch { raw = seg[0] || ''; }
  app.innerHTML = topbar(raw || '标签', { back: true }) + '<div class="loading"></div>';
  let tags = null;
  try { tags = await getTags(); } catch { tags = null; }
  if (!tags || !tags.k) {
    app.innerHTML = topbar(raw || '标签', { back: true }) + emptyHtml('签', '标签数据未就绪，请刷新重试');
    return;
  }
  const key = tagKeyOf(tags, raw);
  const entry = key ? tags.k[key] : null;
  if (!entry) {
    app.innerHTML = topbar(raw || '标签', { back: true }) +
      emptyHtml('空', '没有这个标签<br><a href="#/" style="color:var(--accent)">回首页</a>');
    return;
  }
  const [tab, ids] = entry;
  setNavCtx(ids, '标签 · ' + key).catch(() => {});   // 阅读队列：这个标签下的作品（remap/去重/截断在 setNavCtx 内）

  // 相关标签：与本标签共现最多的其他标签（排除书目/体裁类）
  const set = new Set(ids);
  const rel = [];
  for (const [k2, e2] of Object.entries(tags.k)) {
    if (k2 === key || !tagIsTheme(tags, k2)) continue;
    const ids2 = e2[1];
    const small = ids2.length <= ids.length ? ids2 : ids;
    const big = ids2.length <= ids.length ? set : new Set(ids2);
    let n = 0;
    for (const id of small) if (big.has(id)) n++;
    if (n >= 3) rel.push({ k: k2, n });
  }
  rel.sort((a, b) => b.n - a.n);
  const relHtml = rel.slice(0, 12).map(r => `<a href="#/t/${encodeURIComponent(r.k)}">${esc(zhShow(r.k))}</a>`).join('');

  app.innerHTML = topbar(zhShow(key), { back: true, extra: `<span class="act">${ids.length} 篇</span>` }) + `
    <div class="card">
      <h2>#${esc(zhShow(key))}</h2>
      <div class="section-tip" style="margin:4px 0 0">共 ${ids.length} 篇${tab ? ' · 多见于「' + esc(zhShow(tab)) + '」类合集' : ''}</div>
    </div>
    ${relHtml ? '<div class="group-title">相关标签</div><div class="tagrow">' + relHtml + '</div>' : ''}
    <div class="group-title">作品</div>
    <div class="list" id="tag-list"><div class="loading"></div></div>
    <div style="text-align:center;margin:14px 0"><button class="set-toggle hidden" id="tag-more">加载更多</button></div>`;

  const listEl = document.getElementById('tag-list');
  const moreBtn = document.getElementById('tag-more');
  const PAGE = 40;
  const { more: loadMore } = pagedList({
    listEl, moreBtn,
    items: () => ids,
    total: () => ids.length,
    batchSize: PAGE,
    fetchBatch: async (batch) => {
      try { return await dedupeRows(await loadRowsByIds(batch)); } catch { return []; }
    },
    itemHtml: (r) => rowLink(r),
    firstEmptyHtml: emptyHtml('空', '作品数据加载失败'),
    countUnit: '篇',
    afterBatch: (batch) => prefetchPoems(batch.slice(0, 8)),
  });
  moreBtn.onclick = loadMore;
  await loadMore();
}

// ---------------- 详情页 ----------------

export { BOOKISH_TAGS, tagIsTheme, tagKeyOf, tagView };
