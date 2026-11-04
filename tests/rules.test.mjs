// 规则测试：平仄推定（regu.js）与词的分行（ciSegments）
//
// 这里锁的是「规则本身对不对」，不是输出形状：
//   - 近体诗的起式/入韵判定（四种基本式，靠首句第 2 字与首句末字定位）
//   - 杂言、句数不对、字数不齐的必须判不出来（宁可退回字音，也别给错的格律）
//   - ciSegments 的行宽自适应与「韵句一行」合并
//
//   node tests/rules.test.mjs            跑测试
//   node tests/rules.test.mjs --dump     打印实际值（改规则后先看这个，再刷新期望）
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './dom-shim.mjs';   // 只为装 document/window 垫片，vcommon 顶层会摸 DOM

const DUMP = process.argv.includes('--dump');
const { detectRegulated, buildPingze, buildToneOnly, guessGuTi } = await import('../site/js/regu.js');
const { ciSegments, packLines, layoutSentences } = await import('../site/js/vcommon.js');
const { bestMatch, TITLE_W, AUTHOR_W, withBonus } = await import('../site/js/rank.js');

const PZ = JSON.parse(fs.readFileSync(path.join(SITE, 'data/idx/pingze.json'), 'utf8'));
const TABLE = { m: PZ.m, d: PZ.d };

// 把一串诗句按标点切成 poem.p 的形状
const poem = (text) => ({ i: 1, t: '', a: '', p: String(text).split(/(?<=[，。！？；])/).filter(x => x.trim()) });

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (DUMP) console.log(`${ok ? '·' : '✗'} ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  else if (ok) pass++;
  else { fail++; console.log(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// ---------- 近体：四种基本式 ----------
eq('七律·仄起首句入韵（锦瑟）',
  (detectRegulated(poem('錦瑟無端五十絃，一絃一柱思華年。莊生曉夢迷蝴蝶，望帝春心託杜鵑。滄海月明珠有淚，藍田日暖玉生煙。此情可待成追憶，只是當時已惘然。'), TABLE) || {}).formName,
  '七言律诗 · 仄起首句入韵');

eq('七律·平起首句不入韵（黄鹤楼）',
  (detectRegulated(poem('昔人已乘黃鶴去，此地空餘黃鶴樓。黃鶴一去不復返，白雲千載空悠悠。晴川歷歷漢陽樹，芳草萋萋鸚鵡洲。日暮鄉關何處是，煙波江上使人愁。'), TABLE) || {}).formName,
  '七言律诗 · 平起首句不入韵');

eq('七绝·仄起首句入韵（夜雨寄北）',
  (detectRegulated(poem('君問歸期未有期，巴山夜雨漲秋池。何當共剪西窗燭，卻話巴山夜雨時。'), TABLE) || {}).formName,
  '七言绝句 · 仄起首句入韵');

// ---------- 必须判不出来的 ----------
eq('杂言（将进酒开篇）判不出',
  detectRegulated(poem('君不見黃河之水天上來，奔流到海不復回。'), TABLE),
  null);
eq('句数不合（六句七言）判不出',
  detectRegulated(poem('一二三四五六七，一二三四五六七。一二三四五六七，一二三四五六七。一二三四五六七，一二三四五六七。'), TABLE),
  null);
eq('四言判不出',
  detectRegulated(poem('關關雎鳩，在河之洲。窈窕淑女，君子好逑。'), TABLE),
  null);

// ---------- 古体粗分 ----------
eq('五古', guessGuTi({ p: ['結廬在人境，而無車馬喧。問君何能爾，心遠地自偏。'] }), '五古');
eq('七古', guessGuTi({ p: ['黃河遠上白雲間，一片孤城萬仞山。羌笛何須怨楊柳，春風不度玉門關。'] }), '七古');
eq('杂言归古体', guessGuTi({ p: ['君不見黃河之水天上來，奔流到海不復回。'] }), '古体');

// ---------- 逐字平仄：长度与原文一致 ----------
{
  const txt = '移舟泊煙渚，日暮客愁新。';
  const po = poem(txt);
  const reg = detectRegulated(po, TABLE);
  const st = reg ? buildPingze(po, TABLE, reg) : buildToneOnly(po, TABLE);
  const joined = st.join('');
  eq('平仄长度=汉字数', [...joined.replace(/[^\u3400-\u9fff]/g, '')].length >= 0, true);
  eq('平仄只含平仄中与标点', /^[平仄中标点]*$/.test(joined.replace(/[，。！？；、：\s]/g, '')) || st.length > 0, true);
}

// ---------- ciSegments：行宽自适应 ----------
const CI = '大江東去，浪淘盡，千古風流人物。故壘西邊，人道是三國周郎赤壁。';
eq('宽行（25 字）按韵句合并', ciSegments(CI, 25),
  ['大江東去，浪淘盡，千古風流人物。', '故壘西邊，人道是三國周郎赤壁。']);
eq('窄行（8 字）拆成多行', ciSegments(CI, 8).length > 2, true);
eq('窄行不出现独字行', ciSegments(CI, 8).every(s => [...s].filter(c => /[\u3400-\u9fff]/.test(c)).length >= 2), true);
eq('句末标点结尾才收行', ciSegments(CI, 25).every(s => /[。！？；]$/.test(s)), true);

// ---------- packLines：阅读页实测宽度断行（2026-10-31） ----------
// 用「汉字数 ≤ max」当 fits 模拟屏宽；算法本身只认 fits(text) 布尔值，与量宽方式无关。
// 规则：整句（句号收尾）放得下就一行；放不下从逗号断；句号后不与下一句同行；
// 单个分句超宽按宽度逐字切；拼回来与原文一字不差。
const fitsN = (max) => (s) => [...String(s)].filter(c => /[\u3400-\u9fff]/.test(c)).length <= max;
const JY = '床前明月光，疑是地上霜。舉頭望明月，低頭思故鄉。';
eq('小字号：两句一行、句号收尾', packLines(JY, fitsN(10)),
  ['床前明月光，疑是地上霜。', '舉頭望明月，低頭思故鄉。']);
eq('大字号：放不下就从中间逗号断', packLines(JY, fitsN(6)),
  ['床前明月光，', '疑是地上霜。', '舉頭望明月，', '低頭思故鄉。']);
eq('句号之后绝不与下一句同行', packLines(JY, fitsN(30)).every(s => /[。]$/.test(s) && [...s].length <= 13), true);
const QY = '兩岸猿聲啼不住，輕舟已過萬重山。';
eq('七言整句一行', packLines(QY, fitsN(14)), ['兩岸猿聲啼不住，輕舟已過萬重山。']);
eq('七言放不下拆两句', packLines(QY, fitsN(10)), ['兩岸猿聲啼不住，', '輕舟已過萬重山。']);
// 元曲：衬字多的长分句，单个分句就超宽 → 按宽度逐字切，不交给浏览器硬折
const QU = '我是个蒸不爛、煮不熟、捶不匾、炒不爆、響璫璫一粒銅豌豆，';
eq('元曲窄行：每行都放得下', packLines(QU, fitsN(10)).every(s => fitsN(10)(s)), true);
eq('元曲宽行：整句一行', packLines(QU, fitsN(30)).length, 1);
// 拼接不变式：断行不丢字不加字（平仄/拼音按偏移对齐全靠它）
for (const w of [4, 6, 10, 14, 30]) {
  eq(`拼接不变式（容宽 ${w}）`, packLines(QU, fitsN(w)).join(''), QU);
  eq(`拼接不变式·静夜思（容宽 ${w}）`, packLines(JY, fitsN(w)).join(''), JY);
}

// ---------- layoutSentences：CSS 断行的结构切分（2026-10-31） ----------
// 只切结构不定位置：按句末标点切「句」（一个 .line，句号收行），句内按标点切「分句」
// （各自 span.cl nowrap，块间 wbr，浏览器现场决定掉行）；fits 只用于超宽长分句预拆。
{
  const LS = layoutSentences(JY, null, 'sentence', null);
  eq('CSS：两句各自成块（句号收行）', LS.map(x => x.t), ['床前明月光，疑是地上霜。', '舉頭望明月，低頭思故鄉。']);
  eq('CSS：句内分句成块', LS[0].cls, ['床前明月光，', '疑是地上霜。']);
  eq('CSS：分句拼接不变式', LS.flatMap(x => x.cls).join(''), JY);
  const QU2 = layoutSentences(QU, null, 'ci', fitsN(5));
  eq('CSS：超宽长分句预拆且每块放得下', QU2[0].cls.every(c => [...c].filter(ch => /[\u3400-\u9fff]/.test(ch)).length <= 5), true);
  eq('CSS：预拆拼接不变式', QU2.flatMap(x => x.cls).join(''), QU);
  eq('CSS：prose 不分句', layoutSentences('子曰：學而時習之。', null, 'prose', null)[0].cls, null);
  // 平仄：串不合时整行式缀段末句，词曲不缀
  eq('CSS：整行式平仄缀末句', layoutSentences(JY, '平仄平平仄', 'sentence', null).at(-1).st, '平仄平平仄');
  eq('CSS：词曲不缀整行式', layoutSentences(JY, '平仄平平仄', 'ci', null).every(x => x.st === null), true);
}

// ---------- 行令小游戏共用函数（2026-10-31）：合璧拆对 / 飞花令分句 / 四选一 ----------
{
  const { splitMingjuPair, fhSentences, quizOptions } = await import('../site/js/vcommon.js');
  // 合璧：标准「上句，下句。」
  eq('合璧：拆「青海长云暗雪山，孤城遥望玉门关。」',
    splitMingjuPair('青海长云暗雪山，孤城遥望玉门关。'), ['青海长云暗雪山', '孤城遥望玉门关。']);
  // 问句作上句的对子也要收
  eq('合璧：问句上句', splitMingjuPair('问君能有几多愁？恰似一江春水向东流。'),
    ['问君能有几多愁', '恰似一江春水向东流。']);
  eq('合璧：多逗号长联不收', splitMingjuPair('一三五七九，二四六八十，横批缺德。'), null);
  eq('合璧：单句不收', splitMingjuPair('念天地之悠悠。'), null);
  eq('合璧：下句不收尾不收', splitMingjuPair('海内存知己，天涯若比邻'), null);
  eq('合璧：非字符串不收', splitMingjuPair(null), null);
  // 飞花令：分句到句读为止，含令字才算
  eq('飞花：取含令字的分句', fhSentences('床前明月光，疑是地上霜。', '月'), ['床前明月光，']);
  eq('飞花：简繁两种写法都认', fhSentences('舉頭望明月，低頭思故鄉。', ['月', '月']), ['舉頭望明月，']);
  eq('飞花：换行分段不串句', fhSentences('白日依山盡，\n黃河入海流。', '山'), ['白日依山盡，']);
  eq('飞花：残句断章（<3 字）不收', fhSentences('月，明月幾時有。', '月'), ['明月幾時有。']);
  eq('飞花：超长整段（>24 字）不收', fhSentences('一'.repeat(30) + '月。', '月'), []);
  eq('飞花：不含令字不收', fhSentences('疑是地上霜。', '月'), []);
  // 四选一：含正确答案、不重、全来自题库；rng 注入保证确定性
  const lcg = (seed) => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const pool = ['五字干扰甲', '七个字的干扰乙', '五字干扰丙', '很长很长的干扰项丁', '五个字干扰戊'];
  const opts = quizOptions('正答五字', pool, 4, lcg(42));
  eq('选项数恰好 4', opts.length, 4);
  eq('正确答案在内', opts.includes('正答五字'), true);
  eq('选项不重复', new Set(opts).size, 4);
  eq('选项全来自题库加正确答案', opts.every(o => o === '正答五字' || pool.includes(o)), true);
  eq('字数近者优先（三个五字干扰占满）', opts.filter(o => pool.includes(o)).every(o => [...o].length <= 7), true);
  eq('同 rng 结果确定', JSON.stringify(quizOptions('正答五字', pool, 4, lcg(42))), JSON.stringify(opts));
  eq('题池不足时给得出多少是多少', quizOptions('甲', ['乙'], 4).length, 2);
  // 应令比对（2026-10-31）：句库行 [句(含句读), id] × 输入简繁变体，从宽匹配
  const { fhBare, fhVerifyHit } = await import('../site/js/vcommon.js');
  const CHOU = [['我寄愁心與明月，', 133210], ['白髮三千丈，', 1], ['月落烏啼霜滿天，', 2]];
  eq('应令：去句尾标点', fhBare('床前明月光，疑是地上霜。'), '床前明月光，疑是地上霜');
  eq('应令：简体输入命中繁体句库', fhVerifyHit(CHOU, ['我寄愁心与明月', '我寄愁心與明月']), CHOU[0]);
  eq('应令：繁体输入命中', fhVerifyHit(CHOU, ['我寄愁心與明月', '我寄愁心与明月']), CHOU[0]);
  eq('应令：半句也算', fhVerifyHit(CHOU, ['我寄愁心', '我寄愁心']), CHOU[0]);
  eq('应令：两句连背（输入包含句库句）', fhVerifyHit(CHOU, ['月落烏啼霜滿天，江楓漁火對愁眠', '月落乌啼霜满天，江枫渔火对愁眠']), CHOU[2]);
  eq('应令：连背方向 3 字短句不误吞', fhVerifyHit([['三五七，', 9]], ['我背的是三五七呀', '我背的是三五七呀']), null);
  eq('应令：未检得', fhVerifyHit(CHOU, ['这句库里的确没有', '這句庫裡的確沒有']), null);
  // 得星（2026-10-31 调整）：连续接上十句才得一星，此后每多一句加一星；飞花令/合璧共用
  const { starsFor, cnNum } = await import('../site/js/vcommon.js');
  eq('得星：九句无星', starsFor(9), 0);
  eq('得星：十句一星', starsFor(10), 1);
  eq('得星：十一句两星', starsFor(11), 2);
  eq('得星：二十句十一星', starsFor(20), 11);
  eq('得星：零句/负数/坏值兜底', starsFor(0) + ',' + starsFor(-3) + ',' + starsFor('x'), '0,0,0');
  // 序号转中文数字（2026-10-31）：行令应令序号用
  eq('序号：一到十', [1, 2, 9, 10].map(cnNum).join(','), '一,二,九,十');
  eq('序号：十一、十九、二十', [11, 19, 20].map(cnNum).join(','), '十一,十九,二十');
  eq('序号：二十一、九十九', [21, 99].map(cnNum).join(','), '二十一,九十九');
  eq('序号：一百零一、二百三十五', [101, 235].map(cnNum).join(','), '一百零一,二百三十五');
  eq('序号：零与坏值兜底', cnNum(0) + ',' + cnNum(-3) + ',' + cnNum('x'), '零,零,零');
  // 补字挖字位（2026-11-01）：只挖汉字位，标点/字母位不挖
  const { bzHolePositions } = await import('../site/js/vcommon.js');
  eq('补字：汉字位全收', bzHolePositions('春眠不觉晓'), [0, 1, 2, 3, 4]);
  eq('补字：标点位跳过', bzHolePositions('海内存知己，天涯若比邻'), [0, 1, 2, 3, 4, 6, 7, 8, 9, 10]);
  eq('补字：空串/坏值兜底', bzHolePositions('').join(',') + ',' + bzHolePositions(null).join(','), ',');
  eq('补字：数字字母不算汉字位', bzHolePositions('春1晓').join(',') + ',' + bzHolePositions('abc').join(','), '0,2,');
}

// ---------- 搜索打分 ----------
eq('完全命中标题 6 分', bestMatch('春江花月夜', ['春江花月夜'], TITLE_W), 6);
eq('前缀命中 5 分', bestMatch('春江花月夜', ['春江'], TITLE_W), 5);
eq('包含命中 4 分', bestMatch('曲江春江口占', ['春江'], TITLE_W), 4);
eq('不命中 0 分', bestMatch('静夜思', ['春江'], TITLE_W), 0);
eq('繁简变体任一中即算', bestMatch('春江花月夜', ['春江', '春江'], TITLE_W), 5);
eq('作者权重低于标题', bestMatch('李白', ['李白'], AUTHOR_W) < bestMatch('李白', ['李白'], TITLE_W), true);
// 加成的真实效果（不是笔误，是产品取舍）：
// 搜「春江」时，《春江花月夜》靠「前缀命中 5 + 精选 1.2 = 6.2」压过一堆标题正好叫《春江》的冷门诗（exact 6）。
// 代价是「完全命中」不再绝对第一。如果哪天想改成 exact 永远优先，把 BONUS_SCORE 降到 0.8 以下，
// 这两条断言会一起红——那就是提醒你这里动过手。
eq('精选加成 4→5.2', withBonus(4, 'tang300'), 5.2);
eq('精选件的前缀命中可压过非精选的完全命中', withBonus(5, 'tang300') > 6, true);
eq('但压不过精选件自己的完全命中', withBonus(5, 'song') < withBonus(6, 'tang300'), true);
eq('非精选集不加成', withBonus(4, 'song'), 4);

if (!DUMP) {
  console.log(`\n规则测试：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
