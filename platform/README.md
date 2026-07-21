# Platform scoring services (Phase 4+)
#
# scoreboard — Express + PG, flag submit + live board
# flag-planter — plants TRN{...} into stand DBs / metadata each tick
# checker — SLA scenarios → sla_samples
# internal-metadata — SSRF target with POST /plant
#
# Preferred local full stack (Phase 5):
#   docker compose -f deploy/docker/compose.dev.yml up --build -d
#
# Manual (without compose):
#   docker run -d --name scoreboard-pg -e POSTGRES_USER=scoreboard \
#     -e POSTGRES_PASSWORD=scoreboard -e POSTGRES_DB=scoreboard -p 5435:5432 postgres:16-alpine
#   npm run build:platform
#   npm run dev -w @hacktraining/scoreboard
#   npm run start -w @hacktraining/internal-metadata
#   npm run once -w @hacktraining/flag-planter
#   npm run once -w @hacktraining/checker
#   node tools/attacker-scripts/phase4-e2e.mjs
#
# Compose network config: platform/scoreboard/config.compose.yaml
# Host/dev config: platform/scoreboard/config.yaml
# Secrets marked INTENTIONALLY WEAK — training only
