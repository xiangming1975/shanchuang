// Service Worker：外壳优先（stale-while-revalidate），数据走应用层 IndexedDB 缓存
const SHELL = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/store.js',
  'js/views.js',
  'js/vcommon.js',
  'js/card.js',
  'js/regu.js',
  'js/py.js',
  'js/html.js',
  'js/rank.js',
  'js/fn.js',
  'js/uizh.js',
  'js/inkbg.js',
  'js/lunar.js',
  'js/notes.js',
  'js/views/home.js',
  'js/views/list.js',
  'js/views/tag.js',
  'js/views/tags.js',
  'js/views/detail.js',
  'js/views/search.js',
  'js/views/mine.js',
  'js/views/mingju.js',
  'js/views/genre.js',
  'js/views/dyn.js',
  'js/views/report.js',
  'js/views/history.js',
  'js/views/mynotes.js',
  'js/views/hebi.js',
  'js/views/feihua.js',
  'js/views/bz.js',
  'js/views/jl.js',
  'js/views/paged.js',
  'js/views/sources.js',
  // vendor/pinyin-pro.min.js 约 500KB，不进 SHELL：按需加载，见 js/py.js 的 ensurePinyinLib()
  // 首次拉取后由本 SW 缓存，离线仍可用
  // pako.esm.mjs（226KB）必须进 SHELL：老浏览器解压全部 gzip 数据都靠它，
  // 不能等用到才拉（第十轮 🟠-5，2026-11-04）
  'vendor/pako.esm.mjs',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/shot-read.png',
  'icons/shot-search.png',
  'icons/icon.svg'
];
const CACHE = 'shici-shell-v352';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐项预缓存：addAll 是「全成或全不成」，任何一个 404 都会让整个离线能力失效。
    // history.js 漏进 SHELL 那次就是这么静默坏掉的（失败只记 warn，不拖垮其余）。
    await Promise.all(SHELL.map(u =>
      cache.add(new Request(u, { cache: 'reload' }))
        .catch(err => console.warn('[sw] SHELL 预缓存失败：', u, err && err.message))
    ));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) return; // 数据归应用层缓存
  if (e.request.method !== 'GET') return;
  // 字体是 4.2MB 的静态资源：缓存优先，一辈子只下一次。
  // 走下面那条「网络优先」会每次刷新都回源校验一遍，没必要。
  if (url.pathname.includes('/fonts/')) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      const resp = await fetch(e.request);
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    })());
    return;
  }
  // 网络优先：拿到新壳就顺手更新缓存，断网才回退旧壳
  e.respondWith(
    fetch(e.request).then(resp => {
      // 第十轮 🟠-2（2026-11-04）：/api/ 响应不进缓存——离线时 caches.match 会吐出
      // 陈旧的 TTS 状态 JSON（误报「合成中」），也污染 shell 缓存清单
      if (resp.ok && !url.pathname.startsWith('/api/')) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request).then(hit => hit ||
      // 第十轮 🟠-1（2026-11-04）：只有页面导航（SPA 路由）才回退 index.html。
      // 子资源（JS/CSS/vendor）失败若回退 HTML，会被浏览器当 JS/CSS 解析——
      // vendor 拼音库离线首载正是这种错配（HTML-200 触发 onload、内容全是标签）。
      // 改为返回网络错误：script 的 onerror / 模块 import 的 reject 正常触发各自降级。
      (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
