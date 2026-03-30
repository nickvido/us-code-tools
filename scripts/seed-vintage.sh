#!/usr/bin/env bash
# seed-vintage.sh — Download all title ZIPs for a given OLRC vintage into the cache layout.
#
# Usage: ./scripts/seed-vintage.sh <vintage> [--dry-run]
#
# The vintage ID must match an OLRC prior release point (e.g. 113-296, 115-442).
# URL pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{lawId}/xml_usc{XX}@{vintage}.zip
#
# The congress and law-id are parsed from the vintage string:
#   vintage = "{congress}-{lawId}"    e.g. "113-296" → congress=113, lawId=296
set -euo pipefail

VINTAGE="${1:?Usage: seed-vintage.sh <vintage> [--dry-run]}"
DRY_RUN="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$PROJECT_ROOT/data/cache/olrc/vintages/$VINTAGE"

# Parse congress and law-id from vintage string
CONGRESS="${VINTAGE%%-*}"
LAW_ID="${VINTAGE#*-}"

echo "=== Seeding vintage $VINTAGE (Congress $CONGRESS, PL $LAW_ID) ==="
echo "Cache: $CACHE_DIR"
echo ""

DOWNLOADED=0
SKIPPED=0
FAILED=0

for title in $(seq 1 54); do
  PADDED=$(printf "%02d" "$title")
  TITLE_DIR="$CACHE_DIR/title-$PADDED"
  ZIP_NAME="xml_usc${PADDED}@${VINTAGE}.zip"
  ZIP_PATH="$TITLE_DIR/$ZIP_NAME"
  URL="https://uscode.house.gov/download/releasepoints/us/pl/${CONGRESS}/${LAW_ID}/${ZIP_NAME}"

  if [[ -f "$ZIP_PATH" ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "[DRY] Would download: $URL"
    continue
  fi

  mkdir -p "$TITLE_DIR"
  printf "  Title %2d... " "$title"

  if curl -sS -L -o "$ZIP_PATH" --max-time 120 --retry 2 "$URL" 2>/dev/null; then
    # Check if we got an actual ZIP (not an HTML/XML error page)
    if file "$ZIP_PATH" | grep -q "Zip archive"; then
      SIZE=$(wc -c < "$ZIP_PATH" | tr -d ' ')
      printf "✓ (%s bytes)\n" "$SIZE"
      DOWNLOADED=$((DOWNLOADED + 1))
    else
      printf "✗ (not a ZIP — likely error page)\n"
      rm -f "$ZIP_PATH"
      rmdir "$TITLE_DIR" 2>/dev/null || true
      FAILED=$((FAILED + 1))
    fi
  else
    printf "✗ (download failed)\n"
    rm -f "$ZIP_PATH"
    rmdir "$TITLE_DIR" 2>/dev/null || true
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== Done ==="
echo "Downloaded: $DOWNLOADED"
echo "Skipped (already cached): $SKIPPED"
echo "Failed: $FAILED"
