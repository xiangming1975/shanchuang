// ETL：构建显示级 简体→繁体 逐字映射 idx/s2td.json
// ---------------------------------------------------------------------------
// 背景：语料繁简混杂（同库内曹操简体、屈原繁体），「默认繁体显示」需要把简体源
// 转成繁体。idx/s2t.json（build.js 产物）是裸频率反推，对古诗是灾难
// （沈→瀋、谷→穀、面→麵、斗→鬥），不能上显示层。
//
// 本脚本的做法：
//   1. 用 opencc-js 的「词组级」s2t 转换器（STPhrases + STCharacters）跑全量已发布
//      语料（site/data/poems），转换是带上下文的（「人云亦云」「皇后」都能正确处理）。
//   2. 对每个简体字统计它实际被转成哪个繁体字的次数，取边际众数——
//      得到「在本语料上最常正确」的逐字等长映射（等长 ⇒ 显示层转换不破坏
//      眉批/摘录的字符偏移、注释定位与平仄对齐）。
//   3. 人工兜底表（OVERRIDES）修正统计救不了的字。opencc 会把大量「本身即合法
//      繁体字」的常用字也转过（冬→鼕、才→纔、志→誌、胡→鬍、曲→麴），这些字
//      必须钉死为原字并移出简体检测集合，否则繁体原文会被误判为简体源而转坏。
//   4. 产出简体专用字集合 so 与繁体专用字集合 to：so 是「转了才对」的字
//      （OVERRIDES 钉死的字不在内），to 是只出现在繁体里的字。前端据此判断
//      「这段文字是简体源还是繁体源」——繁体模式下繁体原文原样不动，只转简体源；
//      简体模式只转繁体源。
//   5. fix：逐字转换后无法避免的错串修正（白發→白髮、擊築→擊筑这类上下文词）。
//
// 产物形状：{ v: 1, m: { 简: 繁, ... }, so: "诗关...", to: "詩關...", fix: { "白發": "白髮", ... } }
// 幂等性：m 的值都是繁体字、不是 m 的键；so 与 to 不相交。重复套用结果不变。

const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const ROOT = path.join(__dirname, '..');
const POEMS_DIR = path.join(ROOT, 'site', 'data', 'poems');
const OUT = path.join(ROOT, 'site', 'data', 'idx', 's2td.json');

const convS2T = OpenCC.Converter({ from: 'cn', to: 't' });
const convT2S = OpenCC.Converter({ from: 't', to: 'cn' });

// ---------- 收集语料字符串 ----------
const strings = [];
function walk(v) {
  if (v == null) return;
  if (typeof v === 'string') { if (v.length >= 2) strings.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) walk(x); return; }
  if (typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]); }
}
{
  let n = 0;
  for (const f of fs.readdirSync(POEMS_DIR).filter(f => f.endsWith('.json')).sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(POEMS_DIR, f), 'utf8'));
    walk(Array.isArray(rows) ? rows : rows.rows);
    n++;
  }
  console.log(`语料分块 ${n} 个，字符串 ${strings.length} 条`);
}

// ---------- 逐字投票（词组级转换，按码点对齐） ----------
const votes = new Map(); // 简字 → Map(繁字 → 次数)
let voted = 0, skipped = 0;
for (const s of strings) {
  const out = convS2T(s);
  const a = [...s], b = [...out];
  if (a.length !== b.length) { skipped++; continue; } // 词组映射变长（罕见），放弃该串
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    let m = votes.get(a[i]);
    if (!m) { m = new Map(); votes.set(a[i], m); }
    m.set(b[i], (m.get(b[i]) || 0) + 1);
    voted++;
  }
}
console.log(`逐字投票 ${voted} 次，长度变化跳过 ${skipped} 串`);

// ---------- opencc 原始简/繁侧集合（初判用，最终 so 以 OVERRIDES 修正后为准） ----------
const rawSimpChars = new Set();   // conv 后会变（opencc 判定简体侧，含误伤）
const rawTradChars = new Set();   // 只出现在繁体里
const seen = new Set();
for (const s of strings) for (const ch of s) {
  if (seen.has(ch)) continue;
  seen.add(ch);
  if (convS2T(ch) !== ch) rawSimpChars.add(ch);
  else if (convT2S(ch) !== ch) rawTradChars.add(ch);
}

// ---------- 人工兜底表 ----------
// 分三类（脚本按注释语义统一处理）：
//   值 === 键      → 钉死原字：字本身是合法繁体（或逐字转换必错），从 so 移除，永不转
//   值 !== 键 且键在 rawSimpChars → 强制指定繁体（否决统计众数），仍在 so
//   其余           → 显式补充的低频字转换
const OVERRIDES = {
  // ---- 钉死原字：opencc 过度转换 / 本身即合法繁体 ----
  '沈': '沈',   // 沈佺期、沈约；「瀋」只用于地名
  '于': '于',   // 之子于归、凤凰于飞、君子于役——诗经体「于」是正字
  '谷': '谷',   // 山谷、金谷园；穀只指粮食
  '面': '面',   // 面色、江面；麵不涉诗文
  '斗': '斗',   // 北斗、斗酒、气冲牛斗；鬥罕见
  '征': '征',   // 征人、远征；「徵」（宫徵/徵召）逐字难分，取征
  '里': '里',   // 万里、乡里；「裏」（梦里）逐字两难，取古诗更高频的里
  '后': '后',   // 后宫、后主、后妃、后皇嘉树；「后来」类译文残留可接受
  '只': '只',   // 只今、只在此山中——传统刊本即用「只」
  '干': '干',   // 干戈、干谒、干云；「乾/幹」细分难，取干
  '台': '台',   // 楼台、台城、歌台；臺另成词
  '系': '系',   // 系出、联系；係/繋细分难
  '松': '松',   // 松柏、松风——绝不能成「鬆」
  '蒙': '蒙',   // 蒙受、承蒙；濛只作空濛
  '制': '制',   // 制度、制服；製只作制造
  '咸': '咸',   // 咸阳、咸受其益（咸=皆）；鹹只作咸味
  '雕': '雕',   // 雕栏、雕梁；鵰只是猛禽
  '舍': '舍',   // 客舍、茅舍、昼夜不舍（论语）；捨只作舍弃
  '才': '才',   // 才华、才下眉头；纔是白话虚词，转了必错
  '胡': '胡',   // 胡马、胡笳、胡天八月；鬍只是胡子
  '冬': '冬',   // 冬就是冬；鼕只作鼓声
  '欲': '欲',   // 欲穷千里目、欲把西湖；慾只作嗜欲
  '御': '御',   // 御风、御史、御沟；禦只作抵禦
  '志': '志',   // 诗言志、志向；誌只作杂志
  '曲': '曲',   // 曲终人散、曲径；麴只作酒麴
  '回': '回',   // 回眸、回车；迴只作迴廊
  '糊': '糊',   // 糊涂；餬只作糊口
  '余': '余',   // 余（第一人称，古典核心用法）；「餘」逐字转必伤「余幼好此奇服」类
  '游': '游',   // 游鱼、陆游人名两可，且「游」本身合法；逐字转遊会伤「皆若空游」类
  '准': '准',   // 准（古典即用准，如隆准）；準另作标准——保守钉原字
  '冲': '冲',   // 大盈若冲（老子）、沖虚；衝/沖两难，钉原字
  '筑': '筑',   // 击筑（高渐离）、筑（乐器）；築只作建筑——钉原字，fix 修「建築」类
  '别': '别',   // 别（古典即用别，如告别/别赋）；彆只作别扭
  '钟': '鐘',   // 钟声、钟鼓、夜半钟声到客船——鐘为准（鍾只是姓氏/钟情，诗文中鐘占多）
  // ---- 强制指定（否决统计） ----
  '叶': '葉',   // 一叶知秋、红叶——葉占绝对多数（叶韵的叶读 xié，本就写作叶）
};

// ---------- 繁体源字符频：找出「本身即合法繁体」的漏网之鱼 ----------
// 繁体源字符串 = 含 rawTradChars 且不含 rawSimpChars（opencc 口径，有误伤但够筛）。
// 规则一：映射字在繁体源里出现 ≥30 次 ⇒ 它本身就是常用繁体字，逐字转它必伤原文 ⇒ 钉原字
//         （秋/家/出/千/梁/佛/象……全是这种：单字 opencc 不转，只在「秋千」「仿佛」
//          这类词里转，统计众数被词组形式劫持）。
// 规则二：总转换率 <50%（被转的次数远少于出现次数）⇒ 同样是「只在特定词里转」⇒ 钉原字。
// 两条都只作用于不在 OVERRIDES 里的字——人工表优先级最高。
const tradFreq = new Map();
const totalFreq = new Map();
for (const s of strings) {
  let hasT = false, hasS = false;
  for (const ch of s) {
    totalFreq.set(ch, (totalFreq.get(ch) || 0) + 1);
    if (rawSimpChars.has(ch)) hasS = true;
    else if (rawTradChars.has(ch)) hasT = true;
  }
  if (!hasT || hasS) continue;
  for (const ch of s) tradFreq.set(ch, (tradFreq.get(ch) || 0) + 1);
}
const voteTotal = new Map();
for (const [ch, vm] of votes) voteTotal.set(ch, [...vm.values()].reduce((a, b) => a + b, 0));

// ---------- 逐字映射 ----------
const m = {};
for (const [ch, vm] of votes) {
  let best = null, bestN = 0;
  for (const [t, n] of vm) if (n > bestN) { bestN = n; best = t; }
  m[ch] = OVERRIDES[ch] || best || convS2T(ch);
}
for (const ch of rawSimpChars) if (!m[ch]) m[ch] = OVERRIDES[ch] || convS2T(ch);
// 自动钉原字：规则一 / 规则二（人工表不覆盖的字）
let autoPinned = 0;
for (const ch of Object.keys(m)) {
  if (OVERRIDES[ch]) continue;
  const tf = totalFreq.get(ch) || 0;
  const vt = voteTotal.get(ch) || 0;
  if ((tradFreq.get(ch) || 0) >= 30 || (tf > 0 && vt / tf < 0.5)) { m[ch] = ch; autoPinned++; }
}
for (const [ch, t] of Object.entries(OVERRIDES)) if (seen.has(ch)) m[ch] = t;
for (const ch of Object.keys(m)) if (m[ch] === ch) delete m[ch];
console.log(`自动钉原字 ${autoPinned} 个（规则一/二）`);

// ---------- so / to 集合 ----------
// so = 会转的字（OVERRIDES 钉死的已在上一步从 m 删除，天然出局）
const soChars = Object.keys(m).filter(ch => seen.has(ch));
const toChars = [...rawTradChars].filter(ch => seen.has(ch));

// ---------- 转换后错串修正表（fix） ----------
// 逐字映射的已知硬伤：上下文词。等长或整词替换，按 key 长度降序应用。
const fix = {
  // 「云」=说 的语境（逐字取了雲，这里修回）
  '詩雲': '詩云', '書雲': '書云', '人雲亦雲': '人云亦云', '不知所雲': '不知所云',
  // 「发」=髮 的语境（逐字取了發）
  '白發': '白髮', '華發': '華髮', '鶴發': '鶴髮', '霜發': '霜髮', '怒發': '怒髮',
  '結發': '結髮', '束發': '束髮', '削發': '削髮', '披發': '披髮', '發指': '髮指', '理發': '理髮',
  // 词组级传统写法（单字钉了原字或取了众数，词组照转）
  '秋千': '鞦韆', '仿佛': '彷彿',
  '並刀': '并刀', '並州': '并州',   // 并州剪、并刀如水（周邦彦）——并是地名本字
  '復道': '複道',                   // 阿房宫赋「复道行空」用複（複=重叠）
  // 「于」的现代虚词语境（于钉了原字保诗经体「之子于归」；现代介词/副词语组传统排印作「於」）
  '關于': '關於', '對于': '對於', '由于': '由於', '至于': '至於', '屬于': '屬於', '等于': '等於',
  '終于': '終於', '于是': '於是', '位于': '位於', '處于': '處於', '善于': '善於', '用于': '用於',
  '基于': '基於', '源于': '源於', '勇于': '勇於', '乐于': '樂於', '急于': '急於', '难于': '難於', '易于': '易於',
  // 「系」的现代词组语境（系钉了原字保「系出/系于」；关系/联系另作係/繫）
  '關系': '關係', '聯系': '聯繫',
  // 「余」的「剩余」语境（余钉了原字保第一人称；白话词组照转）
  '其余': '其餘', '余下': '餘下', '多余': '多餘', '剩余': '剩餘', '余生': '餘生', '余年': '餘年',
  // 「复」的另一支（复取了「復」；重複/複製语境照转）
  '復制': '複製', '重復': '重複',
};

const doc = { v: 1, m, so: soChars.join(''), to: toChars.join(''), fix };
fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(`s2td 映射 ${Object.keys(m).length} 字，简体专用 ${soChars.length}，繁体专用 ${toChars.length}`);
console.log(`写出 ${path.relative(ROOT, OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`);

// ---------- 审查报告 ----------
console.log('\n【终审】剩余高频映射（应全部为干净的繁简对，看不出问题即定稿）：');
const review = [...Object.keys(m)]
  .filter(ch => (totalFreq.get(ch) || 0) >= 3000)
  .sort((a, b) => (totalFreq.get(b) || 0) - (totalFreq.get(a) || 0));
for (const ch of review.slice(0, 80)) {
  console.log(`  ${ch}→${m[ch]}  (总频 ${totalFreq.get(ch)}, 转换率 ${((voteTotal.get(ch) || 0) / totalFreq.get(ch) * 100).toFixed(0)}%)`);
}
