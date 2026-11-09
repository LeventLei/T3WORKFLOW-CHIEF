#!/usr/bin/env bash
# 安装 Chief 模式到 Pi / T3 Code。
#   ./install.sh                  # 只安装 skill 到 ~/.agents/skills/chief-t3
#   ./install.sh /path/to/project # 同时把 AGENTS.md 装进该项目（已存在则备份）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$REPO_DIR/skills/chief-t3"
SKILL_DST="${CHIEF_SKILL_DIR:-$HOME/.agents/skills/chief-t3}"

echo "==> skill: $SKILL_DST"
mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -r "$SKILL_SRC" "$SKILL_DST"

if [ "${1:-}" != "" ]; then
  PROJECT="$1"
  [ -d "$PROJECT" ] || { echo "项目目录不存在: $PROJECT" >&2; exit 1; }
  TARGET="$PROJECT/AGENTS.md"
  if [ -f "$TARGET" ]; then
    BACKUP="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$TARGET" "$BACKUP"
    echo "==> 备份旧 AGENTS.md: $BACKUP"
  fi
  cp "$REPO_DIR/AGENTS.md" "$TARGET"
  echo "==> 项目入口: $TARGET"
  LEDGER="$HOME/.t3-tasks/$(basename "$PROJECT")"
  mkdir -p "$LEDGER"
  [ -f "$LEDGER/HANDOFF.md" ] || cp "$REPO_DIR/templates/HANDOFF.md" "$LEDGER/HANDOFF.md"
  echo "==> 任务台账: $LEDGER"
fi

echo
echo "完成。新开一个 T3 Code 线程生效（当前会话需 /reload）。"
echo "验证：让 Chief 跑一次 orchestrator_capabilities，确认角色表里的 provider/model 仍然存在。"
