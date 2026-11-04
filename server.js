// 零依赖静态服务器：异步 gzip（预压缩缓存）、HTTP Range（音频 seek）、TTS 按需合成（限流）
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, 'site');
const PORT = process.argv[2] ? parseInt(process.argv[2]) : 3737;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  // 第十轮 🟡-4（2026-11-04）：字体与 gzip 数据补 MIME，原先回退 octet-stream
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.gz': 'application/gzip',
};

// 安全响应头（第十轮 🟠-4，2026-11-04）：与生产侧 site/_headers 同口径，改一处必须同步另一处。
// CSP 只放行唯一内联脚本（index.html 启动错误收集器）的 sha256——内联事件属性全站为零，
// 拼音库/pako 均 vendor 化为同源资源，无需 unsafe-inline 脚本。
const CSP = "default-src 'self'; script-src 'self' 'sha256-GrKmPj3BRylir2flCPtLks3nkOfu+GVW2dZTyr0HaDY='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const SAFE = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': CSP,
};

// gzip 预压缩缓存（异步压缩，不阻塞事件循环）；条目封顶，防爬虫把全站 chunks 都压进内存
const gzCache = new Map(); // file -> { src, z }
const GZ_CACHE_MAX = 400;

// 路径规范化：禁止 /../ 穿越到 ROOT 之外（decodeURIComponent 会把 %2e%2e%2f 还原成 ../）
function safeJoin(p) {
  const file = path.normalize(path.join(ROOT, p));
  return (file === ROOT || file.startsWith(ROOT + path.sep)) ? file : null;
}

function serveFile(req, res, p) {
  const file0 = safeJoin(p);
  if (!file0) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('403 Forbidden'); return; }
  const file = file0;
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 第十轮 🟢-2：404 不回显请求路径（那是客户端自己发的东西，回显无意义还可能被外链利用）
      console.log('[404] ' + req.method + ' ' + p);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const isData = p.indexOf('/data/') >= 0;
    const baseHeaders = { ...SAFE, 'Content-Type': type, 'Cache-Control': isData ? 'no-store' : 'no-cache', 'Accept-Ranges': 'bytes' };
    // HSTS 只在 TLS 下发：明文 HTTP 发了浏览器也忽略，还污染无痕本地调试
    if (req.socket && req.socket.encrypted) baseHeaders['Strict-Transport-Security'] = 'max-age=31536000';

    // Range 请求（音频 seek）
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [s0, e0] = range.replace('bytes=', '').split('-');
      let start, end;
      if (s0 === '' && e0 !== '') {
        // 后缀区间 bytes=-500：最后 500 字节（RFC 7233）。原先被当成前 501 字节（第十轮 🟡-2，2026-11-04）
        start = Math.max(0, st.size - parseInt(e0));
        end = st.size - 1;
      } else {
        start = s0 === '' ? 0 : parseInt(s0);
        end = e0 === '' ? st.size - 1 : parseInt(e0);
      }
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return; }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    // gzip（仅文本类）
    const accept = req.headers['accept-encoding'] || '';
    if (st.size > 1024 && /\bgzip\b/.test(accept) && /^(text\/|application\/json|application\/manifest|image\/svg)/.test(type)) {
      let cached = gzCache.get(file);
      const use = (c) => {
        res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip', 'Content-Length': c.z.length });
        res.end(c.z);
      };
      if (cached && cached.src === st.size && cached.mtime === st.mtimeMs) { use(cached); return; }
      fs.readFile(file, (err2, buf) => {
        if (err2) { res.writeHead(500); res.end(); return; }
        zlib.gzip(buf, { level: 6 }, (err3, z) => {
          if (err3) { res.writeHead(200, baseHeaders); fs.createReadStream(file).pipe(res); return; }
          const c = { src: st.size, mtime: st.mtimeMs, z };
          gzCache.set(file, c);
          if (gzCache.size > GZ_CACHE_MAX) gzCache.delete(gzCache.keys().next().value);   // FIFO 淘汰
          use(c);
        });
      });
      return;
    }
    res.writeHead(200, { ...baseHeaders, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- 按需 TTS 合成（限流） ----------
const TTS_QUEUE = [];
const TTS_STATUS = new Map();
const AUDIO_DIR = path.join(ROOT, 'audio');
const TTS_MAX_QUEUE = 50;
const ttsRunning = new Map();   // id -> child，同时在跑的合成任务

// worker 池：队列空则立即返回；有槽位就起进程（TTS_WORKERS 默认 2，机器弱可设 1）
// 合成脚本 etl/tts-one.js 已随 O1 归档到 poetry-site-archive-20261027/etl-dead/（朗诵改 speechSynthesis 后此路已废）。
// 找不到就直接失败返回，不要让 spawn 抛 ENOENT 变成 500。
const TTS_ONE = path.join(__dirname, 'etl', 'tts-one.js');
function pumpTTS() {
  while (ttsRunning.size < TTS_WORKERS && TTS_QUEUE.length) {
    const id = TTS_QUEUE.shift();
    if (id === undefined) break;
    if (!fs.existsSync(TTS_ONE)) {
      console.log('[tts] etl/tts-one.js 已归档，跳过合成请求 id=' + id);
      TTS_STATUS.clear();   // 全清：原先只删当前 id，其他 'queued' 状态会永久滞留（第十轮 🟡-3）
      TTS_QUEUE.length = 0;
      return;
    }
    TTS_STATUS.set(id, 'running');
    const child = spawn('node', [TTS_ONE, String(id)], { stdio: 'ignore' });
    ttsRunning.set(id, child);
    const done = () => {
      ttsRunning.delete(id);
      TTS_STATUS.delete(id);
      pumpTTS();
    };
    child.on('close', done);
    child.on('error', done);
    setTimeout(() => { try { child.kill(); } catch (e) {} }, 180000);
  }
}

// ---------- 鉴权与限流（公网部署前置；局域网默认阈值很宽，基本无感） ----------
const intEnv = (k, d) => { const v = parseInt(process.env[k] || '', 10); return Number.isFinite(v) && v > 0 ? v : d; };
const TTS_TOKEN = (process.env.TTS_TOKEN || '').trim();     // 设置后：API 必须带 token（给脚本/第三方用）
const TTS_PER_MIN = intEnv('TTS_PER_MIN', 8);               // 单 IP 每分钟上限
const TTS_PER_HOUR = intEnv('TTS_PER_HOUR', 60);            // 单 IP 每小时上限
const TTS_DAILY_CAP = intEnv('TTS_DAILY_CAP', 3000);        // 全站每日合成上限（防跑爆机器）
const TRUST_PROXY = process.env.TRUST_PROXY === '1';        // 反向代理后面才开，读 X-Forwarded-For
const TTS_WORKERS = intEnv('TTS_WORKERS', 2);               // 并发合成数（每个占一个 node 进程 + CPU 核）

const ipBuckets = new Map();       // ip -> { mWin, mCnt, hWin, hCnt }
// 桶只增不减：公网长期暴露于扫描流量时 Map 会缓慢膨胀。每小时清一次过期桶
// （过期的桶下次访问也会整体重置，删掉与保留等价；unref 不阻止进程退出）
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) {
    if (now - b.hWin >= 3600e3) ipBuckets.delete(ip);
  }
}, 3600e3).unref();
let dayStamp = new Date().toISOString().slice(0, 10);
let dayCount = 0;

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function overLimit(ip) {
  const now = Date.now();
  const HOUR = 3600e3, MIN = 60e3;
  let b = ipBuckets.get(ip);
  if (!b) { b = { mWin: now, mCnt: 0, hWin: now, hCnt: 0 }; ipBuckets.set(ip, b); }
  if (now - b.mWin >= MIN) { b.mWin = now; b.mCnt = 0; }
  if (now - b.hWin >= HOUR) { b.hWin = now; b.hCnt = 0; }
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) { dayStamp = today; dayCount = 0; }
  if (b.mCnt >= TTS_PER_MIN) return { code: 429, msg: '请求过于频繁，请稍后再试', retry: Math.ceil((MIN - (now - b.mWin)) / 1000) };
  if (b.hCnt >= TTS_PER_HOUR) return { code: 429, msg: '本小时合成次数已达上限', retry: Math.ceil((HOUR - (now - b.hWin)) / 1000) };
  if (dayCount >= TTS_DAILY_CAP) return { code: 503, msg: '今日合成额度已用完，请明天再试', retry: 3600 };
  b.mCnt++; b.hCnt++; dayCount++;
  return null;
}

// 只接受本站页面发起（挡住跨站盗刷）；带了 token 的调用不受此限
function sameOriginOk(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const ref = req.headers.referer || req.headers.origin || '';
  if (!ref) return true;                       // 隐私模式可能不带 Referer，交给限流兜底
  try { return new URL(ref).host === req.headers.host; } catch (e) { return false; }
}

function jsonErr(res, code, status, extra) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(Object.assign({ status, ok: false }, extra || {})));
}

function handleTTSApi(p, req, res) {
  const m = p.match(/^\/api\/tts\/(\d+)/);
  if (!m) { jsonErr(res, 404, 'notfound'); return; }
  const id = m[1];

  // ① 口令（可选）：TTS_TOKEN 存在时，必须带 ?k= 或 X-TTS-Token
  let authorized = false;
  if (TTS_TOKEN) {
    const given = (req.headers['x-tts-token'] || '') || new URLSearchParams(req.url.split('?')[1] || '').get('k') || '';
    authorized = given === TTS_TOKEN;
    if (!authorized) { jsonErr(res, 401, 'unauthorized', { message: '缺少或错误的口令' }); return; }
  } else if (!sameOriginOk(req)) {
    // ② 同源校验：只服务本站页面
    jsonErr(res, 403, 'forbidden', { message: '仅允许本站页面调用' });
    return;
  }

  // ③ 限流（token 授权调用也限，避免脚本跑爆）
  const ip = clientIp(req);
  const hit = overLimit(ip);
  if (hit) { jsonErr(res, hit.code, 'limited', { message: hit.msg, retryAfter: hit.retry }); return; }
  const mp3 = path.join(AUDIO_DIR, id + '.mp3');
  if (fs.existsSync(mp3) && fs.statSync(mp3).size > 2000) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  if (TTS_STATUS.has(id)) {
    // 已在队列/运行中
  } else if (TTS_QUEUE.length >= TTS_MAX_QUEUE) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'busy', message: '合成队列已满，请稍后再试' }));
    return;
  } else {
    TTS_QUEUE.push(id);
    TTS_STATUS.set(id, 'queued');
    pumpTTS();
  }
  const ahead = ttsRunning.size + Math.max(TTS_QUEUE.indexOf(id), 0);
  const rounds = Math.ceil(Math.max(ahead, 1) / TTS_WORKERS);
  res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    status: TTS_STATUS.get(id) || 'queued',
    ahead: Math.max(ahead, 0),
    workers: TTS_WORKERS,
    etaSec: Math.max(rounds, 1) * 25,
  }));
}

// COMPAT: 旧版 3 位分块名自动映射到 4 位（/data/poems/x-123.json → x-0123.json）
function compatPath(p) {
  const m = p.match(/^(\/data\/poems\/[^\/]+?)-(\d{3})\.json$/);
  if (!m) return p;
  const four = m[1] + '-0' + m[2] + '.json';
  try { fs.accessSync(path.join(ROOT, four)); return four; } catch (e) { return p; }
}

const server = http.createServer((req, res) => {
  // 坏百分号编码（`/data/%zz` 之类）会让 decodeURIComponent 抛 URIError。
  // 之前没兜住，扫描器/手改的链接发一次就能把整个静态服务器打挂（2026-10-27 挂过一次，58 小时后才发现）。
  let p;
  try {
    p = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  try {
    if (p === '/') p = '/index.html';
    p = compatPath(p);
    if (p.indexOf('/api/tts/') === 0) { handleTTSApi(p, req, res); return; }
    serveFile(req, res, p);
  } catch (e) {
    // 其它同步异常也别让进程退出：记一行日志，回 500
    console.error('[req] 处理异常', req.method, req.url, e && e.message);
    try { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500'); } catch {}
  }
});

// 客户端提前断开、发畸形报文时 Node 会抛 clientError，默认行为容易留下半开连接
server.on('clientError', (err, socket) => {
  try { socket.destroy(); } catch {}
});

// 端口被占（多半是已经有一个实例在跑）：说人话退出，别甩一屏 stack 让人以为服务坏了
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log(`端口 ${PORT} 已被占用 —— 多半已经有一个实例在跑，直接访问 http://127.0.0.1:${PORT} 即可。`);
    process.exit(0);
  }
  console.error('[server] 启动失败：', e && e.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`静态服务器已启动: http://127.0.0.1:${PORT} (异步gzip + Range + TTS队列${TTS_MAX_QUEUE})`);
  console.log(`TTS 防护: ${TTS_TOKEN ? '口令模式' : '同源模式'} · 并发 ${TTS_WORKERS} · 单 IP ${TTS_PER_MIN}/分 ${TTS_PER_HOUR}/时 · 全站 ${TTS_DAILY_CAP}/日${TRUST_PROXY ? ' · 信任代理头' : ''}`);
});
