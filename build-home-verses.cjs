// 首页大标题诗句数据构建（2026-10-29 修订）
// 读两份 CSV（窗边读诗书 / 节气节日诗句）→ site/data/idx/home-verses.json
// 结构：{ v, win: [[联句, 作品id]...], cat: { '清明（节气）': [...] } }
// 修订点：
//   ① 按表头取值，不再靠列序号（节气表新增「联句」列）
//   ② 只收整联（联内上下句），拒绝跨联拼接
//   ③ 长度上限收到 24 字，首页单行放得下
// 用法：node build-home-verses.cjs
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'site', 'data', 'idx', 'home-verses.json');
const MAX_LEN = 24;   // 一联总长上限：首页单行显示

function parseCSV(file) {
  const s2 = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  const lines = s2.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    const parts = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    const row = {};
    head.forEach((h, i) => { row[h] = parts[i] || ''; });
    return row;
  });
}

// 一整联：联内用「，；、：」分上下句，末尾带一个「。！？」。
// 关键判据：联末标点只能出现在**最后一位**；出现在中间说明跨联拼接了。
function cleanCouplet(v) {
  const s2 = String(v || '').trim();
  if (!s2) return '';
  const body = s2.slice(0, -1);
  if (/[。！？]/.test(body)) return '';         // 中间还有句末标点 → 跨联，丢
  if (!/[。！？]/.test(s2.slice(-1))) return ''; // 结尾不是联末 → 不成联
  if (!/[，；、：]/.test(body)) return '';       // 只有一句 → 无对
  if ([...s2].length > MAX_LEN) return '';
  return s2;
}

const data = { v: 2, win: [], cat: {} };

// ① 窗边读诗书：标题,作者,诗句,id
for (const r2 of parseCSV(path.join(ROOT, '窗边读诗书.csv'))) {
  const verse = cleanCouplet(r2['诗句']);
  const id = parseInt(r2['id'], 10);
  if (!verse || !Number.isFinite(id)) continue;
  data.win.push([verse, id]);
}

// ② 节气节日：类别,命中词,命中位,标题,作者,朝代,集合,上句,本句,下句,联句,id
for (const r2 of parseCSV(path.join(ROOT, '节气节日诗句.csv'))) {
  const cat = r2['类别'];
  const verse = cleanCouplet(r2['联句']) || cleanCouplet((r2['本句'] || '') + (r2['下句'] || ''));
  const id = parseInt(r2['id'], 10);
  if (!cat || !verse || !Number.isFinite(id)) continue;
  if (!data.cat[cat]) data.cat[cat] = [];
  data.cat[cat].push([verse, id]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data), 'utf8');
console.log('win:', data.win.length, '联；cat:', Object.keys(data.cat).length, '类',
  Object.values(data.cat).reduce((s2, a) => s2 + a.length, 0), '行 →', OUT);
