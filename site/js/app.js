// 路由与启动
import { homeView, listView, detailView, authorView, searchView, tagView, favView, reciteView, excerptView, settingsView, applyTheme, applyKaiFont, stopRead, preloadSearch, dynIndexView, dynView, tagIndexView, reportView, mingjuView, genreView, historyView, myNotesView, hebiView, feihuaView, bzView, jlView, sourcesView, popupMsg } from './views.js';
import { pref, getManifest, luckyPoemId, migrateDedupRemap } from './store.js';
import { initInkBackground } from './inkbg.js';
import { setZhMode, loadZhConv, loadCharMap } from './fn.js';
import { installZhUi } from './uizh.js';
import { esc } from './py.js';
import { nextRenderSeq, isCurrent, setAppHTML } from './render-guard.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

// 本地存储写满 / 容量到顶：store.js 已做过「一个会话只报一次」，
// 这里只负责把它变成看得见的提示（detail.msg 有具体文案就用它）。
window.addEventListener('shici:storage-full', (e) => {
  const msg = (e && e.detail && e.detail.msg) || '本地存储已满，历史可能不再记录。建议先导出备份，再清理部分摘录或历史。';
  try { popupMsg(msg, '知道了'); } catch (err) {}
});

const routes = {
  '': homeView,
  'cat': homeView,      // 分类板块已并入首页；旧链接仍可用
  'c': listView,
  'p': detailView,
  'a': authorView,
  's': searchView,
  't': tagView,
  'tags': tagIndexView,
  'd': dynIndexView,
  'dy': dynView,
  'j': reportView,
  'm': mingjuView,
  'g': genreView,
  'h': historyView,
  'n': myNotesView,   // 我的眉批（设置页进来）
  'hb': hebiView,     // 合璧：出上句接下句（2026-10-31）
  'fh': feihuaView,   // 飞花令：定令字轮流出句（2026-10-31）
  'bz': bzView,       // 补字：名句挖一字补回（2026-11-01）
  'jl': jlView,       // 接龙：下句首字接上句尾字（2026-11-01）
  'fav': favView,
  'recite': reciteView,
  'excerpts': excerptView,
  'settings': settingsView,
  'data': settingsView, // 数据管理并入设置；旧链接仍可用
  'src': sourcesView,   // 数据来源页（从首页致谢的数据部分独立出来）
};

// 随机一首（R6）：PWA 桌面捷径「随便看看」直达用；抽中后跳详情页
async function randomView(_seg, seq) {
  setAppHTML(seq, '<div class="loading dv-loading"></div>');
  const id = await luckyPoemId().catch(() => null);
  if (!isCurrent(seq)) return;   // 第十一轮 A-3：抽签期间已切页，别覆盖新页
  if (id != null) {
    location.hash = '#/p/' + id;
  } else {
    setAppHTML(seq, '<div class="empty-state"><div class="big">误</div>没抽到作品，请稍后再试<br><a href="#/" style="color:var(--accent)">回首页</a></div>');
  }
}
routes['random'] = randomView;

async function render() {
  const seq = nextRenderSeq();
  stopRead();
  const hash = location.hash.replace(/^#\/?/, '');
  const seg = hash.split('/').filter(s => s !== '');
  const key = seg[0] || '';
  // 第十一轮 D-5：普通对象直接索引会命中 Object.prototype（#/__proto__ 把
  // "fn is not a function" 甩给用户），改为自有属性判定。
  const fn = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : null;
  // tab 高亮
  const tabMap = { '': 'home', 'cat': 'home', 'c': 'home', 's': 'search', 't': 'home', 'tags': 'home', 'd': 'home', 'dy': 'home', 'm': 'home', 'g': 'home', 'fav': 'fav', 'recite': 'recite', 'excerpts': 'fav', 'settings': 'settings', 'data': 'settings', 'src': '', 'h': '', 'n': 'settings', 'p': '', 'a': '', 'j': '', 'hb': '', 'fh': '', 'bz': '', 'jl': '' };
  const tab = tabMap[key] ?? key;
  for (const a of tabbar.querySelectorAll('a')) {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    // 读屏靠 aria-current 判断"我在哪一页"，光看颜色不行
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!fn) {   // 不存在的路由：《...》别把 "fn is not a function" 甩给用户
    setAppHTML(seq, '<div class="empty-state"><div class="big">误</div>没有这个页面<br><a href="#/" style="color:var(--accent)">回首页</a></div>');
    return;
  }
  try {
    // 序号作为第二参数传给视图；视图内部每个 await 后都必须校验，见 render-guard.js
    await fn(seg.slice(1), seq);
  } catch (e) {
    console.error(e);
    if (isCurrent(seq)) {
      const msgStr = String((e && e.message) || e);
      // 离线（首访未完成初始化、或断网后进未缓存页）给友好态 + 自动重试，
      // 不再甩「manifest 加载失败」这类报错文案（评审 N8）
      const offline = !navigator.onLine || /manifest 加载失败|Failed to fetch|NetworkError|load failed|数据加载失败|timeout|abort/i.test(msgStr);
      if (offline) {
        setAppHTML(seq, '<div class="empty-state"><div class="big">离</div>当前离线，联网后会自动重试<br>' +
          '<span class="section-tip">首次使用需联网完成初始化；已看过的内容离线也能读</span></div>');
        // 第十一轮 C-4：原条件 !navigator.onLine 写反（联网后反而不重试），且无 online 监听。
        setTimeout(() => { if (isCurrent(seq)) render(); }, 30000);
      } else {
        // 异常消息可能夹带数据文件名等，插 innerHTML 前过 esc（第十轮 🟡-5）
        setAppHTML(seq, `<div class="empty-state"><div class="big">误</div>页面加载出错：${esc(msgStr)}</div>`);
      }
    }
  }
  if (!isCurrent(seq)) return;
  // 视图白屏兜底：异步失败时宁可让用户看到"重试"，也不要留一块空白纸
  if (!app.innerHTML.trim()) {
    setAppHTML(seq, '<div class="empty-state"><div class="big">误</div>这一页没加载出来<br>' +
      '<button class="set-toggle" id="boot-retry" style="color:var(--accent)">点这里重新加载</button></div>');
    const retry = document.getElementById('boot-retry');
    if (retry) retry.onclick = () => location.reload();
  }
  // 带 ?cur= 的列表要自己定位到当前行，不能把滚动拉回顶部
  if (!/[?&](cur|n|v)=/.test(hash)) window.scrollTo(0, 0);   // ?n= 眉批、?v= 名句定位，别把滚动拉回顶部
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => render());   // 第十一轮 C-4：联网立刻重渲染，不等 30 秒

// 启动
applyTheme();
applyKaiFont();   // 楷体子集开关：关掉时 4.1MB 字体一个字节都不会请求
// 「自动」模式按时间换肤：每分钟对一次表，跨过 18:00 / 次日 06:00 就会切；
// 从后台切回前台也立刻对一次（手机息屏一晚上，回来不该还是白天的配色）。
setInterval(() => { if (pref('theme') === 'auto') applyTheme(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pref('theme') === 'auto') applyTheme();
});
// 跟随系统模式：OS 切换深浅色时实时跟（auto 走上面的对表；这里是键不存在的情况）
if (window.matchMedia) {
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  if (mqDark.addEventListener) mqDark.addEventListener('change', () => { if (!pref('theme')) applyTheme(); });
}
const fsSaved = parseInt(pref('fs') || '17', 10);
// 第十一轮 P3：导入备份的坏值会变成 NaN → --fs: NaNpx，先把范围兜住
const fsPx = Number.isFinite(fsSaved) && fsSaved >= 10 && fsSaved <= 40 ? fsSaved : 17;
document.documentElement.style.setProperty('--fs', fsPx + 'px');
tabbar.classList.remove('hidden');
initInkBackground();     // 实时水墨背景（纯 canvas，绘制一次；resize / 切主题时重绘）
// 简繁显示（2026-10-29）：默认繁體。先设模式、载齐映射再首渲染，
// 避免第一帧闪原生繁简混排；映射加载失败（离线首访）则原样显示，不阻塞启动。
setZhMode(pref('zh'));
// 第十一轮 A-2：首渲染原挂在裸 `getManifest().finally()` 上，manifest 永久 pending
// 时首屏会一直停在「载入中…」。改为「启动依赖 vs 硬超时」赛跑，超时也放行 render。
const BOOT_TIMEOUT_MS = 8000;
const bootReady = Promise.all([
  getManifest().catch(() => null),
  loadCharMap().catch(() => {}),
  loadZhConv().catch(() => {}),
]);
Promise.race([
  bootReady,
  new Promise(res => setTimeout(res, BOOT_TIMEOUT_MS)),
]).then(() => {
  migrateDedupRemap();   // 去重后：用户数据旧 i → 保留正文 i（一次性，按 remap.v 幂等）
  preloadSearch();
  // 界面框架文字（按钮/标题/提示/tabbar）的简繁跟随：装好再首渲染，
  // 首屏和之后每次视图落屏都会被观察器统一转换；正文等内容层幂等跳过。
  try { installZhUi(); } catch (e) { console.warn('[boot] installZhUi', e); }
  render();
});

// Service Worker
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // 新版 SW 接管后自动刷新一次：否则用户要手动刷两次才能看到刚改的代码
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

// 未处理的 Promise 异常可视化（避免异步逻辑静默失败）
window.addEventListener('unhandledrejection', (e) => {
  if (window.__surfacedErr) return;
  window.__surfacedErr = true;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#a3372f;color:#fff;font-size:11px;line-height:1.4;padding:6px;z-index:999;max-height:45%;overflow:auto;white-space:pre-wrap;word-break:break-all';
  d.textContent = '异常: ' + ((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason));
  document.body.appendChild(d);
});
