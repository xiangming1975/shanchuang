// SW SHELL / modulepreload 一致性断言（评审 N4）。
//
// 背景：views.js 直接 re-export 的视图在启动模块图里，漏进 SHELL = 离线整站白屏
//（history.js 那次，第四轮 R2 修的）；`index.html` 的 modulepreload 漏了则在线首屏
// 也要多一跳串行模块发现。把「加视图忘同步清单」变成 npm test 能当场抓住的断言。
import fs from 'node:fs';
import path from 'node:path';
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

console.log(fail ? `✗ shell 一致性 ${fail}/${pass + fail} 失败` : `✓ shell 一致性 ${pass} 项全过`);
process.exit(fail ? 1 : 0);
