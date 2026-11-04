// 页面：home
import { app, rowLink, reciteDue, PROSE_SET, layoutSentences, makeLineFits } from '../vcommon.js';
import { getManifest, getPoem, getHistory, getRecites, getFavs, getExcerpts, noteTotal, luckyPoemId, readStats, cachedText, colIdOf, pref, clearNavCtx } from '../store.js';
import { esc } from '../py.js';
import { lunarDate, solarTermDate, solarTermName } from '../lunar.js';
import { zhShow } from '../fn.js';

// 设备种子：首次访问时生成一次，此后这台设备固定（用来让「四时读诗」每人不同）
function deviceSeed() {
  const K = 'sc_devseed';
  let v = null;
  try { v = localStorage.getItem(K); } catch (e) {}
  if (!v) {
    v = String((Math.random() * 4294967296) >>> 0);
    try { localStorage.setItem(K, v); } catch (e) {}
  }
  return parseInt(v, 10) || 20261027;
}

// mulberry32：一个输入 → 一个可复现的随机流。
// 老代码拿 Math.sin(day*9301+49297) 当随机源，两次调用返回同一个值（集合与位置强行绑定），
// 而且实测周期只有 10 天——每两周就重复一遍。
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 四时读诗（R1，2026-10-30）：晨读 / 午诵 / 昏习 / 夜思 —— 06:00 / 12:00 / 18:00 / 22:00 各换一篇，
// 一天四课。时刻对应日出、日中、日入、人定；读→诵→习→思是递进的工夫，不是随便四个动词。
// 每课在所属时段内固定、到点换新——「几点有新课」写在脸上，时段切换本身就是回访理由。
// 夜思跨午夜：22:00 起就算次日的课，整夜（22:00–05:59）同一篇，不在零点偷偷换诗。
const DAILY_PHASES = [
  { name: '晨读', from: 6 },
  { name: '午诵', from: 12 },
  { name: '昏习', from: 18 },
  { name: '夜思', from: 22 },
];
function dailyPhase(now) {
  const h = now.getHours();
  if (h >= 22 || h < 6) return 3;
  if (h >= 18) return 2;
  if (h >= 12) return 1;
  return 0;
}

// 首页大标题诗句（2026-10-28，替代原题句池）：
// 逢节气/节日显示对应诗句，平时随机窗边读诗联句；只出诗句、点击进详情。
// 数据由 build-home-verses.cjs 从两份 CSV 生成（idx/home-verses.json），此处只做挑选。
let homeVersesData = null;
let homeVersesPromise = null;
async function loadHomeVerses() {
  if (homeVersesData) return homeVersesData;
  if (!homeVersesPromise) {
    // ?r=2：题句池改过一次（跨联修复），URL 带版本号才能绕开 IndexedDB 里的旧数据。
    // 以后每次重做 CSV，这里 +1。
    homeVersesPromise = cachedText('data/idx/home-verses.json?r=3')
      .then(t2 => { homeVersesData = JSON.parse(t2); return homeVersesData; })
      .catch(() => { homeVersesPromise = null; return null; });
  }
  return homeVersesPromise;
}

// 今天该显示哪一类：节日（农历）> 除夕（明天初一）> 寒食（清明前一天）> 节气（当日）> null
function homeVerseKey(now) {
  const lm = lunarDate(now);
  const FEST = {
    '1/1': '春节（节日）', '1/15': '元宵（节日）', '3/3': '上巳（节日）',
    '5/5': '端午（节日）', '7/7': '七夕（节日）', '7/15': '中元（节日）',
    '8/15': '中秋（节日）', '9/9': '重阳（节日）', '10/1': '寒衣节（节日）',
    '10/15': '下元（节日）', '12/8': '腊八（节日）', '12/23': '祭灶（节日）',
  };
  if (FEST[lm.m + '/' + lm.d]) return FEST[lm.m + '/' + lm.d];
  const tm = lunarDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (tm.m === 1 && tm.d === 1) return '除夕（节日）';       // 明天初一 → 今天除夕
  const qm = solarTermDate(now.getFullYear(), '清明');
  if (qm) {
    const prev = new Date(qm.getFullYear(), qm.getMonth(), qm.getDate() - 1);
    if (prev.getMonth() === now.getMonth() && prev.getDate() === now.getDate()) return '寒食（节日）';
  }
  const st = solarTermName(now);
  if (st) return st + '（节气）';
  return null;
}

async function fillHomeVerse() {
  try {
    const data = await loadHomeVerses();
    if (!data) return;
    const key = homeVerseKey(new Date());
    let pool = (key && data.cat[key]) || data.win || [];
    if (!pool.length) pool = data.win || [];
    if (!pool.length) return;
    const [verse, id] = pool[Math.floor(Math.random() * pool.length)];
    const el = document.getElementById('home-verse');
    if (!el) return;
    // 兜底：句中不该出现「。！？」——旧缓存数据可能还带，渲染前直接删掉，
    // 只保留句末那一个（下标 -1）。
    const text = String(verse).replace(/[。！？](?!$)/g, '');
    el.innerHTML = '<a href="#/p/' + id + '?v=' + encodeURIComponent(String(verse)) + '">' + esc(zhShow(text)) + '</a>';
  } catch (e) {}
}

async function homeView() {
  clearNavCtx();   // 回首页 = 新会话：退出阅读队列（2026-11-01 navCtx）
  const m = await getManifest();
  // 2026-10-28 首页极简化：28 个集合砖块、按朝代/按主题标签条、课文横幅全部移出。
  // 它们都搬进了 #/tags（现名「目录」），首页只留两个动作：随便看看、全部标签。
  // 好处不只是版面：首页不再取 tags.json（284KB）与 dyn.json（4KB），每次进首页都省这 288KB 解析。

  // 首页卡片：四时读诗（「今日一句」2026-10-30 下线，卡片固定为四时读诗）
  let dailyHtml = '<div class="loading"></div>';
  const nowT = new Date();
  const phase = dailyPhase(nowT);
  try {
    // 四时读诗：只从「精品池」里抽（全集里太多残句与佚名，不适合上首页）。
    // 种子 = 设备种子 ^ 日期 ^ 时段 → 同一台设备当课固定、到点换新；不同设备看到不同的诗。
    const PREMIUM = [
      'tang300', 'songci300', 'shijing', 'chuci', 'guwen', 'qjs', 'hjj', 'nalan', 'cc',
      'keben', 'mtssb', 'smts', 'nt', 'ymy',
      // mengxue / ssxx / lunyu 已排除：装的是三字经、弟子规、幼学琼林、四书五经、论语，
      // 是蒙学与经部，不是「诗」，放上首页不对味
    ];
    const pool = m.collections.filter(c => PREMIUM.includes(c.id) && c.count > 0);
    const day = Math.floor(nowT.getTime() / 864e5);
    // 夜思（22:00 后）记作次日的课：pd = day + 1，与次日凌晨共用同一粒种子
    const pd = nowT.getHours() >= 22 ? day + 1 : day;
    const rng = mulberry32((deviceSeed() ^ (pd * 2654435761) ^ ((phase + 1) * 2654435761)) >>> 0);
    // 长度上限 40 行：池内只有 0.4%（14 首，最长是天问 203 行）会超，抽到就顺延取下一首。
    // 随机流是确定的，所以「同设备同一天」仍然固定，不会每次刷新都变。
    // 另设预览上限：卡片只出头两行，但古文/赋一「行」就是一整段——按手机屏约 14 字/行
    // 估折行，头两行超过 6 行（含自动换行）的不要，卡片不能被一篇文章撑爆。
    const estLines = (p) => (p || []).slice(0, 2)
      .reduce((s, l) => s + Math.max(1, Math.ceil(String(l).length / 14)), 0);
    let poem = null, fallback = null;
    for (let k = 0; k < 4; k++) {
      const c2 = pool[Math.floor(rng() * pool.length)];
      // 2026-11-01（第七轮 P0-1）：count（存活条数）→ span（id 跨度），集合尾区记录也参与抽取；
      // 旧 manifest 无 span 时退回 count。span 来自 manifest，确定性不变，「同设备同天固定」保持。
      const pid = c2.start + Math.floor(rng() * (c2.span != null ? c2.span : c2.count));
      const p2 = await getPoem(pid).catch(() => null);
      if (!p2) continue;
      if (!fallback) fallback = p2;
      if ((p2.p || []).length <= 40 && estLines(p2.p) <= 6) { poem = p2; break; }
    }
    poem = poem || fallback;
    if (poem) {
      // 预览与详情页同一套 CSS 断行（layoutSentences）：分句各成 span.cl（nowrap），
      // 块间 <wbr>，句与句、段与段之间 <br>——装得下就并成一行，放不下在分句边界掉行，
      // 位置由浏览器现场排版。古文（prose）不切，整段流动，与详情页一致。
      // fits 沿用详情页实测判定器：它按正文字号（1.28rem）量宽，比卡片的字号大，
      // 预拆只会偏保守（多拆），不会漏拆，卡片没有 nowrap 溢出风险。
      const mode = PROSE_SET.has(colIdOf(poem.i)) ? 'prose' : 'sentence';
      const fits = makeLineFits(false, false);
      const segHtml = (l) => layoutSentences(l, null, mode, fits).map(seg =>
        seg.cls
          ? seg.cls.map(c => '<span class="cl">' + esc(zhShow(c)) + '</span>').join('<wbr>')
          : esc(zhShow(seg.t))
      ).join('<br>');
      const lines = (poem.p || []).slice(0, 2).map(segHtml).join('<br>');
      dailyHtml = '<a href="#/p/' + poem.i + '">' +
        '<div class="dt">' + esc(poem.r && poem.r !== poem.t ? zhShow(poem.r) + '·' : '') + esc(zhShow(poem.t)) + '</div>' +
        '<div class="da">' + esc(zhShow([poem.d, poem.a].filter(Boolean).join(' · '))) + '</div>' +
        '<p class="dp">' + lines + '</p></a>';
    }
  } catch (e) {}
  const his = getHistory();
  let hisHtml = '';
  if (his.length) {
    const last = await getPoem(his[0]).catch(() => null);
    if (last) {
      hisHtml = '<div class="group-title gt-row"><span>继续阅读</span><a href="#/h">阅读历史</a></div>' +
        '<div class="list">' + rowLink(last) + '</div>';
    }
  }

  // 行令（2026-10-31，扩至四令 2026-11-01）：飞花令 / 合璧 / 补字 / 接龙。
  // 定令字轮流出句、出上句接下句、名句补字、尾字接首字，都是酒令。
  // 式样与晨读/今日复习卡一致（.card + h2），入口 chips 沿用目录页的 .tagrow。
  // 卡内展示各令战绩（局数/星数）：接过句才算局，连续十句（合）得一星——
  //   全零（没玩过）不渲染，保持首页干净；数据来自偏好，每次进首页现读现画。
  const pInt = (k) => parseInt(pref(k) || '0', 10) || 0;
  const g = (pre) => [pInt(pre + 'rounds'), pInt(pre + 'stars')];
  const [fhR, fhS] = g('fh'), [hbR, hbS] = g('hb'), [bzR, bzS] = g('bz'), [jlR, jlS] = g('jl');
  const lingHtml = '<div class="card" id="ling-card"><h2>行令</h2>' +
    '<div class="tagrow">' +
    '<a href="#/fh">飞花令<span class="tagn">酒令</span></a>' +
    '<a href="#/hb">合璧<span class="tagn">接句</span></a>' +
    '<a href="#/bz">补字<span class="tagn">填字</span></a>' +
    '<a href="#/jl">接龙<span class="tagn">接字</span></a>' +
    '</div>' +
    (fhR || fhS || hbR || hbS || bzR || bzS || jlR || jlS
      ? '<div class="game-score" style="margin-top:8px">飞花令 <b>' + fhR + '</b> 局 <b>' + fhS + '</b> 星 · 合璧 <b>' + hbR + '</b> 局 <b>' + hbS + '</b> 星 · 补字 <b>' + bzR + '</b> 局 <b>' + bzS + '</b> 星 · 接龙 <b>' + jlR + '</b> 局 <b>' + jlS + '</b> 星</div>'
      : '') +
    '</div>';

  // 今日复习（R4）：遗忘曲线到期 = 天然的不定期回访触发器。
  // 以前只有进背诵页才看得见，现在提到首页成就卡上方。
  // 2026-10-30 起空态也渲染（入口常驻）：没背过就引导去背第一篇；背过但没到期就一句安心话。
  const recs = getRecites();
  const dueList = reciteDue(recs, Date.now());
  let dueHtml = '';
  if (dueList.length) {
    const duePoems = (await Promise.all(dueList.slice(0, 3).map(d => getPoem(d.id).catch(() => null)))).filter(Boolean);
    dueHtml = '<div class="card" id="due-card"><h2>今日复习</h2>' +
      '<div class="achv-streak">有 <b>' + dueList.length + '</b> 首按遗忘曲线到期待复习</div>' +
      (duePoems.length ? '<div class="list">' + duePoems.map(p => rowLink(p)).join('') + '</div>' : '') +
      '<a class="mj-more" href="#/recite">进背诵页复习</a></div>';
  } else {
    dueHtml = '<div class="card" id="due-card"><h2>今日复习</h2>' +
      '<div class="achv-streak">' + (Object.keys(recs).length
        ? '今日没有到期待复习的诗文，<a href="#/random">多读两篇</a>诗文，如何？'
        : '你还没有背诵任何诗文，快去<a href="#/random">背一篇</a>吧！') + '</div></div>';
  }

  const THANKS = [
    '    <div class="group-title">致谢</div>',
    '    <div class="card" data-fold><h2 class="fold-head">数据来源与致谢<span class="fold-btn">+</span></h2><div class="fold-body">',
    '      <div class="annotate tight">',
    '        <p>本站语料与功能构建于数十个开放数据集与工具，完整清单（数据集名称 / 网址 / 版权 / 内容备注）见 <a href="#/src">数据来源页</a>。</p>',
    '        <p>感谢 <b>DevEco Code</b> 与 <b>GLM-5.3</b> 大模型——全库 62.7 万条逐条审计，识破「存活条数被误当 id 跨度」这一隐性缺陷：以 manifest 补 `span` 一枚字段的最小代价，治愈标签页 43% 错行、集合尾区 2.6 万首的翻页断头与抽签盲区，《題白崖三洞》们的上一首/下一首由此复明。</p>',
    '        <p>亦是「行令」游戏的设计者——飞花令、接龙、合璧、补字：山窗以全库 214.59 万首为腹笥与你对坐应令，连句得星、错手判负、战绩随备份同行。数据修在看不见处，棋局下在每一天里。</p>',
    '        <p>感谢 <b>WorkBuddy</b> 与 <b>DeepSeek-V4.1-Flash</b> 大模型——四书译文按段对齐、名句索引、摘录本、标签体系、水墨背景与整轮界面重构，皆由其协作完成。</p>',
    '        <p class="section-tip">全库经两轮去重整理：合并集内与跨集合重复正文约 2.8 万条，并将各版本的译文、注释、赏析与创作背景归并，保留信息最完整者。</p>',
    '        <p class="section-tip">许可（分层）：站点代码 MIT；本站整理的索引、校勘与去重层 CC BY-NC-SA 4.0；第三方语料保留各自原许可、不重新授权。整库不可按单一许可再分发，商用须逐源替换。详见 <a href="#/src">数据来源与许可</a>。</p>',
    '      </div></div></div>',
  ].join('\n');

  // 我的成就（2026-10-29，打卡动力）：连续天数做高亮行，明细进网格。
  // 数字只是果，「今天还能接上」才是激励点——断连时给行动指引而不是显示 0。
  const rs = readStats();
  const recN = Object.keys(getRecites()).length;
  const favN = getFavs().length;
  const excN = getExcerpts().length;
  const ntN = noteTotal();
  let achvHtml = '';
  if (rs.total || rs.days || recN || favN || excN || ntN) {
    const statBox = (v, l, href) => href
      ? `<a class="stat" href="${href}"><b>${v}</b><span>${l}</span></a>`
      : `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    achvHtml = '<div class="card" id="achv-card"><h2>我的成就</h2>' +
      `<div class="achv-streak">${rs.streak >= 1
        ? '已连续阅读 <b>' + rs.streak + '</b> 天'
        : '连续已断，今天读一篇重新开始'}</div>` +
      '<div class="stats-row">' +
      statBox(rs.total, '累计已读') +
      statBox(rs.days, '累计打卡') +
      statBox(rs.best, '最长连续') +
      statBox(recN, '背诵', '#/recite') +
      statBox(favN, '收藏', '#/fav') +
      statBox(excN, '摘录', '#/excerpts') +
      statBox(ntN, '眉批', '#/n') +
      '</div>' +
      '<div class="section-tip">「打卡」以读完为准：正文读到末尾记一次，同一天读多篇也只计一天。数据只存本机。</div></div>';
  } else {
    achvHtml = '<div class="card" id="achv-card"><h2>我的成就</h2>' +
      '<div class="achv-streak">读完第一篇，开始你的打卡</div>' +
      '<div class="section-tip">读到正文末尾即记一次已读；连续天数、累计篇数、背诵与摘录都会积攒在这里。</div></div>';
  }

  // 明日预告（R6）：明天逢节气/节日，就提前把「明天为什么来」说出口。
  // 查询逻辑与首页题句同源（homeVerseKey），只是把镜头对准明天。
  const tm = new Date();
  tm.setDate(tm.getDate() + 1);
  const tmKey = homeVerseKey(tm);
  const tmName = tmKey ? tmKey.replace(/（[^）]*）$/, '') : '';
  const tmHtml = tmName
    ? '<div class="section-tip" style="text-align:center;margin:14px 0 6px">明日「' + esc(zhShow(tmName)) + '」· 应景的诗已经备好</div>'
    : '<div class="section-tip" style="text-align:center;margin:14px 0 6px">明日的诗已在窗边备好</div>';

  app.innerHTML =
    '<div class="brand"><div class="logo">山窗</div>' +
    '<div class="slogan" id="home-verse"></div></div>' +
    '<div class="lucky-row">' +
    '  <a class="lucky" href="#/tags">全部标签</a>' +
    '  <button class="lucky" id="lucky-btn" type="button">随便看看</button>' +
    '  <a class="lucky" href="#/s"><svg viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 1 1 0 15c-1.7 0-3.3-.6-4.6-1.6L3 19.3 4.7 21l2.9-2.9A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>搜索诗文</a>' +
    '</div>' +
    hisHtml +
    '<div class="card daily" id="daily-card"><h2>' + esc(zhShow(DAILY_PHASES[phase].name)) + '</h2>' + dailyHtml + '</div>' +
    lingHtml +
    dueHtml +
    achvHtml +
    THANKS +
    tmHtml;

  // 「随便看看」的绑定必须放在 app.innerHTML 之后。
  // 之前这段写在 innerHTML 之前，那一刻 #lucky-btn 还不存在，getElementById 返回 null，
  // 于是按钮看着能点、点下去什么都不发生（不是 luckyPoemId 的问题）。
  const luckyBtn = document.getElementById('lucky-btn');
  if (luckyBtn) {
    luckyBtn.onclick = async () => {
      if (luckyBtn.disabled) return;
      luckyBtn.disabled = true;
      luckyBtn.textContent = '翻找中…';
      const id = await luckyPoemId().catch(() => null);
      luckyBtn.disabled = false;
      luckyBtn.textContent = '随便看看';
      if (id != null) location.hash = '#/p/' + id;
    };
  }
  fillHomeVerse();

  // 按主题浏览、按朝代、课文横幅：2026-10-28 全部移入 #/tags（目录）。
  // 那次改动也顺手删掉了这里的异步填充——首页不再需要 tags.json 与 dyn.json。
  // 「今日一句」卡片（含名句随机填充）2026-10-30 随功能下线一并移除。
}

// （原「分类」板块已并入首页，catView 移除；旧 #/cat 链接在 app.js 路由里重定向到首页）

// ---------------- 列表页 ----------------

export { homeView, dailyPhase };
