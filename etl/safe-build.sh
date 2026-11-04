#!/usr/bin/env bash
# 安全构建（多会话协作专用）：原子锁 -> preflight -> 备份 site/data -> build -> 校验 -> [可选 pack/gz] -> 成功
# 用法：
#   bash etl/safe-build.sh                  只做 build（产出明文 site/data），保持既有语义
#   bash etl/safe-build.sh --deploy-ready  build 成功后，在同一把锁 / 同一回滚事务内依次跑 pack --go + gz --go
# 任一阶段失败：rollback 把 site/data 半成品改名保留、把 site/data.bak-$ts 移回，不删除任何数据文件。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOCK="$ROOT/ops/.build.lock"
LOCK_D="$LOCK.d"
STATE="ops/state.json"
# 基线写死：不允许用环境变量降低（B-1）。传入更小值直接报错退出。
BASELINE_MIN=2145874
if [ -n "${EXPECT_MIN:-}" ] && [ "$EXPECT_MIN" -lt "$BASELINE_MIN" ] 2>/dev/null; then
  echo "✗ 拒绝：环境变量 EXPECT_MIN=$EXPECT_MIN 低于固定基线 $BASELINE_MIN，禁止降低校验阈值" >&2
  exit 2
fi
EXPECT_MIN="$BASELINE_MIN"
EXPECT_COLS=79
# build.js 在 2.1M 记录时会把全部记录读进内存；默认堆(~4G)会 OOM，需显式加大
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB:-10240}"
mkdir -p "$ROOT/ops"

DEPLOY_READY=0
case "${1:-}" in
  --deploy-ready) DEPLOY_READY=1 ;;
  '') ;;
  *) echo "✗ 未知参数：$1（仅支持 --deploy-ready）" >&2; exit 2 ;;
esac

# 1) 原子锁：mkdir 成功即持锁，失败读目录内 ts 判陈旧（阈值 LOCK_MAX_MIN 默认 120 分钟）
LOCK_MAX_MIN="${LOCK_MAX_MIN:-120}"
if mkdir "$LOCK_D" 2>/dev/null; then
  :  # 持锁成功
else
  lts="$(cat "$LOCK_D/ts" 2>/dev/null || true)"
  case "$lts" in ''|*[!0-9]*) lts=0 ;; esac
  age=$(( $(date +%s) - lts ))
  if [ "$age" -lt $(( LOCK_MAX_MIN * 60 )) ]; then
    echo "✗ 已有构建在进行（锁 ${age}s 前，阈值 ${LOCK_MAX_MIN}min），退出。并发 build 会互相踩坏数据。" >&2
    exit 3
  fi
  echo "陈旧锁（${age}s 前 > ${LOCK_MAX_MIN}min），删除目录重建后继续" >&2
  rm -rf "$LOCK_D"
  if ! mkdir "$LOCK_D"; then
    echo "✗ 重建锁目录失败" >&2
    exit 3
  fi
fi
printf '%s\n' "$(date +%s)" > "$LOCK_D/ts"
printf '%s\n' "$$" > "$LOCK_D/pid"
printf '%s\n' "$(hostname 2>/dev/null || echo unknown)" > "$LOCK_D/host"

rollback() {
  echo "↩ 回滚 site/data（半成品改名保留、备份移回，不删除任何东西）" >&2
  if [ -d site/data ]; then mv site/data "site/data.failed-$ts" 2>/dev/null || true; fi
  if [ -d "site/data.bak-$ts" ]; then mv "site/data.bak-$ts" site/data 2>/dev/null || true; fi
}
cleanup() {
  rm -rf "$LOCK_D" 2>/dev/null || true   # 原子锁目录
  rm -f "$LOCK" 2>/dev/null || true      # 兼容清理旧版锁文件
}
# 备份完成前只需清锁；备份完成后切到 rollback trap，覆盖 build/校验/pack/gz 全程
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

# 5) 校验：total 不低于固定基线 / 集合数精确 79 / 每个 collection 的 chunks 分块齐全
total="$(node -e "console.log(require('./site/data/manifest.json').total)")"
cols="$(node -e "console.log(require('./site/data/manifest.json').collections.length)")"
echo "manifest.total=$total / $cols 集合（基线 >= $EXPECT_MIN，集合数 = $EXPECT_COLS）"
if [ "$total" -lt "$EXPECT_MIN" ]; then
  echo "✗ 总数 $total 低于固定基线 $EXPECT_MIN，判定缩水，回滚！" >&2
  exit 2
fi
if [ "$cols" -ne "$EXPECT_COLS" ]; then
  echo "✗ 集合数 $cols != $EXPECT_COLS，回滚！" >&2
  exit 2
fi
if ! node -e '
const fs = require("fs");
const path = require("path");
const m = require("./site/data/manifest.json");
const dir = path.join("site", "data", "poems");
let missing = 0;
for (const c of m.collections) {
  for (const cf of (c.chunks || [])) {
    const plain = path.join(dir, cf);
    if (!fs.existsSync(plain) && !fs.existsSync(plain + ".gz")) {
      if (missing < 10) console.error("  缺分块:", c.id, cf);
      missing++;
    }
  }
}
if (missing) { console.error("缺失分块合计:", missing); process.exit(1); }
console.log("分块齐全校验通过");
'; then
  echo "✗ manifest 引用的分块文件缺失，回滚！" >&2
  exit 2
fi

# 6) --deploy-ready：pack/gz 与 build 共用同一把锁与同一个回滚事务，任一步失败即整体回滚
if [ "$DEPLOY_READY" = 1 ]; then
  echo "==> [deploy-ready] pack --go"
  if ! node etl/pack-deploy-20261103.mjs --go; then
    echo "✗ pack 失败，回滚整个事务" >&2
    exit 1
  fi
  echo "==> [deploy-ready] gz --go"
  if ! node etl/gzip-data-20261103.mjs --go; then
    echo "✗ gz 失败，回滚整个事务" >&2
    exit 1
  fi
fi

# 7) 全部阶段成功后才撤掉 rollback（保留备份供人工核对；--deploy-ready 任一失败不会走到这里）
trap 'cleanup' EXIT
node -e "const fs=require('fs');const s=fs.existsSync('$STATE')?JSON.parse(fs.readFileSync('$STATE','utf8')):{};s.last_build={at:new Date().toISOString(),total:Number('$total'),collections:Number('$cols'),backup:'site/data.bak-$ts'};fs.writeFileSync('$STATE',JSON.stringify(s,null,2));"
echo "✓ 构建完成：$total 首 / $cols 集合"
echo "旧数据备份：site/data.bak-$ts（核对无误后可删）"
if [ "$DEPLOY_READY" = 1 ]; then
  echo "✓ 已打包 + gzip，可直接发布：bash deploy-cf.sh --skip-build"
else
  echo "下一步（如需部署）：bash etl/safe-build.sh --deploy-ready 完成数据准备，再 bash deploy-cf.sh --skip-build 发布"
fi
