// 近体诗格律推定（五绝/七绝/五律/七律）
// 用途：源数据缺平仄时，按格律模板生成逐字平仄。
// 原则：
//   1) 能确定体裁才推（句数 4/8、每句 5/7 字、句式整齐），古体/乐府/杂言一律不碰；
//   2) 逐字优先用「字→平仄」表的实然读音，多音字与生僻字才由模板定；
//   3) 模板匹配置信度不够就返回 null，宁可没有，也不给错的。

// 五言四个基本句式（每式 4 句，律诗循环两次）
const W5 = {
  zeNoRhyme: ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],  // 仄起不入韵
  zeRhyme: ['仄仄仄平平', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],    // 仄起入韵
  pingNoRhyme: ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'], // 平起不入韵
  pingRhyme: ['平平仄仄平', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],   // 平起入韵
};

// 七言四式：不能简单在五言前加两字——那样起式会反转，key 与「平起/仄起」的语义就对不上了。
const W7 = {
  zeNoRhyme: ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平'],
  zeRhyme: ['仄仄平平仄仄平', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平'],
  pingNoRhyme: ['平平仄仄平平仄', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平'],
  pingRhyme: ['平平仄仄仄平平', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平'],
};

const FORMS = {
  zeNoRhyme: '仄起首句不入韵',
  zeRhyme: '仄起首句入韵',
  pingNoRhyme: '平起首句不入韵',
  pingRhyme: '平起首句入韵',
};

const SPLIT = /[，。！？；：、,.!?;:]/;

// 把 poem.p 拆成句：返回 [{ text, lineIdx }]
function splitLines(p) {
  const out = [];
  for (let k = 0; k < p.length; k++) {
    const raw = String(p[k] || '');
    let buf = '';
    for (const ch of raw) {
      if (SPLIT.test(ch)) {
        if (buf) { out.push({ text: buf, lineIdx: k }); buf = ''; }
      } else buf += ch;
    }
    if (buf) out.push({ text: buf, lineIdx: k });
  }
  return out;
}

// 取某字的主音平仄；未知返回 ''
function toneOf(table, ch) {
  const v = table && table.m && table.m[ch];
  return v === '平' || v === '仄' ? v : '';
}
// 多音字：有格律/词模板时由模板定音，没有时退回主音
function isDuo(table, ch) {
  if (!table || !table.d || !table.d.length) return false;
  if (!table._ds) table._ds = new Set(table.d);
  return table._ds.has(ch);
}

/**
 * 判定体裁并匹配格律
 * @returns null | { len, kind, form, formName, template：string[] }
 */
export function detectRegulated(poem, table) {
  if (!poem || !Array.isArray(poem.p) || !poem.p.length) return null;
  const lines = splitLines(poem.p);
  if (!lines.length) return null;

  const counts = new Set(lines.map(l => l.text.length));
  if (counts.size !== 1) return null;              // 杂言
  const len = [...counts][0];
  if (len !== 5 && len !== 7) return null;
  const n = lines.length;
  if (n !== 4 && n !== 8) return null;             // 只认绝句与律诗

  for (const l of lines) if (!/^[\u3400-\u9fff]+$/.test(l.text)) return null;

  const cand = len === 5 ? W5 : W7;
  const scoreOf = (base) => {
    const tpl = n === 8 ? [...base, ...base] : base;
    let hit = 0, cmp = 0;
    for (let i = 0; i < n; i++) {
      const text = lines[i].text, pat = tpl[i];
      for (let pos = 0; pos < len; pos++) {
        const isEven = (pos + 1) % 2 === 0;              // 二四六
        const isFirstLast = i === 0 && pos === len - 1;   // 首句末字定入韵
        if (!isEven && !isFirstLast) continue;            // 一三五不论
        const t = toneOf(table, text[pos]);
        if (!t) continue;
        const p = pat[pos];
        if (p !== '平' && p !== '仄') continue;
        cmp++;
        if (t === p) hit++;
      }
    }
    return { rate: cmp ? hit / cmp : 0, cmp };
  };

  // 先用首句第 2 字定起式、首句末字定入韵——这两点是格律的定义，比整体打分可靠；
  // 任一点拿不到（多音/生僻）才退回四选一打分。七言律诗只差首句一两个字，
  // 全靠打分时"次优差"会把真正的七律筛掉（曾导致七律 0 篇）。
  const first = lines[0].text;
  const qi = toneOf(table, first[1]) || toneOf(table, first[3]);
  const lastTone = toneOf(table, first[len - 1]);
  const rhyme = lastTone ? (lastTone === '平' ? 'Rhyme' : 'NoRhyme') : '';

  let key = '';
  if (qi && rhyme) {
    key = (qi === '平' ? 'ping' : 'ze') + rhyme;
  }
  let best = null;
  if (key && cand[key]) {
    const sc = scoreOf(cand[key]);
    if (sc.cmp >= n * 1.2 && sc.rate >= 0.8) best = { key, base: cand[key] };
  }
  if (!best) {
    // 兜底：四选一打分，要求样本够、命中率 ≥85%、且明显高于次优
    let top = null, second = -1;
    for (const [k, base] of Object.entries(cand)) {
      const sc = scoreOf(base);
      if (!top || sc.rate > top.rate) { second = top ? top.rate : -1; top = { key: k, base, ...sc }; }
      else if (sc.rate > second) second = sc.rate;
    }
    if (top && top.cmp >= n * 1.2 && top.rate >= 0.85 && top.rate - second >= 0.05) best = top;
  }
  if (!best) return null;

  const tpl = n === 8 ? [...best.base, ...best.base] : best.base;
  const head = tpl[0];
  return {
    len, kind: n === 8 ? '律诗' : '绝句',
    form: best.key,
    formName: `${len === 5 ? '五' : '七'}言${n === 8 ? '律诗' : '绝句'} · ${head[1] === '平' ? '平起' : '仄起'}${head[head.length - 1] === '平' ? '首句入韵' : '首句不入韵'}`,
    template: tpl,
  };
}

/**
 * 按模板生成逐字平仄串（与 poem.p 每行等长，标点原样保留）
 * @returns string[]
 */
export function buildPingze(poem, table, reg) {
  const tpl = reg.template;
  const out = [];
  let seg = 0, pos = 0;
  for (const raw of poem.p) {
    const text = String(raw || '');
    let buf = '';
    for (const ch of text) {
      if (SPLIT.test(ch)) { buf += ch; seg++; pos = 0; continue; }   // 断句：换下一句模板，字位归零
      const pat = tpl[seg] || '';
      const t = toneOf(table, ch);
      const at = pat[pos];
      if (t) buf += t;                       // 字表有确定读音 → 用实然
      else if (at === '平' || at === '仄') buf += at;  // 多音/生僻 → 由格律定
      else buf += '　';
      pos++;
    }
    out.push(buf);
  }
  return out;
}

// ---------------- 词：用「同调作品反推」的模板 ----------------
// 词的字数由词牌固定，所以「词牌 + 总字数」相同即可逐字对齐，
// 不必依赖外部词谱（现成词谱只覆盖 3% 的无平仄词作，且多为正体）。

const bodyChars = (p) => {
  const out = [];
  for (const line of p) for (const ch of String(line || '')) if (!SPLIT.test(ch)) out.push(ch);
  return out;
};

export function detectCi(poem, tplMap, table) {
  if (!poem || !Array.isArray(poem.p) || !poem.p.length || !tplMap) return null;
  // 题名常写成「别名・正名」（金缕衣・贺新郎、定风波令・定风波），逐段试，命中即用
  const segs = String(poem.t || '').split(/[・·]/).map(x => x.trim()).filter(Boolean);
  if (!segs.length) return null;
  const chars = bodyChars(poem.p);
  if (chars.length < 8) return null;
  let name = '', hit = null;
  for (const s of segs) {
    const h = tplMap[s + '|' + chars.length];
    if (h) { name = s; hit = h; break; }
  }
  if (!hit) return null;
  const [pat, sample] = hit;
  const fixed = [...pat].filter(c => c !== '中').length;
  const ratio = fixed / pat.length;
  if (ratio < 0.35) return null;          // 固定位太少，标了也是猜
  return { pat, sample, name, ratio };
}

export function buildCiPingze(poem, table, ci) {
  const out = [];
  let i = 0;
  for (const raw of poem.p) {
    const text = String(raw || '');
    let buf = '';
    for (const ch of text) {
      if (SPLIT.test(ch)) { buf += ch; continue; }
      const at = ci.pat[i] || '中';
      const t = toneOf(table, ch);
      if (t && !isDuo(table, ch)) buf += t;             // 单音字：用实然
      else if (at === '平' || at === '仄') buf += at;    // 多音/生僻：由模板定
      else buf += t || '中';                                  // 可平可仄：占位保对齐，不显示
      i++;
    }
    out.push(buf);
  }
  return out;
}

// ---------------- 古体/未合律：只标字音 ----------------
// 古体诗没有固定格律，但每个字本身的平仄是确定的，照样可以给读者看；
// 多音字只能取常用读音，说明小字里要交代。
export function buildToneOnly(poem, table) {
  const out = [];
  for (const raw of poem.p) {
    const text = String(raw || '');
    let buf = '';
    for (const ch of text) {
      if (SPLIT.test(ch)) { buf += ch; continue; }
      buf += toneOf(table, ch) || '中';
    }
    out.push(buf);
  }
  return out;
}

// 古体粗分类：句长整齐的五言/七言各成一类，长短不齐归「古体」
export function guessGuTi(poem) {
  const lens = new Set();
  for (const line of (poem.p || [])) {
    for (const seg of String(line).split(SPLIT)) {
      const n = [...seg].filter(ch => /[\u3400-\u9fff]/.test(ch)).length;
      if (n) lens.add(n);
    }
  }
  if (lens.size === 1 && lens.has(5)) return '五古';
  if (lens.size === 1 && lens.has(7)) return '七古';
  return '古体';
}
