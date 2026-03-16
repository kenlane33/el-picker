#!/usr/bin/env bash
set -euo pipefail

# Build a Chrome Web Store-ready zip of the ElPicker extension.
# Output: dist/el-picker.zip

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
ZIP_NAME="el-picker.zip"

# Extension files to include (no Next.js app, no node_modules, no dev files)
EXTENSION_FILES=(
  manifest.json
  background.js
  content.js
  content.css
  popup.html
  popup.js
  icons/
)

echo "==> Cleaning dist/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "==> Packaging extension files..."
cd "$SCRIPT_DIR"

# Build the zip, excluding macOS junk
zip -r "$DIST_DIR/$ZIP_NAME" "${EXTENSION_FILES[@]}" \
  -x "*.DS_Store" -x "__MACOSX/*"

# Show what's in the zip
echo ""
echo "==> Contents of $ZIP_NAME:"
unzip -l "$DIST_DIR/$ZIP_NAME"

SIZE=$(du -h "$DIST_DIR/$ZIP_NAME" | cut -f1)
echo ""
echo "==> Built: dist/$ZIP_NAME ($SIZE)"
echo "    Upload this file to the Chrome Developer Dashboard."
