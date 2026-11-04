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

export function pagedList(opt) {
  const { listEl, moreBtn, items, total, batchSize, itemHtml,
    prepare, fetchBatch, firstEmptyHtml, countUnit, endEl, afterBatch } = opt;
  let shown = 0;

  const more = async () => {
    const busy = !!(prepare || fetchBatch);
    if (busy) { moreBtn.disabled = true; moreBtn.textContent = '加载中…'; }
    if (prepare) await prepare(shown + batchSize);
    const batch = items().slice(shown, shown + batchSize);
    if (!batch.length) { if (busy) moreBtn.disabled = false; return; }
    const first = shown === 0;
    shown += batch.length;   // 备料前先记账：await 期间重复点击不会重渲染同一批
    let toRender = batch;
    if (fetchBatch) {
      try { toRender = (await fetchBatch(batch)) || batch; } catch {}
      moreBtn.disabled = false;
    }
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
  };

  const reset = () => { shown = 0; listEl.innerHTML = ''; };

  return { more, reset };
}
