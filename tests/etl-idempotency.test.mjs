// ETL 干跑幂等性（第十一轮 B-2 / E-6）：不带 --go 时绝不写文件。
//
// 两个脚本都用 path.resolve('site') / path.resolve('site','data') 基于 cwd 定位，且末尾会
// walk(SITE) 统计，所以必须在「临时 cwd」里造一个最小 site/ 工程再跑；绝不能碰真实 site/。
// BAK 用 path.resolve('..', 'backup-*')，故把 cwd 放到 tmp 的下一级 work/，让备份目录也落在
// tmp 内，任何越界写入都能被「文件清单 + 内容哈希」对比抓到。
//
// 用法：node tests/etl-idempotency.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPTS = [
  path.join(ROOT, 'etl', 'pack-deploy-20261103.mjs'),
  path.join(ROOT, 'etl', 'gzip-data-20261103.mjs'),
];

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) pass++;
  else { fail++; console.log('✗ ' + name + ' —— ' + got); }
};

// 递归列出 tmp 内所有「文件」的相对路径 + sha256；目录不计入「文件清单」。
function snapshot(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(p, r); continue; }
      const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      out.push(r + '  ' + h);
    }
  };
  walk(dir, '');
  return out.sort().join('\n');
}
function briefDiff(a, b) {
  const A = new Set(a.split('\n')), B = new Set(b.split('\n'));
  const added = [...B].filter(x => !A.has(x));
  const removed = [...A].filter(x => !B.has(x));
  return `新增/变化 ${added.length} 项、消失 ${removed.length} 项` +
    (removed.length ? '\n    消失: ' + removed.slice(0, 6).join(' | ') : '') +
    (added.length ? '\n    新增: ' + added.slice(0, 6).join(' | ') : '');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shici-etl-idem-'));
try {
  const work = path.join(tmp, 'work');
  const site = path.join(work, 'site');
  const idx = path.join(site, 'data', 'idx');
  for (const d of [idx, path.join(idx, 'firstlines'), path.join(idx, 'fh'), path.join(idx, 'jl')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const put = (rel, obj) => fs.writeFileSync(
    path.join(site, 'data', rel),
    typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  // 最小夹具：让三个步骤都能跑到「本该写、但干跑必须不写」的分支。
  put('manifest.json', { total: 1000000 });
  put('idx/firstlines.json', { 0: '甲', 1: '乙' });
  put('idx/firstlines/0.json', { 0: '甲' });
  put('idx/firstlines/index.json', { v: 2, shard: 200000, parts: [0] });
  put('idx/fh/index.json', { v: 2, chars: [] });
  put('idx/fh/人.json', [['床前明月光，', 1]]);
  put('idx/jl/甲.json', [['句一', 1]]);
  put('idx/jl-meta.json', { v: 1, own: '', buckets: 0 });
  put('idx/pingze.json', { m: {}, d: {} });

  const before = snapshot(tmp);
  ok('临时夹具文件清单非空（防空对比假绿）', before.split('\n').length >= 9, '仅 ' + before.split('\n').length + ' 个文件');

  for (const script of SCRIPTS) {
    const label = path.basename(script);
    ok('脚本存在: ' + label, fs.existsSync(script), '找不到 ' + script);
    let runErr = null;
    try {
      execFileSync(process.execPath, [script], {
        cwd: work, encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024,
      });
    } catch (e) { runErr = e; }
    ok('干跑 ' + label + ' 正常退出（exit 0）', runErr === null,
      runErr ? (runErr.status + ': ' + String(runErr.stderr || runErr.message).slice(0, 500)) : '');
    const after = snapshot(tmp);
    ok('干跑 ' + label + ' 前后文件清单与内容哈希完全一致', after === before, briefDiff(before, after));
  }
} finally {
  // 只删自己 mkdtempSync 造的目录，绝不碰真实 site/。
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(fail ? `\n✗ ETL 干跑幂等 ${fail}/${pass + fail} 失败` : `✓ ETL 干跑幂等 ${pass} 项全过`);
process.exit(fail ? 1 : 0);
