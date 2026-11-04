// EPUB 提取后处理脚本
// 过滤空壳条目(无正文、无赏析、无注释),重新计算 manifest,生成汇总报告
const fs = require('fs');
const path = require('path');

const OUT_DIR = 'C:/Users/xiang/Downloads/buchong';
const poemsDir = path.join(OUT_DIR, 'poems');
const authorsDir = path.join(OUT_DIR, 'authors');

// 读取 manifest
const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
const allAuthors = {};

console.log('=== 后处理:过滤空壳条目 ===\n');

const summary = [];
let totalWorks = 0;
let totalFiltered = 0;

for (const col of manifest) {
  const allWorks = [];
  let emptyCount = 0;
  let authorSet = new Set();

  for (const chunk of col.chunks) {
    const data = JSON.parse(fs.readFileSync(path.join(poemsDir, chunk), 'utf8'));
    for (const w of data) {
      const hasText = w.p && w.p.length > 0;
      const hasApp = w.f && w.f.s && w.f.s.length > 0;
      const hasAnn = w.f && w.f.z && w.f.z.length > 0;
      if (hasText || hasApp || hasAnn) {
        allWorks.push(w);
        if (w.a) authorSet.add(w.a);
      } else {
        emptyCount++;
      }
    }
  }

  // 重新分块写入
  const chunkSize = 200;
  const chunks = [];
  for (let i = 0; i < allWorks.length; i += chunkSize) {
    const chunkFile = `${col.id}-${String(Math.floor(i / chunkSize)).padStart(4, '0')}.json`;
    fs.writeFileSync(path.join(poemsDir, chunkFile), JSON.stringify(allWorks.slice(i, i + chunkSize), null, 2), 'utf8');
    chunks.push(chunkFile);
  }

  // 重新收集作者
  for (const w of allWorks) {
    if (w.a && !allAuthors[w.a]) allAuthors[w.a] = { name: w.a, desc: '' };
  }

  // 更新 manifest
  col.count = allWorks.length;
  col.visible = allWorks.length;
  col.chunks = chunks;

  // 统计
  let withText = 0, withApp = 0, withAnn = 0;
  for (const w of allWorks) {
    if (w.p && w.p.length > 0) withText++;
    if (w.f && w.f.s && w.f.s.length > 0) withApp++;
    if (w.f && w.f.z && w.f.z.length > 0) withAnn++;
  }
  const pctText = allWorks.length ? (withText / allWorks.length * 100).toFixed(1) : '0';
  const pctApp = allWorks.length ? (withApp / allWorks.length * 100).toFixed(1) : '0';
  const pctAnn = allWorks.length ? (withAnn / allWorks.length * 100).toFixed(1) : '0';

  totalWorks += allWorks.length;
  totalFiltered += emptyCount;

  summary.push({
    id: col.id, name: col.name, tab: col.tab,
    count: allWorks.length, withText, withApp, withAnn,
    pctText, pctApp, pctAnn, authors: authorSet.size
  });

  console.log(`${col.id.padEnd(20)} ${col.name}: ${allWorks.length} works (${emptyCount} filtered out)`);
  console.log(`  正文 ${pctText}% | 赏析 ${pctApp}% | 注释 ${pctAnn}% | 作者 ${authorSet.size}`);
}

// 更新作者
for (const col of manifest) {
  for (const chunk of col.chunks) {
    const data = JSON.parse(fs.readFileSync(path.join(poemsDir, chunk), 'utf8'));
    for (const w of data) {
      if (w.a && !allAuthors[w.a]) allAuthors[w.a] = { name: w.a, desc: '' };
    }
  }
}
const authorList = Object.values(allAuthors);
const authorChunkSize = 500;
for (let i = 0; i < authorList.length; i += authorChunkSize) {
  const chunkFile = `a-${String(Math.floor(i / authorChunkSize)).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(authorsDir, chunkFile), JSON.stringify(authorList.slice(i, i + authorChunkSize), null, 2), 'utf8');
}

// 写入 manifest
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// 生成汇总报告
const lines = [];
lines.push('# 中国文学鉴赏辞典大系 提取汇总');
lines.push('');
lines.push('> 提取时间:2026-10-28');
lines.push('> 数据源:`中国文学鉴赏辞典大系（套装共17部22册）` EPUB');
lines.push('> 输出目录:`C:\\Users\\xiang\\Downloads\\buchong\\`');
lines.push('> 格式:与 poetry-site 网站数据格式一致(poems/*.json + authors/*.json + manifest.json)');
lines.push('');
lines.push('## 一、总览');
lines.push('');
lines.push('| 集合 | 集合名 | 分类 | 作品数 | 有正文 | 有赏析 | 有注释 | 作者数 |');
lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
let gt = 0, gwt = 0, gwa = 0, gwa2 = 0;
for (const s of summary) {
  lines.push(`| ${s.id} | ${s.name} | ${s.tab} | ${s.count} | ${s.pctText}% | ${s.pctApp}% | ${s.pctAnn}% | ${s.authors} |`);
  gt += s.count;
  gwt += s.withText;
  gwa += s.withApp;
  gwa2 += s.withAnn;
}
lines.push(`| **合计** | - | - | **${gt}** | ${(gwt/gt*100).toFixed(1)}% | ${(gwa/gt*100).toFixed(1)}% | ${(gwa2/gt*100).toFixed(1)}% | ${authorList.length} |`);
lines.push('');
lines.push('## 二、字段说明');
lines.push('');
lines.push('每个作品条目字段(与 poetry-site 网站数据格式一致):');
lines.push('');
lines.push('- `i`:序号(全局连续)');
lines.push('- `t`:题名');
lines.push('- `a`:作者');
lines.push('- `d`:朝代推断');
lines.push('- `p`:段落数组(原文,每段一句/一行)');
lines.push('- `tg`:标签数组(留空)');
lines.push('- `f`:译注对象');
lines.push('  - `f.y`:正文(原文全文)');
lines.push('  - `f.z`:注释(仅 561 条有独立注释块)');
lines.push('  - `f.s`:赏析(鉴赏文章)');
lines.push('');
lines.push('## 三、数据质量说明');
lines.push('');
lines.push('### 正文覆盖率 76.6%(5928/7736)');
lines.push('');
lines.push('EPUB 原文结构为"标题+作者+正文+赏析",部分集合正文在 `kai_long`/`yinwen`/`yinwen-fs` 等 class 中,已被正确提取。以下集合正文覆盖率较低:');
lines.push('');
lines.push('| 集合 | 作品数 | 有正文 | 覆盖率 | 原因 |');
lines.push('| --- | ---: | ---: | ---: | --- |');
for (const s of summary.filter(s => s.count > 0 && parseFloat(s.pctText) < 50)) {
  const reason = s.id === 'yuanmingqing' || s.id === 'lidaifu' || s.id === 'nvxing' || s.id === 'mingqingxiaoshuo'
    ? '作者名与作品标题共用 `h3.center`,无法区分' : '结构特殊,需人工复核';
  lines.push(`| ${s.id} | ${s.count} | ${s.withText} | ${s.pctText}% | ${reason} |`);
}
lines.push('');
lines.push('### 注释覆盖率 7.3%(561/7736)');
lines.push('');
lines.push('EPUB 原文将注释融合在赏析文章中,不是独立字段。仅 `guwen` 古文鉴赏辞典(557 条)和少量其他集合有独立注释块。`f.z` 字段存储的是原文中以 `〔注〕`/`【注】` 标记的注释段落。');
lines.push('');
lines.push('### 赏析覆盖率 79.6%(6161/7736)');
lines.push('');
lines.push('赏析文章从 `normaltext`/`normaltext_top`/`normaltext1`/`left` 等 class 中提取。大部分作品都有赏析。');
lines.push('');
lines.push('## 四、文件结构');
lines.push('');
lines.push('```');
lines.push('buchong/');
lines.push('├── manifest.json          # 集合清单(17 部)');
lines.push('├── poems/');
lines.push('│   ├── tang300-0000.json  # 唐诗鉴赏辞典 (200 条/chunk)');
lines.push('│   ├── ...               # 每个集合按 200 条分片');
lines.push('│   └── xinshi-0001.json  # 新诗鉴赏辞典');
lines.push('└── authors/');
lines.push('    ├── a-000.json         # 作者索引 (500 条/chunk)');
lines.push('    └── a-003.json');
lines.push('```');
lines.push('');
lines.push('## 五、提取方法');
lines.push('');
lines.push('- 提取脚本:`C:\\Users\\xiang\\Downloads\\poetry-site\\extract_v7.cjs`(可复现)');
lines.push('- HTML 块解析器:只匹配块级标签(p/div/h1-h6),正确处理嵌套,内联标签内容当作文本');
lines.push('- 作品标题检测:`title-poem` class、`h3/h2.center`、`h3.calibre3/4`、`h4.calibre5`');
lines.push('- 正文检测:`kai_long`、`yinwen`、`yinwen-fs`、`yinwen-kt-c`、`yinwen-fs-n` 等');
lines.push('- 赏析检测:`normaltext`、`normaltext_top`、`normaltext1`、`left`(带【赏析】标记状态机)');
lines.push('- 作者检测:`h1.calibre1`、`h2.calibre3`、`p.right`/`p.center` 短文本、`shuming`/`shuming1`');
lines.push('- 经过 7 轮迭代,主要修复:contentEnd 用闭标签长度、CSS 选择器 vs HTML 字符串、词牌名误判、h3.center 歧义消解');

fs.writeFileSync(path.join(OUT_DIR, '提取汇总.md'), lines.join('\n'), 'utf8');

console.log(`\n=== 后处理完成 ===`);
console.log(`总作品: ${gt} (过滤空壳 ${totalFiltered} 条)`);
console.log(`总作者: ${authorList.length}`);
console.log(`输出: ${OUT_DIR}`);
