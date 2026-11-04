// SW SHELL / modulepreload 一致性断言（评审 N4）。
//
// 背景：views.js 直接 re-export 的视图在启动模块图里，漏进 SHELL = 离线整站白屏
//（history.js 那次，第四轮 R2 修的）；`index.html` 的 modulepreload 漏了则在线首屏
// 也要多一跳串行模块发现。把「加视图忘同步清单」变成 npm test 能当场抓住的断言。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SITE } from './dom-shim.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; console.log('✗ ' + name + ' —— ' + got); }
};

const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
const shellStart = sw.indexOf('const SHELL = [');
const shellEnd = sw.indexOf('];', shellStart);
const shell = [...sw.slice(shellStart, shellEnd).matchAll(/'([^']+)'/g)].map(m => m[1]);

// ① SHELL 每一项都真实存在（防止改名/漏拷后离线静默缺文件）
for (const u of shell) ok('SHELL 文件存在: ' + u, fs.existsSync(path.join(SITE, u)), '缺 ' + u);

// ①b 按需加载的动态资源不在 SHELL（首访不下载），但文件必须真实存在
ok('拼音库不进 SHELL（按需加载）', !shell.includes('vendor/pinyin-pro.min.js'), 'vendor 在 SHELL 里');
ok('动态资源存在: vendor/pinyin-pro.min.js', fs.existsSync(path.join(SITE, 'vendor/pinyin-pro.min.js')), '缺 vendor/pinyin-pro.min.js');

// ② views.js re-export 的每个视图（启动模块图）必须在 SHELL 里
const viewsSrc = fs.readFileSync(path.join(SITE, 'js/views.js'), 'utf8');
const bootViews = [...viewsSrc.matchAll(/from '\.\/(views\/[^']+\.js)'/g)].map(m => 'js/' + m[1]);
ok('views.js 确实 re-export 了视图（防正则失配）', bootViews.length >= 10, bootViews.length + ' 个');
for (const v of bootViews) ok('启动视图在 SHELL: ' + v, shell.includes(v), v);

// ③ 同时要有 modulepreload（在线首屏少一跳）
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const preloads = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);
for (const v of bootViews) ok('启动视图有 modulepreload: ' + v, preloads.includes(v), v);

// ④ 已知的基础模块也要在 preload（app.js 的直接/二跳依赖）
for (const m of ['js/app.js', 'js/store.js', 'js/views.js', 'js/vcommon.js', 'js/py.js', 'js/html.js', 'js/fn.js', 'js/rank.js', 'js/inkbg.js', 'js/regu.js']) {
  ok('modulepreload: ' + m, preloads.includes(m), m);
}

// ⑤ 楷体子集（A18）：文件在、体积不超门禁、CSS 真引用了它
//    字体几 MB，最容易「悄悄多嵌一个字重/字族」——门禁按探针实测的 4.14MB 定 4.6MB 上限。
{
  const fontRel = 'fonts/lxgw-wenkai-sub.woff2';
  const fontPath = path.join(SITE, fontRel);
  ok('楷体子集存在: ' + fontRel, fs.existsSync(fontPath), '缺文件，跑 npm run font');
  if (fs.existsSync(fontPath)) {
    const mb = fs.statSync(fontPath).size / 1048576;
    ok('楷体子集体积 ≤ 4.6MB（实测 4.14MB）', mb > 0.5 && mb <= 4.6, mb.toFixed(2) + 'MB');
  }
  ok('字体许可在: fonts/OFL.txt', fs.existsSync(path.join(SITE, 'fonts/OFL.txt')), '缺 OFL');
  const css = fs.readFileSync(path.join(SITE, 'css/style.css'), 'utf8');
  ok('CSS 有 @font-face', /@font-face\s*\{/.test(css), '没有 @font-face');
  ok('CSS 引用子集路径正确（相对 css/ 目录）', css.includes('url("../fonts/lxgw-wenkai-sub.woff2")'), '路径对不上');
  ok('楷体走 CSS 变量（一处开关管全站）', /--kai:\s*"LXGW WenKai"/.test(css), '--kai 没定义');
  ok('关掉开关时不请求字体', /\[data-kai="0"\]\s*\{\s*--kai:[^}]*\}/.test(css), '缺少 data-kai=0 覆盖');
}

// ⑥ 第十一轮 F-4 / E-6：SHELL 补齐、CSP 三处一致、内联脚本 hash、版本号同步
{
  // 6a vendor/pako.esm.mjs 必须在 SHELL（老浏览器解压 gzip 全靠它，离线不能等用到才拉）
  ok('SHELL 含 vendor/pako.esm.mjs', shell.includes('vendor/pako.esm.mjs'), 'SHELL 缺 vendor/pako.esm.mjs');

  // 6b render-guard.js 进 SHELL，且 index.html 有对应 modulepreload
  ok('SHELL 含 js/render-guard.js', shell.includes('js/render-guard.js'), 'SHELL 缺 js/render-guard.js');
  const rgPreload = [...html.matchAll(/<link\b[^>]*>/g)].some(t =>
    /rel="modulepreload"/.test(t[0]) && /href="[^"]*js\/render-guard\.js/.test(t[0]));
  ok('index.html 有 js/render-guard.js 的 modulepreload', rgPreload, 'modulepreload 缺 js/render-guard.js');

  // 6c 三处 CSP 字符串完全一致（_headers / server.js / index.html 的 meta content）
  const srv = fs.readFileSync(path.join(SITE, '..', 'server.js'), 'utf8');
  const hdr = fs.readFileSync(path.join(SITE, '_headers'), 'utf8');
  const cspHtml = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
  const cspSrv = (srv.match(/const\s+CSP\s*=\s*"([^"]*)"/) || [])[1] || '';
  const hdrLine = hdr.split(/\r?\n/).find(l => l.trim().startsWith('Content-Security-Policy:')) || '';
  const cspHdr = hdrLine.slice(hdrLine.indexOf(':') + 1).trim();
  ok('index.html 能提取 CSP', !!cspHtml, '未匹配到 http-equiv=Content-Security-Policy 的 content');
  ok('server.js 能提取 CSP', !!cspSrv, '未匹配到 const CSP = "..."');
  ok('_headers 能提取 CSP', !!cspHdr, '未匹配到 Content-Security-Policy: 行');
  ok('三处 CSP 字符串完全一致', !!cspHtml && cspHtml === cspSrv && cspSrv === cspHdr,
    `html=${JSON.stringify(cspHtml)}\n    srv=${JSON.stringify(cspSrv)}\n    hdr=${JSON.stringify(cspHdr)}`);

  // 6d 唯一内联 <script> 的 sha256 必须等于 CSP 里放行的 'sha256-...'
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  ok('index.html 只有 1 个内联 <script>', inline.length === 1, inline.length + ' 个');
  const inlineHash = inline.length
    ? 'sha256-' + crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64') : '(无内联脚本)';
  const cspHash = (cspHtml.match(/sha256-[A-Za-z0-9+/=]+/) || [])[0] || '';
  ok('CSP 含 sha256 放行令牌', !!cspHash, 'CSP 里没有 sha256-... : ' + JSON.stringify(cspHtml));
  ok('内联脚本 sha256 == CSP 的 sha256-...', inlineHash === cspHash,
    `内联=${inlineHash} CSP=${cspHash || '(缺)'}`);
  ok('三处 CSP 共用同一 sha256 令牌', !!cspHash && cspSrv.includes(cspHash) && cspHdr.includes(cspHash),
    `令牌=${cspHash || '(缺)'} server=${cspSrv.includes(cspHash)} _headers=${cspHdr.includes(cspHash)}`);

  // 6e 版本号同步：SW 的 CACHE 与 index.html 的 style.css?v= 必须一起 bump（宽松：只验同时存在）
  const cache353 = /CACHE\s*=\s*['"]shici-shell-v353['"]/.test(sw);
  const css192 = /style\.css\?v=192(?!\d)/.test(html);
  ok('sw.js CACHE 已 bump 到 shici-shell-v353', cache353,
    (sw.match(/const\s+CACHE\s*=\s*['"][^'"]+['"]/) || ['未找到 CACHE'])[0]);
  ok('index.html style.css?v=192 已 bump', css192,
    (html.match(/style\.css\?v=\d+/) || ['未找到 style.css?v='])[0]);
  ok('版本号一致性：v353 与 ?v=192 同时存在', cache353 && css192,
    `CACHE(v353)=${cache353} style.css?v=192=${css192}`);

  // 6f 首访预算（第十一轮 F-2）：关键路径不能无限膨胀。
  const storeSrc = fs.readFileSync(path.join(SITE, 'js', 'store.js'), 'utf8');
  const preloadCount = [...html.matchAll(/rel="modulepreload"/g)].length;
  ok('modulepreload 不超过 36 个', preloadCount <= 36, preloadCount + ' 个');
  ok('getManifest 用条件请求（不再用 ?_= 禁用 HTTP 缓存）',
    /fetchWithTimeout\('data\/manifest\.json',\s*\{\s*cache:\s*'no-cache'\s*\}/.test(storeSrc),
    'manifest 请求未使用 cache:no-cache');
  const manifestPath = path.join(SITE, 'data', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const kb = fs.statSync(manifestPath).size / 1024;
    ok('manifest.json 不超过 256KB', kb <= 256, kb.toFixed(1) + ' KB');
  }
}

console.log(fail ? `✗ shell 一致性 ${fail}/${pass + fail} 失败` : `✓ shell 一致性 ${pass} 项全过`);
process.exit(fail ? 1 : 0);
