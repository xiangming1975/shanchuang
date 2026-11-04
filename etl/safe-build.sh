#!/usr/bin/env bash
# 安全构建（多会话协作专用）：加锁 -> preflight -> 备份 site/data -> build -> 校验 -> 失败回滚
# 用法：bash etl/safe-build.sh
# 说明：只做 build（产出明文 site/data）。要部署再跑 npm run pack -- --go && npm run gz -- --go
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOCK="$ROOT/ops/.build.lock"
STATE="ops/state.json"
EXPECT_MIN="${EXPECT_MIN:-2100000}"   # 低于此总数视为缩水，回滚
# build.js 在 2.1M 记录时会把全部记录读进内存；默认堆(~4G)会 OOM，需显式加大
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB:-10240}"
mkdir -p "$ROOT/ops"

# 1) 锁（时间戳判定，跨工具可靠；不用 pid——Git Bash 的 $$ 是 MSYS pid，与 Windows pid 不符）
LOCK_MAX="${LOCK_MAX_MIN:-120}"   # 锁超过此分钟数视为陈旧
if [ -f "$LOCK" ]; then
  lts="$(awk '{print $1}' "$LOCK" 2>/dev/null || echo 0)"
  age=$(( $(date +%s) - lts ))
  if [ "$age" -lt $(( LOCK_MAX * 60 )) ]; then
    echo "✗ 已有构建在进行（锁 ${age}s 前，阈值 ${LOCK_MAX}min），退出。并发 build 会互相踩坏数据。" >&2
    exit 3
  fi
  echo "陈旧锁（${age}s 前 > ${LOCK_MAX}min），清理后继续"
fi
printf '%s %s\n' "$(date +%s)" "$(date -u +%FT%TZ)" > "$LOCK"

rollback() {
  echo "↩ 回滚 site/data（半成品改名保留，不删，避开沙箱批量删除限制）" >&2
  if [ -d site/data ]; then mv site/data "site/data.failed-$ts" 2>/dev/null || true; fi
  if [ -d "site/data.bak-$ts" ]; then mv "site/data.bak-$ts" site/data; fi
}
cleanup() { rm -f "$LOCK"; }
trap 'cleanup' EXIT

# 2) 预检
node etl/preflight.mjs

# 3) 备份当前 site/data
ts="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -d site/data ]; then
  mv site/data "site/data.bak-$ts"
  echo "已备份 site/data -> site/data.bak-$ts"
fi
trap 'rollback; cleanup' EXIT

# 4) 构建
if ! node etl/build.js; then
  echo "✗ build 失败" >&2
  exit 1
fi

# 5) 校验总数
total="$(node -e "console.log(require('./site/data/manifest.json').total)")"
cols="$(node -e "console.log(require('./site/data/manifest.json').collections.length)")"
echo "manifest.total=$total / $cols 集合（阈值 >= $EXPECT_MIN）"
if [ "$total" -lt "$EXPECT_MIN" ]; then
  echo "✗ 总数低于基线，判定缩水，回滚！" >&2
  exit 2
fi

# 6) 成功
trap 'cleanup' EXIT
node -e "const fs=require('fs');const s=fs.existsSync('$STATE')?JSON.parse(fs.readFileSync('$STATE','utf8')):{};s.last_build={at:new Date().toISOString(),total:Number('$total'),collections:Number('$cols'),backup:'site/data.bak-$ts'};fs.writeFileSync('$STATE',JSON.stringify(s,null,2));"
echo "✓ 构建完成：$total 首 / $cols 集合"
echo "旧数据备份：site/data.bak-$ts（核对无误后可删）"
echo "下一步（如需部署）：npm run pack -- --go && npm run gz -- --go"
