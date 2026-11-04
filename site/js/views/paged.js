// 「加载更多」分页懒加载骨架（2026-10-29 复用收敛：朝代 / 标签 / 名句 / 浏览历史 /
// 眉批原先各写一份 25-35 行的同构代码）。
//
// 返回 { more, reset }：
//   more()   渲染下一批（首批也由它出：绑到 moreBtn.onclick 后再 await 一次即可）
//   reset()  清空已渲染内容与计数（名句页换筛选时用）
//
// 选项（items/total 用函数：朝代页的 ids 随分片加载渐进增长，名句页的 filtered 换筛选时会换）：
//   listEl / moreBtn   列表容器与按钮
//   items()            待分页数组
//   total()            总数（朝代页用 meta.c，而非 ids.length）
//   batchSize          每批条数
//   itemHtml(item)     单条 → HTML
//   prepare(need)      可选：切片前异步备料（朝代页按需取 id 分片；need=目标条数）
//   fetchBatch(batch)  可选：渲染前异步备料（取行 / 填缓存），返回值是实际要渲染的数组；
//                      不传则按 batch 原样渲染（历史/眉批缺行时由各自 itemHtml 画兜底行）
//   firstEmptyHtml     首批结果为空时的占位（数据加载失败）；不传则不清首屏占位
//   countUnit          按钮剩余计数的单位（'篇'/'条'）；不传则按钮只显示「加载更多」
//   endEl              到底标记元素（textContent 置「— 到底了 —」）
//   afterBatch(batch)  可选：每批渲染完的钩子（prefetch）

import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';

export function pagedList(opt) {
  const { listEl, moreBtn, items, total, batchSize, itemHtml,
    prepare, fetchBatch, firstEmptyHtml, countUnit, endEl, afterBatch } = opt;
  let shown = 0;

  const more = async () => {
    // 视图已被换掉：listEl 脱离 DOM，别往摘掉的节点里画（第十一轮渲染竞态）
    // 只在明确脱离 DOM 时跳过；测试垫片没有 isConnected（undefined）不算脱离。
    if (listEl.isConnected === false) return;
    const busy = !!(prepare || fetchBatch);
    if (busy) { moreBtn.disabled = true; moreBtn.textContent = '加载中…'; }
    try {
      // prepare/fetchBatch 异常只给局部提示，不让整页落入错误态
      if (prepare) {
        try { await prepare(shown + batchSize); }
        catch {
          if (listEl.isConnected !== false && shown === 0) listEl.innerHTML = '<div class="section-tip">加载失败，请点「加载更多」重试</div>';
          return;
        }
      }
      if (listEl.isConnected === false) return;
      const batch = items().slice(shown, shown + batchSize);
      if (!batch.length) return;
      const first = shown === 0;
      shown += batch.length;   // 备料前先记账：await 期间重复点击不会重渲染同一批
      let toRender = batch;
      if (fetchBatch) {
        try { toRender = (await fetchBatch(batch)) || batch; }
        catch {
          if (listEl.isConnected !== false && first) listEl.innerHTML = '<div class="section-tip">加载失败，请点「加载更多」重试</div>';
          return;
        }
      }
      if (listEl.isConnected === false) return;
      // 首批：清掉 loading 占位；备料结果为空时换成调用方给的失败占位
      if (first && firstEmptyHtml !== undefined) listEl.innerHTML = toRender.length ? '' : firstEmptyHtml;
      listEl.insertAdjacentHTML('beforeend', toRender.map(itemHtml).join(''));
      if (shown >= total()) {
        moreBtn.classList.add('hidden');
        if (endEl && !endEl.textContent) endEl.textContent = '— 到底了 —';
      } else {
        moreBtn.classList.remove('hidden');
        moreBtn.textContent = countUnit
          ? `加载更多（还有 ${(total() - shown).toLocaleString()} ${countUnit}）`
          : '加载更多';
      }
      if (afterBatch) afterBatch(batch);
    } finally {
      // 无论成功/异常都恢复按钮，避免卡死在「加载中…」
      if (busy) moreBtn.disabled = false;
    }
  };

  const reset = () => { shown = 0; listEl.innerHTML = ''; };

  return { more, reset };
}
