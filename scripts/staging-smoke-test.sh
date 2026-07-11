#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 https://mlm-modular-staging.<account>.workers.dev" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

check_header() {
  local headers="$1" name="$2" expected="$3"
  local value
  value="$(printf '%s\n' "$headers" | awk -F': ' -v key="$(echo "$name" | tr '[:upper:]' '[:lower:]')" 'tolower($1)==key {gsub("\r", "", $2); print $2}' | tail -1)"
  if [[ "$value" != "$expected" ]]; then
    echo "Header $name expected '$expected' but got '$value'" >&2
    exit 1
  fi
}

echo "[1/3] Modular health route"
response="$(curl -sS -D - "$BASE_URL/health-modular" -o /tmp/mlm-health.json)"
check_header "$response" "x-mlm-router" "modular"
grep -q '"status":"ok"' /tmp/mlm-health.json

echo "[2/3] Modular calendar redirect"
response="$(curl -sS -D - "$BASE_URL/calendar-modular" -o /dev/null)"
check_header "$response" "x-mlm-router" "modular"
printf '%s\n' "$response" | grep -qi '^location: .*\/console\/calendar'

echo "[3/3] Legacy fallback"
response="$(curl -sS -D - "$BASE_URL/health" -o /tmp/mlm-legacy-health.json)"
check_header "$response" "x-mlm-router" "legacy"
grep -q '"status":"ok"' /tmp/mlm-legacy-health.json

echo "Staging smoke test passed. No write routes were called."
