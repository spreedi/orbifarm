#!/usr/bin/env bash
# Build the password-protected investor deck from the iCloud source
# into ./invest-deck/ for GitHub Pages deployment.
#
# Usage: ./build-deck.sh
# Requires: node + npx (StatiCrypt is fetched on demand).

set -euo pipefail

SRC_DIR="/Users/jan.bredack/Library/Mobile Documents/com~apple~CloudDocs/Documents/VerticalFarming/Financials/2026-04-19 OrbiFarm Investor Deck HTML"
SRC_HTML="$SRC_DIR/Investor Deck.html"
PWFILE="$SRC_DIR/.investor-password"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$REPO_DIR/invest-deck"

if [ ! -f "$SRC_HTML" ]; then
  echo "ERROR: source HTML not found: $SRC_HTML" >&2
  exit 1
fi
if [ ! -f "$PWFILE" ]; then
  echo "ERROR: password file not found: $PWFILE" >&2
  exit 1
fi

PASSWORD="$(tr -d '\r\n' < "$PWFILE")"
if [ -z "$PASSWORD" ]; then
  echo "ERROR: password file is empty" >&2
  exit 1
fi

echo "==> Staging assets to $OUT_DIR"
mkdir -p "$OUT_DIR/images"
# Only the images actually referenced by the deck (per README). Unused
# renders stay in iCloud.
USED_IMAGES=(
  "hero-cover.png"
  "loop-diagram.jpeg"
  "ip-moat-facility.png"
  "facility-aisle.png"
  "jan-bredack.jpg"
  "maja-bredack.jpeg"
)
# Remove stale files from a previous build so deletions propagate.
find "$OUT_DIR/images" -mindepth 1 -maxdepth 1 -delete
for img in "${USED_IMAGES[@]}"; do
  cp "$SRC_DIR/images/$img" "$OUT_DIR/images/$img"
done
cp "$SRC_DIR/deck-stage.js" "$OUT_DIR/deck-stage.js"

echo "==> Encrypting HTML with StatiCrypt"
TMP="$(mktemp -d)"
cp "$SRC_HTML" "$TMP/index.html"
(
  cd "$TMP"
  STATICRYPT_PASSWORD="$PASSWORD" npx --yes staticrypt index.html \
    --short \
    --template-title "OrbiFarm® · Investor Access" \
    --template-instructions "Enter the access code shared with you by OrbiFarm to view the Series A investor deck." \
    --template-button "Unlock Deck" \
    --template-placeholder "Access code" \
    --template-error "Incorrect code. Please verify with OrbiFarm." \
    --template-color-primary "#00c853" \
    --template-color-secondary "#080d0a" \
    --remember 7 \
    -d out
)
cp "$TMP/out/index.html" "$OUT_DIR/index.html"
rm -rf "$TMP"

echo "==> Done. Output: $OUT_DIR"
echo "   (source HTML stays in iCloud; never committed)"
