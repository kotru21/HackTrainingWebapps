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

# --- Credentials (generated once, reused on re-runs) ---------------------------------
# Replace the built-in weak training values with short, easy-to-type random ones and hand
# them to the organizer at the end. Persisted to artifacts/credentials.env so idempotent
# re-runs (or a second --app round) keep the SAME creds instead of rotating mid-game.
# Set GEN_CREDS=0 to keep the manifest defaults (e.g. quick throwaway bring-up).
GEN_CREDS="${GEN_CREDS:-1}"
GEN_TLS="${GEN_TLS:-1}"
CREDS_FILE="${CREDS_FILE:-$ROOT/artifacts/credentials.env}"
TLS_DIR="${TLS_DIR:-$ROOT/artifacts/tls}"
if [[ "$GEN_CREDS" == "1" ]]; then
  if [[ -f "$CREDS_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS_FILE"
    echo "==> Reusing credentials from $CREDS_FILE"
  else
    # Short random token, no look-alike chars (0/o/1/l/i). Captured via a subshell with
    # `|| true` so the SIGPIPE head sends to tr (reading the endless /dev/urandom) does
    # not trip `set -o pipefail` and abort the whole bootstrap.
    gen() {
      local s
      s="$(LC_ALL=C tr -dc 'a-hj-km-np-z2-9' </dev/urandom 2>/dev/null | head -c "${1:-8}")" || true
      printf '%s' "$s"
    }
    TEAM_A_TOKEN="$(gen 8)"; TEAM_B_TOKEN="$(gen 8)"; JUDGE_TOKEN="$(gen 10)"
    IDE_A_PASS="$(gen 8)"; IDE_B_PASS="$(gen 8)"; GRAFANA_PASS="$(gen 8)"
    mkdir -p "$(dirname "$CREDS_FILE")"
    cat >"$CREDS_FILE" <<EOF
TEAM_A_TOKEN=$TEAM_A_TOKEN
TEAM_B_TOKEN=$TEAM_B_TOKEN
JUDGE_TOKEN=$JUDGE_TOKEN
IDE_A_PASS=$IDE_A_PASS
IDE_B_PASS=$IDE_B_PASS
GRAFANA_PASS=$GRAFANA_PASS
EOF
    chmod 600 "$CREDS_FILE"
    echo "==> Generated fresh credentials → $CREDS_FILE"
  fi
fi

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

# --- TLS: one self-signed wildcard cert for *.hack.local, served as the ingress-nginx
# default certificate so every host (scoreboard/grafana/app/IDE) gets HTTPS with no
# per-Ingress tls block. Fixes code-server's "insecure context" warning. Cert is
# generated once and reused (artifacts/tls). Set GEN_TLS=0 to stay HTTP-only.
if [[ "$GEN_TLS" == "1" ]]; then
  if [[ ! -f "$TLS_DIR/tls.crt" || ! -f "$TLS_DIR/tls.key" ]]; then
    echo "==> Generating self-signed *.hack.local certificate"
    mkdir -p "$TLS_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$TLS_DIR/tls.key" -out "$TLS_DIR/tls.crt" \
      -subj "/O=HackTraining/CN=hack.local" \
      -addext "subjectAltName=DNS:hack.local,DNS:*.hack.local" >/dev/null 2>&1
    chmod 600 "$TLS_DIR/tls.key"
  fi
  echo "==> Installing TLS cert as ingress-nginx default certificate"
  kubectl -n ingress-nginx create secret tls hack-local-tls \
    --cert="$TLS_DIR/tls.crt" --key="$TLS_DIR/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  # Point the controller at it (idempotent — only add the arg once).
  if ! kubectl -n ingress-nginx get deploy ingress-nginx-controller \
        -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null \
        | grep -q 'default-ssl-certificate'; then
    kubectl -n ingress-nginx patch deploy ingress-nginx-controller --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--default-ssl-certificate=ingress-nginx/hack-local-tls"}]' 2>/dev/null || true
  fi
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

# --- Inject generated credentials over the weak training defaults --------------------
# Done after every apply above (the app-specific ConfigMap re-introduces placeholders),
# so a re-run always re-lands the same reused creds. team/judge tokens live in the
# scoreboard ConfigMap (read by scoreboard, checker AND planter — one source, stays
# consistent); IDE and Grafana passwords are plain Deployment env. metadata_plant_token
# and DB passwords are internal-only and left untouched.
if [[ "$GEN_CREDS" == "1" ]]; then
  echo "==> Injecting generated credentials"
  kubectl -n platform get configmap scoreboard-config -o yaml \
    | sed -e "s/team-a-token/${TEAM_A_TOKEN}/g" \
          -e "s/team-b-token/${TEAM_B_TOKEN}/g" \
          -e "s/judge-token/${JUDGE_TOKEN}/g" \
    | kubectl apply -f - >/dev/null
  kubectl -n platform rollout restart deploy/scoreboard deploy/checker deploy/flag-planter 2>/dev/null || true
  kubectl -n team-a set env deploy/code-server PASSWORD="${IDE_A_PASS}" 2>/dev/null || true
  kubectl -n team-b set env deploy/code-server PASSWORD="${IDE_B_PASS}" 2>/dev/null || true
  kubectl -n platform set env deploy/grafana GF_SECURITY_ADMIN_PASSWORD="${GRAFANA_PASS}" 2>/dev/null || true
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

if [[ "$GEN_TLS" == "1" ]]; then
  echo "TLS: HTTPS enabled on all hosts via self-signed *.hack.local cert"
  echo "     (browsers warn — accept once, or import $TLS_DIR/tls.crt as a trusted CA)."
fi

if [[ "$GEN_CREDS" == "1" ]]; then
  cat <<EOF

======================= ORGANIZER CREDENTIALS (distribute) =======================
  Team A  flag token : ${TEAM_A_TOKEN}      IDE (team-a.ide.hack.local): ${IDE_A_PASS}
  Team B  flag token : ${TEAM_B_TOKEN}      IDE (team-b.ide.hack.local): ${IDE_B_PASS}
  Judge   token      : ${JUDGE_TOKEN}
  Grafana admin      : admin / ${GRAFANA_PASS}   (grafana.hack.local)
----------------------------------------------------------------------------------
  Team tokens go to each captain (used on the scoreboard "Submit flag" form).
  Judge token stays with the judge. Saved to: ${CREDS_FILE}
  Re-runs reuse these; delete the file (or set GEN_CREDS=0) to change this behaviour.
==================================================================================
EOF
fi
