// 通鉴白话写回主库 (A方案: f.y = 整卷拼接白话译文)
// 主库只读此前针对 dedup; 此处为授权的通鉴译文补齐, 先备份再写.
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const TS = new Date().toISOString().replace(/[:.]/g, '-');

const PUNCT = /[\s，。、；：？！“”‘’（）《》〈〉<>\[\]【】…—·~`!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>/\?]/g;
const norm = (s) => ('' + (s || '')).replace(PUNCT, '').toLowerCase();
const MIN_LEN = 8; // 仅取较长句, 减少跨卷误匹配

const t0 = Date.now();
const log = (...a) => { console.error('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's]', ...a); };

// ---------- 1. 读 s33, 建 通鉴 白话模式 + 4字前缀分桶 ----------
log('读取 s33 通鉴白话...');
const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const s33 = sm.collections.find(c => c.id === 's33_hf_tri');
const ztRe = /资治通鉴|資治通鑑/;
const patMap = new Map();   // norm句 -> baihua (去重, 保留首见)
const pats = [];            // 全局顺序
const bhs = [];             // 并行 baihua
let s33Total = 0, ztRaw = 0;
for (const ch of s33.chunks) {
  const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    s33Total++;
    const src = ('' + (r.t || '')) + ('' + (r.o || ''));
    if (!ztRe.test(src)) continue;
    const p = Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || ''));
    const w = norm(p);
    if (w.length < MIN_LEN) continue;
    ztRaw++;
    if (!patMap.has(w)) {
      const b = (r.f && r.f.y) ? ('' + r.f.y).trim() : '';
      patMap.set(w, b);
      pats.push(w);
      bhs.push(b);
    }
  }
}
log('s33 总记录', s33Total, '| 通鉴句(去重后)', pats.length);

// 4字前缀分桶
const bucket = new Map();
for (let i = 0; i < pats.length; i++) {
  const k = pats[i].substr(0, 4);
  let l = bucket.get(k);
  if (!l) { l = []; bucket.set(k, l); }
  l.push(i);
}
log('分桶完成, 桶数', bucket.size);

// ---------- 2. 读主库通鉴分块, 逐卷匹配 ----------
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
const zt = mm.collections.find(c => c.id === 'zitongjian');
log('主库通鉴分块', zt.chunks.join(','), '| 记录', zt.count);

const idToBaihua = new Map();
let volWith = 0, totalSent = 0, totalChars = 0;
for (const ch of zt.chunks) {
  const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    const T = norm(Array.isArray(r.p) ? r.p.join('') : ('' + (r.p || '')));
    const seen = new Set();
    for (let i = 0; i < T.length; i++) {
      const list = bucket.get(T.substr(i, 4));
      if (!list) continue;
      for (const c of list) {
        if (seen.has(c)) continue;
        if (T.startsWith(pats[c], i)) seen.add(c);
      }
    }
    if (seen.size) {
      const idx = [...seen].sort((a, b) => a - b);
      const y = idx.map(i => bhs[i]).join('');
      if (y) { idToBaihua.set(r.i, y); volWith++; totalSent += idx.length; totalChars += y.length; }
    }
  }
}
log('匹配完成: 获白话卷', volWith, '/', zt.count,
    '| 匹配句', totalSent, '| 白话字符', totalChars,
    '| 覆盖率', (100 * volWith / zt.count).toFixed(1) + '%');

// ---------- 3. 备份 + 写回 ----------
// 清掉上次失败残留的 .new (若有)
for (const ch of zt.chunks) {
  const stale = MAIN + '/poems/' + ch + '.new';
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}
const bakDir = MAIN + '/zt-writeback-bak/' + TS;
fs.mkdirSync(bakDir, { recursive: true });
for (const ch of zt.chunks) {
  fs.copyFileSync(MAIN + '/poems/' + ch, bakDir + '/' + ch);
}
log('备份至', bakDir);

let applied = 0;
for (const ch of zt.chunks) {
  const fp = MAIN + '/poems/' + ch;
  const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const r of arr) {
    const y = idToBaihua.get(r.i);
    if (y) {
      r.f = r.f || {};
      r.f.y = y;
      applied++;
    }
  }
  fs.writeFileSync(fp, JSON.stringify(arr));
}
log('写回完成, 应用记录', applied);

// ---------- 4. 校验 ----------
let ok = 0, miss = 0;
for (const ch of zt.chunks) {
  const arr = JSON.parse(fs.readFileSync(MAIN + '/poems/' + ch, 'utf8'));
  for (const r of arr) {
    if (idToBaihua.has(r.i)) {
      if (r.f && r.f.y && r.f.y.length) ok++; else miss++;
    }
  }
}
log('校验: 应有', idToBaihua.size, '| 实际有 f.y', ok, '| 缺失', miss);

const report = {
  generated: new Date().toISOString(),
  plan: 'A: f.y = 整卷拼接白话译文 (子串贴回, 4字前缀分桶加速, 句长>=8)',
  s33TotalRecords: s33Total,
  ztSentencesDedup: pats.length,
  mainJuanTotal: zt.count,
  juanWithBaihua: volWith,
  coveragePct: +(100 * volWith / zt.count).toFixed(1),
  matchedSentences: totalSent,
  baihuaChars: totalChars,
  appliedRecords: applied,
  verifyOk: ok,
  verifyMiss: miss,
  backupDir: bakDir.replace(MAIN, 'site/data')
};
fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/zt_writeback_report.json', JSON.stringify(report, null, 1));
log('报告写入 zt_writeback_report.json');
console.log(JSON.stringify(report, null, 1));
