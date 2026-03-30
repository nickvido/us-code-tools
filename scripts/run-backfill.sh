#!/usr/bin/env bash
# run-backfill.sh — Run OLRC backfill one vintage at a time to avoid OOM.
#
# Each vintage runs in its own Node process so the heap is freed between runs.
# Resume-safe: the orchestrator skips already-committed vintages.
#
# Usage: ./scripts/run-backfill.sh <target-repo>
set -euo pipefail

TARGET="${1:?Usage: run-backfill.sh <target-repo>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VINTAGES=(
  113-21
  113-296
  114-38
  114-329
  115-51
  115-442
  116-91
  116-344
  117-81
  117-262
  118-82
  118-158
  119-73
)

TOTAL=${#VINTAGES[@]}
ACCUMULATED=""

echo "=== OLRC Backfill: $TOTAL vintages → $TARGET ==="
echo ""

for i in "${!VINTAGES[@]}"; do
  v="${VINTAGES[$i]}"
  n=$((i + 1))

  # Accumulate vintages so the planner builds the full plan each time
  # (needed for correct tag assignment)
  if [ -z "$ACCUMULATED" ]; then
    ACCUMULATED="$v"
  else
    ACCUMULATED="$ACCUMULATED,$v"
  fi

  echo "────────────────────────────────────────"
  echo "[$n/$TOTAL] Vintage $v"
  echo "────────────────────────────────────────"

  # Run in a separate process with generous heap (8GB)
  # The orchestrator's resume logic will skip already-committed vintages
  if node --max-old-space-size=8192 "$PROJECT_ROOT/dist/index.js" backfill \
    --phase olrc --target "$TARGET" --vintages "$ACCUMULATED" 2>&1; then
    echo "  ✓ done"
  else
    echo "  ✗ FAILED (exit code $?)"
    echo "  Re-run this script to resume from where it stopped."
    exit 1
  fi

  echo ""
done

echo "=== All $TOTAL vintages committed ==="
echo ""
echo "Inspect with:"
echo "  cd $TARGET"
echo "  git log --oneline --decorate"
echo "  git tag -l"
echo "  git diff annual/2013..annual/2025 --stat"
