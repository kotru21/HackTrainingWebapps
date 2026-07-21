#!/usr/bin/env bash
# bootstrap-cluster.sh — idempotent platform + team-a + team-b on k3s (SPEC §8.3 / Phase 6)
# Requires: kubectl, cluster with NetworkPolicy CNI, ingressClass nginx, StorageClass local-path
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
K8S="$ROOT/deploy/k8s"
KUBECONFIG_OUT="${KUBECONFIG_OUT:-$ROOT/artifacts/kubeconfigs}"
STORAGE_CLASS="${STORAGE_CLASS:-local-path}"

echo "==> HackTraining bootstrap (storageClass=$STORAGE_CLASS)"

kubectl get ns >/dev/null

# ingress-nginx (skip if present)
if ! kubectl get ingressclass nginx >/dev/null 2>&1; then
  echo "==> Installing ingress-nginx"
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml
  kubectl -n ingress-nginx wait --for=condition=available deploy/ingress-nginx-controller --timeout=180s || true
fi

echo "==> Apply base namespaces / PSA"
kubectl apply -k "$K8S/base"

# Round roles (defender/attacker labels)
kubectl apply -f "$K8S/overlays/round-roles.yaml"

echo "==> Apply platform (scoreboard, checker, planter, loki, grafana, metadata)"
kubectl apply -k "$K8S/platform"

echo "==> Apply team overlays"
kubectl apply -k "$K8S/overlays/team-a"
kubectl apply -k "$K8S/overlays/team-b"

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
