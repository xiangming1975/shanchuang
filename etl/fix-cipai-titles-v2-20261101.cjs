// 词牌标题修正 v2（全库）：
// 0) 回滚 pdb_songci 第一遍的 188 条误伤（原题已带 ·，被插成双 ·）
// 1) 全库扫描修正，新防线：
//    ① 【 开头（元曲宫调套数约定）整类不动
//    ② P 黑名单（双调/中吕/南吕/仙吕/正宫/黄钟/越调/商调/般涉/同前/歇指/大石/小石——宫调名与「同前」混进词牌清单）
//    ③ rest 去掉起始分隔符后仍含 ·・•‧ → 已结构化（别名·正名 / 组诗N首·其N），不动
//    ④ rest[0] ∈ 复合题后缀 {慢令引近遍犯叠弄拍词曲歌篇辞影序煞} → 不动
//    ⑤ 胶着（直接接字）只在词曲类集合修；诗/赋/文全集只修空格分隔（防「南浦别」「虞美人草」类诗题误伤）
//    ⑥ rest 以 ASCII 点 . ．开头视同分隔符（"念奴娇.追思焦裕禄"）
//    空格/点分隔在全部集合统一为 ·
// 同步 names/ft/mingju/hot + manifest.v bump。幂等。
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'site', 'data');
const BACKUP = path.join(__dirname, '..', 'backup-titlefix-20261101');
const read = p => fs.readFileSync(path.join(DATA, p), 'utf8');
const readJ = p => JSON.parse(read(p));
const write = (p, s) => fs.writeFileSync(path.join(DATA, p), s);

const M = readJ('manifest.json');
const cols = M.collections;
const colById = new Map(cols.map(c => [c.id, c]));
const cp = readJ('idx/cipai.json');
const g = readJ('idx/genre.json');
const cipSet = new Set();
for (const c of cp) if (c.n) cipSet.add(String(c.n).replace(/[·・•‧\s　]/g, ''));
for (const k of Object.keys(g.m)) if (k.startsWith('词·')) cipSet.add(k.slice(2));
const cipais = [...cipSet].filter(s => s.length >= 2).sort((a, b) => b.length - a.length);
const SUFFIX = new Set(['慢', '令', '引', '近', '遍', '犯', '叠', '弄', '拍', '词', '曲', '歌', '篇', '辞', '影', '序', '煞']);
const BLOCK_P = new Set(['双调', '中吕', '南吕', '仙吕', '正宫', '黄钟', '越调', '商调', '般涉', '同前', '歇指', '大石', '小石']);
const BLOCK_T = new Set(['虞美人草']);   // 咏物诗题（虞美人草=植物），与词牌同名的整题保护
// 胶着只在这些词曲类集合修（诗/赋/文全集的词牌同名诗题风险高，只修空格分隔）
const GLUE_OK = new Set(['songci', 'songci300', 'hjj', 'nt', 'nalan', 'yq', 'jssci', 'pdb_songci', 'pdb_songci300', 'pdb_yuan',
  'pdb_song', 'pdb_qing', 'pdb_ming', 'pdb_other', 'pdb_pre', 'pdb_mod', 'pdb_guwen',
  'qingS', 'mingS', 'jinyuan', 'qingS_new', 'song_new', 'mingS_new', 'jinyuan_new', 'xdS', 'xdS_new', 'other']);
const sane = s => String(s || '').replace(/[\n\r\t]+/g, ' ').trim();

function fixTitle(t, glueOk) {
  if (!t || t.startsWith('【') || BLOCK_T.has(t)) return null;     // ①
  const norm = String(t).replace(/[·・•‧\s　]+/g, '');
  if (!norm || cipSet.has(norm)) return null;
  let P = null;
  for (const cip of cipais) if (norm.length > cip.length && norm.startsWith(cip)) { P = cip; break; }
  if (!P || BLOCK_P.has(P) || !t.startsWith(P)) return null;      // ②
  let rest = t.slice(P.length);
  if (!rest.trim()) return null;
  const hadSep = /^[·・•‧]/.test(rest);
  rest = rest.replace(/^[·・•‧.．\s　]+/, '');                     // ⑥ 统一吞掉起始分隔（含 ASCII 点）
  if (!rest) return null;
  if (/[·・•‧]/.test(rest)) return null;                           // ③ 内部还有分隔 → 已结构化
  if (SUFFIX.has(rest[0]) || cipSet.has(P + rest[0]) || cipSet.has(P + rest.slice(0, 2))) return null;  // ④
  if (hadSep || /^[\s　.．]/.test(t.slice(P.length))) return P + '·' + rest;  // 原有分隔/空格/点 → 规范为 ·（全集合）
  if (!glueOk) return null;                                        // ⑤ 胶着仅词曲类集合
  return P + '·' + rest;
}

// ---------- Pass 0: 回滚 pdb_songci 误伤 ----------
const revertList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'audit-out', 'revert-list.json'), 'utf8'));
const revertMap = new Map(revertList);
{
  let done = 0;
  for (const cf of colById.get('pdb_songci').chunks) {
    const bfp = path.join(BACKUP, 'poems', cf);
    if (!fs.existsSync(bfp)) continue;
    const orig = JSON.parse(fs.readFileSync(bfp, 'utf8'));
    let touched = false;
    for (const r of orig) {
      if (revertMap.has(r.i) && r.t === revertMap.get(r.i)) {
        const arr = JSON.parse(read('poems/' + cf));
        const rec = arr.find(x => x.i === r.i);
        if (rec && rec.t !== r.t) { rec.t = r.t; touched = true; done++; }
        if (touched) write('poems/' + cf, JSON.stringify(arr));
        touched = false;
      }
    }
  }
  console.log('Pass 0 回滚误伤:', done, '条');
}

// ---------- Pass 1: 全库扫描 + 修正 ----------
const changes = new Map();   // i -> {t: newTitle, cid}
for (const c of cols) {
  const glueOk = GLUE_OK.has(c.id);
  for (const cf of c.chunks) {
    let arr; try { arr = JSON.parse(read('poems/' + cf)); } catch { continue; }
    for (const r of arr) {
      const nt = fixTitle(r.t || '', glueOk);
      if (nt != null && nt !== r.t) changes.set(r.i, { t: nt, cid: c.id, cf });
    }
  }
}
console.log('全库待改:', changes.size, '条');
// 备份受影响分块（不覆盖已有备份）
const affected = new Set();
for (const [, v] of changes) affected.add(v.cf);
for (const cf of affected) {
  const dst = path.join(BACKUP, 'poems', cf);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(DATA, 'poems', cf), dst);
  }
}
// 写回（pdb_songci 回滚过的分块也一并按 changes 再处理——回滚标题若命中新规则会被再改，符合预期）
let n = 0;
for (const cf of affected) {
  const arr = JSON.parse(read('poems/' + cf));
  for (const r of arr) {
    const v = changes.get(r.i);
    if (v && v.cf === cf) { r.t = v.t; n++; }
  }
  write('poems/' + cf, JSON.stringify(arr));
}
console.log('已写回:', n, '条 /', affected.size, '个分块');

// ---------- Pass 2: names 同步 ----------
{
  const nidx = readJ('idx/names/index.json');
  let fixed = 0;
  for (const p of nidx.parts) {
    const lines = read('idx/names/' + p.id + '.json').split('\n');
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      const t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
      const id = parseInt(line.slice(0, t1), 10);
      if (changes.has(id)) { out.push(id + '\t' + changes.get(id).t + '\t' + line.slice(t2 + 1)); fixed++; }
      else out.push(line);
    }
    const seg = out.map(l => l + '\n').join('');
    write('idx/names/' + p.id + '.json', seg);
    p.n = out.length; p.b = Buffer.byteLength(seg);
  }
  write('idx/names/index.json', JSON.stringify(nidx));
  console.log('names 同步:', fixed);
}
// ---------- Pass 3: ft 同步 ----------
{
  const fidx = readJ('idx/ft/index.json');
  let fixed = 0;
  for (const o of fidx.order) {
    const fp = 'idx/ft/' + o.id + '.json';
    const arr = readJ(fp);
    let touched = false;
    for (const row of arr) if (row && changes.has(row[0])) { row[1] = changes.get(row[0]).t; fixed++; touched = true; }
    if (touched) write(fp, JSON.stringify(arr));
  }
  console.log('ft 同步:', fixed);
}
// ---------- Pass 4: mingju/hot ----------
{
  const mj = readJ('idx/mingju.json');
  let a = 0;
  for (const row of mj) if (changes.has(row[3])) { row[2] = changes.get(row[3]).t; a++; }
  if (a) write('idx/mingju.json', JSON.stringify(mj));
  const hot = readJ('idx/hot.json');
  const rows = Array.isArray(hot) ? hot : hot.rows;
  let b = 0;
  for (const r of rows) if (changes.has(r.i)) { r.t = changes.get(r.i).t; b++; }
  if (b) { if (Array.isArray(hot)) write('idx/hot.json', JSON.stringify(rows)); else { hot.rows = rows; write('idx/hot.json', JSON.stringify(hot)); } }
  console.log('mingju/hot 同步:', a + '/' + b);
}
// ---------- Pass 5: manifest.v ----------
M.v = Date.now();
write('manifest.json', JSON.stringify(M, null, 1));
console.log('manifest.v →', M.v);
console.log('=== v2 完成 ===');
