#!/usr/bin/env bash
# build-and-load.sh — build all stand/platform images and import them into k3s containerd.
# One command instead of six docker builds + a save|import loop (which is easy to fumble).
# Usage: ./scripts/build-and-load.sh [app1|app2|all]   (default: all)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WHICH="${1:-all}"
CTR="${K3S_CTR:-k3s ctr}"

# name  →  Dockerfile (build context is always the repo root)
ALL_IMAGES=(
  "app1-helpdesk-vulnerable apps/app1-helpdesk/vulnerable/Dockerfile"
  "app2-billing-vulnerable  apps/app2-billing/vulnerable/Dockerfile"
  "scoreboard               platform/scoreboard/Dockerfile"
  "flag-planter             platform/flag-planter/Dockerfile"
  "checker                  platform/checker/Dockerfile"
  "internal-metadata        platform/internal-metadata/Dockerfile"
)

# Select the subset to build. Platform images are always needed; stand images depend on
# the round. `all` builds everything (handy for a first bring-up).
declare -a IMAGES=()
for entry in "${ALL_IMAGES[@]}"; do
  name="${entry%% *}"
  case "$WHICH" in
    all) IMAGES+=("$entry") ;;
    app1) [[ "$name" == "app2-billing-vulnerable" ]] || IMAGES+=("$entry") ;;
    app2) [[ "$name" == "app1-helpdesk-vulnerable" ]] || IMAGES+=("$entry") ;;
    *) echo "Usage: $0 [app1|app2|all]" >&2; exit 1 ;;
  esac
done

echo "==> Building ${#IMAGES[@]} images (context: $ROOT)"
for entry in "${IMAGES[@]}"; do
  # shellcheck disable=SC2086
  set -- $entry
  name="$1"; dockerfile="$2"
  echo "==> docker build hacktraining/$name:local  (-f $dockerfile)"
  docker build -t "hacktraining/$name:local" -f "$dockerfile" .
done

echo "==> Importing into k3s containerd"
for entry in "${IMAGES[@]}"; do
  # shellcheck disable=SC2086
  set -- $entry
  name="$1"
  echo "==> import hacktraining/$name:local"
  docker save "hacktraining/$name:local" | $CTR images import -
done

count="$($CTR images ls 2>/dev/null | grep -c 'hacktraining/' || true)"
echo "==> Done. hacktraining images now in k3s: $count"
