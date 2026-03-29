#!/usr/bin/env bash
# download-olrc.sh — Download all OLRC USLM XML title ZIPs
#
# Usage: ./scripts/download-olrc.sh [--all-in-one]
#
# The OLRC website requires a session cookie. This script establishes a
# session first, then downloads all title ZIPs into data/cache/olrc/.
#
# Options:
#   --all-in-one   Download the single all-titles ZIP instead of individual ZIPs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$PROJECT_ROOT/data/cache/olrc"
COOKIE_JAR="$(mktemp)"
BASE_URL="https://uscode.house.gov"

# Current release point — update these when OLRC publishes a new one
RELEASE="119/73"
RELEASE_TAG="119-73"
RELEASE_DATE="2026-01-23"
RELEASE_LAW="P.L. 119-73"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo "=== OLRC USLM XML Download ==="
echo "Release point: $RELEASE_LAW ($RELEASE_DATE)"
echo "Cache dir: $CACHE_DIR"
echo ""

# Create cache directory
mkdir -p "$CACHE_DIR"

# Step 1: Establish session cookie
echo "[1/3] Establishing session..."
curl -sL -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/" > /dev/null
echo "  ✓ Session established"

# Step 2: Download
if [[ "${1:-}" == "--all-in-one" ]]; then
  echo "[2/3] Downloading all-in-one ZIP..."
  FILENAME="xml_uscAll@${RELEASE_TAG}.zip"
  curl -sL -b "$COOKIE_JAR" --progress-bar \
    "$BASE_URL/download/releasepoints/us/pl/$RELEASE/$FILENAME" \
    -o "$CACHE_DIR/$FILENAME"
  echo "  ✓ $FILENAME"
  FILE_COUNT=1
else
  echo "[2/3] Downloading individual title ZIPs..."

  # Scrape the download page for ZIP URLs
  DOWNLOAD_PAGE=$(curl -sL -b "$COOKIE_JAR" "$BASE_URL/download/download.shtml")
  ZIPS=$(echo "$DOWNLOAD_PAGE" | grep -oE "releasepoints/us/pl/$RELEASE/xml_usc[^\"]+\\.zip" | grep -v "uscAll" | sort -u)
  TOTAL=$(echo "$ZIPS" | wc -l | tr -d ' ')

  echo "  Found $TOTAL title ZIPs"
  echo ""

  COUNT=0
  FAILED=0
  for zip_path in $ZIPS; do
    COUNT=$((COUNT + 1))
    FILENAME=$(basename "$zip_path")
    printf "  [%2d/%d] %s..." "$COUNT" "$TOTAL" "$FILENAME"

    if curl -sfL -b "$COOKIE_JAR" \
      "$BASE_URL/download/$zip_path" \
      -o "$CACHE_DIR/$FILENAME"; then
      SIZE=$(wc -c < "$CACHE_DIR/$FILENAME" | tr -d ' ')
      printf " ✓ (%s bytes)\n" "$SIZE"
    else
      printf " ✗ FAILED\n"
      FAILED=$((FAILED + 1))
    fi
  done
  FILE_COUNT=$COUNT
fi

# Step 3: Write metadata
echo ""
echo "[3/3] Writing metadata..."

cat > "$CACHE_DIR/RELEASE.json" <<METADATA
{
  "source": "olrc",
  "release_point": "$RELEASE_LAW",
  "release_date": "$RELEASE_DATE",
  "release_tag": "$RELEASE_TAG",
  "download_url": "$BASE_URL/download/download.shtml",
  "downloaded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file_count": $FILE_COUNT,
  "notes": "USLM XML format. Current through $RELEASE_LAW ($RELEASE_DATE)."
}
METADATA

echo "  ✓ RELEASE.json written"

# Summary
echo ""
echo "=== Download Complete ==="
echo "Files: $FILE_COUNT"
if [[ "${FAILED:-0}" -gt 0 ]]; then
  echo "Failed: $FAILED"
  echo "⚠️  Some downloads failed. Re-run to retry."
  exit 1
fi
echo "Location: $CACHE_DIR"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/unpack-olrc.sh"
echo "  2. Run: node dist/index.js transform --input data/cache/olrc/xml/ --output data/output/titles/"
