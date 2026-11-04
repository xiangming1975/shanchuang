// 拼音/平仄渲染：pinyin-pro（UMD 全局 pinyinPro），逐字 memoize
import { esc } from './html.js';
export { esc };
// fns：脚注命中 [{start,len,n}]
// pzs：平仄逐字标注（charIdx -> '平'|'仄'|'中'），每字正下方
const memo = new Map();
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function hasPinyinLib() { return typeof window !== 'undefined' && window.pinyinPro && window.pinyinPro.pinyin; }

// 拼音库按需加载（评审细项 9）：vendor 脚本不再随首屏载入（约 500KB），开「拼音」时才拉。
// SW 的 fetch 处理器会把首次拉取缓存下来，之后离线可用；失败允许重试。
let pyLibPromise = null;
export function ensurePinyinLib() {
  if (hasPinyinLib()) return Promise.resolve(true);
  if (!pyLibPromise) {
    pyLibPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'vendor/pinyin-pro.min.js';
      s.onload = () => {
        const ok = hasPinyinLib();
        // 第十一轮 P3：脚本 200 但库没挂上（内容损坏 / 旧 SW 把 HTML 缓存到该 URL）
        // 时，不能让 resolved(false) 固化整会话。清掉 promise 允许下次重试。
        if (!ok) pyLibPromise = null;
        resolve(ok);
      };
      s.onerror = () => { pyLibPromise = null; resolve(false); };
      document.head.appendChild(s);
    });
  }
  return pyLibPromise;
}

// 平仄串与正文字符 zip：汉字取下一个 平/仄/中，标点跳过；汉字数不足则返回 null（调用方退回整行式）
export function zipStrain(text, strain) {
  if (!strain) return null;
  const chars = [...String(text)];
  const ss = [...String(strain)];
  const out = new Array(chars.length).fill(null);
  let k = 0;
  for (let i = 0; i < chars.length; i++) {
    if (!CJK.test(chars[i])) continue;
    while (k < ss.length && !/[平仄中○●？?]/.test(ss[k])) k++;
    if (k >= ss.length) return null;
    out[i] = ss[k];
    k++;
  }
  return out;
}

// 多音字消歧必须**整行**喂给 pinyin-pro：它内置分词与词典（「参差」→ cēncī，「参」单查 → cān）。
// 逐字调用会把上下文丢掉，永远返回最高频单字音（踩过：「参差荇菜」标成 cān chà）。
// type:'all' 每项带 origin，按码点索引对齐回原串；nonZh:'consecutive' 让连续非汉字并成一项，
// origin 拼起来正好还原整行，索引不错位。逐字 memo 只作整行调用失败时的兜底。
const lineMemo = new Map();
function pinyinPerChar(text) {
  if (lineMemo.has(text)) return lineMemo.get(text);
  let out = null;
  try {
    const items = window.pinyinPro.pinyin(text, { toneType: 'symbol', type: 'all', nonZh: 'consecutive' });
    if (Array.isArray(items)) {
      out = new Map();                       // 码点索引 -> 拼音
      let i = 0;
      for (const it of items) {
        const org = [...String(it && it.origin || '')];
        if (org.length === 1 && CJK.test(org[0]) && it.isZh && it.pinyin) out.set(i, it.pinyin);
        i += org.length;
      }
    }
  } catch {}
  if (lineMemo.size > 400) lineMemo.clear(); // 行级缓存封顶（防长诗反复切开关时无界增长）
  lineMemo.set(text, out);
  return out;
}

export function rubyHTML(text, fns, usePy, pzs) {
  if (usePy === undefined) usePy = true;
  if (usePy && !hasPinyinLib()) { usePy = false; }
  const linePy = usePy ? pinyinPerChar(String(text)) : null;
  let out = '';
  const marks = new Map(); // charIdx -> [{open/close, n}]
  if (fns && fns.length) {
    for (const h of fns) {
      if (!marks.has(h.start)) marks.set(h.start, []);
      marks.get(h.start).push({ open: true, n: h.n });
      const end = h.start + h.len;
      if (!marks.has(end)) marks.set(end, []);
      marks.get(end).push({ open: false, n: h.n });
    }
  }
  let ci = 0;
  const openNs = [];
  const emit = (core, pz) => {
    out += pz ? `<span class="pzcell">${core}<i class="pzw">${pz}</i></span>` : core;
  };
  for (const ch of String(text)) {
    if (marks.has(ci)) {
      for (const m of marks.get(ci)) {
        if (m.open) { out += `<span class="fn" data-n="${m.n}"><span class="fnw">`; openNs.push(m.n); }
        else { const n = openNs.pop(); out += `</span><sup class="fnn" data-n="${n}">${n + 1}</sup></span>`; }
      }
    }
    const pz = pzs ? pzs[ci] : null;
    if (usePy && CJK.test(ch)) {
      let py = linePy ? linePy.get(ci) : undefined;
      if (py === undefined) {                 // 整行结果里没有（库异常 / 罕见字）→ 逐字兜底
        py = memo.get(ch);
        if (py === undefined) {
          try {
            const arr = window.pinyinPro.pinyin(ch, { toneType: 'symbol', type: 'array' });
            py = (arr && arr[0]) || ch;
          } catch { py = ch; }
          memo.set(ch, py);
        }
      }
      emit(py === ch ? esc(ch) : `<ruby>${esc(ch)}<rt>${esc(py)}</rt></ruby>`, pz);
    } else if (ch === '\n') {
      out += '<br>';
    } else {
      emit(esc(ch), pz && CJK.test(ch) ? pz : null);
    }
    ci++;
  }
  // 词条结束在文本末尾时，补发上标与闭合
  for (const n of openNs) out += `</span><sup class="fnn" data-n="${n}">${n + 1}</sup></span>`;
  return out;
}

// 无拼音、仅脚注/平仄标记
export function annotHTML(text, fns, pzs) {
  return rubyHTML(text, fns, false, pzs);
}

