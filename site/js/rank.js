// 搜索打分规则（纯函数，供 views/search.js 与 tests/rules.test.mjs 共用）
// 分成三档：完全相等 > 前缀命中 > 包含命中；作者权重略低，避免"李白"这类短名压过标题。
export const TITLE_W = [6, 5, 4];
export const AUTHOR_W = [5.5, 3, 2];

// 精选集加成：搜「春江」时《春江花月夜》（前缀命中）应当压过一串同名的冷门《春江》。
// 1.2 分够翻过 exact/startsWith 的 1 分差，又不足以让 includes(4) 反超 exact(6)。
export const BONUS_COLLS = new Set(['tang300', 'songci300', 'qjs', 'shijing', 'chuci', 'guwen', 'lunyu', 'ssxx', 'mengxue', 'keben', 'jsshi', 'jssci', 'jsswen', 'ershisishi', 'zitongjian', 'jingbu']);
export const BONUS_SCORE = 1.2;

// vars 是查询词的繁简/大小写变体；tl 是被比较的标题（已 toLowerCase）
export function bestMatch(tl, vars, w) {
  let best = 0;
  for (const v of vars) {
    let s = 0;
    if (tl === v) s = w[0];
    else if (tl.startsWith(v)) s = w[1];
    else if (tl.includes(v)) s = w[2];
    if (s > best) best = s;
  }
  return best;
}

export function withBonus(score, collId) {
  return BONUS_COLLS.has(collId) ? score + BONUS_SCORE : score;
}
