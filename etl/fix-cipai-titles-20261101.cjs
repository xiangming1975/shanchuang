// 词牌标题修正（2026-11-01，用户报告 pdb_songci 词牌与题/首句粘连）
// 规则：
//   ① 标题去分隔后完全等于某词牌 → 不动
//   ② 最长词牌前缀 P（清单 = cipai.json ∪ genre 词·键），且原始标题以 P 开头：
//      - P 后是 ·・•‧ → 统一成 ·（已有分隔，仅规范符号）
//      - P 后是空格/全角空格 → 改为 ·（"浣溪沙 玄武湖"→"浣溪沙·玄武湖"）
//      - P 后直接接字 → 插 ·（"浣溪沙寄湘弟遂园"→"浣溪沙·寄湘弟遂园"）；
//        但 rest 以 慢/令/引/近/遍/犯/叠/弄/拍 开头、或 P+rest 前缀本身是词牌 → 跳过（词牌变体，清单未收，不敢断界）
//   ③ 只处理 pdb_songci（宋词补遗，用户指名范围）
// 同步：names 分片受影响行、ft 行标题、mingju/hot 标题、manifest.v bump
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
const SUFFIX = new Set(['慢', '令', '引', '近', '遍', '犯', '叠', '弄', '拍']);
const sane = s => String(s || '').replace(/[\n\r\t]+/g, ' ').trim();

// 词牌判定：返回 newT 或 null（不改）
function fixTitle(t) {
  const norm = String(t).replace(/[·・•‧\s　]+/g, '');
  if (!norm || cipSet.has(norm)) return null;
  let P = null;
  for (const cip of cipais) {
    if (norm.length > cip.length && norm.startsWith(cip)) { P = cip; break; }
  }
  if (!P) return null;
  if (!t.startsWith(P)) return null;
  const rest = t.slice(P.length);
  if (!rest.trim()) return null;
  if (/^[·・•‧]/.test(rest)) return P + '·' + rest.replace(/^[·・•‧\s　]+/, '');   // 规范符号
  if (/^[\s　]/.test(rest)) return P + '·' + rest.replace(/^[\s　]+/, '');          // 空格 → ·
  // 胶着：排除词牌变体（浣溪沙慢/甘州遍/渡江云三犯 这类清单没收的）
  if (SUFFIX.has(rest[0])) return null;
  if (cipSet.has(P + rest[0]) || cipSet.has(P + rest.slice(0, 2))) return null;
  return P + '·' + rest;
}

// ---------- Pass 1: 扫 pdb_songci，算出改动清单 ----------
const col = colById.get('pdb_songci');
const changes = new Map();   // i -> newT
let skippedSuffix = 0;
for (const cf of col.chunks) {
  const arr = JSON.parse(read('poems/' + cf));
  for (const r of arr) {
    const nt = fixTitle(r.t || '');
    if (nt != null && nt !== r.t) {
      if (/^[·・]/.test((r.t || '').slice(String(nt).split('·')[0].length)) && !/^[\s　]/.test((r.t || '').slice(String(nt).split('·')[0].length))) skippedSuffix++;
      changes.set(r.i, sane(nt));
    }
  }
}
console.log('pdb_songci 待改标题:', changes.size, '条');
// 分类型统计
let nGlued = 0, nSpace = 0, nBullet = 0;
for (const [i, nt] of changes) {
  const idx = nt.indexOf('·');
  void idx;
}
// 样例
let shown = 0;
for (const [i, nt] of changes) {
  if (shown >= 10) break;
  console.log('  #' + i + ' → ' + JSON.stringify(nt));
  shown++;
}

// ---------- Pass 2: 备份受影响分块 → 改标题 → 写回 ----------
const affectedChunks = new Set();
for (const cf of col.chunks) {
  const arr = JSON.parse(read('poems/' + cf));
  if (arr.some(r => changes.has(r.i))) affectedChunks.add(cf);
}
console.log('受影响分块:', affectedChunks.size, '个');
for (const cf of affectedChunks) {
  const dst = path.join(BACKUP, 'poems', cf);
  if (!fs.existsSync(dst)) {   // 重跑时不要用「已修正版」覆盖原始备份
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(DATA, 'poems', cf), dst);
  }
}
let changedRecs = 0;
for (const cf of affectedChunks) {
  const arr = JSON.parse(read('poems/' + cf));
  for (const r of arr) {
    if (changes.has(r.i)) { r.t = changes.get(r.i); changedRecs++; }
  }
  write('poems/' + cf, JSON.stringify(arr));
}
console.log('已改写记录:', changedRecs);

// ---------- Pass 3: names 分片受影响行同步 ----------
{
  const nidx = readJ('idx/names/index.json');
  let fixed = 0;
  for (const p of nidx.parts) {
    const lines = read('idx/names/' + p.id + '.json').split('\n');
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      const t1 = line.indexOf('\t');
      const t2 = line.indexOf('\t', t1 + 1);
      const id = parseInt(line.slice(0, t1), 10);
      if (changes.has(id)) {
        out.push(id + '\t' + changes.get(id) + '\t' + line.slice(t2 + 1));
        fixed++;
      } else out.push(line);
    }
    const seg = out.map(l => l + '\n').join('');
    write('idx/names/' + p.id + '.json', seg);
    p.n = out.length;
    p.b = Buffer.byteLength(seg);
  }
  write('idx/names/index.json', JSON.stringify(nidx));
  console.log('names 受影响行:', fixed);
}

// ---------- Pass 4: ft 行标题同步 ----------
{
  const fidx = readJ('idx/ft/index.json');
  let fixed = 0;
  for (const o of fidx.order) {
    const fp = 'idx/ft/' + o.id + '.json';
    const arr = readJ(fp);
    let touched = false;
    for (const row of arr) {
      if (row && changes.has(row[0])) { row[1] = changes.get(row[0]); fixed++; touched = true; }
    }
    if (touched) write(fp, JSON.stringify(arr));
  }
  console.log('ft 受影响行:', fixed);
}

// ---------- Pass 5: mingju / hot 标题同步 ----------
{
  const mj = readJ('idx/mingju.json');
  let fixed = 0;
  for (const row of mj) if (changes.has(row[3])) { row[2] = changes.get(row[3]); fixed++; }
  if (fixed) write('idx/mingju.json', JSON.stringify(mj));
  const hot = readJ('idx/hot.json');
  const rows = Array.isArray(hot) ? hot : hot.rows;
  let fixedH = 0;
  for (const r of rows) if (changes.has(r.i)) { r.t = changes.get(r.i); fixedH++; }
  if (fixedH) {
    if (Array.isArray(hot)) write('idx/hot.json', JSON.stringify(rows));
    else { hot.rows = rows; write('idx/hot.json', JSON.stringify(hot)); }
  }
  console.log('mingju/hot 受影响行:', fixed + '/' + fixedH);
}

// ---------- Pass 6: manifest.v bump ----------
M.v = Date.now();
write('manifest.json', JSON.stringify(M, null, 1));
console.log('manifest.v →', M.v);
console.log('=== 词牌标题修正完成 ===');
