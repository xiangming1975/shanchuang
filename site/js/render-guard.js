// 渲染序号守卫（第十一轮 A-3 / E-1 / E-2）。
//
// 背景：app.js 原先只在「视图函数整体返回后」比较 renderSeq。视图内部多次 await
// 之后仍会写 #app，快速切页时旧请求回来会覆盖新页面。这里把序号收敛到独立模块，
// 由 app.js 在每次 render 开头领取，作为第二个参数传给视图；视图及其异步回调
// 在每次写 #app 前必须经 setAppHTML / isCurrent 校验。
//
// 独立模块而非放 app.js：避免 views/*.js → app.js → views.js 的循环依赖。
let seq = 0;

export function nextRenderSeq() { return ++seq; }
export function currentRenderSeq() { return seq; }
export function isCurrent(s) { return s === undefined || s === seq; }

// 写主内容区的唯一入口。返回 false 表示本次写入已被更新的路由放弃。
export function setAppHTML(s, html) {
  if (!isCurrent(s)) return false;
  const app = document.getElementById('app');
  if (!app) return false;
  app.innerHTML = html;
  return true;
}

// 给「先取数据、再局部插入」的场景用（如名句卡、分页追加）。
export function appEl(s) {
  return isCurrent(s) ? document.getElementById('app') : null;
}
