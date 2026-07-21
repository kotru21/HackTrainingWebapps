#!/usr/bin/env bash
# collect-logs.sh — archive pod/Loki logs + security_audit + git-diff for forensics
# Usage: ./scripts/collect-logs.sh --round N [--team a|b|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUND=""
TEAM="all"
LOKI_URL="${LOKI_URL:-http://127.0.0.1:3100}"
SINCE="${COLLECT_SINCE:-2h}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --round) ROUND="${2:-}"; shift 2 ;;
    --team) TEAM="${2:-}"; shift 2 ;;
    --loki-url) LOKI_URL="${2:-}"; shift 2 ;;
    --since) SINCE="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --round N [--team a|b|all] [--since 2h]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ROUND" ]]; then
  echo "ERROR: --round N required" >&2
  exit 1
fi

TEAMS=()
if [[ "$TEAM" == "all" ]]; then
  TEAMS=(a b)
else
  TEAMS=("$TEAM")
fi

ART_ROOT="$ROOT/artifacts"
mkdir -p "$ART_ROOT"

dump_audit() {
  local ns="$1" out="$2"
  local pg_pod
  pg_pod=$(kubectl -n "$ns" get pods -l app.kubernetes.io/component=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$pg_pod" ]]; then
    printf 'id,ts,note\n0,,no postgres pod\n' >"$out"
    return
  fi
  if kubectl -n "$ns" exec "$pg_pod" -- \
    psql -U billing -d billing -v ON_ERROR_STOP=1 -c \
    "COPY (SELECT id, ts, team, actor, event, route, src_ip, detail FROM security_audit ORDER BY ts) TO STDOUT WITH CSV HEADER" \
    >"$out" 2>/dev/null; then
    return
  fi
  printf 'id,ts,note\n0,,audit query failed\n' >"$out"
}

collect_one() {
  local t="$1"
  local ns="team-${t}"
  local dir="$ART_ROOT/round-${ROUND}-${t}"
  rm -rf "$dir"
  mkdir -p "$dir"/{loki,audit,git,meta}

  echo "==> Collecting $ns → $dir"

  kubectl -n "$ns" logs -l app.kubernetes.io/component=app --tail=5000 --timestamps=true \
    >"$dir/loki/app.log" 2>/dev/null || echo "(no app logs)" >"$dir/loki/app.log"
  kubectl -n "$ns" logs -l app.kubernetes.io/component=postgres --tail=5000 --timestamps=true \
    >"$dir/loki/postgres.log" 2>/dev/null || echo "(no postgres logs)" >"$dir/loki/postgres.log"
  kubectl -n platform logs -l app.kubernetes.io/name=scoreboard --tail=2000 --timestamps=true \
    >"$dir/loki/scoreboard.log" 2>/dev/null || true

  if command -v curl >/dev/null 2>&1; then
    local end start
    end="$(date +%s)000000000"
    if date -d "$SINCE ago" +%s >/dev/null 2>&1; then
      start="$(date -d "$SINCE ago" +%s)000000000"
    else
      start="$(( $(date +%s) - 7200 ))000000000"
    fi
    curl -sfG "${LOKI_URL}/loki/api/v1/query_range" \
      --data-urlencode "query={namespace=\"${ns}\"}" \
      --data-urlencode "start=${start}" \
      --data-urlencode "end=${end}" \
      --data-urlencode "limit=5000" \
      -o "$dir/loki/loki-query.json" 2>/dev/null \
      || echo '{"status":"skipped","reason":"loki unreachable"}' >"$dir/loki/loki-query.json"
  fi

  dump_audit "$ns" "$dir/audit/security_audit.csv"

  # Submissions without flag column (forensics by vuln_id / timing only)
  local spg
  spg=$(kubectl -n platform get pods -l app.kubernetes.io/name=scoreboard-pg -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -n "$spg" ]]; then
    kubectl -n platform exec "$spg" -- \
      psql -U scoreboard -d scoreboard -c \
      "COPY (SELECT id, submitter_team, vuln_id, points, status, first_blood, src_ip, submitted_at FROM submissions ORDER BY submitted_at) TO STDOUT WITH CSV HEADER" \
      >"$dir/audit/submissions.csv" 2>/dev/null \
      || echo "id,note" >"$dir/audit/submissions.csv"
  fi

  if kubectl -n "$ns" get deploy code-server >/dev/null 2>&1; then
    kubectl -n "$ns" exec "deploy/code-server" -- sh -c \
      'cd /workspace 2>/dev/null && (git status -sb; echo ---; git diff; echo ---; git diff --cached) 2>/dev/null || echo no git repo in workspace' \
      >"$dir/git/workspace.diff" 2>/dev/null \
      || echo "code-server exec failed" >"$dir/git/workspace.diff"
  else
    echo "no code-server" >"$dir/git/workspace.diff"
  fi

  {
    echo "round=${ROUND}"
    echo "team=${t}"
    echo "namespace=${ns}"
    echo "collected_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    kubectl get ns "$ns" --show-labels 2>/dev/null || true
  } >"$dir/meta/info.txt"

  local archive="$ART_ROOT/round-${ROUND}-${t}.tar.gz"
  tar -czf "$archive" -C "$ART_ROOT" "round-${ROUND}-${t}"
  echo "PASS: wrote $archive ($(du -h "$archive" | awk '{print $1}'))"
}

for t in "${TEAMS[@]}"; do
  collect_one "$t"
done
