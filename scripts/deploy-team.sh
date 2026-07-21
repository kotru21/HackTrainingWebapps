#!/usr/bin/env bash
# deploy-team.sh — apply one team overlay
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAM="${1:-}"
if [[ -z "$TEAM" || ! "$TEAM" =~ ^(a|b)$ ]]; then
  echo "Usage: $0 <a|b>" >&2
  exit 1
fi
kubectl apply -k "$ROOT/deploy/k8s/overlays/team-$TEAM"
kubectl -n "team-$TEAM" rollout status deploy/app --timeout=180s
