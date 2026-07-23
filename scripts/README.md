# Round orchestration scripts (Phase 7)

| Script | Purpose |
|--------|---------|
| `bootstrap-cluster.sh` / `.ps1` | Cluster bring-up (Phase 6) |
| `deploy-team.sh` | Apply one team overlay |
| `reset-round.sh` / `.ps1` | Restore vulnerable baseline (<60s) |
| `swap-roles.sh` / `.ps1` | Scoreboard SoT: `GET /api/round` → `POST /api/round/next` → sync NetPol/labels |
| `collect-logs.sh` / `.ps1` | `artifacts/round-<n>-<team>.tar.gz` |
| `phase8-smoke.sh` / `.ps1` | Full PoC matrix (Phase 8) → `artifacts/phase8-smoke-report.*` |
| `check-app1-identical-src.sh` / `.ps1` | Enforce single shared app1 `src/` |
| `verify-networkpolicy.sh` | Attacker isolation check |

## Typical round end (Linux / Git Bash)

```bash
./scripts/collect-logs.sh --round 1
./scripts/swap-roles.sh --scoreboard-url http://127.0.0.1:3020
./scripts/reset-round.sh --team a --app app2
./scripts/reset-round.sh --team b --app app2
./scripts/verify-networkpolicy.sh   # optional
```

## Windows (PowerShell)

```powershell
.\scripts\collect-logs.ps1 -Round 1
.\scripts\swap-roles.ps1 -ScoreboardUrl http://127.0.0.1:3020
.\scripts\reset-round.ps1 -Team a -App app2
.\scripts\reset-round.ps1 -Team b -App app2
```

If Git Bash/`bash` is on PATH, the `.ps1` wrappers call the `.sh` scripts (full SQL audit dump).

Judge token default: `judge-token` (`# INTENTIONALLY WEAK — training only`).

Env knobs:

| Variable | Meaning |
|----------|---------|
| `SKIP_IMAGE_SET=1` | Do not switch to `*:local` image (useful when images not `kind load`ed) |
| `SCOREBOARD_URL` | For `swap-roles` (default `http://127.0.0.1:3020`) |
| `JUDGE_TOKEN` | Scoreboard judge auth |
| `RESET_IMAGE_APP2` / `RESET_IMAGE_APP1` | Override baseline images |
