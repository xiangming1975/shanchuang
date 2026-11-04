#!/usr/bin/env node
/**
 * audit-body.cjs — 主库正文排查
 *
 * 目标：找出正文的 (1) 完全相同条目 (2) 异体字差异 (3) 错字差异，落盘成报告。
 *
 * 思路（两趟）：
 *   第一趟 meta：遍历所有分片
 *     - bodyHash：去空白换行后的正文指纹 → 碰撞即「完全相同」（可去重）
 *     - groupKey：norm(作者) + 首句前12字 + 正文长度桶 → 把「同一诗文的不同版本」聚到一组
 *     - 近重复组 = 同组内 bodyHash 不完全相同（同诗异版）
 *   第二趟 diff：仅对近重复组，读原文逐字比对
 *     - 逐汉字 offset 收集各版本字符，版本多数表决定「正字」
 *     - 判定三档：
 *         variant   ：{正字, 异字} 命中异体字表（字形异、字义同，纯异体）
 *         suspect   ：仅当存在真正多数派（票数过半）时，个别少数派字（且非异体）→ 疑似错字
 *         uncertain ：平票 / 不过半（多为 2 版本异文）→ 异文待判，不自动判错
 *
 * 退出码：0 完成；2 用法/数据错误。
 *
 * 用法：
 *   node audit-body.cjs --scope all           # 全量 meta+diff
 *   node audit-body.cjs --scope tang300       # 单集合验证
 *   node audit-body.cjs --scope all --phase meta   # 仅 meta（看规模）
 *   node audit-body.cjs --selftest            # 合成数据验证核心逻辑
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const POEMS = path.join(ROOT, 'site', 'data', 'poems');
const MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const OUT = path.join(ROOT, 'audit-out');
const PER_CHUNK = 200;

// ============================================================== 异体字表（常见繁体异体字对）
// 仅收录明确异体字（字形异、字义同）。异文/通假（如尊/樽、沽/酤）不入表，平票时归 uncertain。
const VARIANT_PAIRS = [
  ['里', '裡'], ['云', '雲'], ['于', '於'], ['征', '徵'], ['游', '遊'], ['群', '羣'],
  ['峰', '峯'], ['携', '攜'], ['够', '夠'], ['才', '纔'], ['扎', '紮'], ['尸', '屍'],
  ['几', '幾'], ['系', '係'], ['复', '復'], ['复', '複'], ['干', '乾'], ['干', '幹'],
  ['台', '臺'], ['台', '檯'], ['签', '簽'], ['签', '籤'], ['注', '註'], ['秘', '祕'],
  ['粗', '麤'], ['唇', '脣'], ['兄', '兇'], ['吊', '弔'], ['册', '冊'], ['删', '刪'],
  ['杰', '傑'], ['升', '昇'], ['沈', '瀋'], ['谷', '穀'], ['床', '牀'], ['坐', '座'],
  ['坏', '壞'], ['并', '並'], ['并', '併'], ['庵', '菴'], ['廉', '簾'], ['战', '戰'],
  ['戏', '戲'], ['离', '離'], ['种', '種'], ['称', '稱'], ['窥', '窺'], ['窍', '竅'],
  ['窃', '竊'], ['窗', '窓'], ['穷', '窮'], ['竞', '競'], ['笋', '筍'], ['笔', '筆'],
  ['筑', '築'], ['粮', '糧'], ['纪', '紀'], ['红', '紅'], ['纸', '紙'], ['绝', '絕'],
  ['丝', '絲'], ['网', '網'], ['纲', '綱'], ['绳', '繩'], ['继', '繼'], ['续', '續'],
  ['义', '義'], ['圣', '聖'], ['闻', '聞'], ['声', '聲'], ['聪', '聰'], ['联', '聯'],
  ['修', '脩'], ['脚', '腳'], ['肤', '膚'], ['临', '臨'], ['舆', '輿'], ['舍', '捨'],
  ['艳', '艷'], ['花', '華'], ['范', '範'], ['苗', '苖'], ['志', '誌'], ['野', '埜'],
  ['煮', '煑'], ['焰', '燄'], ['灾', '災'], ['侄', '姪'], ['桌', '棹'], ['棕', '椶'],
  ['杯', '盃'], ['碗', '椀'], ['瓶', '甁'], ['灯', '燈'], ['烟', '煙'], ['猫', '貓'],
  ['猪', '豬'], ['虫', '蟲'], ['蚕', '蠶'], ['龟', '龜'], ['龙', '龍'], ['凤', '鳳'],
  ['鸟', '鳥'], ['鸡', '雞'], ['鸭', '鴨'], ['鹅', '鵝'], ['鱼', '魚'], ['马', '馬'],
  ['驴', '驢'], ['驼', '駝'], ['鲸', '鯨'], ['鲨', '鯊'], ['鲤', '鯉'],
  ['回', '迴'], ['讙', '歡'], ['岳', '嶽'], ['咏', '詠'], ['渊', '淵'], ['迹', '跡'],
  ['迹', '蹟'], ['略', '畧'], ['概', '槩'], ['况', '況'], ['减', '減'], ['昂', '卬'],
  ['俯', '俛'], ['溪', '谿'], ['遍', '徧'], ['唯', '惟'], ['忽', '惚'], ['村', '邨'],
  ['馆', '舘'], ['减', '減'],
  // —— 补充常见异体字（抽样发现的误报项 + 古诗高频）——
  ['里', '裏'], ['歎', '嘆'], ['閑', '閒'], ['疎', '疏'], ['汎', '泛'], ['却', '卻'],
  ['斗', '鬥'], ['鼇', '鰲'], ['鏁', '鎖'], ['余', '餘'], ['乾', '幹'], ['厤', '曆'],
  ['歷', '暦'], ['睹', '覩'], ['逾', '踰'], ['耀', '燿'], ['袪', '祛'], ['雁', '鴈'],
  ['鹃', '鵑'], ['莺', '鶯'], ['鸿', '鴻'], ['鹏', '鵬'], ['鹤', '鶴'], ['鸦', '鵶'],
  ['鸳', '鴛'], ['鸯', '鴦'], ['猿', '蝯'], ['蟹', '蠏'], ['蜂', '蠭'], ['蝶', '蝿'],
  ['蚊', '螡'], ['蜡', '蠟'], ['虾', '蝦'], ['蜘', '鼅'], ['蛛', '鼄'], ['蚁', '螘'],
  ['萤', '螢'], ['蝉', '蟺'], ['蜗', '蠃'], ['螃', '魬'], ['虬', '虯'], ['蛟', '鮫'],
  ['鳄', '鰐'], ['鲫', '鯽'], ['鲈', '鱸'], ['鳜', '鱖'], ['彪', '虩'], ['犀', '㸷'],
  ['兔', '菟'], ['熊', '羆'], ['鹿', '麀'], ['麟', '麐'], ['凤', '鳯'], ['乌', '烏'],
  ['鸦', '鵶'], ['鸥', '鷗'], ['鹭', '鷺'], ['鹊', '鵲'], ['鸦', '鵶'],
  // —— 第三轮补充（诗歌高频异体，抽样漏报表项）——
  ['常', '嫦'], ['沈', '沉'], ['櫂', '棹'], ['荆', '荊'], ['劒', '劍'], ['衞', '衛'],
  ['傍', '旁'], ['雕', '彫'], ['准', '準'], ['冰', '氷'], ['凌', '淩'], ['制', '製'],
  ['刻', '剋'], ['创', '創'], ['辨', '辯'], ['辞', '辭'], ['酸', '痠'], ['雇', '僱'],
  ['集', '雧'], ['雝', '雍'], ['雋', '雋'], ['梁', '樑'], ['梨', '棃'], ['桺', '柳'],
  ['簷', '檐'], ['樯', '檣'], ['槛', '檻'], ['歡', '懽'], ['飲', '飮'], ['飢', '饑'],
  ['飯', '飰'], ['飾', '餙'], ['餐', '飡'], ['鮮', '鱻'], ['惻', '恻'], ['慘', '惨'],
  ['慎', '昚'], ['傲', '慠'], ['恍', '怳'], ['悦', '說'], ['悽', '淒'], ['悲', '悱'],
  ['惠', '慧'], ['愈', '癒'], ['愉', '婾'], ['慨', '嘅'], ['憚', '殫'], ['憐', '怜'],
  ['憑', '凭'], ['憂', '忧'], ['應', '应'], ['懃', '勤'], ['懺', '忏'], ['成', '诚'],
];
const VARIANT_SET = new Set();
for (const [x, y] of VARIANT_PAIRS) VARIANT_SET.add([x, y].sort().join('|'));

// ============================================================== 文本工具
function normText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^\u4e00-\u9fff]/g, '');
}
function firstSentNorm(p, n = 12) {
  const s = (Array.isArray(p) && p.length) ? p[0] : '';
  return normText(s).slice(0, n);
}
function hanChars(p) {
  return (Array.isArray(p) ? p.join('') : String(p || '')).replace(/[^\u4e00-\u9fff]/g, '');
}
function bodyRaw(p) {
  return (Array.isArray(p) ? p.join('\n') : String(p || '')).replace(/\s+/g, '');
}
// cyrb53：53-bit 哈希，碰撞率远低于 32-bit，适合 60 万级去重
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, j; i < str.length; i++) {
    j = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ j, 2654435761);
    h2 = Math.imul(h2 ^ j, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
function hanLenBucket(p) {
  const L = hanChars(p).length;
  return L < 20 ? '<20' : L < 50 ? '20-49' : L < 100 ? '50-99' : L < 300 ? '100-299' : L < 1000 ? '300-999' : '1000+';
}
function groupKey(a, p) {
  return normText(a) + '|' + firstSentNorm(p) + '|' + hanLenBucket(p);
}
// 把一个汉字 offset 映射回「第几句 / 句内字序 / 上下文」
function locate(rec, hanOff) {
  let cnt = 0;
  const p = rec.p || [];
  for (let pi = 0; pi < p.length; pi++) {
    const line = p[pi];
    for (let li = 0; li < line.length; li++) {
      if (/[\u4e00-\u9fff]/.test(line[li])) {
        if (cnt === hanOff) {
          const ctx = line.slice(Math.max(0, li - 6), li + 7);
          return { para: pi, charInPara: li, paraText: line, ctx };
        }
        cnt++;
      }
    }
  }
  return { para: -1, charInPara: -1, paraText: '', ctx: '' };
}

// ============================================================== 近重复组分析（逐字 + 多数表决）
function analyzeGroup(recs) {
  const hans = recs.map(r => hanChars(r.p));
  const lens = hans.map(h => h.length);
  const minL = Math.min(...lens), maxL = Math.max(...lens);
  if (maxL - minL > 15) {
    return { type: 'structure', lenRange: [minL, maxL], note: '版本长度差过大，疑似增删/结构差异，未逐字比对' };
  }
  const V = recs.length;
  const offDiffs = [];
  for (let off = 0; off < maxL; off++) {
    const chars = [];
    for (let v = 0; v < V; v++) chars.push(off < hans[v].length ? hans[v][off] : null);
    const present = chars.filter(c => c !== null);
    if (present.length && !present.every(c => c === present[0])) {
      const freq = {};
      for (const c of present) freq[c] = (freq[c] || 0) + 1;
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const majority = sorted[0][0], majCount = sorted[0][1];
      const overHalf = majCount * 2 > V; // 真正多数派（票数过半）
      for (let k = 1; k < sorted.length; k++) {
        const ch = sorted[k][0];
        const pairKey = [majority, ch].sort().join('|');
        const isVariant = VARIANT_SET.has(pairKey);
        let tag;
        if (isVariant) tag = 'variant';
        else if (overHalf) tag = 'suspect';       // 多数相同算正确，个别不同算错字
        else tag = 'uncertain';                    // 平票/不过半：异文待判，不自动判错
        const loc = locate(recs[0], off);
        offDiffs.push({
          off, majority, minority: ch, minorityCount: sorted[k][1],
          votes: majCount + '/' + (V - sorted[k][1]),
          tag, para: loc.para, charInPara: loc.charInPara, ctx: loc.ctx,
        });
      }
    }
  }
  return { type: 'char', offDiffs };
}

// ============================================================== 参数
function parseArgs(argv) {
  const o = { scope: 'all', phase: 'all', selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') o.selftest = true;
    else if (a === '--scope') o.scope = argv[++i];
    else if (a === '--phase') o.phase = argv[++i];
    else if (a === '--out') OUT = argv[++i];
  }
  return o;
}

// ============================================================== 自测
function selftest() {
  console.log('── 自测：合成 异体/错字 数据 ──');
  const recs = [
    { i: 1, a: '王维', t: '终南别业', d: '唐', p: ['中歲頗好道晚家南山陲', '興來每獨往勝事空自知', '行到水窮處坐看雲起時', '偶然值林叟談笑無還期'] },
    { i: 2, a: '王维', t: '終南別業', d: '唐', p: ['中歲頗好道晚家南山陲', '興來每獨往勝事空自知', '行到水窮處坐看云起時', '偶然值林叟談笑無還期'] }, // 雲→云 异体
    { i: 3, a: '王维', t: '终南别业', d: '唐', p: ['中歲頗好道晚家南山陲', '興來每獨往勝事空自知', '行到水窮處坐看雲起诗', '偶然值林叟談笑無還期'] }, // 時→诗 错字
  ];
  const grp = analyzeGroup(recs);
  console.log('类型:', grp.type, '差异数:', grp.offDiffs.length);
  for (const d of grp.offDiffs) {
    console.log(`  off=${d.off} ${d.majority}→${d.minority} [${d.tag}] 票${d.votes} 句${d.para + 1} 上下文「${d.ctx}」`);
  }
  const tags = grp.offDiffs.map(d => d.tag).sort().join(',');
  const ok = grp.offDiffs.length === 2 && tags === 'suspect,variant';
  console.log(ok ? '✓ 自测通过（异体+错字均正确判定）' : '✗ 自测失败');
  return ok ? 0 : 1;
}

// ============================================================== 主流程
function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('用法错误: ' + e.message); return 2; }
  if (opts.selftest) return selftest();
  if (!fs.existsSync(MANIFEST)) { console.error('manifest 不存在: ' + MANIFEST); return 2; }
  if (!fs.existsSync(POEMS)) { console.error('poems 目录不存在: ' + POEMS); return 2; }

  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const collMeta = new Map();
  for (const c of m.collections) collMeta.set(c.id, c);
  const collections = opts.scope === 'all'
    ? m.collections
    : m.collections.filter(c => opts.scope.split(',').includes(c.id));
  if (!collections.length) { console.error('scope 无匹配集合: ' + opts.scope); return 2; }

  // ---- meta 阶段 ----
  console.log(`── meta 阶段：集合 ${collections.length} 个 ──`);
  const entries = [];
  const bodyMap = new Map();
  const grpMap = new Map();
  let total = 0, shardRead = 0;
  for (const c of collections) {
    for (let ci = 0; ci < c.chunks.length; ci++) {
      const fn = c.id + '-' + String(ci).padStart(4, '0') + '.json';
      const fp = path.join(POEMS, fn);
      if (!fs.existsSync(fp)) continue;
      const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
      shardRead++;
      for (const r of arr) {
        const idx = entries.length;
        const raw = bodyRaw(r.p);
        const bh = cyrb53(raw);
        const grp = groupKey(r.a, r.p);
        entries.push({ i: r.i, coll: c.id, a: r.a || '', t: r.t || '', len: hanChars(r.p).length, fs: firstSentNorm(r.p), bh, grp });
        if (!bodyMap.has(bh)) bodyMap.set(bh, []);
        bodyMap.get(bh).push(idx);
        if (!grpMap.has(grp)) grpMap.set(grp, []);
        grpMap.get(grp).push(idx);
        total++;
      }
    }
    if (shardRead % 50 === 0) console.log(`  …已读 ${shardRead} 分片，条目 ${total}`);
  }
  console.log(`  meta 完成：条目 ${total}，分片 ${shardRead}`);

  // 完全重复
  const dupGroups = [];
  for (const [bh, idxs] of bodyMap) {
    if (idxs.length > 1) {
      dupGroups.push({
        bh,
        count: idxs.length,
        members: idxs.map(i => ({ i: entries[i].i, coll: entries[i].coll, a: entries[i].a, t: entries[i].t })),
      });
    }
  }
  // 近重复组（同组且 bodyHash 不全相同）
  const nearGroups = [];
  for (const [grp, idxs] of grpMap) {
    if (idxs.length > 1) {
      const bhs = new Set(idxs.map(i => entries[i].bh));
      if (bhs.size > 1) nearGroups.push(idxs.map(i => entries[i]));
    }
  }
  console.log(`  完全重复组：${dupGroups.length}（涉及 ${dupGroups.reduce((s, g) => s + g.count, 0)} 条）`);
  console.log(`  近重复组：${nearGroups.length}`);

  if (opts.phase === 'meta') {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, '_meta_summary.json'),
      JSON.stringify({ total, shardRead, dupGroups: dupGroups.length, nearGroups: nearGroups.length }, null, 2), 'utf8');
    console.log('  [meta] 已写 _meta_summary.json');
    return 0;
  }

  // ---- diff 阶段 ----
  console.log(`── diff 阶段：近重复组 ${nearGroups.length} ──`);
  const chunkCache = new Map();
  const recByI = new Map();
  function loadChunk(collId, ci) {
    const key = collId + '#' + ci;
    if (chunkCache.has(key)) return chunkCache.get(key);
    const c = collMeta.get(collId);
    const fn = c.id + '-' + String(ci).padStart(4, '0') + '.json';
    const arr = JSON.parse(fs.readFileSync(path.join(POEMS, fn), 'utf8'));
    chunkCache.set(key, arr);
    // 去重后集合内 i 可能不连续（留空槽），按真实 i 建索引，供 getRec 精确查表
    for (const r of arr) if (r && typeof r.i === 'number') recByI.set(r.i, r);
    return arr;
  }
  function getRec(i) {
    // 优先按真实 i 精确查表；去重后 i 有空洞且分片紧密存放，不能按 (i-start)%PER_CHUNK 取位
    if (recByI.has(i)) return recByI.get(i);
    for (const c of collections) {
      if (i >= c.start && i < c.start + c.count) {
        const ci = Math.floor((i - c.start) / PER_CHUNK);
        const arr = loadChunk(c.id, ci);
        const rec = arr.find(r => r.i === i);
        if (rec) return rec;
      }
    }
    return null;
  }

  const diffs = [];
  let variantCnt = 0, suspectCnt = 0, uncertainCnt = 0, structureCnt = 0;
  let g = 0;
  for (const members of nearGroups) {
    g++;
    if (g % 2000 === 0) console.log(`  …已分析 ${g}/${nearGroups.length} 组`);
    const recs = members.map(e => getRec(e.i)).filter(Boolean);
    if (recs.length < 2) continue;
    const analysis = analyzeGroup(recs);
    if (analysis.type === 'structure') {
      structureCnt++;
      diffs.push({
        grp: members[0].grp, type: 'structure', lenRange: analysis.lenRange, note: analysis.note,
        members: members.map(e => ({ i: e.i, coll: e.coll, a: e.a, t: e.t })),
      });
      continue;
    }
    if (!analysis.offDiffs.length) continue;
    for (const d of analysis.offDiffs) {
      if (d.tag === 'variant') variantCnt++;
      else if (d.tag === 'suspect') suspectCnt++;
      else uncertainCnt++;
    }
    diffs.push({
      grp: members[0].grp, type: 'char',
      members: members.map(e => ({ i: e.i, coll: e.coll, a: e.a, t: e.t })),
      offDiffs: analysis.offDiffs,
    });
  }

  // ---- 落盘 ----
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'duplicates.json'), JSON.stringify(dupGroups, null, 1), 'utf8');
  fs.writeFileSync(path.join(OUT, 'diffs.json'), JSON.stringify(diffs, null, 1), 'utf8');

  const summary = {
    generatedAt: new Date().toISOString(),
    scope: opts.scope,
    total, shardRead,
    dupGroups: dupGroups.length,
    dupInvolved: dupGroups.reduce((s, g) => s + g.count, 0),
    nearGroups: nearGroups.length,
    diffGroups: diffs.length,
    variantDiffs: variantCnt,
    suspectDiffs: suspectCnt,
    uncertainDiffs: uncertainCnt,
    structureGroups: structureCnt,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // 可读报告
  const md = [];
  md.push('# 主库正文排查报告\n');
  md.push(`- 生成时间：${summary.generatedAt}`);
  md.push(`- 范围：${summary.scope}（${summary.total} 条 / ${summary.shardRead} 分片）\n`);
  md.push('## 使用说明\n');
  md.push('- **完全重复（第一节）**：去空白换行后正文完全相同，可直接去重（每组保留一条即可）。');
  md.push('- **异体（第二节）**：纯异体字（字形异、字义同，如 雲/云、峯/峰、裏/里），建议保留其一，不需逐字改正。');
  md.push('- **疑似错字（第三节）**：仅在 ≥3 版本且某字明显占多数时，个别少数派字。请结合版本与资料复核后再逐字改正。');
  md.push('- **异文待判（第四节）**：2 版本平票或不过半的差异，多为版本异文（如 尊/樽、沽/酤、復/願），非错字，需人工/资料判定。');
  md.push('- **按集合定位**：duplicates.json / diffs.json 每条含 `coll`（集合 id）。诗歌类（tang300 / pdb_* / shijing / chuci 等）优先处理；史书类（ershisishi / zitongjian / jingbu）的「异文待判」多为专业校勘差异，建议单独流程。\n');
  md.push('## 统计\n');
  md.push('| 项目 | 数量 |');
  md.push('| --- | --- |');
  md.push(`| 完全重复组 | ${summary.dupGroups}（涉及 ${summary.dupInvolved} 条）|`);
  md.push(`| 近重复组 | ${summary.nearGroups} |`);
  md.push(`| 已分析差异组 | ${summary.diffGroups} |`);
  md.push(`| 异体字差异（variant） | ${summary.variantDiffs} 处 |`);
  md.push(`| 疑似错字（suspect，多数派少数） | ${summary.suspectDiffs} 处 |`);
  md.push(`| 异文待判（uncertain，平票/不过半） | ${summary.uncertainDiffs} 处 |`);
  md.push(`| 结构差异（增删，未逐字） | ${summary.structureGroups} 组 |\n`);
  md.push('> 判定规则：variant=纯异体字（字形异义同）；suspect=仅在 ≥3 版本且某字明显占多数时，个别少数派字（疑似错字）；uncertain=2 版本平票或不过半，多为版本异文，需人工/资料复核。\n');
  md.push('## 一、正文完全相同（可直接去重）\n');
  md.push('> 按「去空白换行后的正文」哈希碰撞。每组保留一条即可，其余去重。\n');
  dupGroups.slice(0, 30).forEach((g, k) => {
    md.push(`### ${k + 1}. ${g.members[0].a}《${g.members[0].t}》 ×${g.count}`);
    g.members.forEach(mm => md.push(`- i=${mm.i} [${mm.coll}]`));
  });
  if (dupGroups.length > 30) md.push(`\n… 其余 ${dupGroups.length - 30} 组见 duplicates.json`);
  md.push('\n## 二、异体字差异（variant，建议保留其一）\n');
  const variantGroups = diffs.filter(d => d.type === 'char' && d.offDiffs.some(x => x.tag === 'variant'));
  variantGroups.slice(0, 40).forEach((d, k) => {
    md.push(`### ${k + 1}. ${d.members[0].a}《${d.members[0].t}》`);
    d.offDiffs.filter(x => x.tag === 'variant').forEach(x => {
      md.push(`- 句${x.para + 1} 第${x.charInPara + 1}字：正「${x.majority}」/ 异「${x.minority}」 ×${x.minorityCount}（票${x.votes}） 　「…${x.ctx}…」`);
    });
    md.push(`  - 涉及：${d.members.map(mm => 'i=' + mm.i + '[' + mm.coll + ']').join('，')}`);
  });
  if (variantGroups.length > 40) md.push(`\n… 其余见 diffs.json`);
  md.push('\n## 三、疑似错字（suspect，需复核后逐字改）\n');
  const suspectGroups = diffs.filter(d => d.type === 'char' && d.offDiffs.some(x => x.tag === 'suspect'));
  suspectGroups.slice(0, 40).forEach((d, k) => {
    md.push(`### ${k + 1}. ${d.members[0].a}《${d.members[0].t}》`);
    d.offDiffs.filter(x => x.tag === 'suspect').forEach(x => {
      md.push(`- 句${x.para + 1} 第${x.charInPara + 1}字：多数「${x.majority}」/ 少数「${x.minority}」 ×${x.minorityCount}（票${x.votes}） 　「…${x.ctx}…」`);
    });
    md.push(`  - 涉及：${d.members.map(mm => 'i=' + mm.i + '[' + mm.coll + ']').join('，')}`);
  });
  if (suspectGroups.length > 40) md.push(`\n… 其余见 diffs.json`);
  md.push('\n## 四、异文待判（uncertain，平票/不过半，版本异文，不自动判错）\n');
  const uncertainGroups = diffs.filter(d => d.type === 'char' && d.offDiffs.some(x => x.tag === 'uncertain'));
  uncertainGroups.slice(0, 40).forEach((d, k) => {
    md.push(`### ${k + 1}. ${d.members[0].a}《${d.members[0].t}》`);
    d.offDiffs.filter(x => x.tag === 'uncertain').forEach(x => {
      md.push(`- 句${x.para + 1} 第${x.charInPara + 1}字：A「${x.majority}」/ B「${x.minority}」（票${x.votes}） 　「…${x.ctx}…」`);
    });
    md.push(`  - 涉及：${d.members.map(mm => 'i=' + mm.i + '[' + mm.coll + ']').join('，')}`);
  });
  if (uncertainGroups.length > 40) md.push(`\n… 其余见 diffs.json`);
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'), 'utf8');

  console.log('── 完成 ──');
  console.log(`  完全重复组 ${summary.dupGroups}（${summary.dupInvolved} 条）`);
  console.log(`  差异组 ${summary.diffGroups}：异体 ${summary.variantDiffs} / 错字 ${summary.suspectDiffs} / 异文待判 ${summary.uncertainDiffs} / 结构 ${summary.structureGroups}`);
  console.log(`  报告已落盘：${OUT}`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { analyzeGroup, cyrb53, groupKey, hanChars, VARIANT_SET };
