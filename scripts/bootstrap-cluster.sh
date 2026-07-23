#!/usr/bin/env bash
# bootstrap-cluster.sh — idempotent platform + team-a + team-b on k3s (SPEC §8.3 / Phase 6)
# Requires: kubectl, cluster with NetworkPolicy CNI, ingressClass nginx, StorageClass local-path
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
K8S="$ROOT/deploy/k8s"
KUBECONFIG_OUT="${KUBECONFIG_OUT:-$ROOT/artifacts/kubeconfigs}"
STORAGE_CLASS="${STORAGE_CLASS:-local-path}"

# Which app to deploy to the team stands (round 1 = app1, round 2 = app2).
APP="app2"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    -h|--help) echo "Usage: $0 [--app app1|app2]"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
if [[ ! "$APP" =~ ^(app1|app2)$ ]]; then
  echo "ERROR: --app must be app1 or app2" >&2
  exit 1
fi

echo "==> HackTraining bootstrap (app=$APP storageClass=$STORAGE_CLASS)"

kubectl get ns >/dev/null

# ingress-nginx (skip if present)
if ! kubectl get ingressclass nginx >/dev/null 2>&1; then
  echo "==> Installing ingress-nginx"
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml
fi

# Wait for the controller AND its admission webhook to be serving before applying any
# manifest that contains Ingress objects. Waiting only for the Deployment to be
# "available" races the webhook: kubectl can try to create an Ingress while the admission
# service still has no endpoints, which aborts with
#   failed calling webhook "validate.nginx.ingress.kubernetes.io": no endpoints available
#   for service "ingress-nginx-controller-admission"
# Run unconditionally (also on reruns) so a re-bootstrap is genuinely idempotent.
echo "==> Waiting for ingress-nginx controller"
kubectl -n ingress-nginx wait --for=condition=available deploy/ingress-nginx-controller --timeout=180s

echo "==> Waiting for ingress-nginx admission webhook endpoints"
for _ in $(seq 1 60); do
  if [[ -n "$(kubectl -n ingress-nginx get endpoints ingress-nginx-controller-admission \
              -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)" ]]; then
    echo "    admission webhook ready"
    break
  fi
  sleep 2
done
if [[ -z "$(kubectl -n ingress-nginx get endpoints ingress-nginx-controller-admission \
            -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)" ]]; then
  echo "ERROR: ingress-nginx admission webhook has no endpoints after 120s" >&2
  exit 1
fi

echo "==> Apply base namespaces / PSA"
kubectl apply -k "$K8S/base"

# Round roles (defender/attacker labels)
kubectl apply -f "$K8S/overlays/round-roles.yaml"

echo "==> Apply platform (scoreboard, checker, planter, loki, grafana, metadata)"
kubectl apply -k "$K8S/platform"

# Point the planter/checker at the chosen app's stands.
if [[ "$APP" == "app1" ]]; then
  echo "==> Select app1 (helpdesk) stand config"
  kubectl apply -f "$K8S/platform/scoreboard-config-app1.yaml"
  kubectl -n platform rollout restart deploy/flag-planter deploy/checker 2>/dev/null || true
fi

echo "==> Apply team overlays ($APP)"
if [[ "$APP" == "app1" ]]; then
  kubectl apply -k "$K8S/overlays/app1/team-a"
  kubectl apply -k "$K8S/overlays/app1/team-b"
else
  kubectl apply -k "$K8S/overlays/team-a"
  kubectl apply -k "$K8S/overlays/team-b"
fi

# Patch storage class if not local-path (e.g. kind)
if [[ "$STORAGE_CLASS" != "local-path" ]]; then
  echo "==> Patching PVC storageClassName → $STORAGE_CLASS"
  kubectl get pvc -A -o name | while read -r pvc; do
    kubectl patch "$pvc" --type merge -p "{\"spec\":{\"storageClassName\":\"$STORAGE_CLASS\"}}" 2>/dev/null || true
  done
fi

mkdir -p "$KUBECONFIG_OUT"
for team in a b; do
  ns="team-$team"
  echo "==> Mint kubeconfig for $ns"
  # Ensure token secret (K8s 1.24+)
  kubectl -n "$ns" create token team-user --duration=8760h >"$KUBECONFIG_OUT/$ns.token" 2>/dev/null \
    || kubectl -n "$ns" get secret -o jsonpath='{.items[0].data.token}' 2>/dev/null | base64 -d >"$KUBECONFIG_OUT/$ns.token" || true
  SERVER="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
  CA="$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
  TOKEN="$(cat "$KUBECONFIG_OUT/$ns.token" 2>/dev/null || true)"
  if [[ -n "$TOKEN" ]]; then
    cat >"$KUBECONFIG_OUT/$ns.kubeconfig" <<EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${CA}
    server: ${SERVER}
  name: hacktraining
contexts:
- context:
    cluster: hacktraining
    namespace: ${ns}
    user: team-user
  name: ${ns}
current-context: ${ns}
users:
- name: team-user
  user:
    token: ${TOKEN}
EOF
    echo "    wrote $KUBECONFIG_OUT/$ns.kubeconfig"
  fi
done

echo "==> Waiting for key deployments"
kubectl -n platform rollout status deploy/scoreboard --timeout=180s || true
kubectl -n team-a rollout status deploy/app --timeout=180s || true
kubectl -n team-b rollout status deploy/app --timeout=180s || true

echo "==> Bootstrap complete"
echo "Hosts (add to /etc/hosts → ingress IP):"
echo "  scoreboard.hack.local grafana.hack.local team-a.app.hack.local team-b.app.hack.local"
echo "Verify NetworkPolicy: scripts/verify-networkpolicy.sh"
