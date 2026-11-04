#!/usr/bin/env bash
# Cloudflare Pages 发布脚本（poetry-site / 项目 shanchuang）
#
# 用法：
#   ./deploy-cf.sh              # 完整链路：safe-build --deploy-ready（build+pack+gz）→ deploy（数据/结构有变动时用）
#   ./deploy-cf.sh --skip-build # 仅部署当前 site/（代码小改、数据未变时用，省去重建数据）
#
# 依赖：
#   - token：默认读 /c/Users/xiang/Downloads/cf-token.txt，可用 CF_TOKEN_FILE 覆盖
#   - wrangler 版本钉死 4.156.2（已缓存）；并发补丁由 patch-wrangler.mjs 自动应用
#   - 直接调用已缓存的 cli.js，避免 npx 在受限网络下元数据检查挂起
set -euo pipefail
cd "$(dirname "$0")"

TOKEN_FILE="${CF_TOKEN_FILE:-/c/Users/xiang/Downloads/cf-token.txt}"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "✗ 找不到 Cloudflare token 文件: $TOKEN_FILE" >&2
  echo "  可用 CF_TOKEN_FILE=/path/to/token 指定" >&2
  exit 1
fi

# 注入鉴权（禁止 wrangler login —— 国内 OAuth 回不来）
export CLOUDFLARE_API_TOKEN="$(cat "$TOKEN_FILE" | tr -d '[:space:]')"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-ff00756871f02220c9ab555b616143b5}"
export BULK_UPLOAD_CONCURRENCY=16   # 保险值；真正生效由 patch-wrangler.mjs 改 cli.js
# 沙箱常注入一个对外 502 的代理；wrangler 走它会 fetch failed。本机 TCP 443 直连可达 CF，清掉代理走直连。
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy \
      npm_config_proxy npm_config_https_proxy npm_config_http_proxy \
      NPM_CONFIG_PROXY NPM_CONFIG_HTTPS_PROXY NPM_CONFIG_HTTP_PROXY

# 解析 wrangler 可执行文件（优先本地安装，否则用 npx 缓存副本）
WRANGLER_CMD=""
if [ -x "./node_modules/.bin/wrangler" ]; then
  WRANGLER_CMD="./node_modules/.bin/wrangler"
else
  CLI="$(ls -d "$HOME/AppData/Local/npm-cache/_npx"/*/node_modules/wrangler/wrangler-dist/cli.js 2>/dev/null | head -1)"
  if [ -n "$CLI" ]; then
    WRANGLER_CMD="node \"$CLI\""
  else
    echo "✗ 找不到 wrangler（本地无 node_modules/wrangler，npx 缓存也没有）。" >&2
    echo "  先运行：npx wrangler@4.156.2 --version" >&2
    exit 1
  fi
fi

# 确保 wrangler 可用并打并发补丁（幂等，覆盖 npx 缓存与本地安装）
node patch-wrangler.mjs

SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

if [ "$SKIP_BUILD" = 0 ]; then
  # 完整链路：build + pack + gz 全部收进同一把原子锁与同一个回滚事务，任一阶段失败整体回滚
  echo "==> [1/2] safe-build --deploy-ready（原子锁 / preflight / 备份 / build / 校验 / pack / gz）"
  bash etl/safe-build.sh --deploy-ready
fi

# 部署前门禁（第十一轮 B-9）：Pages 免费版每站 20,000 文件 / 单文件 25MiB，
# 数据基线 2,145,874 / 79 集合。任一不满足就停，绝不把坏数据推上线。
echo "==> [gate] 部署前门禁"
node - <<'NODE'
const fs = require('fs'), path = require('path');
const ROOT = path.resolve('site');
const MAX_FILES = 18000, MAX_BYTES = 25 * 1024 * 1024;
const BASELINE = 2145874, COLS = 79;
let files = 0; const over = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    files++;
    const st = fs.statSync(p);
    if (st.size > MAX_BYTES) over.push(path.relative(ROOT, p) + ' ' + (st.size / 1048576).toFixed(1) + 'MB');
  }
})(ROOT);
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const bad = [];
if (files > MAX_FILES) bad.push(`文件数 ${files} > ${MAX_FILES}`);
if (over.length) bad.push(`超限文件 ${over.length} 个：` + over.slice(0, 5).join(', '));
if (m.total !== BASELINE) bad.push(`manifest.total=${m.total} != ${BASELINE}`);
if (!m.collections || m.collections.length !== COLS) bad.push(`集合数 != ${COLS}`);
if (bad.length) { console.error('✗ 门禁未通过：\n  - ' + bad.join('\n  - ')); process.exit(1); }
console.log(`✓ 门禁通过：${files} 文件 / manifest ${m.total} 首 / ${COLS} 集合`);
NODE

echo "==> [deploy] 上传到 Cloudflare Pages（shanchuang / main）"
eval "$WRANGLER_CMD pages deploy site --project-name shanchuang --branch main"
echo "✓ 部署完成：https://shanchuang.pages.dev"
