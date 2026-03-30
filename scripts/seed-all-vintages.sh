#!/usr/bin/env bash
# seed-all-vintages.sh — Download all known OLRC vintages for historical backfill.
#
# Usage: ./scripts/seed-all-vintages.sh [--dry-run]
#
# Downloads ~13 vintages × 54 titles = ~700 ZIP files.
# Expect ~1–2 GB total and 30–60 minutes depending on connection speed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN="${1:-}"

# Known vintages from olrc-planner.ts (2 per congress, oldest first)
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

echo "=== Seeding ${#VINTAGES[@]} OLRC vintages ==="
echo ""

for vintage in "${VINTAGES[@]}"; do
  echo "────────────────────────────────────────"
  "$SCRIPT_DIR/seed-vintage.sh" "$vintage" "$DRY_RUN"
  echo ""
done

echo "=== All vintages seeded ==="
