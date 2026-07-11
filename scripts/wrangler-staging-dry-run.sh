#!/usr/bin/env bash
set -euo pipefail

CONFIG="${1:-wrangler.staging.toml}"
TMP_CONFIG="$(mktemp)"
OUT_DIR="$(mktemp -d)"
trap 'rm -f "$TMP_CONFIG"; rm -rf "$OUT_DIR"' EXIT

node tools/staging-preflight.mjs "$CONFIG"
cp "$CONFIG" "$TMP_CONFIG"

# Wrangler dry-run needs a syntactically valid D1 UUID. Replace only the known placeholder
# in the temporary copy; the repository config remains unchanged.
sed -i 's/REPLACE_WITH_STAGING_D1_ID/00000000-0000-0000-0000-000000000000/g' "$TMP_CONFIG"

npx --yes wrangler@4 deploy \
  --dry-run \
  --config "$TMP_CONFIG" \
  --outdir "$OUT_DIR"

if [[ ! -f "$OUT_DIR/index.js" && ! -f "$OUT_DIR/worker.js" ]]; then
  echo "Wrangler dry-run completed but no bundled Worker entry was found." >&2
  find "$OUT_DIR" -maxdepth 2 -type f -print >&2 || true
  exit 1
fi

echo "Wrangler staging dry-run passed."
echo "No Worker was deployed and no Cloudflare resource was modified."
