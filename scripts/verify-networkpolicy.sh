#!/usr/bin/env bash
# verify-networkpolicy.sh — from an attacker-ns pod, app HTTP works; postgres/code-server/platform fail
set -euo pipefail

ATTACKER_NS="${ATTACKER_NS:-team-b}"
DEFENDER_NS="${DEFENDER_NS:-team-a}"

echo "==> NetworkPolicy check: attacker=$ATTACKER_NS → defender=$DEFENDER_NS"

kubectl -n "$ATTACKER_NS" delete pod np-probe --ignore-not-found --wait=false 2>/dev/null || true
kubectl -n "$ATTACKER_NS" run np-probe --restart=Never --image=busybox:1.36 --command -- sleep 120
kubectl -n "$ATTACKER_NS" wait --for=condition=Ready pod/np-probe --timeout=60s

APP_HOST="app.${DEFENDER_NS}.svc.cluster.local"
PG_HOST="postgres.${DEFENDER_NS}.svc.cluster.local"
IDE_HOST="code-server.${DEFENDER_NS}.svc.cluster.local"
SB_HOST="scoreboard.platform.svc.cluster.local"

echo "-- APP HTTP (expect success)"
if kubectl -n "$ATTACKER_NS" exec np-probe -- wget -qO- --timeout=5 "http://${APP_HOST}/healthz" 2>/dev/null | grep -q ok \
  || kubectl -n "$ATTACKER_NS" exec np-probe -- wget -qO- --timeout=5 "http://${APP_HOST}/" 2>/dev/null | grep -q ok; then
  echo "PASS: attacker can reach defender app HTTP"
else
  echo "FAIL: attacker cannot reach defender app (check egress NetPol allow-egress-to-opponent-app)"
  exit 1
fi

echo "-- postgres :5432 (expect hang/fail)"
if kubectl -n "$ATTACKER_NS" exec np-probe -- nc -z -w 2 "$PG_HOST" 5432; then
  echo "FAIL: attacker reached postgres"
  exit 1
else
  echo "PASS: postgres blocked"
fi

echo "-- code-server :8080 (expect fail)"
if kubectl -n "$ATTACKER_NS" exec np-probe -- nc -z -w 2 "$IDE_HOST" 8080; then
  echo "FAIL: attacker reached code-server"
  exit 1
else
  echo "PASS: code-server blocked"
fi

echo "-- scoreboard platform (expect fail)"
if kubectl -n "$ATTACKER_NS" exec np-probe -- nc -z -w 2 "$SB_HOST" 80; then
  echo "FAIL: attacker reached platform scoreboard"
  exit 1
else
  echo "PASS: platform scoreboard blocked"
fi

kubectl -n "$ATTACKER_NS" delete pod np-probe --wait=false
echo "==> All NetworkPolicy checks passed"
