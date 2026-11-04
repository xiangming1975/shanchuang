const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
// 两边语料均为简体, 跳过 opencc(逐字转换在94万条+通鉴整卷上极慢); 仅做标点/大小写归一
let convT2S = (s) => s;
const PUNCT = /[\s，。、；：？！“”‘’（）《》〈〉<>\[\]【】…—·~`!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>/\?]/g;
function norm(s) { let o = ''; for (const ch of String(s || '')) o += convT2S(ch); return o.replace(PUNCT, '').toLowerCase(); }

// ---- main lib zitongjian ----
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const zt = mm.collections.find(c => c.id === 'zitongjian');
const juanList = [];
for (const ch of zt.chunks) {
  const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    const raw = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    juanList.push({ i: r.i, t: r.t, text: norm(raw) });
  }
}
console.error('main lib 通鉴卷数:', juanList.length);

// ---- s33 通鉴 白话句 ----
const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const s33 = sm.collections.find(c => c.id === 's33_hf_tri');
const ztSent = [];
for (const ch of s33.chunks) {
  const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    const src = ('' + (r.t || '')) + ('' + (r.o || ''));
    const p = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    if (/资治通鉴|資治通鑑/.test(src) && p.length >= 4) {
      ztSent.push({ w: norm(p), b: (r.f && r.f.y) ? r.f.y : '' });
    }
  }
}
console.error('s33 通鉴白话句:', ztSent.length);

// ---- align: 子串法 (s33 通鉴句 嵌于 主库通鉴大块正文); 仅抽样2卷做质量预览 ----
const SAMPLE = juanList.slice(0, 2);
const out = [];
let juanWith = 0, totalMatched = 0;
const CAP = 200;
for (const j of SAMPLE) {
  const seen = new Set();
  const pairs = [];
  for (const s of ztSent) {
    if (s.w.length < 4) continue;
    if (j.text.includes(s.w) && !seen.has(s.w)) { seen.add(s.w); pairs.push({ wenyan: s.w, baihua: s.b }); if (pairs.length >= CAP) break; }
  }
  if (pairs.length) { juanWith++; totalMatched += pairs.length; out.push({ i: j.i, t: j.t, pairs }); }
}
const preview = {
  generated: new Date().toISOString(),
  method: 's33 通鉴白话句(norm) 子串贴回主库通鉴各卷(norm); 抽样2卷质量预览; 无opencc(两边均简体)',
  note: '子串法可命中(同书异版/异断句); 精确句匹配在主库=0(版本/标点不同). 全库294卷需 Aho-Corasick 加速',
  mainJuanTotal: juanList.length,
  sampleJuanCount: SAMPLE.length,
  juanWithBaihua: juanWith,
  juanCoveragePctInSample: +(100 * juanWith / SAMPLE.length).toFixed(1),
  totalMatchedSentencesInSample: totalMatched,
  s33ZTSentences: ztSent.length,
  samples: out.slice(0, 4).map(j => ({ i: j.i, t: j.t, pairs: j.pairs.slice(0, 8) }))
};
fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/preview_zt_alignment.json', JSON.stringify(preview, null, 1));
console.log('=== 通鉴对齐预览结果 ===');
console.log('主库通鉴卷数:', preview.mainJuanTotal);
console.log('获得白话的卷:', preview.juanWithBaihua, '(' + preview.juanCoveragePct + '%)');
console.log('匹配白话句总数:', preview.totalMatchedSentences, ' / s33通鉴句:', preview.s33ZTSentences);
console.log('--- 样例(前4卷, 每卷前4句) ---');
for (const j of preview.samples) {
  console.log('卷 i=' + j.i + ' | ' + j.t);
  for (const p of j.pairs) console.log('   ' + p.wenyan + '  →  ' + p.baihua);
}
console.log('\n完整预览已写入: preview_zt_alignment.json');
