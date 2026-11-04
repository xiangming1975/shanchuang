// 眉批的锚点逻辑（纯函数，node 里可测）
//
// 为什么不能只用行号：显示行数是「渲染出来的结果」，不是作品的属性。
//   切拼音/平仄 → 行不变；换字号或词的行宽自适应（ciSegments）→ 行会重排；
//   背诵模式、译文对照也会改行数。只存 li 的批注，一开平仄就可能挂到别人头上。
// 所以一条批注同时存两样：
//   t  —— 该行的净文（去空白与标点），真正的锚
//   li —— 当时的行号，只作同文重复行的就近提示

import { simpStr } from './fn.js';

// 净文：去掉所有空白与标点符号。
// 2026-10-29 起正文可切简繁显示，批注的净文快照是「创建那一刻的显示字」：
// 之后切换简繁，快照与正文跨繁简。所以 placeNotes 匹配时两侧都再过一遍
// 繁→简归一（逐字等长），跨模式也能对上；t2s 表未加载时退化为同文匹配。
export function normLine(s) {
  return String(s || '').replace(/[\s\u3000]/g, '').replace(/[\p{P}\p{S}]/gu, '');
}

// 在候选行里挑离 li 最近的那个；li 无效就取第一个
function nearest(cands, li) {
  if (!Number.isFinite(li)) return cands[0];
  let best = cands[0];
  for (const x of cands) if (Math.abs(x - li) < Math.abs(best - li)) best = x;
  return best;
}

// lines: [{t}]（就是 detail.js 里的 readLines）
// notes: [{id, li, t, s, ts}]
// 返回 { placed: [{li, note}], orphans: [note] }
//   placed  —— 能挂到当前某一行的
//   orphans —— 找不到对应行的（字号/断句变化把行拆散且不构成包含关系），界面单独列出来，不静默丢
export function placeNotes(lines, notes) {
  const placed = [], orphans = [];
  if (!Array.isArray(lines) || !lines.length || !Array.isArray(notes) || !notes.length) {
    return { placed, orphans };
  }
  const nrm = lines.map(r => simpStr(normLine(r && r.t)));

  // 净文 → 行号列表（同文重复行很少，但长诗里确有「悠悠苍天」这类叠句）
  const exact = new Map();
  for (let i = 0; i < nrm.length; i++) {
    const k = nrm[i];
    if (!k) continue;
    const arr = exact.get(k);
    if (arr) arr.push(i); else exact.set(k, [i]);
  }

  for (const n of notes) {
    if (!n || !n.id) continue;
    const key = simpStr(normLine(n.t));
    let li = -1;
    if (key) {
      const hit = exact.get(key);
      if (hit && hit.length) {
        li = nearest(hit, n.li);
      } else {
        // 退化：包含关系。词换字号会重新断句，批注记的整行可能被切成两行，
        // 或两行并作一行——重叠最多的那一行就是它原来的位置。
        let bestLi = -1, bestScore = 0;
        for (let i = 0; i < nrm.length; i++) {
          const l = nrm[i];
          if (!l) continue;
          let score = 0;
          if (l.includes(key)) score = key.length;
          else if (key.includes(l)) score = l.length;
          if (score > bestScore) { bestScore = score; bestLi = i; }
        }
        if (bestLi >= 0) li = bestLi;
      }
    }
    if (li >= 0) placed.push({ li, note: n });
    else orphans.push(n);
  }
  placed.sort((a, b) => a.li - b.li);
  return { placed, orphans };
}

// ---------- 导出 Markdown ----------
// groups: [{ pid, notes: [{ t, s, li, ts }] }]，metaOf(pid) → { t: 篇名, m: '朝代 · 作者' }
// 版式：一篇一节，原句做引用块，批语另起一段 —— 直接丢进 Obsidian / 备忘录就能读。
// 批语是用户自己写的，可能以 # / > / - 开头；行首这些字符必须转义，否则会被当成标题、引用或列表。
// 末尾的空格要用前瞻断言，不能进捕获组——否则「# 标题」会被替换成「\#标题」，空格被吃掉。
function escMdLine(line) {
  return String(line).replace(/^(\s*)([#>*+\-=]|\d+[.)])(?=\s|$)/, '$1\\$2');
}

export function notesToMarkdown(groups, metaOf, exportedAt) {
  const list = (groups || []).filter(g => g && g.notes && g.notes.length);
  if (!list.length) return '';
  const total = list.reduce((s, g) => s + g.notes.length, 0);
  const d = exportedAt instanceof Date ? exportedAt : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const when = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  const out = [];
  out.push('# 山窗 · 眉批', '');
  out.push(`共 ${total} 条 · 分布在 ${list.length} 篇`);
  out.push(`导出时间：${when}`, '', '---', '');
  for (const g of list) {
    const meta = (metaOf && metaOf(g.pid)) || {};
    out.push('## ' + (meta.t || ('作品 ' + g.pid)), '');
    if (meta.m) out.push(meta.m, '');
    for (const n of g.notes) {
      const q = String(n.t || '').trim();
      if (q) out.push('> ' + q, '');
      String(n.s || '').split('\n').forEach(line => {
        const t = line.trim();
        if (t) out.push(escMdLine(t));
      });
      out.push('');
    }
    out.push('---', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
