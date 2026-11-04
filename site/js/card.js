// 诗词卡片绘制
// 2026-10-28 起与详情页完全同源：背景 = 网页水墨（paintInkScene），文字 = 同一楷体栈
//（--kai，霞鹜文楷优先），印章 = 详情页「已读」章的同款空心朱框，页脚带同款五瓣小红花。
import { PROSE_SET } from './vcommon.js';
// 卡片底与网页背景共用 js/inkbg.js 的同一套水墨：远山、水岸、舟禽、近景竹梅松
import { paintInkScene } from './inkbg.js';
// 断行：与阅读页同一套骨架（一个韵句一行、能并就并、超长才折），只是卡片画布上
// 没有 DOM 可量宽，用 ciSegments 按字数估宽；阅读页已升级为 packLines 实测宽度。
import { ciSegments } from './vcommon.js';

// 与详情页完全一致的楷体栈（css 的 --kai：霞鹜文楷子集优先 → 系统楷体 → 宋体兜底）
const KAI = '"LXGW WenKai","Kaiti SC","STKaiti","KaiTi",serif';
// 详情页 accent（印章/小红花的朱色）
const ZHU = '#a3372f';

const CARD_W = 1080, CARD_H = 1620;
// 确定性伪随机（同一张卡片内纹理稳定）

function cardRnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 横向雾带（卡片收尾工艺：压淡底纹的过渡带）

function drawMist(ctx, W, y, h, alpha) {
  const g = ctx.createLinearGradient(0, y - h, 0, y + h);
  g.addColorStop(0, 'rgba(252,250,244,0)');
  g.addColorStop(0.5, 'rgba(252,250,244,' + alpha + ')');
  g.addColorStop(1, 'rgba(252,250,244,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y - h, W, h * 2);
}

// 背景：与详情页同一幅水墨（同一个 paintInkScene、同一套调色板）。
// 网页那层墨是按「压在半透明纸下面」调的，卡片没有纸，纸罩压到 0.45 才不糊字。
function paintInk(ctx, W, H, rnd) {
  paintInkScene(ctx, W, H, (rnd() * 1e9) | 0, { alpha: 1 });
}

// 画底：宣纸底 + 详情页同源水墨 + 纸纹 + 雾化（保证正文可读）
// forceStyle 参数保留但不再选意境——背景一律与详情页同源（2026-10-28）。

function paintCardBackground(ctx, seed) {
  const rnd = cardRnd(seed);
  // 纸色四套随机，连渐变方向也随机
  const PAPERS = [
    ['#f9f5ec', '#f4eddf', '#efe5d2'],
    ['#f8f4e9', '#f2ebdb', '#ece0c9'],
    ['#faf6ef', '#f5efe3', '#f0e7d6'],
    ['#f6f3ea', '#f0ebdf', '#e9e1d0'],
  ];
  const paper = PAPERS[Math.floor(rnd() * PAPERS.length)];
  const g = ctx.createLinearGradient(0, 0, CARD_W * (0.22 + rnd() * 0.3), CARD_H);
  g.addColorStop(0, paper[0]);
  g.addColorStop(0.55, paper[1]);
  g.addColorStop(1, paper[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(46, 46, CARD_W - 92, CARD_H - 92);
  ctx.clip();
  paintInk(ctx, CARD_W, CARD_H, rnd);
  drawMist(ctx, CARD_W, CARD_H * (0.30 + rnd() * 0.22), CARD_H * (0.05 + rnd() * 0.06), 0.22 + rnd() * 0.3);
  // 纸纹（细颗粒）
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * CARD_W, y = rnd() * CARD_H;
    ctx.fillStyle = 'rgba(120,104,78,' + (0.012 + rnd() * 0.03) + ')';
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // 通体压白 + 中部加强（水墨自带远山近枝，纸罩压到 0.45 倍，同原水墨槽位）
  const K = 0.45;
  ctx.fillStyle = 'rgba(250,247,240,' + (0.38 * K).toFixed(3) + ')';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const veil = ctx.createLinearGradient(0, 0, 0, CARD_H);
  veil.addColorStop(0, 'rgba(251,248,242,' + (0.30 * K).toFixed(3) + ')');
  veil.addColorStop(0.22, 'rgba(251,248,242,' + (0.55 * K).toFixed(3) + ')');
  veil.addColorStop(0.78, 'rgba(251,248,242,' + (0.55 * K).toFixed(3) + ')');
  veil.addColorStop(1, 'rgba(251,248,242,' + (0.34 * K).toFixed(3) + ')');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // 四角暗角，收边
  const vg = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, CARD_H * 0.28, CARD_W / 2, CARD_H / 2, CARD_H * 0.78);
  vg.addColorStop(0, 'rgba(60,50,38,0)');
  vg.addColorStop(1, 'rgba(60,50,38,0.16)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}
// 按宽度折行（中文逐字）；避头尾：标点不做行首，允许轻微出线

const NO_LEAD = '，。、；：？！）》」』】…·';

// 与阅读页同一套断行骨架（ciSegments，按字数估宽）。差别只在一行放得下几个字：
// 阅读页已升级为 packLines 按实测宽度断行，卡片画布没有 DOM 可量，仍按自己的字号估。
// 分完必须再量一次——标点也占宽度，个别行仍可能出框，超了才退回按宽度硬折。
function splitCardLine(ctx, line, maxW, maxChars) {
  if (ctx.measureText(line).width <= maxW) return [line];
  const out = [];
  for (const seg of ciSegments(line, maxChars)) {
    if (ctx.measureText(seg).width > maxW) out.push(...wrapAtPunct(ctx, seg, maxW));
    else out.push(seg);
  }
  return out;
}

// 按标点折断：卡片字号大，`maxChars` 那个估算偶尔仍偏乐观（标点也占全角宽）。
// 这时宁可多折一行，也不能在「物。」这种地方硬断——断头行比多一行难看。
// 只在句读后下刀；整段没有可断点时才逐字硬折，兜底。
function wrapAtPunct(ctx, text, maxW) {
  const parts = String(text).split(/(?<=[，。？！；、：])/).filter(Boolean);
  const out = [];
  let buf = '';
  for (const p of parts) {
    const cand = buf + p;
    if (buf && ctx.measureText(cand).width > maxW) { out.push(buf); buf = p; }
    else buf = cand;
    while (buf && ctx.measureText(buf).width > maxW) {
      const chars = [...buf];
      let cut = chars.length - 1;
      while (cut > 1 && ctx.measureText(chars.slice(0, cut).join('')).width > maxW) cut--;
      out.push(chars.slice(0, cut).join(''));
      buf = chars.slice(cut).join('');
    }
  }
  if (buf) out.push(buf);
  return out;
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let buf = '';
    for (const ch of para) {
      if (buf && ctx.measureText(buf + ch).width > maxW) {
        if (NO_LEAD.includes(ch)) { buf += ch; out.push(buf); buf = ''; }
        else { out.push(buf); buf = ch; }
      } else buf += ch;
    }
    if (buf) out.push(buf);
  }
  return out;
}

// 详情页「已读」同款印章：空心朱框 + 朱字（css .rd-seal 的 canvas 版）。
// 多行时每行一段文字，整体歪 9°、透明度 .62，与详情页一致。

function drawSealHollow(ctx, cx, cy, w, h, lines, rot, fs) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot || 0);
  ctx.globalAlpha = 0.62;                       // 详情页 .rd-seal 的 opacity
  ctx.strokeStyle = ZHU;
  ctx.lineWidth = 4;                            // 详情页 1.6px × 卡片比例 ≈ 4
  const r = 8;                                  // 详情页 border-radius 3px × 比例
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = ZHU;
  ctx.font = '700 ' + Math.round(fs) + 'px ' + KAI;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, i) => ctx.fillText(t, 0, -h / 2 + h * (i + 0.5) / n));
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

// 详情页「读完」同款小红花：五瓣朱色椭圆 + 纸色花心（detail.js bloom 的 canvas 版）。
// s 为缩放：s=1 时与详情页 SVG 等大（40 viewBox）。

function drawFlower(ctx, cx, cy, s) {
  const ANG = [0, 72, 144, 216, 288];
  ctx.save();
  ctx.translate(cx, cy);
  for (const a of ANG) {
    ctx.save();
    ctx.rotate(a * Math.PI / 180);
    ctx.fillStyle = ZHU;
    ctx.beginPath();
    ctx.ellipse(0, -9.4 * s, 5.1 * s, 8.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#fffdf7';                    // 花心：详情页取 --card-solid，同色
  ctx.beginPath();
  ctx.arc(0, 0, 2.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function pad2(n) { return String(n).padStart(2, '0'); }

// 只画卡（不弹窗）：便于单测/复用

function drawCard(poem, displayLines, title, forceStyle) {
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext('2d');
  const seed = (Math.random() * 0xffffffff) >>> 0;
  paintCardBackground(ctx, seed, forceStyle);

  // 画框：双线细框
  ctx.strokeStyle = 'rgba(70,60,46,0.30)';
  ctx.lineWidth = 2;
  ctx.strokeRect(46, 46, CARD_W - 92, CARD_H - 92);
  ctx.strokeStyle = 'rgba(163,55,47,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(58, 58, CARD_W - 116, CARD_H - 116);

  // ---------- 头部 ----------
  const HEAD = 470;
  ctx.textAlign = 'center';
  // 左上「字字珠玑/尽收眼底」：详情页已读章的同款空心朱框（歪 9°、半透明）
  drawSealHollow(ctx, 168, 156, 196, 136, ['字字珠玑', '尽收眼底'], -Math.PI / 20, 36);
  let fsT = 82;
  ctx.font = '700 ' + fsT + 'px ' + KAI;
  while (ctx.measureText(title).width > CARD_W - 220 && fsT > 44) {
    fsT -= 4;
    ctx.font = '700 ' + fsT + 'px ' + KAI;
  }
  ctx.save();
  ctx.shadowColor = 'rgba(255,253,247,0.85)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#2f2a24';
  ctx.fillText(title, CARD_W / 2, 300);
  ctx.restore();
  ctx.font = '36px ' + KAI;
  ctx.fillStyle = '#6d6253';
  ctx.fillText([poem.d, poem.a].filter(Boolean).join(' · '), CARD_W / 2, 360);
  // 分隔：短线 + 菱形
  ctx.strokeStyle = 'rgba(120,105,84,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(CARD_W / 2 - 120, 398); ctx.lineTo(CARD_W / 2 - 16, 398); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CARD_W / 2 + 16, 398); ctx.lineTo(CARD_W / 2 + 120, 398); ctx.stroke();
  ctx.fillStyle = 'rgba(163,55,47,0.75)';
  ctx.beginPath();
  ctx.moveTo(CARD_W / 2, 389); ctx.lineTo(CARD_W / 2 + 9, 398);
  ctx.lineTo(CARD_W / 2, 407); ctx.lineTo(CARD_W / 2 - 9, 398);
  ctx.closePath(); ctx.fill();

  // ---------- 正文 ----------
  const FOOT_TOP = CARD_H - 300;
  const bodyTop = HEAD;
  const bodyH = FOOT_TOP - bodyTop - 24;
  const maxW = CARD_W - 260;
  const raw = (displayLines || []).map(s2 => String(s2.t || '').trim()).filter(Boolean);
  // 先判断是否散文（整段超宽需折行），再在“最终字号”下折行——否则字号放大后出框
  ctx.font = '56px ' + KAI;
  // 散文判定不能按「56px 下是否超宽」——词的长韵句在最大字号下也会超宽，
  // 会被误判成散文，然后走硬折，折出「物。」这种断头行。
  // 按「最小字号一行能放几个字」判：超过这个数才真是整段散文（古文、赋、评点）。
  const maxCharsMin = Math.max(6, Math.floor(maxW / 30));
  const prose = raw.some(l => [...l].length > maxCharsMin) || PROSE_SET.has((poem._col || {}).id);
  let fsL = 56, lh = 0, items = [], clipped = false;
  for (; fsL >= 30; fsL -= 2) {
    ctx.font = fsL + 'px ' + KAI;
    items = [];
    // 一行能放几个汉字：卡片没有字距，一个汉字占一个字号宽
    const maxChars = Math.max(6, Math.floor(maxW / fsL));
    for (const l of raw) {
      // 散文照旧按宽度折（整段一段话，没有句读节奏）；诗词走共用断行
      const parts = prose
        ? (ctx.measureText(l).width > maxW ? wrapLines(ctx, l, maxW) : [l])
        : splitCardLine(ctx, l, maxW, maxChars);
      parts.forEach((t, k) => items.push({ t, para: k === 0 }));
    }
    lh = Math.round(fsL * (prose ? 1.98 : 1.92));
    if (items.length * lh <= bodyH) break;
  }
  if (fsL < 30) fsL = 30;
  lh = Math.round(fsL * (prose ? 1.98 : 1.92));
  const maxLines = Math.max(1, Math.floor(bodyH / lh));
  let shown = items;
  if (items.length > maxLines) {
    shown = items.slice(0, maxLines);
    shown[maxLines - 1] = { t: shown[maxLines - 1].t.replace(/[，。；、]$/, '') + '……', para: shown[maxLines - 1].para };
    clipped = true;
  }
  ctx.font = fsL + 'px ' + KAI;
  ctx.fillStyle = '#33302a';
  const blockH = shown.length * lh;
  const topGap = Math.min(Math.max(0, (bodyH - blockH) / 2), 150);
  let y = bodyTop + topGap + fsL * 0.82;
  const leftX = CARD_W / 2 - maxW / 2;
  ctx.textAlign = prose ? 'left' : 'center';
  for (const it of shown) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,254,250,0.6)';
    ctx.shadowBlur = 8;
    const x = prose ? leftX + (it.para ? fsL * 2 : 0) : CARD_W / 2;
    ctx.fillText(it.t, x, y);
    ctx.restore();
    y += lh;
  }
  if (clipped) {                       // 长文提示
    ctx.textAlign = 'center';
    ctx.font = '24px ' + KAI;
    ctx.fillStyle = 'rgba(120,105,84,0.75)';
    ctx.fillText('（长文仅展示前 ' + maxLines + ' 行）', CARD_W / 2, y + 6);
  }

  // ---------- 打卡页脚 ----------
  // 页脚宣纸罩：让底纹在此带淡出，保证水印文字清晰
  const fw = ctx.createLinearGradient(0, FOOT_TOP - 46, 0, FOOT_TOP + 46);
  fw.addColorStop(0, 'rgba(250,247,240,0)');
  fw.addColorStop(1, 'rgba(250,247,240,0.9)');
  ctx.fillStyle = fw;
  ctx.fillRect(0, FOOT_TOP - 46, CARD_W, CARD_H - FOOT_TOP + 46);
  ctx.strokeStyle = 'rgba(120,105,84,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(120, FOOT_TOP); ctx.lineTo(CARD_W - 120, FOOT_TOP); ctx.stroke();
  const now = new Date();
  const dstr = now.getFullYear() + '.' + pad2(now.getMonth() + 1) + '.' + pad2(now.getDate());
  const tstr = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3b3229';
  ctx.font = '700 38px ' + KAI;
  ctx.fillText('山窗', 120, FOOT_TOP + 78);
  // 详情页「读完」同款小红花，缀在「山窗」字样右侧
  drawFlower(ctx, 246, FOOT_TOP + 64, 2.0);
  ctx.font = '26px ' + KAI;
  ctx.fillStyle = '#7a6f60';
  const src = [poem.d, poem.a].filter(Boolean).join(' · ') + (title ? '《' + title + '》' : '');
  ctx.fillText(src, 120, FOOT_TOP + 122);
  ctx.fillText((poem._col && poem._col.name) ? '收录于 ' + poem._col.name : '古诗文 · 拼音 · 译文', 120, FOOT_TOP + 164);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#3b3229';
  ctx.font = '700 34px ' + KAI;
  ctx.fillText(dstr, CARD_W - 120, FOOT_TOP + 78);
  ctx.font = '30px ' + KAI;
  ctx.fillStyle = '#7a6f60';
  ctx.fillText(tstr, CARD_W - 120, FOOT_TOP + 122);
  ctx.font = '24px ' + KAI;
  const WD = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  ctx.fillText(WD[now.getDay()], CARD_W - 120, FOOT_TOP + 164);
  // 右下「集」：与详情页同款空心朱框（原来是实心反白）
  drawSealHollow(ctx, CARD_W - 176, CARD_H - 88, 96, 96, ['集'], 0.05, 50);
  return cv;
}

// 画卡片前等楷体就位：canvas 一旦用回退字体画完，不会因为字体后来到了而重绘。
// 关掉楷体开关时不主动拉字体（否则一次 fonts.load 就把 4.1MB 拽下来了）。
// sample 传入卡片实际要画的文字：霞鹜文楷是 unicode-range 子集分包，
// 带样本才能把标题/正文覆盖到的分片一起拉齐。
async function ensureKaiFont(sample) {
  if (document.documentElement.getAttribute('data-kai') === '0') return;
  try {
    if (document.fonts && document.fonts.load) {
      const text = String(sample || '').slice(0, 600);
      await Promise.all([
        document.fonts.load('400 1em "LXGW WenKai"', text),
        document.fonts.load('700 1em "LXGW WenKai"', text),
      ]);
      await document.fonts.ready;
    }
  } catch (e) {}
}

async function makeShareCard(poem, displayLines, title) {
  const sample = (title || '') + '山窗收录于星期' +
    (poem.a || '') + (poem.d || '') +
    (displayLines || []).map(l => l.t || '').join('');
  await ensureKaiFont(sample);
  const cv = drawCard(poem, displayLines, title);
  const url = cv.toDataURL('image/jpeg', 0.92);
  const pop = document.getElementById('fn-pop');
  if (!pop) return;
  pop.innerHTML = '<div class="fn-card" style="text-align:center;max-height:78vh"><div class="fn-term">诗词卡片</div>' +
    '<img src="' + url + '" alt="诗词卡片" style="max-width:100%;max-height:46vh;border:1px solid var(--line);border-radius:10px">' +
    '<div style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap">' +
    '<a class="fn-close" style="text-decoration:none;display:inline-block" href="' + url + '" download="shici-' + poem.i + '.jpg">保存图片</a>' +
    '<button class="fn-close" id="card-again">换一张</button>' +
    '<button class="fn-close" id="card-close">关闭</button></div>' +
    '<div class="section-tip" style="margin-top:8px">长按图片也可保存/分享（微信里长按直接转发）</div></div>';
  pop.classList.remove('hidden');
  const again = pop.querySelector('#card-again');
  if (again) again.onclick = (ev) => { ev.stopPropagation(); makeShareCard(poem, displayLines, title); };
  const close = pop.querySelector('#card-close');
  if (close) close.onclick = (ev) => { ev.stopPropagation(); pop.classList.add('hidden'); };
}

export { KAI, CARD_W, cardRnd, drawMist, paintCardBackground, paintInk, NO_LEAD, wrapLines, drawSealHollow, drawFlower, pad2, drawCard, makeShareCard };
