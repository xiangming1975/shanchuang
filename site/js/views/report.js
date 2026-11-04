// 页面：勘误（#/j/<作品id>）
// 读者反馈统一走问卷「一字师 · 勘误帖」。静态站没有写入能力，这页只做两件事：
// ① 把作品信息写进剪贴板、送到问卷（读者在第 1 题粘贴即可）；
// ② 留一条旁路：复制一段文字直接发我，给不想填表的人。
import { app, COLLECT_URL } from '../vcommon.js';
import { getPoem } from '../store.js';
import { esc } from '../py.js';

// 定位串：唐人 · 李白《将进酒》（#/p/1）—— 问卷第 1 题粘这一行就够我找到它
function locateOf(poem) {
  if (!poem) return '';
  const who = [poem.d, poem.a].filter(Boolean).join(' · ');
  return `${who ? who + ' ' : ''}《${poem.t}》（#/p/${poem.i}）`;
}

async function reportView(seg) {
  const id = parseInt(seg[0]);
  let poem = null;
  if (!isNaN(id)) { try { poem = await getPoem(id); } catch {} }

  const locate = locateOf(poem);
  const tmpl = `${locate ? '【勘误】' + locate : '【勘误】'}
位置：第　　句（标题 / 作者 / 译文 / 注释 / 赏析）
原文：
应有的样子：
依据：`;

  app.innerHTML = `<div class="page-pad"></div>
    <div class="card">
      <h2>一字师 · 勘误帖</h2>
      <div class="section-tip" style="margin:6px 0 12px">
        一字师典出唐人郑谷为齐己改《早梅》——「前村深雪里，昨夜数枝开」，郑谷说「数枝」不如「一枝」，齐己下拜。
        你订正一个字，便是我的老师。
      </div>
      ${locate ? `<div class="rd-stat" style="margin:0 0 12px;opacity:1">${esc(locate)}</div>` : ''}
      <div class="tagrow">
        <button class="set-toggle" id="go-survey">复制作品信息</button>
        <a class="set-toggle" href="${COLLECT_URL}" target="_blank" rel="noopener">打开勘误帖</a>
      </div>
      <div class="section-tip" id="go-tip" style="margin-top:10px">
        ${locate ? '先点「复制作品信息」，再点「打开勘误帖」，问卷第 1 题长按粘贴即可，不必手打。' : '两道题：点一个类型，贴一段话，一分钟能填完。'}
      </div>
    </div>
    <details class="card">
      <summary style="cursor:pointer;font-family:var(--kai);font-size:1.02rem;letter-spacing:.06em;color:var(--ink)">不想填表？复制一段文字发我</summary>
      <div style="margin-top:10px">
        <textarea class="fn-ta" id="report-text" style="height:170px;font-size:0.82rem;line-height:1.75">${esc(tmpl)}</textarea>
        <div class="tagrow" style="margin-top:10px">
          <button class="set-toggle" id="copy-report">复制这段文字</button>
          ${(typeof navigator !== 'undefined' && navigator.share) ? '<button class="set-toggle" id="share-report">分享</button>' : ''}
        </div>
        <div class="section-tip" id="copy-tip" style="margin-top:8px">
          保留编号、位置、原文、应有的样子四行就够。
        </div>
      </div>
    </details>`;

  // 主路径：复制定位串 → 打开问卷
  const go = document.getElementById('go-survey');
  go.onclick = async () => {
    const tip = document.getElementById('go-tip');
    if (!locate) return;
    try {
      await navigator.clipboard.writeText(locate);
      tip.textContent = '已复制。再点「打开勘误帖」，第 1 题长按粘贴即可。';
    } catch {
      tip.textContent = '这个浏览器不让写剪贴板，第 1 题请手填：' + locate;
    }
  };

  // 旁路：复制 / 分享整段文字
  const ta = document.getElementById('report-text');
  const tip = () => document.getElementById('copy-tip');
  document.getElementById('copy-report').onclick = async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
      tip().textContent = '已复制。发给我就行。';
    } catch {
      ta.select();
      document.execCommand && document.execCommand('copy');
      tip().textContent = '已选中，长按复制即可。';
    }
  };
  // 手机上直接走系统分享（微信 / 邮件 / 备忘录都行），桌面浏览器一般没有 navigator.share
  const sh = document.getElementById('share-report');
  if (sh) sh.onclick = async () => {
    try {
      await navigator.share({ title: '勘误', text: ta.value });
    } catch (e) {
      if (e && e.name === 'AbortError') return;      // 用户取消，不算失败
      tip().textContent = '这个浏览器不支持分享，请用「复制这段文字」。';
    }
  };
}

export { reportView };
