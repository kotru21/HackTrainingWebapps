#!/usr/bin/env bash
# deploy-team.sh — apply one team overlay for the chosen app
# Usage: ./scripts/deploy-team.sh <a|b> [app1|app2]   (default app2)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAM="${1:-}"
APP="${2:-app2}"
if [[ -z "$TEAM" || ! "$TEAM" =~ ^(a|b)$ ]]; then
  echo "Usage: $0 <a|b> [app1|app2]" >&2
  exit 1
fi
if [[ ! "$APP" =~ ^(app1|app2)$ ]]; then
  echo "ERROR: app must be app1 or app2" >&2
  exit 1
fi

if [[ "$APP" == "app1" ]]; then
  OVERLAY="deploy/k8s/overlays/app1/team-$TEAM"
else
  OVERLAY="deploy/k8s/overlays/team-$TEAM"
fi

kubectl apply -k "$ROOT/$OVERLAY"
kubectl -n "team-$TEAM" rollout status deploy/app --timeout=180s
