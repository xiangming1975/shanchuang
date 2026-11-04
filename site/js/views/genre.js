// 页面：体裁（#/g/<体裁>）
// 近体/古体/古文/赋的介绍是写死的；词牌介绍取 idx/cipai.json（含格律串）。
// 名篇取 idx/genre.json 里构建期挑好的 id（热标记或来自精选集），再用 id 批量取行。
import { app, topbar, LE_PREFIX, cutTitle, displayTitle, titleMax, snippetOf, emptyHtml, safeDecode } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { loadRowsByIds } from './list.js';
import { getGenre, getCitpl, colIdOf, setNavCtx } from '../store.js';
import { esc } from '../py.js';
import { cachedText } from '../store.js';
import { zhShow } from '../fn.js';

// 静态说明：每种体裁一段定义 + 一段要诀
const TEXT = {
  '五绝': {
    sum: '五言绝句。四句，每句五字，共二十字。是近体诗里最短的一体，讲究一句一境，往往以景结情。',
    how: [
      '平仄：只有四种基本句式，按「首句第二字」分平起、仄起，按「首句末字」分入韵、不入韵，共四式。',
      '押韵：二、四句押平声韵，首句可押可不押；一韵到底，不换韵。',
      '对仗：不要求。',
    ],
    sample: ['仄仄平平仄  ← 仄起不入韵', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
  },
  '七绝': {
    sum: '七言绝句。四句，每句七字，共二十八字。唐人最盛，写景、送别、怀古皆宜，名篇数量在近体诗里最多。',
    how: [
      '平仄：四式，由五绝句式前加两字而来；一三五字平仄可通融，二四六字必须守。',
      '押韵：二、四句押平声韵，首句多入韵。',
      '对仗：不要求，前两句对仗的写法很常见。',
    ],
    sample: ['平平仄仄平平仄  ← 平起不入韵', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平'],
  },
  '五律': {
    sum: '五言律诗。八句，每句五字，共四十字。四联依次为首联、颔联、颈联、尾联，中间两联须对仗。',
    how: [
      '平仄：四式，前四句与五绝同，后四句循环一次（第五句粘第四句）。',
      '押韵：二、四、六、八句押平声韵，首句可押可不押。',
      '对仗：颔联、颈联必须对仗，是律诗最硬的一条。',
    ],
    sample: ['仄仄平平仄', '平平仄仄平', '平平平仄仄  ← 颔联', '仄仄仄平平  ← 颔联', '仄仄平平仄', '平平仄仄平', '平平平仄仄  ← 颈联', '仄仄仄平平  ← 颈联'],
  },
  '七律': {
    sum: '七言律诗。八句，每句七字，共五十六字。格律最严、容量最大，杜甫的七律被视为极则。',
    how: [
      '平仄：四式，前四句与七绝同，后四句循环一次。',
      '押韵：二、四、六、八句押平声韵，首句多入韵。',
      '对仗：颔联、颈联对仗；部分名篇四联全对。',
    ],
    sample: ['仄仄平平仄仄平  ← 仄起入韵', '平平仄仄仄平平', '平平仄仄平平仄  ← 颔联', '仄仄平平仄仄平  ← 颔联', '仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄  ← 颈联', '仄仄平平仄仄平  ← 颈联'],
  },
  '五古': {
    sum: '五言古诗。句数不限，每句五字。汉魏以来的老体式，不讲平仄粘对，靠气韵和叙述取胜。',
    how: [
      '平仄：无固定格律，只要求读来顺口；本站在这类作品上只标字音平仄，不校格律。',
      '押韵：可隔句押、可换韵，比近体自由。',
      '对仗：不要求。',
    ],
    sample: null,
  },
  '七古': {
    sum: '七言古诗。句数不限，每句七字。李白、岑参一路的写法，气势开张，常伴长短句。',
    how: [
      '平仄：无固定格律。',
      '押韵：常换韵，甚至一句一韵。',
      '对仗：不要求。',
    ],
    sample: null,
  },
  '古体': {
    sum: '古体诗（杂言）。句数、字数都不固定，三言到九言混用，是《诗经》《乐府》以来的自由体。',
    how: [
      '平仄：无固定格律。',
      '押韵：宽，可换韵、可通押。',
      '说明：本站在这类作品上只标字音平仄，不作格律校验。',
    ],
    sample: null,
  },
  '古文': {
    sum: '古文（散文）。不收格律约束，包含先秦诸子、史传、唐宋八大家一路的散体文章。',
    how: ['本站古文主要来自《古文观止》《古文典籍》与四书，附注释与译文。'],
    sample: null,
  },
  '赋': {
    sum: '赋。介于诗文之间，铺陈排比、多用对偶，汉赋宏丽，魏晋六朝转骈，唐宋趋于散文化。',
    how: ['本站赋作取自《历代赋》，按朝代排列。'],
    sample: null,
  },
  '词': {
    sum: '词。依词牌填写，每牌有固定句数、字数与平仄，故名「长短句」。分小令、中调、长调。',
    how: [
      '结构：多分上下两阕，上阕写景、下阕抒情是常见章法。',
      '平仄：依词谱，每个词牌各不相同；词谱里「中」表示可平可仄。',
      '押韵：位置由词牌规定，平韵、仄韵、换韵各有定式。',
    ],
    sample: null,
  },
};

const CI_PREFIX = '词·';

function sectionHtml(title, items) {
  if (!items || !items.length) return '';
  return `<div class="card"><h2>${title}</h2><div class="annotate">${items.map(x => `<p style="margin:0 0 8px">${esc(x)}</p>`).join('')}</div></div>`;
}

async function genreView(seg, seq = currentRenderSeq()) {
  const key = safeDecode(seg[0] || '');
  setAppHTML(seq, topbar(zhShow(key) || '体裁', { back: true }) + '<div class="loading"></div>');

  const map = await getGenre().catch(() => ({}));
  if (!isCurrent(seq)) return;
  const info = map[key];
  if (!info && !TEXT[key] && !key.startsWith(CI_PREFIX)) {
    setAppHTML(seq, topbar(zhShow(key) || '体裁', { back: true }) +
      emptyHtml('空', '没有这个体裁<br><a style="color:var(--accent)" href="#/tags">看看全部标签</a>'));
    return;
  }

  const isCi = key.startsWith(CI_PREFIX);
  const name = isCi ? key.slice(CI_PREFIX.length) : key;
  const t = TEXT[key] || (isCi ? TEXT['词'] : null);

  // 词牌：简介与格律串都来自 cipai.json（与搜索结果里的词牌卡同源）
  let cp = null;
  if (isCi) {
    try {
      const list = JSON.parse(await cachedText('data/idx/cipai.json'));
      cp = list.find(x => x.n === name) || null;
    } catch {}
  }

  // 第一段必须是这个体裁自己的解释：词牌用词牌简介，不能拿「词」的通论顶上
  let sumText;
  if (isCi) {
    sumText = (cp && cp.i) ? zhShow(cp.i) : `词牌「${zhShow(name)}」。现存词谱未收本调，本站按同调作品的平仄反推其格律，详见下方词谱卡。`;
  } else {
    sumText = (t && t.sum) || '';
  }

  // 词谱卡：有格律串就列串；没有就退回同调统计（很多常用词牌现存词谱不收正体）
  let cipaiHtml = '';
  if (isCi) {
    if (cp && cp.g) {
      cipaiHtml = `<div class="card"><h2>词谱</h2>
        ${cp.cat ? `<div class="section-tip" style="margin:0 0 6px">${esc(zhShow(cp.cat))}</div>` : ''}
        <div class="genre-pattern">${esc(cp.g.split('【')[0].split('。').filter(x => x.trim()).map(x => x.trim() + '。').join('\n'))}</div>
        <div class="section-tip" style="margin-top:8px">「中」表示可平可仄；括号内的「韵」是押韵位置。</div></div>`;
    } else {
      try {
        const tpl = await getCitpl();
        const cands = Object.keys(tpl).filter(k => k.startsWith(name + '|'))
          .map(k => {
            const [pat, n] = tpl[k];
            return { chars: +k.split('|')[1], n, fixed: [...pat].filter(c => c !== '中').length / pat.length };
          })
          .sort((a, b) => b.n - a.n);
        if (cands.length) {
          const c0 = cands[0];
          cipaiHtml = `<div class="card"><h2>词谱</h2>
            <div class="annotate" style="font-size:0.86rem">
              常见字数 ${c0.chars} 字（同调 ${c0.n} 首统计，其中 ${Math.round(c0.fixed * 100)}% 的字位平仄固定）。
            </div>
            <div class="section-tip" style="margin-top:8px">
              现存词谱未收此调的正体，故不列逐字平仄；点正文上方的「平仄」可看本站按同调反推的标注。
            </div></div>`;
        }
      } catch {}
    }
  }

  if (!isCurrent(seq)) return;

  const fmt = t && t.sample ? `<div class="card"><h2>平仄格式</h2>
    <div class="genre-pattern">${t.sample.map(x => `<div>${esc(x)}</div>`).join('')}</div></div>` : '';

  const howTitle = isCi ? '填词通则' : '格律要点';
  const howHtml = (t && t.how) ? `<div class="card"><h2>${howTitle}</h2>
    <div class="annotate" style="font-size:0.88rem">${t.how.map(x => `<p style="margin:0 0 8px">${esc(x)}</p>`).join('')}</div>
    ${isCi ? '<div class="section-tip" style="margin-top:6px">以上是词的通则，具体到这个词牌以词谱为准。</div>' : ''}</div>` : '';

  setAppHTML(seq, topbar(zhShow(isCi ? name : key), { back: true, extra: info ? `<span class="act">${info.n.toLocaleString()} 篇</span>` : '' }) + `
    <div class="card">
      <h2>${esc(zhShow(isCi ? name : key))}</h2>
      <div class="annotate">${esc(zhShow(sumText))}</div>
      ${info ? `<div class="section-tip" style="margin-top:8px">本站收录 ${info.n.toLocaleString()} 篇</div>` : ''}
    </div>
    ${cipaiHtml}
    ${howHtml}
    ${fmt}
    <div class="group-title">名篇</div>
    <div class="list" id="g-list"><div class="loading"></div></div>
    <div class="section-tip" style="text-align:center;margin-top:10px">名篇按热度与精选集挑选，不按年代排序</div>`);

  const listEl = document.getElementById('g-list');
  const ids = (info && info.top) || [];
  setNavCtx(ids, (isCi ? '词牌' : '体裁') + ' · ' + (isCi ? name : key)).catch(() => {});   // 阅读队列：该体裁名篇（≤20）
  if (!ids.length) { listEl.innerHTML = emptyHtml('篇', '这一类暂无可推荐的名篇'); return; }
  try {
    const rows = await loadRowsByIds(ids);
    if (!isCurrent(seq)) return;
    // 名篇要带首句：同一词牌下十几首《浣溪沙》，只有题目分不出来
    const item = (r) => {
      const plain = String(r.t || '').replace(LE_PREFIX, '');
      const full = displayTitle(r);
      const snip = snippetOf(r.p && r.p[0]);
      // 词的首句已经进标题了，下面那行首句就不用再叠一遍
      const showSnip = snip && full === plain;
      return `<a class="row" href="#/p/${r.i}" title="${esc(full)}"><span class="rt">${esc(cutTitle(full, titleMax(colIdOf(r.i))))}</span><span class="ra">${esc(zhShow(r.a || '佚名'))}</span></a>` +
        (showSnip ? `<div class="snippet">${esc(snip)}</div>` : '');
    };
    listEl.innerHTML = rows.map(item).join('') || emptyHtml('', '名篇数据加载失败');
  } catch {
    listEl.innerHTML = emptyHtml('', '名篇数据加载失败');
  }
}

export { genreView };
