#!/usr/bin/env bash
# unpack-olrc.sh — Extract downloaded OLRC ZIPs and verify integrity
#
# Usage: ./scripts/unpack-olrc.sh
#
# Extracts all title ZIPs from data/cache/olrc/ into data/cache/olrc/xml/
# and runs integrity checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$PROJECT_ROOT/data/cache/olrc"
XML_DIR="$CACHE_DIR/xml"

echo "=== OLRC Unpack & Verify ==="

# Check for downloads
ZIPS=$(find "$CACHE_DIR" -maxdepth 1 -name "*.zip" | sort)
ZIP_COUNT=$(echo "$ZIPS" | grep -c '\.zip$' || true)

if [[ $ZIP_COUNT -eq 0 ]]; then
  echo "✗ No ZIP files found in $CACHE_DIR"
  echo "  Run ./scripts/download-olrc.sh first."
  exit 1
fi

echo "Found $ZIP_COUNT ZIP file(s)"
echo ""

# Create extraction directory
mkdir -p "$XML_DIR"

# Step 1: Extract all ZIPs
echo "[1/3] Extracting ZIPs..."
EXTRACT_FAILED=0
for zip in $ZIPS; do
  BASENAME=$(basename "$zip")
  printf "  %s..." "$BASENAME"

  if unzip -oq "$zip" -d "$XML_DIR" 2>/dev/null; then
    printf " ✓\n"
  else
    printf " ✗ FAILED\n"
    EXTRACT_FAILED=$((EXTRACT_FAILED + 1))
  fi
done

if [[ $EXTRACT_FAILED -gt 0 ]]; then
  echo ""
  echo "⚠️  $EXTRACT_FAILED ZIP(s) failed to extract. Check for corrupt downloads."
  echo "  Re-run ./scripts/download-olrc.sh to re-download."
  exit 1
fi

# Step 2: Count and inventory XML files
echo ""
echo "[2/3] Inventorying XML files..."
XML_COUNT=$(find "$XML_DIR" -name "*.xml" | wc -l | tr -d ' ')
echo "  Total XML files: $XML_COUNT"

# Count by title directory (if individual ZIPs)
TITLE_DIRS=$(find "$XML_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
TITLE_COUNT=$(echo "$TITLE_DIRS" | grep -c '.' || true)

if [[ $TITLE_COUNT -gt 0 ]]; then
  echo "  Title directories: $TITLE_COUNT"
  echo ""
  echo "  Per-title XML counts:"
  for dir in $TITLE_DIRS; do
    DIRNAME=$(basename "$dir")
    DIR_XML_COUNT=$(find "$dir" -name "*.xml" | wc -l | tr -d ' ')
    printf "    %-20s %5d files\n" "$DIRNAME" "$DIR_XML_COUNT"
  done
fi

# Step 3: Basic integrity check — verify XML files are well-formed
echo ""
echo "[3/3] Spot-checking XML integrity..."
SAMPLE_COUNT=0
BAD_COUNT=0
for xml in $(find "$XML_DIR" -name "*.xml" | sort | head -20); do
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  # Check that file starts with XML declaration or has a root element
  if head -1 "$xml" | grep -qE '^\s*<(\?xml|lawDoc|document|us-code)'; then
    : # ok
  else
    echo "  ⚠️  Unexpected start: $(basename "$xml"): $(head -c 80 "$xml")"
    BAD_COUNT=$((BAD_COUNT + 1))
  fi
done

echo "  Checked $SAMPLE_COUNT sample files, $BAD_COUNT warnings"

# Summary
echo ""
echo "=== Unpack Complete ==="
echo "XML files: $XML_COUNT"
echo "Location: $XML_DIR"

# Write inventory
cat > "$CACHE_DIR/INVENTORY.json" <<INVENTORY
{
  "unpacked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "zip_count": $ZIP_COUNT,
  "xml_count": $XML_COUNT,
  "title_dir_count": $TITLE_COUNT,
  "xml_dir": "$XML_DIR"
}
INVENTORY

echo ""
echo "Next step:"
echo "  node dist/index.js transform --input $XML_DIR --output data/output/titles/"
