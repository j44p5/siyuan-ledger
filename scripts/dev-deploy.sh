#!/usr/bin/env bash
# 一键开发部署：编译 → 部署到思源工作空间 plugins 目录
# 用法：bash scripts/dev-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 真实思源工作空间（探测或手动指定）
SIYUAN_WS="${SIYUAN_WS:-/Users/howke/Documents/sy/SiYuan}"
DEST="$SIYUAN_WS/data/plugins/siyuan-ledger"

cd "$ROOT"

echo "[1/3] 安装依赖…"
if command -v pnpm >/dev/null; then PM=pnpm;
elif command -v npm >/dev/null; then PM=npm;
else echo "未找到 npm/pnpm，请先安装 Node.js"; exit 1; fi
$PM install --no-audit --no-fund

echo "[2/3] 编译 (vite build)…"
$PM run build

echo "[3/3] 部署到 $DEST …"
mkdir -p "$DEST"
# rsync 同步，--delete 保证 dist 内容与目标一致
if command -v rsync >/dev/null; then
  rsync -a --delete "$ROOT/dist/" "$DEST/"
else
  rm -rf "$DEST"; mkdir -p "$DEST"; cp -R "$ROOT/dist/." "$DEST/"
fi

echo "✅ 完成。请在思源「设置 → 集市 → 已下载 → 插件」中启用「记账本 / Ledger」。"
echo "   若已启用过，按 ⌘R 或重启思源以加载最新代码。"
