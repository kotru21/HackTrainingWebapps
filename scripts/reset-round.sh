#!/usr/bin/env bash
# reset-round.sh — restore vulnerable baseline for a team stand (< 60s target)
# Usage: ./scripts/reset-round.sh --team a|b [--app app1|app2] [--dry-run]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAM=""
APP="app2"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team) TEAM="${2:-}"; shift 2 ;;
    --app) APP="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      echo "Usage: $0 --team a|b [--app app1|app2] [--dry-run]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ ! "$TEAM" =~ ^(a|b)$ ]]; then
  echo "ERROR: --team a|b required" >&2
  exit 1
fi
if [[ ! "$APP" =~ ^(app1|app2)$ ]]; then
  echo "ERROR: --app must be app1 or app2" >&2
  exit 1
fi

NS="team-${TEAM}"
START_TS=$(date +%s)

echo "==> reset-round team=$TEAM app=$APP ns=$NS"

if [[ "$APP" == "app2" ]]; then
  IMAGE="${RESET_IMAGE_APP2:-hacktraining/app2-billing-vulnerable:local}"
else
  IMAGE="${RESET_IMAGE_APP1:-hacktraining/app1-helpdesk-vulnerable:local}"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY-RUN: would set $NS/deploy/app image=$IMAGE, wipe workspace, rollout restart"
  exit 0
fi

kubectl get ns "$NS" >/dev/null

# 0) Ensure workspace PVC is Bound (recreate if stuck Pending)
ensure_pvc() {
  local claim="$1"
  local phase
  phase=$(kubectl -n "$NS" get pvc "$claim" -o jsonpath='{.status.phase}' 2>/dev/null || echo Missing)
  if [[ "$phase" != "Bound" ]]; then
    echo "==> Recreating PVC $claim (was $phase)"
    kubectl -n "$NS" delete pvc "$claim" --wait=false --ignore-not-found 2>/dev/null || true
    # wait for deletion
    for _ in $(seq 1 20); do
      kubectl -n "$NS" get pvc "$claim" >/dev/null 2>&1 || break
      sleep 1
    done
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${claim}
  namespace: ${NS}
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 5Gi
EOF
  fi
}

ensure_pvc workspace

# Prefer Recreate so we don't surge a second pod against a single RWO volume
kubectl -n "$NS" patch deployment app --type merge -p '{"spec":{"strategy":{"type":"Recreate"}}}' 2>/dev/null || true

# 1) Ensure vulnerable image (skip if missing from nodes — still wipe+restart)
PREV_IMAGE="$(kubectl -n "$NS" get deploy app -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
if [[ "${SKIP_IMAGE_SET:-0}" != "1" ]]; then
  kubectl -n "$NS" set image "deployment/app" "app=${IMAGE}" 2>/dev/null \
    || kubectl -n "$NS" patch deployment app --type json \
      -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"${IMAGE}\"}]"
fi

# 2) Wipe workspace PVC contents (team patches) via short-lived Job.
#    Emptying the PVC is what restores the baseline: on the next app start the
#    seed-workspace initContainer re-copies a clean vulnerable source tree from the image.
kubectl -n "$NS" delete job reset-workspace --ignore-not-found --wait=false 2>/dev/null || true
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: reset-workspace
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 60
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: wipe
          image: busybox:1.36
          command: ["sh", "-c", "rm -rf /workspace/* /workspace/.[!.]* 2>/dev/null; echo wiped; ls -la /workspace || true"]
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: workspace
EOF

# Don't block long on PVC wipe if PVC missing
kubectl -n "$NS" wait --for=condition=complete job/reset-workspace --timeout=25s 2>/dev/null || true

# 3) Hard recycle app pods (reliable <60s; avoids stuck RollingUpdate surges)
kubectl -n "$NS" scale "deployment/app" --replicas=0
kubectl -n "$NS" wait --for=delete pod -l app.kubernetes.io/component=app --timeout=20s 2>/dev/null || \
  kubectl -n "$NS" delete pod -l app.kubernetes.io/component=app --force --grace-period=0 2>/dev/null || true
# Wait until a pod is Running (Ready may fail if probe expects /readyz on training stubs)
wait_app_running() {
  local deadline=$((SECONDS + 35))
  while (( SECONDS < deadline )); do
    local ready phase
    phase=$(kubectl -n "$NS" get pods -l app.kubernetes.io/component=app -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)
    ready=$(kubectl -n "$NS" get pods -l app.kubernetes.io/component=app -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || true)
    if [[ "$phase" == "Running" ]]; then
      echo "==> app pod Running (ready=$ready)"
      return 0
    fi
    if [[ "$phase" == "Pending" ]]; then
      local reason
      reason=$(kubectl -n "$NS" get pods -l app.kubernetes.io/component=app -o jsonpath='{.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)
      if [[ "$reason" == "ErrImagePull" || "$reason" == "ImagePullBackOff" ]]; then
        return 2
      fi
    fi
    sleep 1
  done
  return 1
}

kubectl -n "$NS" scale "deployment/app" --replicas=1
wr=0
wait_app_running || wr=$?
if [[ "$wr" -eq 2 ]]; then
  echo "WARN: image $IMAGE not on nodes — reverting to ${PREV_IMAGE:-hashicorp/http-echo:1.0}"
  kubectl -n "$NS" set image "deployment/app" "app=${PREV_IMAGE:-hashicorp/http-echo:1.0}" || true
  kubectl -n "$NS" scale "deployment/app" --replicas=0
  kubectl -n "$NS" delete pod -l app.kubernetes.io/component=app --force --grace-period=0 2>/dev/null || true
  kubectl -n "$NS" scale "deployment/app" --replicas=1
  wait_app_running || { echo "FAIL: app not Running" >&2; kubectl -n "$NS" get pods -o wide >&2; exit 1; }
elif [[ "$wr" -ne 0 ]]; then
  echo "FAIL: app not Running in time" >&2
  kubectl -n "$NS" get pods -o wide >&2 || true
  exit 1
fi

# 4) Optional: bounce postgres clients by deleting app pods again after DB ready
kubectl -n "$NS" wait --for=condition=ready pod -l app.kubernetes.io/component=postgres --timeout=20s 2>/dev/null || true

# 5) Health check
READY=0
for _ in $(seq 1 15); do
  if kubectl -n "$NS" exec "deploy/app" -- wget -qO- --timeout=2 http://127.0.0.1:3011/healthz 2>/dev/null | grep -q ok \
    || kubectl -n "$NS" exec "deploy/app" -- wget -qO- --timeout=2 http://127.0.0.1:3000/healthz 2>/dev/null | grep -q ok; then
    READY=1
    break
  fi
  sleep 1
done

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo "==> reset-round done in ${ELAPSED}s (limit 60)"

if [[ "$READY" -ne 1 ]]; then
  echo "WARN: healthz not confirmed; check kubectl -n $NS get pods" >&2
fi
if [[ "$ELAPSED" -gt 60 ]]; then
  echo "FAIL: reset exceeded 60s (${ELAPSED}s)" >&2
  exit 1
fi
echo "PASS: baseline restored for $NS ($APP)"
