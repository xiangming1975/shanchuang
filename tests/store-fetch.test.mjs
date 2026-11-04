// 第十一轮 E-6：数据层取数的故障路径回归。
// 用 dom-shim 的 setFetchMode 注入 404 / SPA 假 200 / 坏 gzip，
// 断言 cachedText 能按设计回退、且不把解压失败伪装成「作品不存在」。
import './dom-shim.mjs';
import { setFetchMode } from './dom-shim.mjs';
import { cachedText } from '../site/js/store.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; console.log('✗ ' + name + ' —— ' + got); }
};
const URL = 'data/idx/pingze.json';   // KEEP_PLAIN 表：明文 + .gz 同时存在
const parses = (s) => { try { return !!JSON.parse(s); } catch { return false; } };

async function main() {
  setFetchMode('ok');
  const good = await cachedText(URL, true);
  ok('正常路径：.gz 经 DecompressionStream 解压后可解析', parses(good), String(good).slice(0, 60));

  setFetchMode('gz404');
  const plain = await cachedText(URL, true);
  ok('.gz 缺失时回退明文表', parses(plain), String(plain).slice(0, 60));

  setFetchMode('html200');
  let htmlErr = null;
  try { await cachedText(URL, true); } catch (e) { htmlErr = e; }
  ok('SPA 假 200（text/html）不当数据', !!htmlErr && /数据加载失败/.test(htmlErr.message), String(htmlErr && htmlErr.message));

  setFetchMode('badgz');
  let badText = null, badErr = null;
  try { badText = await cachedText(URL, true); } catch (e) { badErr = e; }
  ok('坏 gzip：双兜底后回退明文，或给出明确错误',
    !!((badText && parses(badText)) || (badErr && /数据加载失败/.test(badErr.message))),
    'text=' + String(badText).slice(0, 20) + ' err=' + String(badErr && badErr.message).slice(0, 80));

  setFetchMode('nodb');
  const nodb = await cachedText(URL, true);
  ok('无 IDB 时取数链路仍可用', parses(nodb), String(nodb).slice(0, 60));

  setFetchMode('ok');   // 复位，避免污染同进程后续套件
  console.log(`store-fetch：${pass} 通过，${fail} 失败`);
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
