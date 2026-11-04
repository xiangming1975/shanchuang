// 第八轮修正：派生索引统一清洗（2026-11-01）
// ① ft 57 片：去 null 槽位、已删 id 行重定向到保留正文（id/题/作者改权威值）、片内按 id 去重、index.json 计数改正
// ② names：按当前库全量重建（7 片，排除 hide 30 条，与旧口径一致）
// ③ fast.json：同格式行清洗（重定向+去重）
// ④ tags.json / mingju.json / hot.json / dyn.json+分片 / genre.json：已删 id 重定向 + 去重
// ⑤ manifest.v bump（客户端 IDB 缓存一次性失效——names/ft 内容真的变了，必须让旧缓存退役）
// 幂等：重跑无副作用（无 stale 行时全部原样写回）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const DATA = path.join(__dirname, '..', 'site', 'data');
// 明文优先；gz 化后明文可能被移走，回退读同名 .json.gz（离线脚本不依赖明文存在）
const read = p => {
  const full = path.join(DATA, p);
  if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  const gz = full + '.gz';
  if (fs.existsSync(gz)) return zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  throw new Error('缺文件（明文/gz 均无）: ' + p);
};
const readJ = p => JSON.parse(read(p));
const write = (p, s) => fs.writeFileSync(path.join(DATA, p), s);

const M = readJ('manifest.json');
const cols = M.collections;
const colById = new Map(cols.map(c => [c.id, c]));
const remap = readJ('dedup-remap.json').map || {};
const remapKeys = new Set(Object.keys(remap));
const ridOf = id => { const s = String(id); return remapKeys.has(s) ? remap[s] : id; };

// ---------- Pass 1: 全库扫一遍，拿权威 {i,t,a,d,tg,hide} 与 hide 集合 ----------
console.log('Pass 1: 扫描全库记录…');
const recs = new Map();   // i -> {i,t,a,d,tg}
const hideSet = new Set();
for (const c of cols) {
  for (const cf of c.chunks) {
    let arr;
    try { arr = JSON.parse(read('poems/' + cf)); } catch (e) { console.log('  分块解析失败:', cf, e.message); continue; }
    for (const r of arr) {
      recs.set(r.i, { i: r.i, t: r.t || '', a: r.a || '', d: r.d || '', tg: Array.isArray(r.tg) ? r.tg : [] });
      if (r.hide) hideSet.add(r.i);
    }
  }
}
console.log('  记录:', recs.size, 'hide:', hideSet.size);
const inLib = i => recs.has(i);
const stats = { ftNulls: 0, ftRemapped: 0, ftDropped: 0, ftDupInShard: 0, namesLines: 0, fastRemapped: 0, tagsCollapsed: 0, mjRemapped: 0, mjMerged: 0, hotMerged: 0, dynRemapped: 0, genreRemapped: 0 };

// ---------- ② names 全量重建（排除 hide，7 片均分） ----------
console.log('Pass 2: 重建 names 索引…');
{
  const nidx = readJ('idx/names/index.json');
  const partIds = nidx.parts.map(p => p.id);
  const sane = s => String(s || '').replace(/[\n\r\t]+/g, ' ').trim();   // 91 条二十四史卷题内嵌换行，会撑破行格式
  const lines = [];
  for (const c of cols) {
    for (const cf of c.chunks) {
      let arr; try { arr = JSON.parse(read('poems/' + cf)); } catch { continue; }
      for (const r of arr) {
        if (r.hide) continue;
        lines.push(r.i + '\t' + sane(r.t) + '\t' + sane(r.a));
      }
    }
  }
  const NP = partIds.length;
  const per = Math.ceil(lines.length / NP);
  let total = 0;
  nidx.parts = partIds.map((pid, k) => {
    const seg = lines.slice(k * per, (k + 1) * per).map(l => l + '\n').join('');
    write('idx/names/' + pid + '.json', seg);
    total += seg ? seg.split('\n').length - 1 : 0;
    return { id: pid, n: seg ? seg.split('\n').length - 1 : 0, b: Buffer.byteLength(seg) };
  });
  nidx.total = total;
  write('idx/names/index.json', JSON.stringify(nidx));
  stats.namesLines = total;
  console.log('  names 重写:', total, '行 /', NP, '片');
}

// ---------- ① ft 分片清洗 ----------
console.log('Pass 3: 清洗 ft 分片…');
{
  const fidx = readJ('idx/ft/index.json');
  let total = 0;
  for (const o of fidx.order) {
    const fp = 'idx/ft/' + o.id + '.json';
    let arr;
    try { arr = JSON.parse(read(fp)); } catch (e) { console.log('  分片解析失败:', o.id, e.message); continue; }
    const rows = [];
    const seen = new Set();
    for (const row of arr) {
      if (row == null) { stats.ftNulls++; continue; }
      let id = row[0];
      if (remapKeys.has(String(id))) {
        const rec = recs.get(remap[id]);
        if (!rec) { stats.ftDropped++; continue; }           // remap 目标竟不在库（理论不可能）
        rows.push([rec.i, rec.t, rec.a, row[3]]);
        stats.ftRemapped++;
      } else if (!inLib(id)) {
        stats.ftDropped++;                                    // 无主行，丢弃
        continue;
      } else {
        rows.push(row);
      }
    }
    // 片内按 id 去重（保首条）
    const out = [];
    for (const row of rows) {
      if (seen.has(row[0])) { stats.ftDupInShard++; continue; }
      seen.add(row[0]);
      out.push(row);
    }
    write(fp, JSON.stringify(out));
    o.n = out.length;
    total += out.length;
  }
  fidx.total = total;
  write('idx/ft/index.json', JSON.stringify(fidx));
  console.log('  ft: null 去除', stats.ftNulls, '/ 重定向', stats.ftRemapped, '/ 丢弃', stats.ftDropped, '/ 片内去重', stats.ftDupInShard, '/ 真实行', total);
}

// ---------- ③ fast.json 行清洗 ----------
console.log('Pass 4: 清洗 fast.json…');
{
  const txt = read('idx/fast.json');
  const lines = txt.split('\n');
  const sane = s => String(s || '').replace(/[\n\r\t]+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab + 1);
    const id = parseInt(line.slice(0, tab), 10);
    if (!Number.isFinite(id) || tab2 < 0) continue;
    const rid = ridOf(id);
    if (seen.has(rid)) continue;
    seen.add(rid);
    if (rid !== id) {
      const rec = recs.get(rid);
      if (!rec) continue;
      out.push(rec.i + '\t' + sane(rec.t) + '\t' + sane(rec.a));
      stats.fastRemapped++;
    } else {
      // 原行重建：顺带净化内嵌换行/制表符（与 names 同口径）
      out.push(id + '\t' + sane(line.slice(tab + 1, tab2)) + '\t' + sane(line.slice(tab2 + 1)));
    }
  }
  write('idx/fast.json', out.map(l => l + '\n').join(''));
  console.log('  fast: 重定向', stats.fastRemapped, '/ 行数', out.length);
}

// ---------- ④ tags.json ----------
console.log('Pass 5: 清洗 tags.json…');
{
  const tags = readJ('idx/tags.json');
  for (const k of Object.keys(tags.k)) {
    const e = tags.k[k];
    const ids = e[1];
    const seen = new Set();
    const out = [];
    for (const id of ids) {
      const rid = ridOf(id);
      if (!inLib(rid)) continue;
      if (seen.has(rid)) { stats.tagsCollapsed++; continue; }
      seen.add(rid);
      out.push(rid);
    }
    e[1] = out;
  }
  write('idx/tags.json', JSON.stringify(tags));
  console.log('  tags: 塌缩去重', stats.tagsCollapsed);
}

// ---------- ⑤ mingju.json ----------
console.log('Pass 6: 清洗 mingju.json…');
{
  const mj = readJ('idx/mingju.json');
  const seen = new Set();
  const out = [];
  for (let mi = 0; mi < mj.length; mi++) {
    let row = mj[mi];
    const id = row[3];
    if (remapKeys.has(String(id))) {
      const rec = recs.get(remap[id]);
      if (!rec) { stats.mjMerged++; continue; }
      const col = colById.get(colIdOfRec(rec.i));
      row = [row[0], rec.a, rec.t, rec.i, rec.d, col ? col.name : row[5], rec.tg];
      stats.mjRemapped++;
    } else if (!inLib(id)) { stats.mjMerged++; continue; }
    const key = row[3] + '|' + row[0];
    if (seen.has(key)) { stats.mjMerged++; continue; }   // 同诗同句只留一条
    seen.add(key);
    out.push(row);
  }
  write('idx/mingju.json', JSON.stringify(out));
  console.log('  mingju: 重定向', stats.mjRemapped, '/ 合并丢弃', stats.mjMerged, '/ 余', out.length);
}
function colIdOfRec(i) {
  // 线性找集合（记录量小，无所谓）；按 manifest 顺序 start 升序
  for (const c of cols) if (i >= c.start && i < c.start + (c.span != null ? c.span : c.count)) return c.id;
  return '';
}

// ---------- ⑥ hot.json ----------
console.log('Pass 7: 清洗 hot.json…');
{
  const hot = readJ('idx/hot.json');
  const rows = Array.isArray(hot) ? hot : hot.rows;
  const byId = new Map();
  for (const r of rows) {
    const rid = ridOf(r.i);
    const rec = recs.get(rid);
    if (!rec) continue;
    const prev = byId.get(rid);
    if (!prev) byId.set(rid, { i: rid, t: rec.t, a: rec.a, h: r.h || 0 });
    else { prev.h = Math.max(prev.h, r.h || 0); stats.hotMerged++; }
  }
  const out = [...byId.values()].sort((a, b) => b.h - a.h);
  if (Array.isArray(hot)) { write('idx/hot.json', JSON.stringify(out)); }
  else { hot.rows = out; write('idx/hot.json', JSON.stringify(hot)); }
  console.log('  hot: 合并', stats.hotMerged, '/ 余', out.length);
}

// ---------- ⑦ dyn.json + dyn 分片 ----------
console.log('Pass 8: 清洗 dyn 索引…');
{
  const dyn = readJ('idx/dyn.json');
  for (const row of dyn.rows) {
    let total = 0;
    row.chunks = row.chunks.map(cp => {
      const arr = readJ('idx/' + cp);   // dyn.json 里的路径相对 idx/（getDynChunk 同款拼接）
      const seen = new Set();
      const out = [];
      for (const id of arr) {
        const rid = ridOf(id);
        if (!inLib(rid)) continue;
        if (seen.has(rid)) { stats.dynRemapped++; continue; }
        seen.add(rid);
        out.push(rid);
      }
      write('idx/' + cp, JSON.stringify(out));
      total += out.length;
      return cp;
    });
    row.c = total;
  }
  write('idx/dyn.json', JSON.stringify(dyn));
  console.log('  dyn: 去重/重定向', stats.dynRemapped);
}

// ---------- ⑧ genre.json（top id 重定向；n 口径不动） ----------
console.log('Pass 9: 清洗 genre.json…');
{
  const g = readJ('idx/genre.json');
  for (const k of Object.keys(g.m)) {
    const e = g.m[k];
    if (!Array.isArray(e.top)) continue;
    const seen = new Set();
    const out = [];
    for (const id of e.top) {
      const rid = ridOf(id);
      if (!inLib(rid) || seen.has(rid)) { stats.genreRemapped++; continue; }
      seen.add(rid);
      out.push(rid);
    }
    e.top = out;
  }
  write('idx/genre.json', JSON.stringify(g));
  console.log('  genre: 清理', stats.genreRemapped);
}

// ---------- ⑨ manifest.v bump（让客户端 IDB 里旧的 names/ft/tags 缓存退役） ----------
{
  const old = M.v;
  M.v = Date.now();
  write('manifest.json', JSON.stringify(M, null, 1));
  console.log('manifest.v:', old, '→', M.v);
}
console.log('=== 完成 ===');
console.log(JSON.stringify(stats, null, 1));
