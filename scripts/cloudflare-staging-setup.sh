#!/usr/bin/env bash
set -euo pipefail

# MLM staging resource setup helper.
# This script prints and optionally executes commands for staging resources only.
# It never reads or modifies production wrangler.toml.

MODE="${1:-print}"
D1_NAME="mlm_staging"
R2_NAME="k-linksaas-images-staging"
WORKER_NAME="mlm-modular-staging"

run() {
  if [[ "$MODE" == "apply" ]]; then
    echo "+ $*"
    "$@"
  else
    printf '%q ' "$@"
    printf '\n'
  fi
}

if [[ "$MODE" != "print" && "$MODE" != "apply" ]]; then
  echo "Usage: $0 [print|apply]" >&2
  exit 2
fi

for name in "$D1_NAME" "$R2_NAME" "$WORKER_NAME"; do
  if [[ "$name" != *staging* ]]; then
    echo "Refusing non-staging resource name: $name" >&2
    exit 1
  fi
done

echo "# 1. Create isolated staging D1"
run npx wrangler d1 create "$D1_NAME"

echo

echo "# 2. Create isolated staging R2 bucket"
run npx wrangler r2 bucket create "$R2_NAME"

echo

echo "# 3. After D1 creation, copy the returned database_id into wrangler.staging.toml"
echo "# 4. Add staging-only secrets manually, for example:"
run npx wrangler secret put DASHBOARD_API_TOKEN --config wrangler.staging.toml
run npx wrangler secret put ADMIN_TOKEN --config wrangler.staging.toml

echo

echo "# 5. Run preflight and dry-run before any deployment"
run node tools/staging-preflight.mjs wrangler.staging.toml
run bash scripts/wrangler-staging-dry-run.sh

echo

echo "# Worker name reserved for staging deployment: $WORKER_NAME"
if [[ "$MODE" == "print" ]]; then
  echo "# No Cloudflare resources were created. Re-run with 'apply' only after review."
fi
