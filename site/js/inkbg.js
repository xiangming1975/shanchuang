// 网页背景：实时生成的水墨淡彩（纯 canvas 绘制，零图片资源、零网络请求）
// 与诗词卡片（js/card.js）同一份水墨：卡片背景即本文件的 paintInkScene。
// 远山 + 雾带 + 边缘竹枝 + 飞鸟 + 纸纹颗粒，整体透明度极低，只作底纹、不抢正文。
import { pref } from './store.js';

const CV_ID = 'ink-bg';
let canvas = null;
let observer = null;
let resizeTimer = 0;
let lastSeed = 0;
let onResize = null;            // 供 disposeInkBackground 解绑
let resizeDebounce = 0;
const mediaBindings = [];      // { mq, handler, legacy }，供 disposeInkBackground 解绑
let paintW = 0, paintH = 0;   // 位图实际尺寸（resize 时与视口比较，决定要不要重画）

// 种子随机（mulberry32）：同一种子出同一幅画，便于调试复现
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 渐变端点要用「同一 RGB、alpha=0」的透明色。
// 若写成 rgba(0,0,0,0)，浏览器在预乘前按 RGB 插值，中段会变成灰黑 → 画面上就是一条条灰黑色横纹。
function clearOf(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (!m) return 'rgba(0,0,0,0)';
  const [r, g, b] = m[1].split(',').map(x => x.trim());
  return `rgba(${r},${g},${b},0)`;
}

// 一道山脊：缓坡与锐峰混合，闭合到画布底部
function ridge(g, W, H, baseY, amp, color, rnd, opts) {
  const peaks = [];
  let x = -W * 0.15;
  while (x < W * 1.15) {
    peaks.push([x, baseY - amp * (0.24 + rnd() * 0.7), rnd() > 0.74]);
    x += W * (0.09 + rnd() * 0.16);
  }
  const path = () => {
    g.beginPath();
    g.moveTo(-W * 0.2, baseY);
    let px = -W * 0.2, py = baseY;
    for (const [qx, qy, sharp] of peaks) {
      if (sharp) g.lineTo(qx, qy);
      else g.quadraticCurveTo((px + qx) / 2, Math.min(py, qy) - amp * 0.22, qx, qy);
      px = qx; py = qy;
    }
    g.lineTo(W * 1.2, baseY);
  };
  path();
  // 山脚向下淡出（不压到画布底）：三层山才不会叠成一大片暗块，也符合"山脚没入云烟"的画法
  const bottom = baseY + amp * 1.15;
  g.lineTo(W * 1.2, bottom);
  g.lineTo(-W * 0.2, bottom);
  g.closePath();
  const fill = g.createLinearGradient(0, baseY - amp * 0.85, 0, bottom);
  fill.addColorStop(0, color);
  fill.addColorStop(0.55, color);
  fill.addColorStop(1, clearOf(color));
  g.fillStyle = fill;
  g.fill();
  if (opts && opts.snow) {
    g.save();
    path();
    g.strokeStyle = opts.snow;
    g.lineWidth = Math.max(6, H * 0.012);
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }
  return peaks;    // 供点苔/飞瀑定位
}

// 横向雾带：把远山压淡，形成云气层次
function mist(g, W, H, y, h, color, rnd) {
  const clear = clearOf(color);
  const grad = g.createLinearGradient(0, y - h, 0, y + h);
  grad.addColorStop(0, clear);
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, clear);
  g.fillStyle = grad;
  g.fillRect(0, y - h, W, h * 2);
  // 几团不规则雾，让边缘不呆板
  for (let i = 0; i < 4; i++) {
    const cx = W * rnd(), cy = y + (rnd() - 0.5) * h, rx = W * (0.14 + rnd() * 0.2), ry = h * (0.5 + rnd() * 0.7);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    rg.addColorStop(0, color);
    rg.addColorStop(1, clear);
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// 竹枝：沿画布左或右边缘探入，只占边缘窄带
function bamboo(g, W, H, rnd, color, sideRight, baseY) {
  const baseX = sideRight ? W * (0.955 + rnd() * 0.03) : W * (0.012 + rnd() * 0.03);
  const base = baseY || H * 0.8;
  const topY = base - H * (0.34 + rnd() * 0.16);
  g.strokeStyle = color;
  const n = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const x = baseX + (i - (n - 1) / 2) * W * 0.035;
    const lean = (rnd() - 0.5) * W * 0.03;
    g.lineWidth = Math.max(2.5, H * 0.0045);
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(x + lean * 0.5, (base + topY) / 2, x + lean, topY);
    g.stroke();
    // 竹节
    g.lineWidth = Math.max(1, H * 0.0022);
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      const yy = base + (topY - base) * t;
      const xx = x + lean * t * 0.8;
      g.beginPath();
      g.moveTo(xx - W * 0.008, yy);
      g.lineTo(xx + W * 0.008, yy);
      g.stroke();
    }
    // 竹叶
    g.fillStyle = color;
    for (let k = 0; k < 7; k++) {
      const t = 0.15 + rnd() * 0.75;
      const yy = base + (topY - base) * t;
      const xx = x + lean * t;
      const dir = sideRight ? -1 : 1;
      const len = W * (0.022 + rnd() * 0.022);
      const ang = (rnd() - 0.5) * 0.9;
      g.save();
      g.translate(xx, yy);
      g.rotate(dir > 0 ? ang - 0.5 : Math.PI - ang + 0.5);
      g.beginPath();
      g.ellipse(len * 0.5, 0, len * 0.5, Math.max(1.2, len * 0.11), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}

// 飞鸟：两笔弧线
function birds(g, W, H, rnd, color) {
  const n = 2 + Math.floor(rnd() * 3);
  const bx0 = W * (0.55 + rnd() * 0.3);
  const by0 = H * (0.12 + rnd() * 0.1);
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  for (let i = 0; i < n; i++) {
    const s = 7 + rnd() * 7;
    const bx = bx0 + i * (14 + rnd() * 14);
    const by = by0 + (rnd() - 0.5) * 24;
    g.beginPath();
    g.moveTo(bx - s, by);
    g.quadraticCurveTo(bx - s / 2, by - s * 0.75, bx, by);
    g.quadraticCurveTo(bx + s / 2, by - s * 0.75, bx + s, by);
    g.stroke();
  }
}

// 水面：淡墨长波纹（2026-10-29 重做）
// 旧版 18 行随机短促小波纹段，横在屏底读作「花屏横纹」。参照 LingDong-/shan-shui-inf 的画法：
// 水纹是横贯画面的长线（每条 40%~85% 画宽），起伏用双频正弦叠加（没有噪声库，
// 两个不成整数比的频率叠出来的波形就不像周期函数）；每条线画成两头收尖的带状笔触
// （宽度按 sin 包络，像毛笔提按）；行数 18→10、近处更长更宽——传统画水「留白也是水」，
// 线贵长不贵多，长而连贯才读作「流」，短线密集只会读作「纹路噪点」。
function water(g, W, H, y0, y1b, color, rnd) {
  g.fillStyle = color;
  // 一条水纹：从 (x0,y) 到 (x1,y) 的长波线。amp 控起伏、wid 控笔宽；
  // 上下各退半宽生成闭合带状多边形，fill 出来即一笔「水纹描」——两头尖、中段饱满。
  const line = (x0, x1, y, amp, wid, ph1, ph2) => {
    const N = 28;
    const up = [], dn = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = x0 + (x1 - x0) * t;
      const yy = y + amp * (Math.sin(t * 5.1 + ph1) * 0.72 + Math.sin(t * 9.7 + ph2) * 0.28);
      // 宽度包络：sin 收尖是主形，再叠一个低频调制让中段有肥瘦，笔触不呆
      const w = wid * (0.15 + 0.85 * Math.sin(Math.PI * t)) * (0.8 + 0.2 * Math.sin(t * 7.3 + ph1 * 2));
      up.push([x, yy - w / 2]);
      dn.push([x, yy + w / 2]);
    }
    g.beginPath();
    g.moveTo(up[0][0], up[0][1]);
    for (let j = 1; j <= N; j++) g.lineTo(up[j][0], up[j][1]);
    for (let j = N; j >= 0; j--) g.lineTo(dn[j][0], dn[j][1]);
    g.closePath();
    g.fill();
  };
  const rows = 10;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const y = y0 + (y1b - y0) * Math.pow(t, 0.9);
    const span = W * (0.42 + 0.43 * t);
    const x0 = -W * 0.02 + rnd() * Math.max(1, W * 0.98 - span);
    g.globalAlpha = 0.72 + rnd() * 0.28;   // 行与行墨色微变，水有深浅
    line(x0, x0 + span, y, 1.1 + t * 2.4, 1.5 + t * 2.0, rnd() * 6.28, rnd() * 6.28);
    // 三成概率补一条错开半条身位的短伴线，打破等距排线的机械感
    if (rnd() > 0.7) {
      const s2 = span * (0.3 + rnd() * 0.25);
      const x02 = x0 + span * (0.1 + rnd() * 0.5);
      line(x02, x02 + s2, y + 2.5 + rnd() * 3, 1 + t * 1.6, 1.2 + t * 1.4, rnd() * 6.28, rnd() * 6.28);
    }
  }
  g.globalAlpha = 1;
}

// 岸线：一条起伏的软边，把山脚与水隔开
function shore(g, W, H, y, color, rnd) {
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.beginPath();
  const n = 4;
  let px = -12, py = y;
  g.moveTo(px, py);
  for (let i = 1; i <= n; i++) {
    const nx = (W + 24) * i / n - 12;
    const ny = y + (rnd() - 0.5) * H * 0.018;
    g.quadraticCurveTo((px + nx) / 2 + (rnd() - 0.5) * 30, py + (rnd() - 0.5) * H * 0.012, nx, ny);
    px = nx; py = ny;
  }
  g.stroke();
}

// 花草：岸边一丛细茎 + 点点花头（朱色极淡，只作点睛）
function flora(g, W, H, y, stemColor, petalColor, rnd) {
  const startX = rnd() > 0.5 ? W * (0.06 + rnd() * 0.2) : W * (0.6 + rnd() * 0.2);
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const x = startX + (rnd() - 0.5) * W * 0.2;
    const h = H * (0.012 + rnd() * 0.028);
    const lean = (rnd() - 0.5) * W * 0.024;
    g.strokeStyle = stemColor;
    g.lineWidth = 0.9 + rnd() * 0.6;
    g.beginPath();
    g.moveTo(x, y + 1);
    g.quadraticCurveTo(x + lean * 0.4, y - h * 0.6, x + lean, y - h);
    g.stroke();
    g.fillStyle = petalColor;
    const r = 0.8 + rnd() * 1.0;
    g.beginPath();
    g.arc(x + lean, y - h, r, 0, Math.PI * 2);
    g.fill();
    if (rnd() > 0.55) {                       // 一片叶
      g.strokeStyle = stemColor;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x + lean * 0.35, y - h * 0.42);
      g.quadraticCurveTo(x + lean * 0.35 + 7, y - h * 0.52, x + lean * 0.35 + 12, y - h * 0.36);
      g.stroke();
    }
  }
}

// 竹丛：岸边矮竹（与贯穿全高的 edge bamboo 区分，只占一角）
function bambooClump(g, W, H, x, y, hh, color, rnd) {
  const n = 2 + Math.floor(rnd() * 2);
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    const bx = x + (i - (n - 1) / 2) * W * 0.028 + (rnd() - 0.5) * 6;
    const top = y - hh * (0.8 + rnd() * 0.4);
    const lean = (rnd() - 0.5) * W * 0.03;
    g.lineWidth = 1.5 + rnd();
    g.beginPath();
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx + lean * 0.5, y - hh * 0.5, bx + lean, top);
    g.stroke();
    g.fillStyle = color;
    for (let k = 0; k < 5; k++) {
      const t = 0.3 + rnd() * 0.68;
      const yy = y + (top - y) * t;
      const xx = bx + lean * t;
      const dir = rnd() > 0.5 ? 1 : -1;
      const len = W * (0.018 + rnd() * 0.018);
      g.save();
      g.translate(xx, yy);
      g.rotate(dir > 0 ? -0.45 + rnd() * 0.3 : Math.PI + 0.45 - rnd() * 0.3);
      g.beginPath();
      g.ellipse(len * 0.5, 0, len * 0.5, Math.max(0.9, len * 0.11), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}

// 点苔：沿山脊撒几点墨（传统山水的"点苔"，让山脊不呆板）——画在离屏层，模糊后像墨点
function mossDots(g, peaks, amp, color, rnd) {
  g.fillStyle = color;
  for (const [x, y] of peaks) {
    if (rnd() > 0.55) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(x + (rnd() - 0.5) * 26, y + rnd() * amp * 0.13, 1 + rnd() * 1.2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// 飞瀑：山间一线垂落，底部散成雾
function waterfall(g, peaks, amp, color, mistColor, rnd) {
  if (!peaks.length) return;
  const pk = peaks[Math.floor(rnd() * peaks.length)];
  if (!pk) return;
  const x = pk[0];
  const y = pk[1] + amp * 0.05;
  const len = amp * (0.45 + rnd() * 0.5);
  g.strokeStyle = color;
  g.lineWidth = 1.4 + rnd() * 1.2;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + 3, y + len * 0.5, x - 2, y + len);
  g.stroke();
  const r = 24 + rnd() * 26;
  const rg = g.createRadialGradient(x, y + len, 0, x, y + len, r);
  rg.addColorStop(0, mistColor);
  rg.addColorStop(1, clearOf(mistColor));
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y + len, r, 0, Math.PI * 2);
  g.fill();
}

// 芦苇：水边细茎 + 穗，随风微倾
function reeds(g, W, H, y, color, rnd) {
  const x0 = W * (rnd() > 0.5 ? 0.04 + rnd() * 0.16 : 0.72 + rnd() * 0.18);
  const n = 4 + Math.floor(rnd() * 4);
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    const x = x0 + (rnd() - 0.5) * W * 0.1;
    const h = H * (0.05 + rnd() * 0.07);
    const lean = (rnd() - 0.5) * W * 0.03;
    g.lineWidth = 0.9 + rnd() * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + lean * 0.4, y - h * 0.6, x + lean, y - h);
    g.stroke();
    g.lineWidth = 1.5;                        // 穗
    g.beginPath();
    g.moveTo(x + lean, y - h);
    g.lineTo(x + lean * 1.3, y - h - H * 0.012);
    g.stroke();
  }
}

// 卵石：岸边几丸淡墨
function stones(g, W, H, y, color, rnd) {
  g.fillStyle = color;
  const n = 2 + Math.floor(rnd() * 4);
  const x0 = W * rnd() * 0.78;
  for (let i = 0; i < n; i++) {
    const x = x0 + (rnd() - 0.5) * W * 0.16;
    const w = W * (0.008 + rnd() * 0.014);
    g.beginPath();
    g.ellipse(x, y + rnd() * 2, w, w * (0.45 + rnd() * 0.2), 0, 0, Math.PI * 2);
    g.fill();
  }
}

// 一叶小舟：两笔船身 + 一笔人影，水面留影
function boat(g, W, H, y, color, rnd) {
  const x = W * (0.2 + rnd() * 0.6);
  const w = W * (0.06 + rnd() * 0.04);
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x, y + w * 0.22, x + w / 2, y);
  g.stroke();
  g.beginPath();                              // 船中人
  g.moveTo(x - w * 0.24, y);
  g.lineTo(x - w * 0.18, y - w * 0.2);
  g.stroke();
  g.save();                                   // 水中倒影
  g.globalAlpha = 0.5;
  g.beginPath();
  g.moveTo(x - w * 0.38, y + w * 0.12);
  g.quadraticCurveTo(x, y + w * 0.28, x + w * 0.38, y + w * 0.12);
  g.stroke();
  g.restore();
}

// 水面浮禽：一丸小身 + 一小段颈 + 水影（比"细腿长颈"含蓄，不会像火柴人）
function waterfowl(g, W, H, y, color, rnd) {
  const n = 1 + Math.floor(rnd() * 2);
  g.fillStyle = color;
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    const x = W * (0.18 + rnd() * 0.58) + i * W * 0.06;
    const yy = y + rnd() * H * 0.012;
    const w = W * (0.013 + rnd() * 0.009);
    g.beginPath();
    g.ellipse(x, yy, w, w * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = Math.max(1, w * 0.3);
    g.beginPath();
    g.moveTo(x + w * 0.62, yy - w * 0.08);
    g.quadraticCurveTo(x + w * 0.98, yy - w * 0.48, x + w * 1.06, yy - w * 0.78);
    g.stroke();
    g.save();
    g.globalAlpha = 0.45;
    g.beginPath();
    g.ellipse(x, yy + w * 0.58, w * 1.15, w * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// 纸纹颗粒：极淡的点，模拟宣纸纤维
function grain(g, W, H, rnd, color, count) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const s = rnd() > 0.85 ? 1.8 : 1;
    g.fillRect(W * rnd(), H * rnd(), s, s);
  }
}


/* ══════════════════════════════════════════════════════════════════════
   近景枝：贴边斜出的竹 / 梅 / 松
   与远山不同，这一层画在主画布的原分辨率上（不经 1/3 → 1/2 的离屏缩放），
   笔画是锐的；再加更重的墨色、粗起笔、大叶，才显得「在镜头前面」。
   底线：只占边角，不越过中线，不压正文。
   ══════════════════════════════════════════════════════════════════════ */

// 三次贝塞尔采样：主干要「上升→到顶→回勾」，二次曲线做不出这个转折
function cubicPts(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
  return out;
}

// 折线细分：梅枝要保留锐角，不做平滑
function polyPts(nodes, per) {
  const out = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    for (let k = 0; k < per; k++) {
      const t = k / per;
      out.push([
        nodes[i][0] + (nodes[i + 1][0] - nodes[i][0]) * t,
        nodes[i][1] + (nodes[i + 1][1] - nodes[i][1]) * t,
      ]);
    }
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

// 折角轻磨：Chaikin 一次，把生硬的直角切成两段，仍保留棱角
function chaikin(nodes) {
  if (nodes.length < 3) return nodes;
  const out = [nodes[0]];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, y0] = nodes[i], [x1, y1] = nodes[i + 1];
    out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
    out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

// 收锋指数越大，越「粗到底、只在末梢收」；0.82 会让中段就瘦一半，像铁丝
function taperAt(w0, w1, t) { return w0 + (w1 - w0) * Math.pow(t, 1.55); }

// 渐细笔画：按法线把中心线两侧偏移成多边形再填充。
// 用 stroke 画不出「起笔粗、收笔尖」，画出来的枝条永远像根铁丝。
function taperFill(g, pts, w0, w1) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const w = taperAt(w0, w1, t) / 2;
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const r = pts[Math.max(0, i - 1)];
    const dx = q[0] - r[0], dy = q[1] - r[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    L.push([p[0] + nx * w, p[1] + ny * w]);
    R.push([p[0] - nx * w, p[1] - ny * w]);
  }
  g.beginPath();
  g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) g.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath();
  g.fill();
}

// 一笔墨：先铺一层淡的洇边，再压上实笔——边缘有墨韵，不像矢量图
function inkStroke(g, pts, w0, w1, color, bleed) {
  if (bleed) { g.fillStyle = bleed; taperFill(g, pts, w0 * 1.8, Math.max(1.6, w1 * 2.8)); }
  g.fillStyle = color;
  taperFill(g, pts, w0, w1);
}

// 一片竹叶：两端尖、略有肚
function blade(g, x, y, len, wid, ang) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.45, -wid, len, 0);
  g.quadraticCurveTo(len * 0.45, wid * 0.75, 0, 0);
  g.closePath();
  g.fill();
  g.restore();
}

// 一片叶的轮廓写进当前路径（不单独 fill、不变换状态）——批量绘制的最小单元
function bladePath(g, x, y, len, wid, ang) {
  const c = Math.cos(ang), s2 = Math.sin(ang);
  const tx = (px, py) => x + px * c - py * s2;
  const ty = (px, py) => y + px * s2 + py * c;
  g.moveTo(tx(0, 0), ty(0, 0));
  g.quadraticCurveTo(tx(len * 0.45, -wid), ty(len * 0.45, -wid), tx(len, 0), ty(len, 0));
  g.quadraticCurveTo(tx(len * 0.45, wid * 0.75), ty(len * 0.45, wid * 0.75), tx(0, 0), ty(0, 0));
}

// 叶簇：「个」字扇形——中片最长、末梢一片垂头，真竹叶的坠感。
// 只往 specs 里攒规格，由调用方合成一条路径一次 fill（一丛竹几十片叶）。
function leafFan(specs, x, y, baseAng, R, rnd) {
  const cnt = 3 + Math.floor(rnd() * 2);
  const mid = Math.floor((cnt - 1) / 2);
  for (let k = 0; k < cnt; k++) {
    const off = (k - mid) * 0.30 + (rnd() - 0.5) * 0.12;
    let a = baseAng + off;
    const ll = R * (0.056 + rnd() * 0.030) * (k === mid ? 1.15 : 0.86);
    if (k === cnt - 1) a += 0.42;                 // 末梢一片垂头
    specs.push({ x, y, len: ll, wid: ll * (0.085 + rnd() * 0.03), ang: a });
  }
}

// ── 竹：一丛 1~4 竿，竿上生枝、枝头挂叶 ─────────────────────────────────
// 关键在「同根」：各竿若从边缘不同高度各自起笔，看着是几根平行的影子；
// 从同一处丛生、向不同方向散开，才数得出竿数。
function nearBamboo(g, W, H, rnd, side, M) {
  const R = Math.min(W, H, 720);
  const dir = side > 0 ? -1 : 1;
  const xEdge = side > 0 ? W + R * 0.03 : -R * 0.03;
  const n = 1 + Math.floor(rnd() * 4);          // 一竿到四竿都行
  const baseY = H * (0.45 + rnd() * 0.05);
  const maxReach = Math.min(W * 0.44, R * 0.44);
  const inAng = dir > 0 ? 0 : Math.PI;           // 朝画内的水平方向
  const specs = [];                              // 叶片批量：攒齐一笔 fill

  for (let i = 0; i < n; i++) {
    // 每竿的「顶端落点 / 顶端高度 / 中段弯曲」都错开，否则几条弧会叠成一根
    const rk = R * (0.17 + i * 0.125) + (rnd() - 0.5) * R * 0.04;
    const apexX = xEdge + dir * Math.min(maxReach, Math.max(R * 0.08, rk));
    const short = i === n - 1 && n >= 3;                // 末竿矮一截，丛才有层次
    const apexY = H * (0.03 + rnd() * 0.06) + (short ? H * 0.13 : 0);
    const bow = (rnd() - 0.5) * R * 0.16;
    const p0 = [xEdge + dir * (rnd() - 0.5) * R * 0.02, baseY + (rnd() - 0.5) * H * 0.03];
    const p1 = [xEdge + dir * Math.abs(apexX - xEdge) * 0.06 + bow, baseY - (baseY - apexY) * 0.62];
    const apexY2 = apexY;
    const p3 = [apexX - dir * R * (0.03 + rnd() * 0.03), apexY2 + H * (0.05 + rnd() * 0.04)];
    const pts = cubicPts(p0, p1, [apexX, apexY], p3, 28);
    const w0 = R * (0.0175 - i * 0.0018);
    const w1 = Math.max(1, R * 0.0018);
    inkStroke(g, pts, w0, w1, M.stem, M.stemBleed);

    // 竿上取点的小工具
    const at = (t) => pts[Math.round(Math.max(0, Math.min(1, t)) * (pts.length - 1))];

    // 竹节：节环两道——主环略粗，箨环细、沿竿身错开一点，才看得出「节节」
    for (let k = 1; k <= 6; k++) {
      const t = 0.10 + k * 0.14;
      if (t > 0.95) break;
      const idx = Math.round(t * (pts.length - 1));
      const p = pts[idx];
      const q = pts[Math.min(pts.length - 1, idx + 3)];
      const r2 = pts[Math.max(0, idx - 3)];
      const dx = q[0] - r2[0], dy = q[1] - r2[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const hw = taperAt(w0, w1, t) * 0.72;
      const tx2 = dx / len, ty2 = dy / len;
      const off2 = Math.max(1.4, R * 0.005);
      g.strokeStyle = M.stem;
      g.lineCap = 'round';
      g.beginPath();
      g.lineWidth = Math.max(1.2, R * 0.0032);
      g.moveTo(p[0] + nx * hw, p[1] + ny * hw);
      g.lineTo(p[0] - nx * hw, p[1] - ny * hw);
      g.stroke();
      g.beginPath();
      g.lineWidth = Math.max(0.8, R * 0.0018);
      g.moveTo(p[0] + nx * hw * 0.8 + tx2 * off2, p[1] + ny * hw * 0.8 + ty2 * off2);
      g.lineTo(p[0] - nx * hw * 0.8 + tx2 * off2, p[1] - ny * hw * 0.8 + ty2 * off2);
      g.stroke();
    }

    // 竹枝：从竿上部几节斜出，末梢压一簇叶（竹叶其实长在枝上，不在竿上）
    const brs = 1 + Math.floor(rnd() * 3);
    for (let b = 0; b < brs; b++) {
      const t = 0.38 + b * 0.17 + rnd() * 0.08;
      if (t > 0.96) break;
      const p = at(t);
      const len = R * (0.055 + rnd() * 0.065);
      const ang = inAng - dir * (0.12 + rnd() * 0.42);       // 朝内、略向上
      const ex = p[0] + Math.cos(ang) * len;
      const ey = p[1] + Math.sin(ang) * len - R * 0.012;
      const bp = cubicPts([p[0], p[1]],
        [p[0] + Math.cos(ang) * len * 0.5, p[1] + Math.sin(ang) * len * 0.5 - R * 0.01],
        [ex, ey], [ex + Math.cos(ang) * R * 0.012, ey - R * 0.004], 8);
      inkStroke(g, bp, R * 0.0050, Math.max(0.9, R * 0.0014), M.stem, null);
      // 枝头叶簇（「个」字扇形，末梢一片垂头）
      leafFan(specs, ex, ey, inAng + dir * 0.62, R, rnd);
      // 有的枝再分一小叉
      if (rnd() > 0.55) {
        const a2 = ang + (rnd() - 0.5) * 0.8;
        const e2x = ex + Math.cos(a2) * len * 0.55;
        const e2y = ey + Math.sin(a2) * len * 0.55 - R * 0.008;
        inkStroke(g, cubicPts([ex, ey], [(ex + e2x) / 2, (ey + e2y) / 2 - R * 0.006], [e2x, e2y],
          [e2x + Math.cos(a2) * R * 0.01, e2y], 6), R * 0.0028, Math.max(0.8, R * 0.0011), M.stem, null);
        leafFan(specs, e2x, e2y, inAng + dir * 0.58, R, rnd);
      }
    }

    // 竿梢再压一簇
    const tip = pts[pts.length - 1];
    leafFan(specs, tip[0], tip[1], inAng + dir * 0.80, R, rnd);
  }
  // 一丛几十片叶同色：合成一条路径一次 fill（性能关键）
  g.fillStyle = M.stem;
  g.beginPath();
  for (const b of specs) bladePath(g, b.x, b.y, b.len, b.wid, b.ang);
  g.fill();
}

// ── 梅：折线主干（梅枝如铁线），折角生枝、枝上开花 ───────────────────────
function nearPlum(g, W, H, rnd, side, M) {
  const R = Math.min(W, H, 720);
  const dir = side > 0 ? -1 : 1;
  const xEdge = side > 0 ? W + R * 0.03 : -R * 0.03;
  const inAng = dir > 0 ? 0 : Math.PI;
  let x = xEdge, y = H * (0.52 + rnd() * 0.06);
  const nodes = [[x, y]];
  // 折角节奏：一记斜冲（近水平）接一记回收，才像「铁线梅」而不是斜直线
  const PHI = [1.12, -0.26, 0.96, -0.22, 0.74];
  for (let i = 0; i < PHI.length; i++) {
    const len = R * (0.100 + rnd() * 0.045);
    const a = -Math.PI / 2 + dir * (PHI[i] + (rnd() - 0.5) * 0.18);
    x += Math.cos(a) * len;
    y += Math.sin(a) * len;
    nodes.push([x, y]);
  }
  x -= dir * R * (0.012 + rnd() * 0.02);
  y += R * (0.03 + rnd() * 0.03);
  nodes.push([x, y]);

  const pts = polyPts(chaikin(nodes), 8);
  const w0 = R * 0.0185, w1 = Math.max(1, R * 0.0016);
  inkStroke(g, pts, w0, w1, M.stem, M.stemBleed);

  // 枝：每个折角生 2~3 条，其中一条再分一次叉（梅枝要多、要乱而有势）
  const tips = [];
  const addTwig = (jx, jy, wBase, depth) => {
    const len = R * (0.050 + rnd() * 0.055) * (depth ? 0.72 : 1);
    const ang = inAng + dir * ((rnd() - 0.55) * 1.7);
    const ex = jx + Math.cos(ang) * len;
    const ey = jy + Math.sin(ang) * len;
    const tp = cubicPts([jx, jy],
      [jx + Math.cos(ang) * len * 0.5, jy + Math.sin(ang) * len * 0.5 + (rnd() - 0.5) * R * 0.02],
      [ex, ey], [ex + (rnd() - 0.5) * R * 0.014, ey - R * 0.008], 10);
    inkStroke(g, tp, wBase, Math.max(0.9, w1), M.stem, null);
    tips.push([ex, ey]);
    if (depth === 0 && rnd() > 0.45) {
      // 二次分叉：从这条枝的 2/3 处再挑一根
      addTwig(jx + (ex - jx) * 0.62, jy + (ey - jy) * 0.62, wBase * 0.55, 1);
    }
  };
  for (let i = 1; i < nodes.length - 1; i++) {
    const [jx, jy] = nodes[i];
    const cnt = 1 + (rnd() > 0.5 ? 1 : 0);
    for (let k = 0; k < cnt; k++) addTwig(jx, jy, w0 * (0.42 - k * 0.09), 0);
    tips.push([jx, jy]);
  }
  tips.push([nodes[nodes.length - 1][0], nodes[nodes.length - 1][1]]);

  // 花：五瓣 + 花心；未开的做花苞
  for (const [tx, ty] of tips) {
    if (rnd() > 0.82) continue;                 // 留白：不是每个枝头都要开花
    const cnt = 1 + (rnd() > 0.75 ? 1 : 0);
    for (let k = 0; k < cnt; k++) {
      const bx = tx + (rnd() - 0.5) * R * 0.075;
      const by = ty + (rnd() - 0.5) * R * 0.075;
      if (rnd() > 0.28) {
        const r = R * (0.017 + rnd() * 0.006);
        g.fillStyle = M.bloom;
        // 五瓣要留缝：花心偏移 0.72r、瓣半径 0.44r，否则糊成一团
        for (let j = 0; j < 5; j++) {
          const a = -Math.PI / 2 + j * (Math.PI * 2 / 5) + rnd() * 0.16;
          g.beginPath();
          g.arc(bx + Math.cos(a) * r * 0.72, by + Math.sin(a) * r * 0.72, r * 0.44, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = M.bloomCore;
        g.beginPath();
        g.arc(bx, by, r * 0.20, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = M.bloom;
        g.beginPath();
        g.ellipse(bx, by, R * 0.0055, R * 0.0095, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

// 松针「云片」：先在椭圆内撒满短针，再整体纵向压扁。
// 同心长针从圆心放射，出来是一颗星；**松针成束**才像真松——8~12 个小枝权
// 分布在椭圆外缘，每枝再放射 6~9 根针。整片同色同宽，一笔 beginPath 批量画完
//（原来每根针一次 stroke，一棵松上千次 stroke 是低端手机的性能毛刺）。
function pineCloud(g, x, y, r, ang, color, rnd) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(1, 0.40);
  // 底：一团淡墨撑住整片，边缘再破开
  g.globalAlpha = 0.20;
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineWidth = Math.max(0.9, r * 0.032);
  g.beginPath();
  const tufts = 8 + Math.floor(rnd() * 5);
  for (let t2 = 0; t2 < tufts; t2++) {
    const th = (t2 / tufts) * Math.PI * 2 + rnd() * 0.5;   // 均匀布点 + 抖动
    const rad = r * (0.60 + rnd() * 0.26);
    const bx = Math.cos(th) * rad, by = Math.sin(th) * rad;
    const bn = 6 + Math.floor(rnd() * 4);
    for (let k = 0; k < bn; k++) {
      const a = th + (rnd() - 0.5) * 1.3;                  // 朝外略散
      const len = r * (0.16 + rnd() * 0.22);
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
    }
  }
  g.stroke();
  g.restore();
}

// ── 松：云松。主干带折节，横枝左右铺开，枝头压云片 ─────────────────────
function nearPine(g, W, H, rnd, side, M) {
  const R = Math.min(W, H, 720);
  const dir = side > 0 ? -1 : 1;
  const xEdge = side > 0 ? W + R * 0.03 : -R * 0.03;
  const inAng = dir > 0 ? 0 : Math.PI;
  const y0 = H * (0.52 + rnd() * 0.08);
  const reach = Math.min(W * 0.40, R * (0.16 + rnd() * 0.08));
  const topY = H * (0.12 + rnd() * 0.05);

  // 主干：两段接一处折节，松干不该是一根顺滑的圆弧
  const knee = [xEdge + dir * reach * 0.46, y0 - (y0 - topY) * 0.46 + (rnd() - 0.5) * H * 0.02];
  const seg1 = cubicPts([xEdge, y0], [xEdge + dir * reach * 0.10, y0 - (y0 - topY) * 0.16], knee, knee, 10);
  const seg2 = cubicPts(knee, [knee[0] + dir * reach * 0.26, knee[1] - (knee[1] - topY) * 0.48],
    [xEdge + dir * reach * 0.96, topY - H * 0.015],
    [xEdge + dir * (reach + R * 0.02), topY + H * (0.02 + rnd() * 0.02)], 14);
  const pts = seg1.concat(seg2.slice(1));
  const w0 = R * 0.026, w1 = Math.max(1.4, R * 0.0032);
  inkStroke(g, pts, w0, w1, M.stem, M.stemBleed);

  // 鳞纹：沿主干七道短弧一笔画完（松皮唯一的识别点）
  g.strokeStyle = M.stem;
  g.lineWidth = Math.max(1, R * 0.0022);
  g.beginPath();
  for (let k = 1; k <= 7; k++) {
    const t = 0.08 + k * 0.11;
    const idx = Math.round(t * (pts.length - 1));
    const p = pts[idx];
    const q = pts[Math.min(pts.length - 1, idx + 2)];
    const r2 = pts[Math.max(0, idx - 2)];
    const dx = q[0] - r2[0], dy = q[1] - r2[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const hw = taperAt(w0, w1, t) * 0.34;
    g.moveTo(p[0] + nx * hw, p[1] + ny * hw);
    g.quadraticCurveTo(p[0] + dx / len * hw * 0.9, p[1] + dy / len * hw * 0.9, p[0] - nx * hw, p[1] - ny * hw);
  }
  g.stroke();

  // 横枝：4 层，向画内横出，越往上越短；枝端与枝中各压一片云
  const levels = [0.20, 0.40, 0.60, 0.80];
  for (let li = 0; li < levels.length; li++) {
    const t = levels[li] + (rnd() - 0.5) * 0.05;
    const idx = Math.round(t * (pts.length - 1));
    const p = pts[idx];
    const scale = 1 - li * 0.13;
    const len = R * (0.16 + rnd() * 0.09) * scale;
    // 横枝近乎水平、梢头微微上扬，这是云松的骨架
    const ang = inAng + dir * (-0.10 - rnd() * 0.12);
    const ex = p[0] + Math.cos(ang) * len;
    const ey = p[1] + Math.sin(ang) * len;
    const bp = cubicPts([p[0], p[1]],
      [p[0] + Math.cos(ang) * len * 0.45, p[1] + Math.sin(ang) * len * 0.45 + R * 0.008],
      [p[0] + Math.cos(ang) * len * 0.8, p[1] + Math.sin(ang) * len * 0.8 - R * 0.004],
      [ex, ey], 12);
    inkStroke(g, bp, w0 * (0.34 - li * 0.04), Math.max(1, w1), M.stem, null);

    // 枝头一片大云，枝中一片小云
    pineCloud(g, ex, ey, R * (0.070 + rnd() * 0.020) * scale, ang, M.needle, rnd);
    pineCloud(g, p[0] + (ex - p[0]) * 0.55, p[1] + (ey - p[1]) * 0.55 - R * 0.012,
      R * (0.048 + rnd() * 0.014) * scale, ang, M.needle, rnd);

    // 有的层再生一根短侧枝，向上挑，云片错开高度
    if (rnd() > 0.45) {
      const a2 = ang - dir * (0.45 + rnd() * 0.3);
      const l2 = len * (0.38 + rnd() * 0.2);
      const e2 = [p[0] + Math.cos(a2) * l2, p[1] + Math.sin(a2) * l2];
      inkStroke(g, cubicPts([p[0], p[1]],
        [p[0] + Math.cos(a2) * l2 * 0.5, p[1] + Math.sin(a2) * l2 * 0.5],
        [e2[0], e2[1]], [e2[0] + Math.cos(a2) * R * 0.012, e2[1] - R * 0.004], 8),
      w0 * 0.22, Math.max(1, w1), M.stem, null);
      pineCloud(g, e2[0], e2[1], R * (0.048 + rnd() * 0.014) * scale, a2, M.needle, rnd);
    }
  }
  // 树冠：主干末端压一片，稍大
  const tip = pts[pts.length - 1];
  pineCloud(g, tip[0] + Math.cos(inAng) * R * 0.02, tip[1] - R * 0.01,
    R * (0.075 + rnd() * 0.02), inAng + dir * -0.2, M.needle, rnd);
}

// 入口：随机一侧、随机一种，只占边角
function foregroundBranch(g, W, H, rnd, M, side) {
  const k = rnd();
  if (k < 0.48) nearBamboo(g, W, H, rnd, side, M);
  else if (k < 0.79) nearPlum(g, W, H, rnd, side, M);
  else nearPine(g, W, H, rnd, side, M);
}

// 山景层：先画在 1/5 尺寸的离屏画布，再放大贴回主画布。
// 双线性插值天然把山脊边柔化成"墨晕"，不依赖 ctx.filter（Safari 长期不支持），任何浏览器都能出效果。
// 场景：基础构图（远山→雾→中山→云水→水岸）不变，换配色与点景组合。
// 「清远」是原来的默认景；其余三种各自带专属元素，避免十几样东西全堆一张画上。
const SCENES = [
  { id: 'qingyuan', w: 5 },   // 清远：两重山 + 水岸 + 舟/禽
  { id: 'xueyi', w: 2, near: true },   // 雪意：三重大山 + 雪点 + 枯枝，水面不放花草
  { id: 'yeyu', w: 2 },       // 夜雨：雨丝 + 厚雾 + 深水，无月
  { id: 'wanxia', w: 2 },     // 晚霞：暖霞带 + 低日 + 归鸟
];
// 深色主题下「清远」加权：只有它挂月，雨/雪/晚霞都不挂（月与雨雪互斥，画面上不该同时出现）
function pickScene(rnd, dark) {
  const wOf = (sc) => (dark && sc.id === 'qingyuan') ? sc.w * 2 : sc.w;
  const total = SCENES.reduce((a, sc) => a + wOf(sc), 0);
  let t = rnd() * total;
  for (const sc of SCENES) { t -= wOf(sc); if (t <= 0) return sc; }
  return SCENES[0];
}

// 晚霞：天空一条横向暖色霞带（画在山之前，山压在上面）
function sunsetBand(g, W, H, rnd) {
  const y0 = H * 0.06, hh = H * 0.34;
  const grad = g.createLinearGradient(0, y0, 0, y0 + hh);
  grad.addColorStop(0, 'rgba(214,158,120,0)');
  grad.addColorStop(0.42, 'rgba(212,150,108,0.20)');
  grad.addColorStop(0.72, 'rgba(226,170,124,0.13)');
  grad.addColorStop(1, 'rgba(226,170,124,0)');
  g.fillStyle = grad;
  g.fillRect(0, y0, W, hh);
  // 低日：贴着霞带下缘，只露一层柔光
  const sx = W * (0.18 + rnd() * 0.64), sy = H * (0.30 + rnd() * 0.05);
  const r = Math.min(W, H) * (0.05 + rnd() * 0.02);
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, r * 4.2);
  glow.addColorStop(0, 'rgba(255,236,200,0.42)');
  glow.addColorStop(0.35, 'rgba(240,190,140,0.20)');
  glow.addColorStop(1, 'rgba(240,190,140,0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(sx, sy, r * 4.2, 0, Math.PI * 2); g.fill();
}

// 夜雨：斜雨丝，上密下疏（雨脚落在水面之前就淡了）
function rainVeil(g, W, H, rnd, color) {
  g.strokeStyle = color;
  for (let i = 0; i < 88; i++) {
    const x = W * rnd(), y = H * (0.02 + Math.pow(rnd(), 1.35) * 0.74);
    const len = H * (0.03 + rnd() * 0.07);
    g.lineWidth = 0.8 + rnd() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - len * 0.26, y + len);
    g.stroke();
  }
}

// 雪意：疏雪点，近处稍大
function snowDots(g, W, H, rnd, color) {
  g.fillStyle = color;
  for (let i = 0; i < 96; i++) {
    const t = Math.pow(rnd(), 0.8);
    g.beginPath();
    g.arc(W * rnd(), H * (0.05 + t * 0.85), 0.7 + t * 1.3, 0, Math.PI * 2);
    g.fill();
  }
}

function paintLandscape(g, W, H, rnd, M, dark, scene) {
  // 先画到 1/3 尺寸，再经 1/2 放大到原始尺寸：两次双线性插值把锐角磨成墨晕。
  // 采样密度取 1/3（约 160px 宽）而非更低——太低会让山脊栅格化成可见的台阶。
  const off = document.createElement('canvas');
  off.width = Math.max(4, Math.round(W / 3));
  off.height = Math.max(4, Math.round(H / 3));
  const og = off.getContext('2d');
  if (!og) return;
  og.setTransform(1 / 3, 0, 0, 1 / 3, 0, 0);
  const y1 = H * (0.44 + rnd() * 0.12);
  ridge(og, W, H, y1, H * 0.17, M.far, rnd);
  mist(og, W, H, y1 + H * 0.02, H * 0.055, M.mist, rnd);
  const snowOpt = { snow: dark ? 'rgba(255,252,244,0.06)' : 'rgba(255,255,252,0.16)' };
  const midPeaks = ridge(og, W, H, y1 + H * 0.15, H * 0.14, M.mid, rnd,
    (scene && scene.id === 'xueyi') || rnd() > 0.72 ? snowOpt : null);
  mist(og, W, H, y1 + H * 0.26, H * 0.05, M.mist, rnd);
  // 第三重近山只在「雪意」景出现：平时它与底部水流贴太近，看着像重影
  let waterY = 0;
  if (scene && scene.near) {
    mist(og, W, H, y1 + H * 0.36, H * 0.045, M.mist, rnd);
    const nearPeaks = ridge(og, W, H, y1 + H * 0.41, H * 0.13, M.near, rnd, snowOpt);
    mossDots(og, nearPeaks, H * 0.13, M.moss, rnd);
    waterY = Math.min(H * 0.87, y1 + H * 0.50);   // 水面让到近山脚之下；夹在视口内，别被推出屏幕
  }
  // 点苔与飞瀑画在离屏层：模糊后是墨点与白练，与山体同一层才自然
  mossDots(og, midPeaks, H * 0.14, M.moss, rnd);
  if (!(scene && scene.near) && rnd() > 0.55) waterfall(og, midPeaks, H * 0.14, M.fall, M.mist, rnd);
  const mid = document.createElement('canvas');
  mid.width = Math.max(6, Math.round(W / 2));
  mid.height = Math.max(6, Math.round(H / 2));
  const mg = mid.getContext('2d');
  if (mg) {
    mg.imageSmoothingEnabled = true;
    mg.drawImage(off, 0, 0, mid.width, mid.height);
  }
  g.save();
  g.imageSmoothingEnabled = true;
  try { g.imageSmoothingQuality = 'high'; } catch (e) {}
  g.drawImage(mg ? mid : off, 0, 0, W, H);
  g.restore();
  return { y1, waterY };
}

// 调色板：浅色主题用冷灰墨（淡到只像纸上的一层影），深色主题用暖白墨。
// 网站背景与诗词卡片共用同一套。
const PALETTE = {
  dark: { far: 'rgba(232,222,202,0.11)', mid: 'rgba(236,226,206,0.14)', near: 'rgba(240,230,210,0.18)',
        mist: 'rgba(22,19,15,0.21)', plant: 'rgba(226,216,196,0.038)', bird: 'rgba(230,220,200,0.095)',
        water: 'rgba(228,218,198,0.11)', shore: 'rgba(228,218,198,0.14)',
        floraStem: 'rgba(226,216,196,0.060)', floraPetal: 'rgba(206,146,116,0.105)', clump: 'rgba(226,216,196,0.048)',
        moss: 'rgba(240,230,210,0.072)', fall: 'rgba(255,252,244,0.11)',
        stone: 'rgba(226,216,196,0.068)', boat: 'rgba(238,228,208,0.090)', heron: 'rgba(238,228,208,0.10)',
        grain: 'rgba(255,250,240,0.020)', moon: 'rgba(255,250,236,0.13)',
        moonGlow: 'rgba(255,250,236,0.055)', moonBody: 'rgba(255,251,240,0.40)',
        rain: 'rgba(226,218,200,0.055)', snow: 'rgba(252,250,244,0.16)', sun: 'rgba(255,228,188,0.20)',
        // 近景枝：远山最重才 0.30，这一层给到 0.40+ 才拉得开景深
        stem: 'rgba(240,232,214,0.40)', stemBleed: 'rgba(240,232,214,0.10)',
        bloom: 'rgba(214,152,122,0.40)', bloomCore: 'rgba(30,26,20,0.55)', needle: 'rgba(234,238,228,0.34)' },
  light: { far: 'rgba(112,127,123,0.20)', mid: 'rgba(94,109,105,0.25)', near: 'rgba(78,93,91,0.30)',
        mist: 'rgba(250,247,240,0.30)', plant: 'rgba(84,100,86,0.038)', bird: 'rgba(96,108,104,0.085)',
        water: 'rgba(90,105,103,0.16)', shore: 'rgba(82,95,91,0.22)',
        floraStem: 'rgba(84,100,86,0.075)', floraPetal: 'rgba(163,55,47,0.105)', clump: 'rgba(78,94,80,0.075)',
        moss: 'rgba(66,80,76,0.110)', fall: 'rgba(252,250,244,0.55)',
        stone: 'rgba(96,108,102,0.130)', boat: 'rgba(70,82,78,0.180)', heron: 'rgba(70,82,78,0.220)',
        grain: 'rgba(120,104,84,0.020)', moon: 'rgba(255,252,240,0.16)',
        moonGlow: 'rgba(255,252,240,0.045)', moonBody: 'rgba(255,253,246,0.30)',
        rain: 'rgba(96,110,112,0.105)', snow: 'rgba(255,255,252,0.72)', sun: 'rgba(255,232,190,0.55)',
        // 近景枝：比最重的山（0.30）再重一档，且边缘不糊——锐 + 浓 = 近
        stem: 'rgba(44,40,34,0.46)', stemBleed: 'rgba(44,40,34,0.11)',
        bloom: 'rgba(146,52,42,0.46)', bloomCore: 'rgba(250,244,232,0.55)', needle: 'rgba(52,62,56,0.40)' },
};

// 把整幅水墨画进任意 2D 上下文 —— 网站背景与诗词卡片共用这一份。
// seed 决定构图；opt.dark 选调色板；opt.alpha 整体压淡（卡片用得上）。
// 朔望：Meeus《天文算法》第 49 章，第 k 个朔的儒略日。误差 < 1 分钟。
// 老写法是「用固定 29.53 天从 2000 年那次新月往回推」，26 年下来会差到一两天——
// 2026-10-28（农历十九）算出月龄 16.4、照亮 97%，画出来就是一张满月脸。
function newMoonJDE(k) {
  const T = k / 1236.85;
  const rad = Math.PI / 180;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
  return 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
    - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4
    - 0.40720 * Math.sin(Mp)
    + 0.17241 * E * Math.sin(M)
    + 0.01608 * Math.sin(2 * Mp)
    + 0.01039 * Math.sin(2 * F)
    + 0.00739 * E * Math.sin(Mp - M)
    - 0.00514 * E * Math.sin(Mp + M)
    + 0.00208 * E * E * Math.sin(2 * M)
    - 0.00111 * Math.sin(Mp - 2 * F)
    - 0.00057 * Math.sin(Mp + 2 * F)
    + 0.00056 * E * Math.sin(2 * Mp + M)
    - 0.00042 * Math.sin(3 * Mp)
    + 0.00042 * E * Math.sin(M + 2 * F)
    + 0.00038 * E * Math.sin(M - 2 * F)
    - 0.00024 * E * Math.sin(2 * Mp - M)
    - 0.00017 * Math.sin(Om)
    - 0.00007 * Math.sin(Mp + 2 * M)
    + 0.00004 * Math.sin(2 * Mp - 2 * F)
    + 0.00004 * Math.sin(3 * M)
    + 0.00003 * Math.sin(Mp + M - 2 * F)
    + 0.00003 * Math.sin(2 * Mp + 2 * F)
    - 0.00003 * Math.sin(Mp + M + 2 * F)
    + 0.00003 * Math.sin(Mp - M + 2 * F)
    - 0.00002 * Math.sin(Mp - M - 2 * F)
    - 0.00002 * Math.sin(3 * Mp + M)
    + 0.00002 * Math.sin(4 * Mp);
}

// 返回 { phase: 0 朔 → 0.5 望 → 1 又朔, lit: 照亮比例, age: 月龄(天) }
// phase 用本个朔望月的实际长度做分母，不用平均值——月末那两天不会突然跳。
function moonPhaseAt(ts) {
  const jd = ts / 86400000 + 2440587.5;
  let k = Math.round((jd - 2451550.09766) / 29.530588861);
  while (newMoonJDE(k) > jd) k--;
  while (newMoonJDE(k + 1) <= jd) k++;
  const a = newMoonJDE(k), b = newMoonJDE(k + 1);
  const phase = (jd - a) / (b - a);
  return { phase, lit: (1 - Math.cos(2 * Math.PI * phase)) / 2, age: jd - a };
}

export function paintInkScene(g, W, H, seed, opt) {
  const o = opt || {};
  const rnd = seeded(seed == null ? (Math.random() * 1e9) | 0 : seed);
  const M = PALETTE[o.dark ? 'dark' : 'light'];
  const prevAlpha = g.globalAlpha;
  if (o.alpha != null) g.globalAlpha = prevAlpha * o.alpha;
  // 取景：默认「清远」，另有 雪意 / 夜雨 / 晚霞
  const scene = pickScene(rnd, o.dark);
  // 近景枝挂在哪一侧：一侧就够，两边都挂会显得像画框
  const fgSide = rnd() > 0.5 ? 1 : -1;
  if (scene.id === 'wanxia') sunsetBand(g, W, H, rnd);

  // 山体贯穿视口中部（不是压在底部），这样任何滚动位置都能透出一点画意；
  // 顶部 0~38% 留给天空与月，最下一道山落在 tabbar 上方。
  const land = paintLandscape(g, W, H, rnd, M, !!(o.dark), scene) || {};

  // 2. 月：深色主题固定挂一弯月（月牙 + 两层光晕）；浅色仍按场景随机，且只有光晕
  //    夜雨云厚无月，晚霞已有低日也不挂月
  // 月只挂在「清远」：夜雨、雪意、晚霞一律无月（雨雪与月互斥，不可同框）
  // 深色按真实月相（今晚窗外是什么就是什么）；浅色仍按场景随机，且只有光晕不画月体。
  let moonF = 0, moonPhase = 0;   // moonF：被照亮比例 0..1；moonPhase：0 新月 → 0.5 满月 → 1 又回到新月
  if (o.dark) {
    if (o.moonPhase != null) {                              // 调试/复现：由调用方传入
      moonPhase = ((o.moonPhase % 1) + 1) % 1;
      moonF = (1 - Math.cos(2 * Math.PI * moonPhase)) / 2;
    } else {
      const p = moonPhaseAt(Date.now());
      moonPhase = p.phase;
      moonF = p.lit;
    }
  }

  const wantMoon = scene.id === 'qingyuan' && (o.dark ? moonF >= 0.05 : rnd() > 0.35);
  if (wantMoon) {
    // 月挂近景枝的对面：同侧会被枝叶挡住，看着像树枝戳穿了月亮
    const mx = W * (fgSide < 0 ? 0.72 + rnd() * 0.16 : 0.12 + rnd() * 0.15);
    const my = H * (0.09 + rnd() * 0.09);
    const mr = Math.min(W, H) * (0.038 + rnd() * 0.02);
    const k = o.dark ? (0.45 + 0.55 * moonF) : 1;           // 新月夜几乎不发光，满月最亮

    // 外层光晕：大而极淡，负责"这一片天是亮的"
    const glowOut = g.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 3.8);
    glowOut.addColorStop(0, `rgba(255,250,236,${(0.055 * k).toFixed(3)})`);
    glowOut.addColorStop(1, 'rgba(255,250,236,0)');
    g.fillStyle = glowOut;
    g.beginPath(); g.arc(mx, my, mr * 3.8, 0, Math.PI * 2); g.fill();

    // 内层光晕：贴着月体的一圈，让它有"发光"的实感
    const glowIn = g.createRadialGradient(mx, my, mr * 0.45, mx, my, mr * 2.0);
    glowIn.addColorStop(0, `rgba(255,250,236,${(0.13 * k).toFixed(3)})`);
    glowIn.addColorStop(1, 'rgba(255,250,236,0)');
    g.fillStyle = glowIn;
    g.beginPath(); g.arc(mx, my, mr * 2.0, 0, Math.PI * 2); g.fill();

    // 月体：按真实月相画轮廓——亮缘是半个圆，明暗界线是一段半椭圆（短半轴 = r·|2k−1|）。
    // 这套画法下「照亮面积 = πr²k」是几何精确的，弦月、凸月、满月都是同一个公式的取值；
    // 旧写法用「大圆减小圆」，比例与面积不成正比，89% 的亏凸月看起来就是一张满月脸。
    if (o.dark) {
      const lit = Math.max(0, Math.min(1, moonF));   // 照亮比例（外层那个 k 是光晕强度，别混）
      const rr = mr * Math.abs(2 * lit - 1);     // 明暗界线横向半轴：0 弦月 → r 满月
      const waxing = moonPhase <= 0.5;           // 上半月盈：亮面朝右
      const pad = Math.ceil(mr * 1.6);
      const off = document.createElement('canvas');
      off.width = off.height = pad * 2;
      const og = off.getContext('2d');
      og.fillStyle = `rgba(255,251,240,${(0.34 + 0.16 * lit).toFixed(3)})`;
      // ① 亮缘那半个圆（先画右半，亏月最后整体镜像）
      og.beginPath();
      og.arc(pad, pad, mr, -Math.PI / 2, Math.PI / 2);
      og.closePath();
      og.fill();
      // ② 明暗界线。凸月（照亮过半）时界线在左半边，亮区要往**左**鼓出去；
      //    蛾眉月时界线在右半边，要把右半圆**啃**掉一块。方向搞反就会画成半轮月。
      og.beginPath();
      if (lit >= 0.5) og.ellipse(pad, pad, rr, mr, 0, Math.PI / 2, Math.PI * 1.5);
      else og.ellipse(pad, pad, rr, mr, 0, -Math.PI / 2, Math.PI / 2);
      if (lit >= 0.5) {
        og.fill();
      } else {
        og.globalCompositeOperation = 'destination-out';   // 不透明才削得动
        og.fillStyle = '#000';
        og.fill();
      }
      g.save();
      g.translate(mx, my);
      g.rotate(-0.12);            // 明暗界线略歪，别画得太几何
      if (!waxing) g.scale(-1, 1); // 亏月：整枚镜像，亮面落到左边
      g.drawImage(off, -pad, -pad);
      g.restore();
    }
  }

  // 3. 水岸：山脚没入水中，水面在下三分之一
  const waterTop = land.waterY || Math.min(H * 0.86, (land.y1 || H * 0.5) + H * 0.32);
  water(g, W, H, waterTop, H * 1.02, M.water, rnd);
  shore(g, W, H, waterTop, M.shore, rnd);
  const bleak = scene.id === 'xueyi' || scene.id === 'yeyu';   // 雪/雨：岸边不放花草，只留石与舟
  if (rnd() > 0.4) stones(g, W, H, waterTop + 2, M.stone, rnd);
  if (!bleak && rnd() > 0.28) flora(g, W, H, waterTop - 2, M.floraStem, M.floraPetal, rnd);
  if (rnd() > (bleak ? 0.72 : 0.42)) reeds(g, W, H, waterTop + 2, M.plant, rnd);
  // 一叶小舟或一只水鸟（互斥，避免水面太挤）
  if (rnd() > 0.62) boat(g, W, H, waterTop + H * 0.035, M.boat, rnd);
  else if (rnd() > 0.55) waterfowl(g, W, H, waterTop + H * 0.022, M.heron, rnd);
  if (rnd() > 0.5) {
    const leftSide = rnd() > 0.5;
    bambooClump(g, W, H,
      leftSide ? W * (0.08 + rnd() * 0.1) : W * (0.78 + rnd() * 0.1),
      waterTop - 2, H * (0.12 + rnd() * 0.08), M.clump, rnd);
  }

  // 4. 边缘竹枝（远景那一层，淡到几乎看不见）：放在近景枝的对侧，免得同侧叠成双影
  if (rnd() > 0.4) bamboo(g, W, H, rnd, M.plant, fgSide < 0, waterTop + 2);

  // 5. 飞鸟（晚霞归鸟，成阵；夜雨不飞）
  if (scene.id === 'wanxia') { if (rnd() > 0.25) birds(g, W, H, rnd, M.bird); if (rnd() > 0.5) birds(g, W, H, rnd, M.bird); }
  else if (scene.id !== 'yeyu' && rnd() > 0.4) birds(g, W, H, rnd, M.bird);

  // 5b. 各景专属：雨丝 / 雪点
  if (scene.id === 'yeyu') rainVeil(g, W, H, rnd, M.rain);
  else if (scene.id === 'xueyi') snowDots(g, W, H, rnd, M.snow);

  // 5c. 近景枝：竹 / 梅 / 松，贴边斜出。放在雨雪之后，才在它们「前面」
  foregroundBranch(g, W, H, rnd, M, fgSide);

  // 6. 纸纹颗粒：按设备内存/核心数由 1500 下调到 300，低端再减半（第十一轮性能）
  grain(g, W, H, rnd, M.grain, grainBudget());
  g.globalAlpha = prevAlpha;
}

function grainBudget() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const mem = nav.deviceMemory || 4;        // Chrome 提供（GB），其余浏览器为 undefined
  const cores = nav.hardwareConcurrency || 4;
  return (mem <= 2 || cores <= 2) ? 150 : 300;
}

function paint(seed) {
  const W = Math.max(320, window.innerWidth);
  const H = Math.max(400, window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!canvas) {
    canvas = document.getElementById(CV_ID);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = CV_ID;
      canvas.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(canvas, document.body.firstChild);
    }
  }
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  paintW = W; paintH = H;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  // 调试：?moon=0.5 强制满月、?moon=0.25 上弦。月相由调用方传入而不是 paintInkScene 自己
  // 读 location——它被卡片 moYun 共用，别让 URL 调试参数漏进另一条产品链路。
  const qm = new URLSearchParams(location.search).get('moon');
  paintInkScene(g, W, H, seed, { dark, moonPhase: qm != null && qm !== '' ? +qm : undefined });
}

// 无障碍：系统开了「减少动态效果 / 减少透明度」就整幅不画，露出纸底色。
// 画是静态的，但大面积半透明底纹正是 reduced-transparency 要消掉的东西。
function reduceInk() {
  if (!window.matchMedia) return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches
    || matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

export function repaintInk(forceSeed) {
  // 水墨屏模式停画：画布颜料是暖色的（霞光/花瓣/金月），进了灰阶世界就是杂色；
  // 纯白/纯黑的纸更贴电子墨水屏，也省一次整幅重绘。data-ink 变化由下面的
  // MutationObserver 捕捉，进出水墨屏模式画布会自动隐/显。
  const inkMode = document.documentElement.getAttribute('data-ink') === '1';
  const on = pref('bg') !== '0' && !reduceInk() && !inkMode;
  if (!canvas && !on) return;
  if (!on) {
    if (canvas) canvas.classList.add('hidden');
    return;
  }
  if (canvas) canvas.classList.remove('hidden');
  lastSeed = forceSeed != null ? forceSeed : (Math.random() * 1e9) | 0;
  paint(lastSeed);
}

// 初始化：首次绘制 + 监听尺寸变化与主题切换
export function initInkBackground() {
  // 调试：?inkseed=0 固定一幅构图（默认每次随机）。深色下 seed 0/6-10 落在「清远」，会挂月。
  const q = new URLSearchParams(location.search).get('inkseed');
  repaintInk(q != null && q !== '' ? +q : undefined);
  onResize = () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      // 小幅变化（地址栏伸缩、软键盘）什么都不做：#ink-bg 是 width/height 100%，
      // 浏览器自动拉伸既有位图，远景轻微形变无感。旋转（长宽比翻转）或大幅
      // 变化才按新尺寸重画，桌面拖窗不再连绘。
      const W = Math.max(320, window.innerWidth), H = Math.max(400, window.innerHeight);
      const flipped = (W / H > 1) !== (paintW / paintH > 1);
      if (!paintW || flipped || Math.abs(W - paintW) > 160 || Math.abs(H - paintH) > 200) repaintInk(lastSeed);
    }, 260);
  };
  window.addEventListener('resize', onResize, { passive: true });
  // 主题切换（applyTheme 改的是 html[data-theme]）
  if (window.MutationObserver && !observer) {
    observer = new MutationObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => repaintInk(lastSeed), 60);
    });
    // attributeFilter 去掉 class：只关心主题/水墨屏属性，class 变动不再触发重绘
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-ink'] });
  }
  // 系统主题变化（跟随系统时）：记录绑定，供 disposeInkBackground 解绑
  if (window.matchMedia) {
    const bind = (query) => {
      const mq = matchMedia(query);
      const handler = () => repaintInk(lastSeed);
      if (mq.addEventListener) { mq.addEventListener('change', handler); mediaBindings.push({ mq, handler }); }
      else if (mq.addListener) { mq.addListener(handler); mediaBindings.push({ mq, handler, legacy: true }); }
    };
    bind('(prefers-color-scheme: dark)');
    // 无障碍偏好变化：开启→隐藏画布，关闭→补画
    bind('(prefers-reduced-motion: reduce)');
    bind('(prefers-reduced-transparency: reduce)');
  }
}

// 释放背景监听：移除 resize/matchMedia 监听并断开 observer（第十一轮性能）
export function disposeInkBackground() {
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  clearTimeout(resizeDebounce);
  clearTimeout(resizeTimer);
  for (const b of mediaBindings) {
    if (b.legacy) { if (b.mq.removeListener) b.mq.removeListener(b.handler); }
    else if (b.mq.removeEventListener) b.mq.removeEventListener('change', b.handler);
  }
  mediaBindings.length = 0;
  if (observer) { observer.disconnect(); observer = null; }
}

// 设置页开关用
export function setInkEnabled(on) {
  if (on) repaintInk();
  else if (canvas) canvas.classList.add('hidden');
}
