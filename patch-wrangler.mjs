// 幂等地把 wrangler 的并发常量从 3 提到 16（默认 3 会让 1.4 万文件上传十几小时；48 会 HeadersTimeoutError 整批失败）
// 目标：所有已安装的 wrangler 副本（npx 缓存 + 本地 node_modules）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const TARGET = 16;
const NPM_CACHE = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');

// 收集所有可能的 wrangler 安装目录
const roots = [];
if (fs.existsSync(NPM_CACHE)) {
  for (const d of fs.readdirSync(NPM_CACHE)) {
    const p = path.join(NPM_CACHE, d, 'node_modules', 'wrangler');
    if (fs.existsSync(p)) roots.push(p);
  }
}
// 本地项目安装
const local = path.join(process.cwd(), 'node_modules', 'wrangler');
if (fs.existsSync(local)) roots.push(local);

if (roots.length === 0) {
  console.error('未找到任何 wrangler 安装（npx 缓存或本地）。请先运行 npx wrangler@4.156.2 --version 触发缓存。');
  process.exit(1);
}

let patched = 0;
for (const root of roots) {
  const cli = path.join(root, 'wrangler-dist', 'cli.js');
  if (!fs.existsSync(cli)) { console.error('跳过（无 cli.js）:', root); continue; }
  let s = fs.readFileSync(cli, 'utf8');
  const before = s;
  // 两个常量都改（bulk 上传 + Pages 分桶上传）
  s = s.replace(/BULK_UPLOAD_CONCURRENCY2 = 3/g, `BULK_UPLOAD_CONCURRENCY2 = ${TARGET}`);
  s = s.replace(/BULK_UPLOAD_CONCURRENCY = 3/g, `BULK_UPLOAD_CONCURRENCY = ${TARGET}`);
  if (s !== before) {
    fs.writeFileSync(cli, s);
    console.log(`✓ 已补丁: ${root} (BULK_UPLOAD_CONCURRENCY/2 → ${TARGET})`);
    patched++;
  } else {
    console.log(`· 已是目标值或无需改动: ${root}`);
  }
}
console.log(`补丁完成：${patched} 个副本被修改`);
