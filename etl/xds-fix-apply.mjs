// 近现代诗词集（xdS）逐首校勘 —— 落地执行
// 1) downloads/gushiwen.jsonl（745MB）：按字节偏移就地改写（替换全部等长，偏移不失效）
// 2) etl/out/poems-ingest.jsonl：替换 + 删除混入正文的异文校记
// 3) 随后重跑 etl/build.js 重建站点全部索引
import fs from 'fs';
import path from 'path';

const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'etl/xds-fix.json'), 'utf8')).items;
const DRY = process.argv.includes('--dry');

const byTitle = new Map();
for (const it of FIX) {
  const k = '"nameStr": "' + it.t + '"';
  if (!byTitle.has(k)) byTitle.set(k, []);
  byTitle.get(k).push(it);
}

// ---------- 1) 原始抓取文件：分块就地等长替换 ----------
function patchRaw(file) {
  const CH = 8 << 20;
  const fd = fs.openSync(file, DRY ? 'r' : 'r+');
  const size = fs.fstatSync(fd).size;
  let pos = 0, carry = Buffer.alloc(0), carryStart = 0;
  const done = new Map(); // title -> 行数
  while (pos < size) {
    const len = Math.min(CH, size - pos);
    const chunk = Buffer.alloc(len);
    fs.readSync(fd, chunk, 0, len, pos);
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const lastNl = buf.lastIndexOf(0x0A);
    const upto = lastNl >= 0 ? lastNl + 1 : 0;
    const block = Buffer.from(buf.subarray(0, upto));
    // 逐行处理（行等长替换，可直接改写块内字节）
    let ls = 0;
    while (ls < block.length) {
      let le = block.indexOf(0x0A, ls);
      if (le < 0) le = block.length; else le += 1;
      const lineBuf = block.subarray(ls, le);
      if (lineBuf.length > 60) {
        const line = lineBuf.toString('utf8');
        for (const [sig, items] of byTitle) {
          if (!line.includes(sig)) continue;
          for (const it of items) {
            if (it.subs && it.subs.length && !it.subs.some(([a]) => line.includes(a))) continue;
            // 同标题多首时，用正文指纹再筛一次
            for (const [a, b] of it.subs || []) {
              if (a.length !== b.length) throw new Error('非等长替换不能用于 raw: ' + a + '→' + b);
              let idx2 = 0, n = 0;
              const ab = Buffer.from(a), bb = Buffer.from(b);
              while ((idx2 = lineBuf.indexOf(ab, idx2)) >= 0) {
                bb.copy(block, ls + idx2);
                idx2 += ab.length; n++;
              }
              if (n) done.set(it.t, (done.get(it.t) || 0) + n);
            }
          }
        }
      }
      ls = le;
    }
    if (!DRY) fs.writeSync(fd, block, 0, block.length, carryStart);
    carryStart += upto;
    carry = Buffer.from(buf.subarray(upto));
    pos += len;
  }
  fs.closeSync(fd);
  return done;
}

// ---------- 2) ingest 产物：替换 + 删异文注 ----------
function patchIngest(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const done = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const it = FIX.find(x => x.t === o.t && (x.c || 'xdS') === (o.c || 'xdS'));
    if (!it) continue;
    const before = JSON.stringify(o);
    const origT = o.t;
    const mapAll = (fn) => {
      if (o.t) o.t = fn(o.t);
      if (o.a) o.a = fn(o.a);
      if (Array.isArray(o.p)) o.p = o.p.map(fn);
      if (o.f) for (const k of Object.keys(o.f)) o.f[k] = fn(o.f[k]);
    };
    for (const [a, b] of it.subs || []) mapAll(s => s.split(a).join(b));
    for (const n of it.delNotes || []) mapAll(s => s.split(n).join(''));
    const after = JSON.stringify(o);
    if (after !== before) {
      lines[i] = after;
      done.set(origT, (done.get(origT) || 0) + 1);
    }
  }
  if (!DRY) fs.writeFileSync(file, lines.join('\n'));
  return done;
}

console.log('DRY=' + DRY);
const rawDone = patchRaw(path.join(ROOT, 'downloads/gushiwen.jsonl'));
console.log(`raw：命中 ${rawDone.size} 首`);
const ingDone = patchIngest(path.join(ROOT, 'etl/out/poems-ingest.jsonl'));
console.log(`ingest：命中 ${ingDone.size} 首`);

for (const it of FIX) {
  const a = rawDone.get(it.t) || 0, b = ingDone.get(it.t) || 0;
  const flag = (!a || !b) ? '  <<< 未全部命中' : '';
  console.log(`${it.t}  raw=${a} ingest=${b}${flag}`);
}
