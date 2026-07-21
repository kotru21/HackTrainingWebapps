# Local Docker compose (Phase 5)

Full polygon without k8s:

```powershell
# Free host ports if older containers use 5433–5435 / 3001–3022 / 3099
docker rm -f billing-pg helpdesk-pg scoreboard-pg 2>$null

docker compose -f deploy/docker/compose.dev.yml up --build -d
docker compose -f deploy/docker/compose.dev.yml ps

# PoC against published ports (from repo root, host Node)
node tools/attacker-scripts/app2/sqli.mjs --base http://127.0.0.1:3011
node tools/attacker-scripts/app2/sla-smoke.mjs --base http://127.0.0.1:3011
node tools/attacker-scripts/app2/sla-smoke.mjs --base http://127.0.0.1:3012
# SSRF: avatar fetch runs inside the app container — use compose DNS name
node tools/attacker-scripts/app2/ssrf.mjs --base http://127.0.0.1:3011 --metadata http://internal-metadata:3099/flag
node tools/attacker-scripts/phase4-e2e.mjs --scoreboard http://127.0.0.1:3020 --base http://127.0.0.1:3011

# Scoreboard UI
# http://127.0.0.1:3020/

docker compose -f deploy/docker/compose.dev.yml down -v
```

Services: app1 vuln/ref, app2 vuln/ref, three Postgres, scoreboard, flag-planter, checker, internal-metadata.

Reference images: pinned `node:22.16.0-bookworm-slim`, non-root `USER app`.
Vulnerable images: soft (root / unpinned where intentional for V1.8).
