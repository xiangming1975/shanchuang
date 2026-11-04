// 页面：mine
import { app, topbar, rowLink, cutTitle, displayTitle, titleMax, reciteDue, DAY, dayKey, fmtDate, popupMsg, popupConfirm, applyTheme, applyKaiFont, clearThemeFlip, rowMeta, emptyHtml, PAD } from '../vcommon.js';
import { setAppHTML, isCurrent, currentRenderSeq } from '../render-guard.js';
import { stepFs } from './detail.js';
import { getSearchHist, getPoem, getFavs, getHistory, pref, removeRecite, getRecites, getReciteLog, exportAllData, importAllData, clearUserData, getExcerpts, removeExcerpt, colIdOf, luckyPoemId, noteTotal, getAllNotes } from '../store.js';
import { loadRowsByIds } from './list.js';
import { notesToMarkdown } from '../notes.js';
import { esc } from '../py.js';
import { setInkEnabled } from '../inkbg.js';
import { setZhMode } from '../fn.js';
import { convTree } from '../uizh.js';

// 这五个板块（摘录 / 收藏 / 背诵 / 设置）不用顶部横条：底部 tab 已经指明位置，
// 再顶一条"我的摘录"是重复。PAD 只补一点上方留白，不让内容贴边。

async function excerptView(seg, seq = currentRenderSeq()) {
  const list = getExcerpts();
  if (!list.length) {
    setAppHTML(seq, PAD + favSeg('exc') +
      emptyHtml('摘', '还没有摘录<br>在详情页划选诗句，点「摘录此句」即可保存'));
    return;
  }
  setAppHTML(seq, PAD + favSeg('exc') +
    '<div class="loading"></div><div id="fn-pop" class="hidden"></div>');
  const show = list.slice(0, 300);
  const poems = await Promise.all(show.map(e => getPoem(e.i).catch(() => null)));
  if (!isCurrent(seq)) return;
  const groups = new Map();
  show.forEach((e, k) => {
    if (!groups.has(e.i)) groups.set(e.i, { poem: poems[k], items: [] });
    groups.get(e.i).items.push(e);
  });
  const parts = [];
  for (const [, g] of groups) {
    const p = g.poem;
    const title = p ? esc(p.r && p.r !== p.t ? p.r + '·' + p.t : (p.t || '无题')) : '作品 #' + g.items[0].i;
    parts.push(`<div class="card"><h2><a href="#/p/${g.items[0].i}" style="color:inherit">${title}</a></h2>` +
      (p ? `<div class="section-tip" style="margin:0 0 6px">${esc([p.d, p.a].filter(Boolean).join(' · '))}</div>` : '') +
      g.items.map(e => `<div class="exc-row"><span class="exc-t">「${esc(e.t)}」</span><button class="exc-del" data-id="${esc(e.id)}" title="删除此条">×</button></div>`).join('') +
      '</div>');
  }
  setAppHTML(seq, PAD + favSeg('exc') +
    `<div class="section-tip" style="text-align:center">共 ${list.length} 条${list.length > 300 ? '（显示前 300 条）' : ''}</div>` +
    parts.join('') + '<div id="fn-pop" class="hidden"></div>');
  document.querySelectorAll('.exc-del').forEach(b => {
    b.onclick = (ev) => { ev.stopPropagation(); removeExcerpt(b.dataset.id); excerptView(); };
  });
}

// ---------------- 分享诗词卡片（canvas 程序化水墨底纹 + 打卡页脚） ----------------

function favSeg(active) {
  const favN = getFavs().length;
  const excN = getExcerpts().length;
  return `<div class="seg">
    <a href="#/fav" class="${active === 'fav' ? 'on' : ''}">收藏${favN ? ' ' + favN : ''}</a>
    <a href="#/excerpts" class="${active === 'exc' ? 'on' : ''}">摘录${excN ? ' ' + excN : ''}</a>
  </div>`;
}

async function favView(seg, seq = currentRenderSeq()) {
  const ids = getFavs();
  setAppHTML(seq, PAD + favSeg('fav') + (ids.length ? '<div class="loading"></div>' :
    emptyHtml('藏', `还没有收藏作品<br>先从这几本翻起，喜欢再点收藏
      <div class="tagrow" style="justify-content:center;margin-top:14px">
        <a href="#/c/tang300/0">唐诗三百首</a><a href="#/c/songci300/0">宋词三百首</a><a href="#/c/shijing/0">诗经</a>
      </div>`)));
  if (!ids.length) return;
  const show = ids.slice(0, 300);
  const poems = await Promise.all(show.map(id => getPoem(id).catch(() => null)));
  if (!isCurrent(seq)) return;
  const rows = poems.filter(Boolean).map(p => rowLink(p)).join('');
  setAppHTML(seq, `
    ${PAD}
    <div class="section-tip" style="text-align:right;margin:0 2px 6px">共 ${ids.length} 篇</div>
    ${favSeg('fav')}
    <div class="list">${rows}</div>
    ${ids.length > 300 ? '<div class="section-tip" style="text-align:center">仅显示前 300 篇</div>' : ''}`);
}

// ---------------- 背诵板块 ----------------

async function reciteView(seg, seq = currentRenderSeq()) {
  setAppHTML(seq, PAD + '<div class="loading"></div>');
  const recites = getRecites();
  const log = getReciteLog();
  const ids = Object.keys(recites).map(Number).sort((a, b) => (recites[b].last || 0) - (recites[a].last || 0));

  // 每日计数
  const days = {};
  for (const e of log) { const k = dayKey(new Date(e.t)); days[k] = (days[k] || 0) + 1; }

  // 连续天数
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  let curStreak = 0, longest = 0, run = 0;
  const firstT = log.length ? log[0].t : 0;
  const span = Math.max(1, Math.ceil((Date.now() - firstT) / DAY) + 1);
  for (let i = 0; i <= span; i++) {
    const has = days[dayKey(new Date(today0.getTime() - i * DAY))] > 0;
    if (has) { run++; if (run > longest) longest = run; }
    else {
      if (i === 0) continue;          // 今天还没背不打断当前连击
      if (i === 1 && run > 0 && curStreak === 0) { curStreak = run; }
      run = 0;
    }
    if (i === 0) curStreak = run;
  }
  if (curStreak === 0 && days[dayKey(today0)] > 0) curStreak = run;
  curStreak = Math.max(curStreak, run);

  // 本月次数
  const mk = dayKey(today0).slice(0, 7);
  let monthCount = 0;
  for (const [k, v] of Object.entries(days)) if (k.startsWith(mk)) monthCount += v;

  // 热力图：最近 18 周（周一起）
  const monday = new Date(today0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 17 * 7);
  let cells = '';
  const monthLabels = [];
  for (let w = 0; w < 18; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(monday.getTime() + (w * 7 + dow) * DAY);
      const k = dayKey(d);
      const c = days[k] || 0;
      const lvl = c === 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : 3;
      const future = d > today0;
      cells += `<i class="hm-cell${future ? ' future' : ' l' + lvl}" role="img" aria-label="${k} ${c || 0} 次" title="${k}${c ? ' · ' + c + ' 次' : ''}"></i>`;
      // 月标：列内含 1 号即标（GitHub 同款）。旧版只看周一的月份——月初落在周二~周日时
      //（如 2026-11-01 周日），该列周一还属上月，11 月标永远打不出来，看着像「日历缺了一个月」。
      if (d.getDate() === 1) monthLabels.push([w, d.getMonth() + 1]);
    }
  }
  const labelsHtml = monthLabels.map(([w, m], i) =>
    `<span style="grid-column:${w + 1}${i > 0 && monthLabels[i][0] - monthLabels[i - 1][0] < 2 ? ';visibility:hidden' : ''}">${m}月</span>`).join('');

  // 待复习（遗忘曲线计算抽到 vcommon.reciteDue，首页复习卡共用）
  const due = reciteDue(recites, Date.now());
  const duePoems = await Promise.all(due.slice(0, 15).map(d => getPoem(d.id).catch(() => null)));
  if (!isCurrent(seq)) return;

  // 全部列表（前 60）
  const listPoems = await Promise.all(ids.slice(0, 60).map(id => getPoem(id).catch(() => null)));
  if (!isCurrent(seq)) return;

  const statBox = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;

  setAppHTML(seq, `
    ${PAD}
    ${ids.length === 0 ? emptyHtml('诵', `还没有背诵记录<br>抽一首读一遍，读到末尾点「我能背诵」就算记下了
        <div class="poem-toolbar" style="justify-content:center;margin-top:14px">
          <button id="recite-lucky" type="button">🎲 随机抽一首来背</button>
        </div>
        <div class="tagrow" style="justify-content:center;margin-top:10px">
          <a href="#/c/tang300/0">唐诗三百首</a><a href="#/c/qjs/0">千家诗</a><a href="#/c/mengxue/0">蒙学经典</a>
        </div>`) : `
    <div class="stats-row">
      ${statBox(ids.length, '累计篇目')}
      ${statBox(curStreak, '连续天数')}
      ${statBox(longest, '最长连击')}
      ${statBox(monthCount, '本月次数')}
    </div>
    <div class="card"><h2>背诵日历</h2>
      <div class="hm-labels">${labelsHtml}</div>
      <div class="hm">${cells}</div>
      <div class="hm-legend">少<i class="hm-cell l0" role="img" aria-label="热度图例"></i><i class="hm-cell l1" role="img" aria-label="热度图例"></i><i class="hm-cell l2" role="img" aria-label="热度图例"></i><i class="hm-cell l3" role="img" aria-label="热度图例"></i>多</div>
    </div>
    ${duePoems.filter(Boolean).length ? `
    <div class="group-title">今日复习 · 遗忘曲线提醒（${due.length} 篇待复习）</div>
    <div class="list">${duePoems.filter(Boolean).map(p => rowLink(p)).join('')}</div>
    ${due.length > 15 ? `<div class="section-tip" style="text-align:center">还有 ${due.length - 15} 篇待复习</div>` : ''}` : `
    <div class="section-tip" style="text-align:center;padding:8px 0">✓ 按遗忘曲线（1/2/4/7/15/30 天）暂无到期复习篇目</div>`}
    <div class="poem-toolbar" style="justify-content:center">
      <button id="recite-random">🎲 随机抽背</button>
    </div>
    <div class="group-title">已背诵（${ids.length} 篇）</div>
    <div class="list" id="recite-list">
      ${listPoems.filter(Boolean).map(p => `
        <div class="row recite-row">
          <a href="#/p/${p.i}" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:8px">
            <span class="rt">${esc(cutTitle(displayTitle(p), titleMax(colIdOf(p.i))))}</span>
            <span class="ra">${esc(p.a || '')}</span>
          </a>
          <span class="badge">${recites[p.i].n}次</span>
          <span class="ra">${fmtDate(recites[p.i].last)}</span>
          <button class="recite-del" data-i="${p.i}" title="移除">×</button>
        </div>`).join('')}
    </div>
    ${ids.length > 60 ? `<div class="section-tip" style="text-align:center">仅显示最近 60 篇</div>` : ''}`}
    <div id="fn-pop" class="hidden"></div>`);

  const luckyRecite = document.getElementById('recite-lucky');
  if (luckyRecite) luckyRecite.onclick = async () => {
    luckyRecite.disabled = true;
    const id = await luckyPoemId().catch(() => null);
    luckyRecite.disabled = false;
    if (id != null) location.hash = '#/p/' + id;
  };
  const randomBtn = document.getElementById('recite-random');
  if (randomBtn) randomBtn.onclick = () => {
    const pool = Object.keys(recites);
    location.hash = '#/p/' + pool[Math.floor(Math.random() * pool.length)];
  };
  const delBtns = document.querySelectorAll('.recite-del');
  delBtns.forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    removeRecite(+b.dataset.i);
    reciteView();
  });
}

// ---------------- 设置页（含数据管理） ----------------

async function settingsView(seg, seq = currentRenderSeq()) {
  const favs = getFavs().length;
  const recites = Object.keys(getRecites()).length;
  const his = getHistory().length;
  const sh = getSearchHist().length;
  const exc = getExcerpts().length;
  const nts = noteTotal();
  const theme = pref('theme');            // '' | 'light' | 'dark'
  const inkMode = pref('ink') === '1';    // 一级显示模式：水墨屏
  const fsNow = parseInt(pref('fs') || '17');
  const zhMode = pref('zh') === 't' ? 't' : 's';   // 显示简繁：默认简体，只有显式存 't' 才算繁體
  const bgOn = pref('bg') !== '0';        // 水墨背景默认开启，只有显式存 '0' 才算关
  // defOn：默认开启的项（只有显式存 '0' 才算关）
  const toggleBtn = (key, label, defOn = false) => {
    const on = defOn ? pref(key) !== '0' : pref(key) === '1';
    // label 为空时只显示「开/关」（用于「版本」这种行内已有完整说明的开关）
    const txt = label ? label + (on ? ' · 开' : ' · 关') : (on ? '开' : '关');
    return `<button class="set-toggle ${on ? 'on' : ''}" data-pref="${key}">${txt}</button>`;
  };
  setAppHTML(seq, `
    ${PAD}
    <div class="card">
      <h2>外观</h2>
      <div class="seg" id="ink-seg">
        <button type="button" data-ink="0" class="${inkMode ? '' : 'on'}">普通模式</button>
        <button type="button" data-ink="1" class="${inkMode ? 'on' : ''}">水墨屏模式</button>
      </div>
      <div class="section-tip">显示分两级：先在这里选普通或水墨屏，再用下面四个选日间 / 夜间。水墨屏模式全站只显示灰阶，文字与背景顶到灰阶两端（日间纯黑字配纯白纸，夜间反过来），水墨背景自动停用，适合电子墨水屏设备。</div>
      <div class="seg seg-4" id="theme-seg">
        <button type="button" data-theme-opt="light" class="${theme === 'light' ? 'on' : ''}">日间</button>
        <button type="button" data-theme-opt="dark" class="${theme === 'dark' ? 'on' : ''}">夜间</button>
        <button type="button" data-theme-opt="auto" class="${theme === 'auto' ? 'on' : ''}">自动</button>
        <button type="button" data-theme-opt="system" class="${!theme ? 'on' : ''}">跟随系统</button>
      </div>
      <div class="section-tip">自动：18:00 之后、次日 6:00 之前用夜间，其余时间用日间。</div>
      <div class="set-row">
        <span class="set-label">正文字号</span>
        <span class="set-ctrl">
          <button class="set-step" id="set-fs-dec">A−</button>
          <b id="set-fs-val">${fsNow}</b>
          <button class="set-step" id="set-fs-inc">A＋</button>
        </span>
      </div>
      <div class="set-row">
        <span class="set-label">简繁体<span class="section-tip" style="display:block;margin:2px 0 0">全站文本显示用字</span></span>
        <span class="set-ctrl">
          <span class="seg" id="zh-seg">
            <button type="button" data-zh="t" class="${zhMode === 't' ? 'on' : ''}">繁體</button>
            <button type="button" data-zh="s" class="${zhMode === 's' ? 'on' : ''}">简体</button>
          </span>
        </span>
      </div>
      <div class="set-row">
        <span class="set-label">水墨背景<span class="section-tip" style="display:block;margin:2px 0 0">每次进入随机生成一幅，不重复</span></span>
        <span class="set-ctrl">
          <button class="set-toggle ${bgOn ? 'on' : ''}" id="set-bg">${bgOn ? '开' : '关'}</button>
        </span>
      </div>
    </div>
    <div class="card">
      <h2>阅读默认</h2>
      <div class="poem-toolbar" style="justify-content:flex-start">
        ${toggleBtn('py', '拼音')}
        ${toggleBtn('st', '平仄')}
        ${toggleBtn('fn', '注释')}
        ${toggleBtn('ty', '译文对照', true)}
        ${toggleBtn('ao', '释文展开')}
        ${toggleBtn('kai', '楷体', true)}
      </div>
      <div class="section-tip">打开作品时默认套用这些开关；正文上方仍可临时切换。“释文展开”控制译文/注释/赏析区块是否默认打开。“译文对照”指在每段正文下直接显示该段译文，只对译文与段落能对齐的古文有效（古文观止基本全覆盖）。</div>
      <div class="section-tip">「楷体」用的是随站的霞鹜文楷子集（4.2MB，全库 1.8 万字全覆盖）。关掉即改用系统楷体：安卓多数机型没有楷体，会退回宋体；流量吃紧时可以关。</div>
    </div>
    <div class="card">
      <h2>每日提醒</h2>
      <div class="poem-toolbar" style="justify-content:flex-start">
        <button id="cal-sub">订阅到系统日历</button>
      </div>
      <div class="section-tip">下载 .ics 文件，打开即加入手机/电脑日历：每晚 21:00 提醒「山窗 · 今天的诗读了吗」。只在本机生成，不经过任何服务器。</div>
    </div>
    <div class="card">
      <h2>本机数据</h2>
      <div class="stats-row">
        <div class="stat"><b>${favs}</b><span>收藏</span></div>
        <div class="stat"><b>${recites}</b><span>背诵</span></div>
        <a class="stat" href="#/h"><b>${his}</b><span>浏览历史</span></a>
        <a class="stat" href="#/h/s"><b>${sh}</b><span>搜索历史</span></a>
        <div class="stat"><b>${exc}</b><span>摘录</span></div>
        <a class="stat" href="#/n"><b>${nts}</b><span>眉批</span></a>
      </div>
      <div class="section-tip">收藏、背诵、浏览历史、搜索历史、摘录、眉批、偏好都只保存在本机浏览器里。换手机或清理浏览器数据前，请先导出备份。</div>
    </div>
    <div class="card">
      <h2>导出备份</h2>
      <div class="poem-toolbar" style="justify-content:flex-start">
        <button id="exp-file">下载备份文件</button>
        <button id="exp-copy">复制到剪贴板</button>
        <button id="exp-note">导出眉批 .md</button>
      </div>
      <div class="section-tip">备份文件为 JSON，包含全部收藏、背诵（含日历记录）、浏览历史、搜索历史、摘录、眉批、已读记录（连续天数/累计篇数）与偏好；四时读诗的设备种子不随备份走，换设备后首页每日推荐会不同。</div>
      <div class="section-tip">「导出眉批」是给人读的 Markdown：一篇一节，原句做引用、批语附在下面，可直接丢进笔记软件。</div>
    </div>
    <div class="card">
      <h2>导入恢复</h2>
      <input type="file" id="imp-file" accept=".json,application/json" style="display:none">
      <div class="poem-toolbar" style="justify-content:flex-start">
        <button id="imp-file-btn">选择备份文件</button>
        <button id="imp-paste">粘贴内容导入</button>
      </div>
      <div class="section-tip">导入与现有数据合并，不会覆盖丢失已有记录。</div>
    </div>
    <div class="card">
      <h2>清空数据</h2>
      <div class="poem-toolbar" style="justify-content:flex-start">
        <button id="clr-favs">清空收藏</button>
        <button id="clr-his">清空浏览历史</button>
        <button id="clr-shis">清空搜索历史</button>
        <button id="clr-rec">清空背诵</button>
        <button id="clr-exc">清空摘录</button>
        <button id="clr-note">清空眉批</button>
      </div>
      <div class="section-tip">删除后不可恢复，请先导出备份。</div>
    </div>
    <div class="card">
      <h2>关于</h2>
      <div class="annotate tight">
        <p>山窗 · 千年古诗文。手机优先的古诗文阅读站，79 个集合、214.59 万首/篇（42,424 位作者），含拼音、译文、注释、朗诵与背诵。</p>
        <p class="section-tip">全库经两轮去重整理：合并集内与跨集合重复正文约 2.8 万条，并将各版本的译文、注释、赏析与创作背景归并，保留信息最完整者。</p>
        <p class="section-tip">许可（分层）：站点代码 <b>MIT</b>；本站整理的索引、校勘与去重层 <b>CC BY-NC-SA 4.0</b>；第三方语料保留各自原许可、<b>不重新授权</b>（含 GPL-3.0 / LGPL-3.0 / CC BY-NC / 未标注 成分）。整库不可按单一许可再分发，商用须逐源替换。<a href="#/src">详见数据来源与许可</a>。</p>
      </div>
    </div>
    <div id="fn-pop" class="hidden"></div>`);

  // ---------- 外观 ----------
  // ---------- 一级显示模式：普通 / 水墨屏 ----------
  // 日间/夜间/自动/跟随系统在两种模式里都有效；水墨屏只是把整个调色盘换成灰阶两端。
  // 不存键 = 普通模式（老用户无感升级）。
  document.querySelectorAll('#ink-seg [data-ink]').forEach(b => {
    b.onclick = () => {
      const on = b.dataset.ink === '1';
      if (on) pref('ink', '1');
      else { try { localStorage.removeItem('shici-ink'); } catch {} }
      applyTheme();   // 同步 html[data-ink] 与 meta theme-color；水墨背景监听 data-ink 自动隐/显
      document.querySelectorAll('#ink-seg [data-ink]').forEach(x => x.classList.toggle('on', x.dataset.ink === b.dataset.ink));
    };
  });
  // 四个取值：日间 light / 夜间 dark / 自动 auto / 跟随系统（清掉键，走 matchMedia）
  document.querySelectorAll('#theme-seg [data-theme-opt]').forEach(a => {
    a.onclick = () => {
      const opt = a.dataset.themeOpt;
      if (opt === 'system') { try { localStorage.removeItem('shici-theme'); } catch {} }
      else pref('theme', opt);
      clearThemeFlip();   // 明确选了模式，就丢掉工具栏留下的临时翻转
      applyTheme();   // 顺带同步 meta theme-color 与水墨背景重绘
      document.querySelectorAll('#theme-seg [data-theme-opt]').forEach(x => x.classList.toggle('on', x.dataset.themeOpt === opt));
    };
  });
  document.getElementById('set-fs-dec').onclick = () => {
    stepFs(-1);
    document.getElementById('set-fs-val').textContent = parseInt(pref('fs') || '17');
  };
  document.getElementById('set-fs-inc').onclick = () => {
    stepFs(1);
    document.getElementById('set-fs-val').textContent = parseInt(pref('fs') || '17');
  };
  // ---------- 简繁切换 ----------
  // 只改显示层（正文、译文、注释、列表标题等），不动底层数据与链接索引；
  // 眉批/摘录的锚定在 placeNotes 里做了繁→简归一，跨简繁也能对上行。
  document.querySelectorAll('#zh-seg [data-zh]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.zh;
      if (v === zhMode) return;
      pref('zh', v);
      setZhMode(v);
      // 静态外壳（tabbar、文档标题）不随视图重渲染，切换时手动全树转换一次；
      // #app 内的重渲染交给 uizh 观察器，内容层幂等不双转。
      convTree(document.body);
      settingsView();
      popupMsg(v === 's' ? '已切换为简体显示' : '已切換為繁體顯示');
    };
  });
  // ---------- 阅读默认开关 ----------
  document.querySelectorAll('.set-toggle').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.pref;
      if (!k) return;                     // #set-bg 走自己的绑定
      // 'ty'（逐段译文）与 'kai'（楷体子集）默认开，只有显式 '0' 才算关，取反要按生效值算
      if (k === 'ty' || k === 'kai') pref(k, pref(k) !== '0' ? '0' : '1');
      else pref(k, pref(k) === '1' ? '0' : '1');
      if (k === 'kai') applyKaiFont();
      settingsView();
    };
  });
  // ---------- 水墨背景开关 ----------
  const bgBtn = document.getElementById('set-bg');
  if (bgBtn) {
    bgBtn.onclick = () => {
      const on = pref('bg') !== '0';
      pref('bg', on ? '0' : '1');
      setInkEnabled(!on);
      settingsView();
    };
  }
  // ---------- 每日提醒：ICS 下载导入系统日历 ----------
  // 纯静态站没有推送服务器（R6）：生成一条 RRULE:FREQ=DAILY 的 21:00 事件文件，
  // 用户导入后由系统日历每晚提醒，是唯一可行的 OS 级推力。
  document.getElementById('cal-sub').onclick = () => {
    try {
      const pad = (n) => String(n).padStart(2, '0');
      const now = new Date();
      const start = new Date(now); start.setHours(21, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60000);
      // DTSTART 不带时区 = 浮动本地时间，提醒随设备时区走
      const icsLocal = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
      const stampUTC = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
      const siteUrl = location.origin + location.pathname + '#/';
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shanchuang//daily//CN', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:shanchuang-daily-' + Date.now() + '@' + (location.hostname || 'local'),
        'DTSTAMP:' + stampUTC(now),
        'DTSTART:' + icsLocal(start),
        'DTEND:' + icsLocal(end),
        'RRULE:FREQ=DAILY',
        'SUMMARY:山窗 · 今天的诗读了吗',
        'DESCRIPTION:' + siteUrl,
        'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:山窗 · 今天的诗读了吗', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'shanchuang-daily.ics';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      popupMsg('日历文件已生成下载。打开它即可把「每晚 21:00 读诗」加进系统日历（iPhone 用日历 App 打开，安卓选日历应用）。', '好的');
    } catch (e) { popupMsg('生成失败：' + e.message, '关闭'); }
  };

  // ---------- 数据导出 / 导入 / 清空 ----------
  const stamp = () => {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  };
  document.getElementById('exp-file').onclick = () => {
    try {
      const json = exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'shici-backup-' + stamp() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      popupMsg('备份文件已生成下载，请在浏览器下载列表查看（iPhone 请在"文件"App 中查看）。', '好的');
    } catch (e) { popupMsg('导出失败：' + e.message, '关闭'); }
  };
  // 眉批导出为 Markdown：一篇一节、原句引用、批语随行。给人读的，不是给程序恢复用的
  document.getElementById('exp-note').onclick = async () => {
    const all = getAllNotes();
    const groups = Object.keys(all)
      .map(pid => ({ pid, notes: Array.isArray(all[pid]) ? all[pid] : [] }))
      .filter(g => g.notes.length);
    if (!groups.length) {
      popupMsg('还没有眉批可导出。在正文里点 ☰，再点「写眉批」，给一句写下批语。', '好的');
      return;
    }
    const latest = (g) => g.notes.reduce((m, n) => Math.max(m, n.ts || 0), 0);
    groups.sort((a, b) => latest(b) - latest(a));
    // 篇名与「朝代 · 作者」要现取：store 里只存 id，取不到就退回「作品 id」，不让整份导出失败
    let map = new Map();
    try {
      const rows = await loadRowsByIds(groups.map(g => Number(g.pid)));
      map = new Map(rows.filter(r => r && r.i != null).map(r => [String(r.i), r]));
    } catch (e) {}
    if (!isCurrent(seq)) return;
    const metaOf = (pid) => rowMeta(map.get(String(pid)), pid);
    const total = groups.reduce((s, g) => s + g.notes.length, 0);
    try {
      const md = notesToMarkdown(groups, metaOf, new Date());
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'shici-notes-' + stamp() + '.md';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      popupMsg('已导出眉批 ' + total + ' 条 / ' + groups.length + ' 篇。iPhone 请在「文件」App 查看。', '好的');
    } catch (e) { popupMsg('导出失败：' + e.message, '关闭'); }
  };
  document.getElementById('exp-copy').onclick = () => {
    const json = exportAllData();
    const pop = document.getElementById('fn-pop');
    pop.innerHTML = '<div class="fn-card"><div class="fn-term">备份内容</div><textarea class="fn-ta" readonly>' + esc(json) + '</textarea><div style="display:flex;gap:8px"><button class="fn-close" id="rc-copy">复制</button><button class="fn-close">关闭</button></div></div>';
    pop.classList.remove('hidden');
    pop.querySelector('#rc-copy').onclick = (ev) => {
      ev.stopPropagation();
      const ta = pop.querySelector('textarea');
      ta.select();
      try { document.execCommand('copy'); const t = pop.querySelector('.fn-term'); if (t) t.textContent = '已复制到剪贴板 ✓'; } catch { const t = pop.querySelector('.fn-term'); if (t) t.textContent = '复制失败，请手动全选复制'; }
    };
    pop.querySelectorAll('.fn-close').forEach(b => { if (!b.id) b.onclick = (ev) => { ev.stopPropagation(); pop.classList.add('hidden'); }; });
  };
  const applyImported = (summary) => {
    applyTheme();
    const fsv = parseInt(pref('fs') || '17');
    document.documentElement.style.setProperty('--fs', fsv + 'px');
    settingsView().then(() => {
      popupMsg('导入完成：收藏 ' + summary.favs + ' 篇 · 背诵 ' + summary.recites + ' 篇 · 浏览 ' + summary.history + ' 条 · 搜索词 ' + (summary.searchHist || 0) + ' 条 · 摘录 ' + (summary.excerpts || 0) + ' 条 · 眉批 ' + (summary.notes || 0) + ' 条' + (summary.read != null ? ' · 已读 ' + summary.read + ' 篇' : '') + '，偏好已恢复。', '好的');
    });
  };
  const impFile = document.getElementById('imp-file');
  document.getElementById('imp-file-btn').onclick = () => impFile.click();
  impFile.onchange = () => {
    const f = impFile.files && impFile.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { applyImported(importAllData(String(reader.result))); }
      catch (e) { popupMsg('导入失败：' + e.message, '关闭'); }
    };
    reader.readAsText(f, 'utf-8');
  };
  document.getElementById('imp-paste').onclick = () => {
    const pop = document.getElementById('fn-pop');
    pop.innerHTML = '<div class="fn-card"><div class="fn-term">粘贴备份内容</div>' +
      '<textarea class="fn-ta" id="imp-ta" placeholder="粘贴此前复制的备份 JSON…" style="height:140px"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="fn-close" id="imp-go">导入</button><button class="fn-close">取消</button></div></div>';
    pop.classList.remove('hidden');
    const ta = pop.querySelector('#imp-ta');
    ta.focus();
    pop.querySelector('#imp-go').onclick = (ev) => {
      ev.stopPropagation();
      const s2 = ta.value.trim();
      if (!s2) return;
      pop.classList.add('hidden');
      try { applyImported(importAllData(s2)); }
      catch (e) { popupMsg('导入失败：' + e.message, '关闭'); }
    };
    pop.querySelectorAll('.fn-close').forEach(b => { if (!b.id) b.onclick = (ev) => { ev.stopPropagation(); pop.classList.add('hidden'); }; });
  };;
  // 清空确认统一走 popupConfirm（2026-10-29 复用收敛，原先手写确认弹窗）
  const bindClear = (id, kind, label) => {
    document.getElementById(id).onclick = () => {
      popupConfirm('确认' + label + '？', '删除后不可恢复。', '确认清空', () => {
        clearUserData(kind);
        settingsView();
      });
    };
  };
  bindClear('clr-favs', 'favs', '清空收藏');
  bindClear('clr-his', 'history', '清空浏览历史');
  bindClear('clr-rec', 'recites', '清空背诵');
  bindClear('clr-shis', 'searchhist', '清空搜索历史');
  bindClear('clr-exc', 'excerpts', '清空摘录');
  bindClear('clr-note', 'notes', '清空眉批');
}

// ---------------- 主题 ----------------

export { excerptView, favSeg, favView, reciteView, settingsView };
