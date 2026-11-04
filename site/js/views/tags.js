// 页面：目录（#/tags）
// 2026-10-28：首页极简化，把「典籍 / 朝代」从首页搬到这里。
// 首页只剩「随便看看」与「全部标签」两个动作，所以本页要能当整站目录用：
//   典籍 79 个集合（#/c/*）—— 全集 26 本占全库 28%，只从这里进得来
//   按朝代 7 段（#/dy/*）+ 概览（#/d）
//   课本 / 体裁 / 书目 / 题材 四桶标签（原样保留）
// 行令（飞花令 / 合璧）2026-10-31 起放首页晨读卡下方，不在本页。
import { app, topbar } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { getTagBuckets, getManifest, getDynIndex } from '../store.js';
import { esc } from '../py.js';
import { zhShow } from '../fn.js';

const SECTIONS = [
  ['textbook', '课本', '按册次收录的课文篇目'],
  ['genre', '体裁', '诗、词、曲、文的体式分类'],
  ['bookish', '书目', '常见选本与典籍，点进去是对应篇目的聚合'],
  ['theme', '题材', '写什么、什么时候写、写给谁'],
];

const THEME_HEAD = 60;
const HEAD_LIMIT = { theme: THEME_HEAD, bookish: 40 };

// 集合分组：原五组 + 新增「新体裁」「新诗集」两类，共七组。
// 一个分组可对应多个 tab，故每组第二项为 tab 数组（新体裁/新诗集各含多个新集合）。
const COL_GROUPS = [
  ['精选典集', ['精选']],
  ['经部', ['经部']],
  ['古文', ['古文']],
  ['鉴赏辞典', ['鉴赏']],
  ['全集', ['全集']],
  ['新体裁', ['对联', '飞花令', '词牌', '韵书', '诗话', '四库全书']],
  ['新诗集', ['唐诗', '宋诗', '宋词', '清词', '诗词', '诗经', '蒙学', '先秦', '五代词', '唐五代词']],
];
const cnt = c => (c.visible != null ? c.visible : c.count);

async function tagIndexView(seg, seq = currentRenderSeq()) {
  setAppHTML(seq, topbar('目录', { back: true }) + '<div class="loading"></div>');
  let data = null, m = null, dyn = null;
  try { data = await getTagBuckets(); } catch { data = null; }
  try { m = await getManifest(); } catch { m = null; }
  try { dyn = await getDynIndex(); } catch { dyn = null; }
  if (!isCurrent(seq)) return;

  if (!data || !data.rows) {
    setAppHTML(seq, topbar('目录', { back: true }) +
      '<div class="empty-state"><div class="big">空</div>标签索引未就绪，请刷新重试</div>');
    return;
  }
  const b = data.rows;
  const total = Object.values(b).reduce((s, arr) => s + arr.length, 0);

  // ⓪ 行令（飞花令 / 合璧）：2026-10-31 曾放这里，当天移到首页晨读卡下方——
  // 常玩的东西放常来的地方，本页回归纯目录。

  // ① 典籍：79 个集合按七组平铺。首页删掉砖块后，这是唯一的浏览入口。
  let colHtml = '';
  if (m && m.collections) {
    const groups = COL_GROUPS.map(([label, tabs]) => {
      const cols = m.collections.filter(c => tabs.includes(c.tab) && c.count > 0);
      if (!cols.length) return '';
      return `<div class="tagrow"><span class="dir-lab">${label}</span>` +
        cols.map(c => `<a href="#/c/${c.id}/0">${esc(zhShow(c.name))}<span class="tagn">${cnt(c)}</span></a>`).join('') +
        '</div>';
    }).join('');
    if (groups) {
      const n = m.collections.filter(c => c.count > 0).length;
      colHtml = `<div class="group-title">典籍<span class="gnum">${n}</span></div>` + groups;
    }
  }

  // ② 朝代：7 段 + 概览（构建期分组，见 etl/build.js 的 DYN_GROUPS）
  // 「概览」挂在分组标题行右端，不要让它独占一行变成孤儿按钮（实测会换行）。
  let dynHtml = '';
  if (dyn && dyn.rows) {
    const top = dyn.rows.filter(r => r && r.k);
    if (top.length) {
      dynHtml = '<div class="group-title gt-row"><span>按朝代<span class="gnum">' + top.length + '</span></span>' +
        '<a href="#/d">概览</a></div>' +
        '<div class="tagrow">' +
        top.map(r => `<a href="#/dy/${encodeURIComponent(r.k)}">${esc(zhShow(r.k))}${r.c ? `<span class="tagn">${r.c}</span>` : ''}</a>`).join('') +
        '</div>';
    }
  }

  // ③ 原来的四桶标签
  const sectionHtml = SECTIONS.map(([id, name, tip]) => {
    const list = b[id] || [];
    if (!list.length) return '';
    const head = HEAD_LIMIT[id] ? list.slice(0, HEAD_LIMIT[id]) : list;
    const chips = head.map(([k, n]) =>
      `<a href="#/t/${encodeURIComponent(k)}">${esc(zhShow(k))}<span class="tagn">${n}</span></a>`).join('');
    const more = list.length > head.length
      ? `<div style="text-align:center;margin:10px 0"><button class="set-toggle" data-more="${id}">展开其余 ${list.length - head.length} 个</button></div>`
      : '';
    return `<div class="group-title">${name}<span class="gnum">${list.length}</span></div>
      <div class="section-tip" style="margin:-2px 0 8px">${tip}</div>
      <div class="tagrow" id="bk-${id}">${chips}</div>${more}`;
  }).join('');

  // 页面头部沿用列表页那套（topbar 现在是空壳，页面内得自己说明这是哪儿）
  const nCol = m && m.collections ? m.collections.filter(c => c.count > 0).length : 0;
  const nDyn = dyn && dyn.rows ? dyn.rows.filter(r => r && r.k).length : 0;
  const headTip = [nCol ? nCol + ' 部典籍' : '', nDyn ? nDyn + ' 段朝代' : '', total + ' 个标签']
    .filter(Boolean).join(' · ');

  setAppHTML(seq, topbar('目录', { back: true }) +
    `<div class="card"><h2>目录</h2><div class="section-tip" style="margin:4px 0 0">${headTip}</div></div>` +
    colHtml + dynHtml +
    '<div class="dir-sep"></div>' + sectionHtml);

  for (const btn of document.querySelectorAll('[data-more]')) {
    btn.onclick = () => {
      const id = btn.dataset.more;
      const list = b[id] || [];
      document.getElementById('bk-' + id).innerHTML = list.map(([k, n]) =>
        `<a href="#/t/${encodeURIComponent(k)}">${esc(zhShow(k))}<span class="tagn">${n}</span></a>`).join('');
      btn.remove();
    };
  }
}

export { tagIndexView };
