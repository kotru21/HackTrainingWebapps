# Definition of Done — HackTrainingWebapps (SPEC §11)

Evidence collected in Phase 8 acceptance. Checkboxes reflect project readiness as of the Phase 8 smoke run.

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Both apps run via `compose.dev.yml` and k8s manifests exist | **PASS** | `deploy/docker/compose.dev.yml` healthy; `deploy/k8s/**` + Phase 6 apply/NP |
| 2 | app1 identical `src/` (config-only diffs) | **PASS** | `scripts/check-app1-identical-src.sh`; no `vulnerable/src` or `reference/src` |
| 3 | app2: vuln exploitable, reference fixed | **PASS** | `artifacts/phase8-smoke-report.md` — V2.1–V2.6 vuln PASS / ref FAIL |
| 4 | PoC + SOLUTION.md per vuln | **PASS** | `tools/attacker-scripts/app{1,2}/*`; `apps/*/reference/SOLUTION.md` |
| 5 | planter → submit → SLA checker e2e | **PASS** | Phase 4/5 e2e; smoke `scoring-e2e` + SLA both variants |
| 6 | Loki + 5 Grafana dashboards provisioned | **PASS** | `deploy/k8s/platform/grafana-dashboards.yaml` (5 boards) + Loki/Promtail |
| 7 | `reset-round.sh` baseline &lt; 60s | **PASS** | Phase 7: reset in 49s on kind-sec |
| 8 | NetworkPolicy blocks postgres/IDE/platform from attacker | **PASS** | Phase 6: `verify-networkpolicy` / Calico probe |
| 9 | `instructor-guide.md` roles/timing/hints/checklist | **PASS** | `docs/instructor-guide.md` (+ §9 smoke) |

## How to re-run acceptance

```powershell
docker compose -f deploy/docker/compose.dev.yml up -d
.\scripts\phase8-smoke.ps1
.\scripts\check-app1-identical-src.ps1
```

k3s round path (Linux VM): `bootstrap-cluster.sh` → train → `collect-logs` → `swap-roles` → `reset-round` (Phases 6–7).

## Known gaps (non-blocking for DoD)

- Full two-team live match on bare-metal k3s should be rehearsed on the training VM (Windows host used kind + compose for evidence).
- Load `hacktraining/*:local` images into kind before expecting vulnerable images without `SKIP_IMAGE_SET`.
