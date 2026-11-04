// 界面框架文字的简繁跟随（2026-10-29）
// ---------------------------------------------------------------------------
// 数据内容（正文/标题/译文/注释…）已在各渲染函数里显式过 zhShow；但界面框架文字
// （按钮、卡片标题、提示语、静态 tabbar）是散在十几份模板里的简体字面量，逐处包
// zhShow 既漏不起也养不起——每写一个新按钮都要记得转一次。
// 这里改在 DOM 层统一收口：一个 MutationObserver 盯住 <body>，渲染落屏后把
//   ① 文本节点
//   ② 三枚展示属性 placeholder / title / aria-label
// 过一遍 zhShow。安全性靠四条：
//   - zhShow 幂等：渲染函数已转过的内容（正文等）二次转换是无操作，不双转；
//   - data-* / href / value 一律不碰——链接、索引键、用户输入必须是原字；
//   - TEXTAREA / INPUT / SCRIPT / STYLE / CODE / PRE 里的文本不转：
//     眉批编辑器、勘误模板、搜索框都是用户输入或待提交内容，转了会污染存储
//     （textarea 的文本节点被改写会同步进 value，提交时把「界面字」存进去）；
//   - 观察器回调里先 disconnect 再改、改完重新 observe：自己产生的变更不再
//     回流，无递归；zhShow 幂等保证即使漏掉一拍，下一拍补上也不出错。
import { zhShow } from './fn.js';

const SKIP_TAGS = new Set(['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE', 'CODE', 'PRE']);
const SHOW_ATTRS = ['placeholder', 'title', 'aria-label'];
const ATTR_SEL = '[' + SHOW_ATTRS.join('],[') + ']';

function acceptNode(n) {
  const p = n.parentElement;
  return (p && SKIP_TAGS.has(p.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
}

// 转换一棵子树（root 为元素）。正文等已转内容靠幂等性自然跳过。
export function convTree(root) {
  if (!root || root.nodeType !== 1) return;
  if (typeof document.createTreeWalker !== 'function') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode });
  const batch = [];
  while (walker.nextNode()) batch.push(walker.currentNode);
  for (const n of batch) {
    const c = zhShow(n.nodeValue);
    if (c !== n.nodeValue) n.nodeValue = c;
  }
  for (const el of root.querySelectorAll(ATTR_SEL)) {
    for (const a of SHOW_ATTRS) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      const c = zhShow(v);
      if (c !== v) el.setAttribute(a, c);
    }
  }
}

// 安装观察器（app.js 在映射表就绪后、首渲染前调用一次）
export function installZhUi() {
  const title = document.title;
  const c = zhShow(title);
  if (c !== title) document.title = c;
  if (typeof MutationObserver !== 'function' || !document.body) return;
  const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: SHOW_ATTRS };
  const mo = new MutationObserver(() => {
    mo.disconnect();
    try { convTree(document.body); }
    finally { mo.observe(document.body, OPTS); }
  });
  mo.observe(document.body, OPTS);
  convTree(document.body);   // 静态外壳（tabbar、启动屏）只此一次
}
