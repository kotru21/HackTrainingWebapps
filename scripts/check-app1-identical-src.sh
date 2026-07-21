#!/usr/bin/env bash
# check-app1-identical-src.sh — Phase 8 / SPEC §11: no divergent app1 src trees
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
if [[ -d "$ROOT/apps/app1-helpdesk/vulnerable/src" ]]; then
  echo "FAIL: apps/app1-helpdesk/vulnerable/src must not exist (config-only variant)"
  fail=1
fi
if [[ -d "$ROOT/apps/app1-helpdesk/reference/src" ]]; then
  echo "FAIL: apps/app1-helpdesk/reference/src must not exist"
  fail=1
fi
if [[ ! -d "$ROOT/apps/app1-helpdesk/src" ]]; then
  echo "FAIL: shared apps/app1-helpdesk/src missing"
  fail=1
fi
if [[ "$fail" -eq 0 ]]; then
  echo "PASS: app1 uses a single shared src/ (vulnerable≠reference only via config/deps)"
fi
exit "$fail"
