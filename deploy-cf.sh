#!/usr/bin/env bash
# Cloudflare Pages 发布脚本（poetry-site / 项目 shanchuang）
#
# 用法：
#   ./deploy-cf.sh              # 完整链路：build → pack → gz → deploy（数据/结构有变动时用）
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
export CLOUDFLARE_ACCOUNT_ID="ff00756871f02220c9ab555b616143b5"
export BULK_UPLOAD_CONCURRENCY=16   # 保险值；真正生效由 patch-wrangler.mjs 改 cli.js
# 沙箱常注入一个对外 502 的代理；wrangler 走它会 fetch failed。本机 TCP 443 直连可达 CF，清掉代理走直连。
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy NO_PROXY

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
  echo "==> [1/4] build（重建 jl/fh/firstlines 等分片）"
  npm run build
  echo "==> [2/4] pack（29k → 14k，规避 Pages 2万文件上限，幂等）"
  npm run pack -- --go
  echo "==> [3/4] gz（data 压成 .json.gz，5.87GB → 2.7GB）"
  npm run gz -- --go
fi

echo "==> [${SKIP_BUILD:+4/4}deploy] 上传到 Cloudflare Pages（shanchuang / main）"
eval "$WRANGLER_CMD pages deploy site --project-name shanchuang --branch main"
echo "✓ 部署完成：https://shanchuang.pages.dev"
