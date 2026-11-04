// render-guard.js 纯语义测试（第十一轮 A-3 / E-1 / E-2）。
//
// 只测这个独立模块的语义，不做 app.js 静态扫描（app.js 正在并行改动，避免与实现打架）。
// 用 dom-shim 装好 document/window；为观测 DOM 写入，把 getElementById 固定到一个
// makeEl() 实例上（垫片默认每次返回新元素，写没写看不出来）。
import { makeEl } from './dom-shim.mjs';

const {
  nextRenderSeq, currentRenderSeq, isCurrent, setAppHTML, appEl,
} = await import('../site/js/render-guard.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
};

// ① nextRenderSeq 递增，currentRenderSeq 跟随最后一次领取
const s1 = nextRenderSeq();
const s2 = nextRenderSeq();
eq('nextRenderSeq 递增（+1）', s2, s1 + 1);
eq('currentRenderSeq 等于最后一次领取的序号', currentRenderSeq(), s2);

// ② isCurrent：旧序号失效，当前序号 / undefined 有效
eq('isCurrent(旧 seq) 为 false', isCurrent(s1), false);
eq('isCurrent(当前 seq) 为 true', isCurrent(s2), true);
eq('isCurrent(undefined) 为 true', isCurrent(undefined), true);
eq('isCurrent(乱值) 为 false', isCurrent(s2 + 999), false);

// ③ setAppHTML：过期序号不写 DOM，当前序号 / undefined 才写
const app = makeEl('div');
app.innerHTML = 'ORIGINAL';
globalThis.document.getElementById = (id) => (id === 'app' ? app : makeEl());
eq('setAppHTML(旧 seq) 返回 false', setAppHTML(s1, 'STALE'), false);
eq('setAppHTML(旧 seq) 不写 DOM', app.innerHTML, 'ORIGINAL');
eq('setAppHTML(undefined) 放行', setAppHTML(undefined, 'UNDEF'), true);
eq('setAppHTML(undefined) 写入 DOM', app.innerHTML, 'UNDEF');
eq('setAppHTML(当前 seq) 返回 true', setAppHTML(s2, 'FRESH'), true);
eq('setAppHTML(当前 seq) 写入 DOM', app.innerHTML, 'FRESH');
eq('appEl(旧 seq) 返回 null', appEl(s1), null);
eq('appEl(当前 seq) 返回 #app', appEl(s2) === app, true);

// ④ 再领一次序号，上一轮的 s2 也应变成过期（旧异步回调不许再写）
const s3 = nextRenderSeq();
eq('再领序号后 s2 过期', isCurrent(s2), false);
eq('再领序号后 s2 的 setAppHTML 不写 DOM', setAppHTML(s2, 'STALE2'), false);
eq('DOM 仍停在 FRESH', app.innerHTML, 'FRESH');
eq('currentRenderSeq 跟随 s3', currentRenderSeq(), s3);

console.log(fail ? `\n✗ render-guard ${fail}/${pass + fail} 失败` : `✓ render-guard ${pass} 项全过`);
process.exit(fail ? 1 : 0);
