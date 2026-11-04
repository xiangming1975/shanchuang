// 第二轮增量注入: 把"未用集合里带注释/译文的中文诗词源"注入主库现有诗(只补缺)。
// 备份目录 anno-bak2/ 避免覆盖第一次 anno-bak/。
const fs = require('fs');
const MAIN = 'C:/Users/xiang/Downloads/poetry-site/site/data';
const SRC = 'C:/Users/xiang/Downloads/dataset_dedup';
const DRY = process.env.DRY === '1';
const BATCH = parseInt(process.env.BATCH || '400', 10);
const F = ['y', 'z', 's', 'b', 'o'];
const norm = s => ('' + (s || '')).replace(/[\s，。、？！；：“”‘’《》()（）.,?!;:\-]/g, '');
const pick = (a, b) => { if (!a) return b; if (!b) return a; return a.length >= b.length ? a : b; };
function hash(str){ let h=0x100000001b3n; for(let i=0;i<str.length;i++){ h^=BigInt(str.charCodeAt(i)); h=(h*0x100000001b3n)&0x1ffffffffffffn; } return h.toString(36); }
function gain_add(g, fl){ g[fl]++; }

const sm = JSON.parse(fs.readFileSync(SRC + '/manifest.json', 'utf8'));
const mm = JSON.parse(fs.readFileSync(MAIN + '/manifest.json', 'utf8'));
fs.mkdirSync(MAIN + '/anno-bak2', { recursive: true });
const srcById = Object.fromEntries(sm.collections.map(c => [c.id, c]));
// 未用且带中文注释/译文(y/z/s/b/o)的源
const SRC_IDS = ['s25_hf_orchestra','s21_sfw2099','s26_hf_papersnake','s24_openchinese',
  's36_ms_translation','s19_aopao','s31_kaggle_yololzw','s13_hf_zhtw','s06_joydraw2017',
  's18_shenyunhang','s11_hf_tang300','s08_hf_songs','s22_shewrote','s29_kaggle_songci',
  's01_chinese_poetry'];
const targets = mm.collections.map(c => c.id);
let srcChunks = [];
for (const id of SRC_IDS) { const c = srcById[id]; if (!c) continue; for (const ch of c.chunks) srcChunks.push({ id, ch }); }
console.error('源块总数: ' + srcChunks.length + ' | 每批 ' + BATCH + ' 块 | 源集合:' + SRC_IDS.length);

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
        if (!DRY) { const bak = MAIN + '/anno-bak2/' + ch; if (!fs.existsSync(bak)) fs.writeFileSync(bak, fs.readFileSync(fp)); fs.writeFileSync(fp, JSON.stringify(arr)); }
      }
    }
  }
  console.error('批次 ' + (++batchIdx) + '/' + Math.ceil(srcChunks.length / BATCH) + ' 完成 | 本批索引=' + built + ' | 累计可补 y:' + totalGain.y + ' z:' + totalGain.z + ' s:' + totalGain.s + ' b:' + totalGain.b + ' o:' + totalGain.o);
  map.clear();
}
console.error('总可补: y:' + totalGain.y + ' z:' + totalGain.z + ' s:' + totalGain.s + ' b:' + totalGain.b + ' o:' + totalGain.o);
for (const id of Object.keys(colGain)) { const g = colGain[id]; const sum = g.y+g.z+g.s+g.b+g.o;
  if (sum>0) console.error('  ' + id.padEnd(14) + ' y:'+g.y+' z:'+g.z+' s:'+g.s+' b:'+g.b+' o:'+g.o+' (合计'+sum+')'); }
console.error(DRY ? '【DRY-RUN 完成,未写盘】' : '【已写盘,备份在 anno-bak2/】');
