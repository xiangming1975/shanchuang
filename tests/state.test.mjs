// 有状态纯逻辑的直测（评审 N5）：题名规则 / maskHTML / 已读统计 / 搜索历史清理 / 备份往返。
//
// 这些函数有真实分支（hasSubtitle 的副题豁免、元曲 26 字、前缀清理、read 合并的
// Set.size），此前零覆盖——「Set.length」那类笔误只能靠人肉发现，备份往返一跑就能抓住。
// 依赖 dom-shim 的 localStorage（Map 垫片）；store.js 的键经内存缓存（写穿透），
// 测试里不做直写 localStorage，一律走导出 API，保证缓存一致性。
import './dom-shim.mjs';

const { displayTitle, cutTitle, titleMax, snippetOf } = await import('../site/js/vcommon.js');
const { maskHTML } = await import('../site/js/views/detail.js');
const store = await import('../site/js/store.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
};

// ---------- 题名：词补首句 / 副题豁免 / 元曲放宽（HANDOFF §4.22）----------
// 注意 poem.p 是段落数组（与真实数据同形）
eq('词补首句', displayTitle({ t: '瑞鹤仙', p: ['湿云黏雁影'] }, 'songci300'), '瑞鹤仙·湿云黏雁影');
eq('首句取标点前一段', displayTitle({ t: '卜算子', p: ['缺月挂疏桐，漏断人初静。'] }, 'songci'), '卜算子·缺月挂疏桐');
eq('有副题不重复补', displayTitle({ t: '长相思·山一程', p: ['山一程，水一程。'] }, 'songci'), '长相思·山一程');
eq('「其一」不算副题', displayTitle({ t: '菩萨蛮 其一', p: ['平林漠漠烟如织'] }, 'songci300'), '菩萨蛮 其一·平林漠漠烟如织');
eq('词牌别名即副题不补', displayTitle({ t: '金缕衣・贺新郎', p: ['劝君莫惜金缕衣'] }, 'songci300'), '金缕衣・贺新郎');
eq('非词集不补', displayTitle({ t: '静夜思', p: ['床前明月光'] }, 'tang300'), '静夜思');
eq('titleMax 元曲放宽 26', titleMax('yq'), 26);
eq('titleMax 其余 20', titleMax('tang300'), 20);
eq('cutTitle 超 20 字截断', cutTitle('一二三四五六七八九十甲乙丙丁戊己庚辛壬子丑', 20), '一二三四五六七八九十甲乙丙丁戊己庚辛壬子…');
eq('cutTitle 不截短', cutTitle('短题', 20), '短题');

// ---------- 集合二分边界（store.colIndexOf，2026-10-29 收敛自 4 处重复实现）----------
const COLS = [
  { id: 'a', start: 0, count: 10 },
  { id: 'b', start: 10, count: 5 },
  { id: 'c', start: 100, count: 200 },
];
eq('二分：首集合首 id', store.colIndexOf(0, COLS), 0);
eq('二分：首集合末 id', store.colIndexOf(9, COLS), 0);
eq('二分：次集合首 id', store.colIndexOf(10, COLS), 1);
eq('二分：间隙 id 归前集合（只按 start 定位，与旧实现一致）', store.colIndexOf(50, COLS), 1);
eq('二分：末集合首 id', store.colIndexOf(100, COLS), 2);
eq('二分：末集合末 id', store.colIndexOf(299, COLS), 2);
eq('二分：超末尾仍归末集合（越界检查由调用方负责）', store.colIndexOf(99999, COLS), 2);
eq('二分：首前 id 返回 -1', store.colIndexOf(-1, COLS), -1);
eq('二分：空集合数组返回 -1', store.colIndexOf(5, []), -1);

// ---------- 去重键（fn.dedupeKey，收敛自 3 处重复实现）----------
const { dedupeKey } = await import('../site/js/fn.js');
eq('去重键空值安全', dedupeKey(undefined, null, undefined), '||');
eq('去重键首句截 12 字', dedupeKey('t', 'a', '一二三四五六七八九十一二三四五六'), dedupeKey('t', 'a', '一二三四五六七八九十一二'));
eq('去重键三段式', dedupeKey('题', '者', '首').split('|').length, 3);

// ---------- 首句摘要（vcommon.snippetOf，收敛自 3 处重复实现）----------
eq('首句摘要去空白', snippetOf('床前 明月光　疑是地上霜'), '床前明月光疑是地上霜');
eq('首句摘要恰好 26 字不截断', snippetOf('一'.repeat(26)), '一'.repeat(26));
eq('首句摘要超 26 字截断加省略号', snippetOf('一'.repeat(30)), '一'.repeat(26) + '…');
eq('首句摘要空值安全', snippetOf(null), '');

// ---------- 行元信息 / 空态占位（vcommon.rowMeta / emptyHtml，2026-10-29 复用收敛）----------
const { rowMeta, emptyHtml } = await import('../site/js/vcommon.js');
eq('行元信息：题名+朝代作者', rowMeta({ i: 1, t: '静夜思', d: '唐', a: '李白' }, 1), { t: '静夜思', m: '唐 · 李白' });
eq('行元信息：记录缺失退回占位', rowMeta(null, 42), { t: '作品 42', m: '' });
eq('空态占位：大字+说明', emptyHtml('空', '数据未就绪'), '<div class="empty-state"><div class="big">空</div>数据未就绪</div>');
eq('空态占位：无大字', emptyHtml('', '加载失败'), '<div class="empty-state">加载失败</div>');

// ---------- 分页懒加载骨架（views/paged.js，收敛自 5 处重复）----------
// dom-shim 的元素不落盘内容，这里造一个能真正累积 innerHTML 的假元素
const { pagedList } = await import('../site/js/views/paged.js');
const fakeEl = () => {
  const el = { innerHTML: '', textContent: '', disabled: false, _c: new Set() };
  el.classList = {
    add: (c) => el._c.add(c),
    remove: (c) => el._c.delete(c),
    toggle: (c, f) => { const on = f === undefined ? !el._c.has(c) : !!f; on ? el._c.add(c) : el._c.delete(c); return on; },
    contains: (c) => el._c.has(c),
  };
  el.insertAdjacentHTML = (pos, html) => { el.innerHTML += html; };
  return el;
};
{
  const listEl = fakeEl(), moreBtn = fakeEl(), endEl = fakeEl();
  const items = [1, 2, 3, 4, 5];
  let lastBatch = null;
  const pager = pagedList({
    listEl, moreBtn,
    items: () => items,
    total: () => items.length,
    batchSize: 2,
    itemHtml: (n) => `<i>${n}</i>`,
    countUnit: '个',
    endEl,
    afterBatch: (b) => { lastBatch = b; },
  });
  await pager.more();
  eq('分页：首批渲染 2 条', listEl.innerHTML, '<i>1</i><i>2</i>');
  eq('分页：按钮显剩余', moreBtn.textContent, '加载更多（还有 3 个）');
  eq('分页：按钮未隐藏', moreBtn._c.has('hidden'), false);
  eq('分页：afterBatch 收到本批', lastBatch, [1, 2]);
  await pager.more();
  await pager.more();
  eq('分页：全部渲染', listEl.innerHTML, '<i>1</i><i>2</i><i>3</i><i>4</i><i>5</i>');
  eq('分页：到底隐藏按钮', moreBtn._c.has('hidden'), true);
  eq('分页：到底标记', endEl.textContent, '— 到底了 —');
  pager.reset();
  eq('分页：reset 清空', listEl.innerHTML, '');
  await pager.more();
  eq('分页：reset 后从头渲染', listEl.innerHTML, '<i>1</i><i>2</i>');
}
{
  // 首批备料为空 → firstEmptyHtml 占位
  const listEl = fakeEl(), moreBtn = fakeEl();
  const pager = pagedList({
    listEl, moreBtn,
    items: () => [1, 2],
    total: () => 2,
    batchSize: 2,
    fetchBatch: async () => [],
    itemHtml: (n) => `<i>${n}</i>`,
    firstEmptyHtml: 'EMPTY',
  });
  await pager.more();
  eq('分页：首批为空显示占位', listEl.innerHTML, 'EMPTY');
}

// ---------- 背诵模式掩码 ----------
const maskCount = (s) => (String(s).match(/class="mask"/g) || []).length;
eq('mask all 全隐', maskCount(maskHTML('床前明月光', 'all')), 5);
eq('mask half 隐三分之二（5 字隐 4）', maskCount(maskHTML('床前明月光', 'half')), 4);
eq('mask 不碰非汉字', maskCount(maskHTML('a光，', 'all')), 1);

// ---------- 已读：去重 + 统计（store.js，走导出 API 不直写 localStorage）----------
store.markRead(7); store.markRead(9); store.markRead(7);
const rs = store.readStats();
eq('已读 ids 去重后累计', rs.total, 2);
eq('今日新读篇数', rs.today, 2);
eq('连续天数（今天读了）', rs.streak, 1);
eq('累计打卡天数（出现过的日期数）', rs.days, 1);
eq('最长连续天数', rs.best, 1);
eq('isRead 单篇判断', [store.isRead(7), store.isRead(8)], [true, false]);
eq('readIdSet 供列表批量用', [...store.readIdSet()].sort((a, b) => a - b), [7, 9]);

// ---------- 搜索历史：前缀清理 + 上限 ----------
store.clearUserData('searchhist');
store.pushSearchHist('静');                       // <2 字不入史
eq('单字不入史', store.getSearchHist(), []);
store.pushSearchHist('静夜');
store.pushSearchHist('静夜思');                   // 提交长词时清掉作为前缀的旧条目
eq('前缀清理', store.getSearchHist(), ['静夜思']);
store.pushSearchHist('春晓');
eq('新词插到队首', store.getSearchHist(), ['春晓', '静夜思']);
// 定宽键无前缀关系，冲到上限；SHIST_MAX=1000
for (let i = 0; i < 1100; i++) store.pushSearchHist('词' + String(i).padStart(5, '0'));
eq('搜索历史上限 1000', store.getSearchHist().length, 1000);

// ---------- 备份往返（含 read 合并 / 偏好 / 摘录；Summ的 read 数来自 Set.size）----------
store.toggleFav(5); store.toggleFav(6);
store.markRead(5);
store.pref('fs', '19');
store.pref('ty', '0');
store.pushHistory(8);
store.addExcerpt(8, '测试摘录一句');
const backup = JSON.parse(store.exportAllData());
eq('备份 favs（后收藏在前）', backup.favs, [6, 5]);
eq('备份含已读 ids', backup.read.ids.slice().sort((a, b) => a - b), [5, 7, 9]);
eq('备份含偏好 ty=0', backup.prefs.ty, '0');
eq('备份含摘录', backup.excerpts.length, 1);
// 导入一份带新 read/favs 的备份：合并而非覆盖（ids 并集、favs 并集）
const backup2 = JSON.parse(JSON.stringify(backup));
backup2.favs = [7];
backup2.read = { ids: [5, 99], days: { '2000-01-01': 1 } };
const summary = store.importAllData(JSON.stringify(backup2));
eq('导入摘要 read 数（Set.size 而非 length）', summary.read, 4);   // [5,7,9] ∪ [5,99]
eq('导入后 favs 并集', store.getFavs(), [7, 6, 5]);
eq('导入后已读并集', [...store.readIdSet()].sort((a, b) => a - b), [5, 7, 9, 99]);
eq('导入后偏好恢复', store.pref('ty'), '0');
eq('导入后摘录保留', store.getExcerpts().length, 1);

// ---------- 收藏上限：截断时给一次性提示（评审 N7）----------
const events = [];
globalThis.window.dispatchEvent = (ev) => { events.push(ev && ev.detail && ev.detail.msg); };
store.clearUserData('favs');
for (let i = 0; i < 2001; i++) store.toggleFav(100000 + i);
eq('收藏截断到 2000', store.getFavs().length, 2000);
eq('最旧的被移出（队首是新的）', store.getFavs()[0], 102000);
eq('到顶提示已派发', (events.find(Boolean) || '').includes('收藏'), true);

// ---------- 眉批：锚点解析 + 存取（2026-10-28）----------
// 锚点的意义全在「行号会漂」：切字号、词重新断句之后，批注还得挂回原来那句。
const { normLine, placeNotes } = await import('../site/js/notes.js');
eq('净文去空白与标点', normLine(' 床前 明月光，疑是地上霜。'), '床前明月光疑是地上霜');
const LINES = [
  { t: '床前明月光，' }, { t: '疑是地上霜。' },
  { t: '举头望明月，' }, { t: '低头思故乡。' },
];
const mk = (o) => Object.assign({ id: 'n1', li: 0, t: '床前明月光，', s: '批', ts: 1 }, o);
let r1 = placeNotes(LINES, [mk({})]);
eq('精确命中：行 0', r1.placed.map(p => p.li), [0]);
eq('精确命中：无孤儿', r1.orphans.length, 0);
// 行号漂了（现在是第 3 行），文本没变 → 按文本找回来
const r2 = placeNotes(LINES, [mk({ li: 9 })]);
eq('行号漂移仍按文本命中', r2.placed.map(p => p.li), [0]);
// 叠句：两行同文，取离记录行号最近的那个
const DUP = [{ t: '悠悠苍天，' }, { t: '此何人哉。' }, { t: '悠悠苍天，' }];
const r3 = placeNotes(DUP, [mk({ t: '悠悠苍天，', li: 2 })]);
eq('叠句取最近的同文行', r3.placed.map(p => p.li), [2]);
// 断句变化：原来整行，现在被切成两行 → 包含关系找回
const SPLIT = [{ t: '大江东去，' }, { t: '浪淘尽，' }, { t: '千古风流人物。' }];
const r4 = placeNotes(SPLIT, [mk({ t: '大江东去，浪淘尽，', li: 0 })]);
eq('整行被切开：按重叠最多的行找回', r4.placed.map(p => p.li), [0]);
// 行已不存在（换了版本/错篇）→ 进孤儿堆，不静默丢
const r5 = placeNotes(LINES, [mk({ t: '完全不存在的一句', li: 0 })]);
eq('找不到的行进孤儿', r5.orphans.length, 1);

store.addNote(11, { li: 1, t: '疑是地上霜。' }, '  霜字最冷  ');
eq('眉批写入并去空白', store.getNotes(11)[0].s, '霜字最冷');
eq('眉批计数', store.noteTotal() >= 1, true);
const n1 = store.getNotes(11)[0];
eq('眉批改文', store.updateNote(11, n1.id, '改过'), true);
eq('眉批改后内容', store.getNotes(11)[0].s, '改过');
eq('眉批空文不入库', store.addNote(11, { li: 0, t: 'x' }, '   '), null);
eq('眉批删除', store.removeNote(11, n1.id), true);
eq('删除后清空该篇', store.getNotes(11).length, 0);
eq('空篇键被移除', Object.keys(store.getAllNotes()).includes('11'), false);
// 备份往返：notes 随备份走
store.addNote(12, { li: 0, t: '床前明月光，' }, '备份里要有我');
const bk3 = JSON.parse(store.exportAllData());
eq('备份含眉批', bk3.notes['12'].length, 1);
const sum3 = store.importAllData(JSON.stringify(bk3));
eq('导入摘要含眉批数', sum3.notes >= 1, true);
eq('重复导入不翻倍', store.getNotes(12).length, 1);

// ---------- 眉批导出 Markdown ----------
const { notesToMarkdown } = await import('../site/js/notes.js');
const mdMeta = (pid) => (pid === '12' ? { t: '静夜思', m: '唐 · 李白' } : { t: '作品 ' + pid, m: '' });
eq('空眉批导出空串', notesToMarkdown([], mdMeta, new Date(2026, 9, 28, 14, 5)), '');
const md = notesToMarkdown(
  [{ pid: '12', notes: [{ t: '床前明月光，', s: '# 这不是标题', ts: 1 }, { t: '疑是地上霜。', s: '两行批语\n第二行', ts: 2 }] }],
  mdMeta, new Date(2026, 9, 28, 14, 5));
eq('导出含篇名标题', md.includes('## 静夜思'), true);
eq('导出含朝代作者', md.includes('唐 · 李白'), true);
eq('导出含原句引用', md.includes('> 床前明月光，'), true);
eq('行首 # 被转义', md.includes('\\# 这不是标题'), true);
eq('多行批语不合并成一段', md.includes('两行批语\n第二行'), true);
eq('导出含时间戳', md.includes('导出时间：2026-10-28 14:05'), true);
eq('导出含统计行', md.includes('共 2 条 · 分布在 1 篇'), true);
eq('缺篇名时退回 id', notesToMarkdown([{ pid: '99', notes: [{ t: 'x', s: 'y' }] }], mdMeta).includes('## 作品 99'), true);

// ---------- 工具栏的日间/夜间：临时翻转，不改设置（2026-10-28）----------
// 设置里选了「自动 / 跟随系统」的人，点一下工具栏的月亮不该把这选择改掉。
const { toggleTheme, clearThemeFlip, applyTheme } = await import('../site/js/vcommon.js');
globalThis.localStorage.removeItem('shici-theme');
globalThis.sessionStorage.clear();
eq('未设主题时 pref 为空', store.pref('theme'), null);
toggleTheme();
eq('临时翻转写在 sessionStorage', globalThis.sessionStorage.getItem('shici-theme-flip'), 'dark');
eq('翻转没有动设置里的 shici-theme', store.pref('theme'), null);
clearThemeFlip();
eq('设置页选模式后翻转被清掉', globalThis.sessionStorage.getItem('shici-theme-flip'), null);
// 显式选过日间/夜间的人：点工具栏等于改那个选择，设置页要对得上
store.pref('theme', 'light');
toggleTheme();
eq('显式 light 的人点了变 dark', store.pref('theme'), 'dark');
eq('此时不写翻转', globalThis.sessionStorage.getItem('shici-theme-flip'), null);
globalThis.localStorage.removeItem('shici-theme');
globalThis.sessionStorage.clear();

// ---------- 拼音多音字：整行消歧（py.js rubyHTML，2026-10-29）----------
// 根因回归：逐字调用 pinyin-pro 会丢上下文（「参」单查 → cān），必须整行喂。
// UMD 库在 Node 里用 Function 包装加载，挂到 dom-shim 的 window 上。
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { SITE } = await import('./dom-shim.mjs');
  const src = fs.readFileSync(path.join(SITE, 'vendor/pinyin-pro.min.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'globalThis', src)(mod, mod.exports, globalThis);
  globalThis.window.pinyinPro = mod.exports;
  const { rubyHTML } = await import('../site/js/py.js');
  // 多音字按词定音：参差 cēncī（不是 cān chà）
  const h1 = rubyHTML('参差', [], true, null);
  eq('参差 标 cēn', h1.includes('cēn'), true);
  eq('参差 标 cī', h1.includes('cī'), true);
  eq('参差 不标 cān', h1.includes('cān'), false);
  // 对齐：标点占位但不进 ruby，汉字按码点索引一一对齐
  const h2 = rubyHTML('参差荇菜，左右流之。', [], true, null);
  const rt = [...h2.matchAll(/<ruby>(.)<rt>([^<]+)<\/rt>/g)].map(m => m[1] + '=' + m[2]);
  eq('整行 8 个 ruby', rt.length, 8);
  eq('ruby 逐字对齐', rt.join(' '), '参=cēn 差=cī 荇=xìng 菜=cài 左=zuǒ 右=yòu 流=liú 之=zhī');
  // 词内多音：乐读 yuè、行读 xíng（「奏乐」「行人」按词消歧）
  const h3 = rubyHTML('奏乐行人', [], true, null);
  eq('乐 在「奏乐」里读 yuè', h3.includes('yuè'), true);
  eq('行 在「行人」里读 xíng', h3.includes('xíng'), true);
}

// ---------- 今日待复习（vcommon.reciteDue，R4：首页复习卡与背诵页共用）----------
// 间隔表 [1,2,4,7,15,30]：到期判据 now - last - interval*DAY >= 0，逾期最久排最前
const { reciteDue, DAY } = await import('../site/js/vcommon.js');
const NOW = 1777000000000;                       // 固定时刻，不取 Date.now()
const mkRec = (n, daysAgo) => ({ n, last: NOW - daysAgo * DAY });
eq('待复习：空表', reciteDue({}, NOW), []);
eq('待复习：null 安全', reciteDue(null, NOW), []);
eq('未到期不算（昨天背，间隔 1 天）', reciteDue({ 1: mkRec(1, 0.5) }, NOW), []);
eq('到期即算（正好隔 1 天）', reciteDue({ 7: mkRec(1, 1) }, NOW), [{ id: 7, overdue: 0 }]);
eq('刚过 1ms 也算', reciteDue({ 2: mkRec(1, 1) }, NOW + 1), [{ id: 2, overdue: 1 }]);
eq('逾期最久排最前', reciteDue({ 3: mkRec(1, 3), 5: mkRec(1, 2) }, NOW).map(d => d.id), [3, 5]);
eq('次数超间隔表取末档 30 天', reciteDue({ 9: mkRec(9, 31) }, NOW).map(d => d.id), [9]);
eq('末档未满 30 天不算', reciteDue({ 9: mkRec(9, 29) }, NOW), []);
eq('n=0 的坏记录跳过', reciteDue({ 4: mkRec(0, 5) }, NOW), []);
eq('缺 last 的坏记录跳过', reciteDue({ 4: { n: 2 } }, NOW), []);

// ---------- 四时读诗（home.dailyPhase，R1：晨读/午诵/昏习/夜思）----------
// 06:00/12:00/18:00/22:00 换课；夜思跨午夜——22:00 到次日 05:59 都算同一课
const { dailyPhase } = await import('../site/js/views/home.js');
const PH = (h, m) => dailyPhase(new Date(2026, 9, 30, h, m || 0));
eq('四时：05:59 夜思（跨午夜）', PH(5, 59), 3);
eq('四时：00:00 夜思', PH(0), 3);
eq('四时：06:00 整 晨读', PH(6), 0);
eq('四时：11:59 仍晨读', PH(11, 59), 0);
eq('四时：12:00 整 午诵', PH(12), 1);
eq('四时：17:59 仍午诵', PH(17, 59), 1);
eq('四时：18:00 整 昏习', PH(18), 2);
eq('四时：21:59 仍昏习', PH(21, 59), 2);
eq('四时：22:00 整 夜思', PH(22), 3);
eq('四时：23:59 仍夜思', PH(23, 59), 3);

// ---------- 阅读队列 navCtx（2026-11-01）：remap / 去重 / 截断 / 命中与清队 ----------
{
  // E-8：这段原先读「未入库」的 data/dedup-remap.json.gz；新克隆（无 site/data）会拿到
  // 空表，key0/target 退化成 NaN/undefined，断言要么红要么无意义。这里自带最小夹具：
  // 空表时注入一条 9000001→9000002 的映射再继续，测试名带「夹具兜底」标注来源。
  // getDedupRemap() 返回的是 store 缓存的同一对象，原地注入对 setNavCtx 内部立即可见。
  const remap = await store.getDedupRemap();
  let tag = '';
  if (!remap || !Object.keys(remap).length) {
    remap['9000001'] = 9000002;
    tag = '（夹具兜底）';
  }
  const key0 = +Object.keys(remap)[0];          // 一个真实存在的「被删 id → 保留正文」映射
  const target = remap[key0];
  await store.setNavCtx([key0, key0, target, 5, 'abc', null, 7], '搜索结果 · 测试');
  let q = store.navCtxOf(target);
  eq('navCtx: remap 后命中保留正文 id' + tag, !!q, true);
  eq('navCtx: 重复项（被删 id 与其保留正文）去重' + tag, q.q.ids.filter(x => x === target).length, 1);
  eq('navCtx: 非数字项被剔除' + tag, q.q.ids.includes('abc') || q.q.ids.includes(null), false);
  eq('navCtx: pos 与 label' + tag, [q.pos, q.q.label], [q.q.ids.indexOf(target), '搜索结果 · 测试']);
  // 不假绿：被删 id 必须真的经 remap 落到保留正文，队列里不允许原样留着 key0。
  eq('navCtx: 被删 id 已 remap（不假绿）' + tag, q.q.ids.includes(key0), false);
  eq('navCtx: 普通有效 id 在列', store.navCtxOf(5) !== null, true);
  eq('navCtx: 队列外 id 不命中', store.navCtxOf(999999999), null);
  // 截断 1000
  const big = []; for (let i = 0; i < 1200; i++) big.push(500000 + i);
  await store.setNavCtx(big, '截断');
  q = store.navCtxOf(500000);
  eq('navCtx: 1200 条截断到 1000', q && q.q.ids.length, 1000);
  eq('navCtx: 截断后保留的是队首', q && q.q.ids[0], 500000);
  // 零结果不清队（第九轮 🟠-1 配套）：空入参不动当前队列，清队只走 clearNavCtx
  await store.setNavCtx([], '零结果');
  eq('navCtx: 空入参不清队（保留阅读会话）', [store.navCtxOf(500000) !== null, store.navCtxOf(500000).q.ids.length], [true, 1000]);
  store.clearNavCtx();
  eq('navCtx: clearNavCtx 后不命中', store.navCtxOf(500000), null);
  // 补扫错位回归（第九轮 🟠-1）：补扫增长后二次挂载，以增长后的列表覆盖
  await store.setNavCtx([11, 12], '部分');
  await store.setNavCtx([11, 12, 13, 14], '全部');
  eq('navCtx: 补扫后二次挂载覆盖为增长列表', [store.navCtxOf(13) !== null, store.navCtxOf(11).q.ids.length], [true, 4]);
  store.clearNavCtx();
  // sessionStorage 落盘形状
  await store.setNavCtx([5, 7], '落盘');
  const raw = JSON.parse(sessionStorage.getItem('shici-navq'));
  eq('navCtx: sessionStorage 形状', [raw.label, Array.isArray(raw.ids), raw.ids.join(',')], ['落盘', true, '5,7']);
  store.clearNavCtx();
}

console.log(fail ? `✗ 状态逻辑 ${fail}/${pass + fail} 失败` : `✓ 状态逻辑 ${pass} 项全过`);
process.exit(fail ? 1 : 0);
