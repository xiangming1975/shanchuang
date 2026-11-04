// 幂等地把 wrangler 的并发常量从 3 提到 16（默认 3 会让 1.4 万文件上传十几小时；48 会 HeadersTimeoutError 整批失败）
// 目标：所有已安装的 wrangler 副本（npx 缓存 + 本地 node_modules）
// 第十一轮 B-7：用 `npm config get cache` 拼 _npx、保留硬编码路径为第二候选；
//   改前备份、改后 node --check 校验、替换不命中则 exit 1。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const TARGET = 16;

// 第一候选：npm 自身上报的 cache；第二候选：硬编码的 Windows 默认路径
const npxCaches = [];
try {
  const cache = execSync('npm config get cache', { encoding: 'utf8' }).trim();
  if (cache) npxCaches.push(path.join(cache, '_npx'));
} catch (e) {
  console.error('npm config get cache 失败，回退硬编码路径:', e.message);
}
npxCaches.push(path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'));

// 收集所有可能的 wrangler 安装目录（去重，避免同一副本被处理两次）
const roots = [];
for (const npx of npxCaches) {
  if (!fs.existsSync(npx)) continue;
  for (const d of fs.readdirSync(npx)) {
    const p = path.join(npx, d, 'node_modules', 'wrangler');
    if (fs.existsSync(p) && !roots.includes(p)) roots.push(p);
  }
}
// 本地项目安装
const local = path.join(process.cwd(), 'node_modules', 'wrangler');
if (fs.existsSync(local) && !roots.includes(local)) roots.push(local);

if (roots.length === 0) {
  console.error('未找到任何 wrangler 安装（npx 缓存或本地）。请先运行 npx wrangler@4.156.2 --version 触发缓存。');
  process.exit(1);
}

const ts = Date.now();
let patched = 0;   // 命中目标常量并成功处理的副本数（含「已是目标值」的幂等重跑）
for (const root of roots) {
  const cli = path.join(root, 'wrangler-dist', 'cli.js');
  if (!fs.existsSync(cli)) { console.error('跳过（无 cli.js）:', root); continue; }
  const before = fs.readFileSync(cli, 'utf8');
  let s = before;
  // 两个常量都改（bulk 上传 + Pages 分桶上传）
  s = s.replace(/BULK_UPLOAD_CONCURRENCY2 = 3/g, `BULK_UPLOAD_CONCURRENCY2 = ${TARGET}`);
  s = s.replace(/BULK_UPLOAD_CONCURRENCY = 3/g, `BULK_UPLOAD_CONCURRENCY = ${TARGET}`);
  if (s !== before) {
    const bak = cli + '.bak-' + ts;                 // 改文件前先备份
    fs.copyFileSync(cli, bak);
    fs.writeFileSync(cli, s);
    // 改完用 node --check 校验语法，失败则恢复备份并退出非零
    try {
      execSync(`node --check ${JSON.stringify(cli)}`, { stdio: 'pipe' });
    } catch (e) {
      fs.copyFileSync(bak, cli);
      console.error(`✗ 补丁后语法校验失败，已恢复备份: ${cli}`, e.message);
      process.exit(1);
    }
    console.log(`✓ 已补丁: ${root} (备份 ${path.basename(bak)})`);
    patched++;
  } else if (before.includes(`BULK_UPLOAD_CONCURRENCY = ${TARGET}`) || before.includes(`BULK_UPLOAD_CONCURRENCY2 = ${TARGET}`)) {
    console.log(`· 已是目标值（幂等跳过）: ${root}`);
    patched++;
  } else {
    console.log(`· 未命中并发常量（wrangler 版本可能不符）: ${root}`);
  }
}
console.log(`补丁完成：${patched} 个副本命中`);
if (patched === 0) {
  console.error('✗ 没有任何副本命中 BULK_UPLOAD_CONCURRENCY 常量（patched=0），请检查 wrangler 版本');
  process.exit(1);
}
