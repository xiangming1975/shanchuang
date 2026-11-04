// 富注释集 -> 主库现有诗 注入(只补缺)。分批流式,避免全量驻留内存。
// 单进程: 源按 BATCH 块一批批切,每批建小索引->扫全部主库集合->写盘->释放。
// DRY=1 仅统计。 BATCH=400 (默认)。 --max-old-space-size=4096 足够。
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const DRY = process.env.DRY === '1';
const BATCH = parseInt(process.env.BATCH || '400', 10);
const F = ['y', 'z', 's', 'b', 'o'];
const norm = s => ('' + (s || '')).replace(/[\s，。、？！；：“”‘’《》()（）.,?!;:\-]/g, '');
const pick = (a, b) => { if (!a) return b; if (!b) return a; return a.length >= b.length ? a : b; };
function hash(str){ let h=0x100000001b3n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001b3n)&0x1ffffffffffffn; } return h.toString(36); }

const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
fs.mkdirSync(MAIN + '/anno-bak', { recursive: true });
const srcById = Object.fromEntries(sm.collections.map(c => [c.id, c]));
const SRC_IDS = ['s02_cpp84','s03_cplibrary81','s23_guwendao','s42_gushici_xuanben',
  's39_gushiwen_wenyan','s40_gushiwen_yuanqu','s16_songci_notes','s37_ms_ai_translation',
  's20_tang300','s09_hf_matrixstudio','s52_yongwu','s17_yht_gushiwen',
  's41_gushiwen_mingju','s07_hf_appreciation','s45_gushici_tags',
  's43_gushiwen_shijing','s44_gushiwen_yuefu'];
const targets = mm.collections.map(c => c.id);

// 收集所有源块路径(扁平)
let srcChunks = [];
for (const id of SRC_IDS) { const c = srcById[id]; if (!c) continue; for (const ch of c.chunks) srcChunks.push({ id, ch }); }
console.error('源块总数: ' + srcChunks.length + ' | 每批 ' + BATCH + ' 块');

const totalGain = { y:0, z:0, s:0, b:0, o:0 };
const colGain = {};
let batchIdx = 0;
for (let start = 0; start < srcChunks.length; start += BATCH) {
  const slice = srcChunks.slice(start, start + BATCH);
  const map = new Map(); let built = 0;
  for (const { id, ch } of slice) {
    const arr = JSON.parse(fs.readFileSync(SRC + '/poems/' + ch, 'utf8'));
    for (const r of arr) {
      const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
      if (p.length < 6) continue;
      const f = r.f || {};
      const rec = { y: norm(f.y), z: norm(f.z), s: norm(f.s), b: norm(f.b), o: norm(f.o) };
      if (!(rec.y || rec.z || rec.s || rec.b || rec.o)) continue;
      const h = hash(p), pre = p.slice(0,12); const ex = map.get(h);
      if (ex) { if (ex.pre === pre) for (const fl of F) ex[fl] = pick(ex[fl], rec[fl]); }
      else { rec.pre = pre; map.set(h, rec); built++; }
    }
  }
  // 扫主库
  for (const id of targets) {
    const c = mm.collections.find(x => x.id === id);
    for (const ch of c.chunks) {
      const fp = MAIN + '/poems/' + ch;
      const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
      let fileChanged = false;
      for (const r of arr) {
        const p = norm(Array.isArray(r.p) ? r.p.join('') : ('' + r.p));
        if (p.length < 6) continue;
        const h = hash(p); const rec = map.get(h);
        if (!rec || rec.pre !== p.slice(0,12)) continue;
        const f = r.f || {}; let recChanged = false;
        for (const fl of F) { if (!f[fl] && rec[fl]) { f[fl] = rec[fl]; gain_add(totalGain, fl); colGain[id] = colGain[id] || {y:0,z:0,s:0,b:0,o:0}; colGain[id][fl]++; recChanged = true; } }
        if (recChanged) { r.f = f; fileChanged = true; }
      }
      if (fileChanged) {
        if (!DRY) { const bak = MAIN + '/anno-bak/' + ch; if (!fs.existsSync(bak)) fs.writeFileSync(bak, fs.readFileSync(fp)); fs.writeFileSync(fp, JSON.stringify(arr)); }
      }
    }
  }
  console.error('批次 ' + (++batchIdx) + '/' + Math.ceil(srcChunks.length / BATCH) + ' 完成 | 本批索引=' + built + ' | 累计可补 y:' + totalGain.y + ' z:' + totalGain.z + ' s:' + totalGain.s + ' b:' + totalGain.b + ' o:' + totalGain.o);
  // 释放
  map.clear();
}
function gain_add(g, fl){ g[fl]++; }
console.error('总可补: y:' + totalGain.y + ' z:' + totalGain.z + ' s:' + totalGain.s + ' b:' + totalGain.b + ' o:' + totalGain.o);
for (const id of Object.keys(colGain)) { const g = colGain[id]; const sum = g.y+g.z+g.s+g.b+g.o;
  if (sum>0) console.error('  ' + id.padEnd(14) + ' y:'+g.y+' z:'+g.z+' s:'+g.s+' b:'+g.b+' o:'+g.o+' (合计'+sum+')'); }
console.error(DRY ? '【DRY-RUN 完成,未写盘】' : '【已写盘,备份在 anno-bak/】');
