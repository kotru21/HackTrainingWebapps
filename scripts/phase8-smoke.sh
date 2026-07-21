#!/usr/bin/env bash
# phase8-smoke.sh — run full PoC matrix
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node tools/attacker-scripts/phase8-smoke.mjs "$@"
