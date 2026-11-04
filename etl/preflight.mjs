// 构建前门禁：检查源/构建脚本/基线/锁/磁盘。全部 PASS 才允许 safe-build 继续。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/xiang/Downloads/poetry-site';
const OUT = path.join(ROOT, 'etl', 'out');
const BUILDJS = path.join(ROOT, 'etl', 'build.js');
const MANIFEST = path.join(ROOT, 'site', 'data', 'manifest.json');
const LOCK = path.join(ROOT, 'ops', '.build.lock');
const BASELINE = 2145874;

let fail = 0;
const ok = (m) => console.log('  PASS ' + m);
const warn = (m) => console.log('  WARN ' + m);
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const mb = (n) => (n / 1048576).toFixed(0) + 'MB';

console.log('== preflight ==');

// 1) 源文件
const need = [
  ['poems3.jsonl', 150 * 1048576],
  ['poems-extra79.jsonl', 2.5 * 1024 ** 3],
];
for (const [f, min] of need) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) { bad(`${f} 缺失`); continue; }
  const s = fs.statSync(p).size;
  if (s < min) bad(`${f} 仅 ${mb(s)}（阈值 ${mb(min)}）`); else ok(`${f} ${mb(s)}`);
}

// 2) build.js 状态
const src = fs.readFileSync(BUILDJS, 'utf8');
const a = src.indexOf('const COLLECTIONS');
const b = src.indexOf('];', a);
const n = [...src.slice(a, b + 2).matchAll(/id:\s*'([^']+)'/g)].length;
if (n >= 79) ok(`build.js COLLECTIONS=${n}`); else bad(`build.js COLLECTIONS=${n}（应为 79）`);
if (src.includes('poems-extra79')) ok('extras 含 poems-extra79'); else bad('extras 缺 poems-extra79');
if (src.includes('process.env.SITE_DIR')) ok('SITE 支持 SITE_DIR 覆盖'); else warn('SITE 未支持 env 覆盖（safe-build 不需要）');

// 3) 当前线上基线
if (fs.existsSync(MANIFEST)) {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (m.total >= BASELINE * 0.99) ok(`当前 site/data total=${m.total} / ${m.collections.length} 集合`);
    else bad(`当前 site/data total=${m.total} 低于基线 ${BASELINE}（疑似已缩水！）`);
  } catch (e) { warn('site/data/manifest.json 解析失败: ' + e.message); }
} else warn('当前无 site/data/manifest.json（首次构建？）');

// 4) 锁（信息提示，不拦截；真正的并发拦截在 safe-build.sh）
if (fs.existsSync(LOCK)) {
  const ts = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10) || 0;
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age < 120 * 60) warn(`构建锁存在（${age}s 前写入），可能有构建在跑（safe-build 会自行拦并发）`);
  else warn(`陈旧锁（${Math.floor(age / 60)} 分钟前），safe-build 会自动清理`);
} else ok('无构建锁');

// 5) 磁盘
try {
  const st = fs.statfsSync(ROOT);
  const freeGB = (st.bfree * st.bsize) / 1024 ** 3;
  if (freeGB < 5) bad(`磁盘剩余 ${freeGB.toFixed(1)}GB（<5GB，构建易失败）`); else ok(`磁盘剩余 ${freeGB.toFixed(1)}GB`);
} catch (e) { warn('无法读取磁盘空间: ' + e.message); }

console.log(fail ? `\n✗ preflight 未通过（${fail} 项 FAIL），禁止构建` : '\n✓ preflight 通过');
process.exit(fail ? 1 : 0);
