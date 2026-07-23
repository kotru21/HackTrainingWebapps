# HackTrainingWebapps — Kubernetes / k3s (Phase 6)

## Layout

| Path | Purpose |
|------|---------|
| `base/` | namespaces platform/team-a/team-b, PSA labels, ClusterRole |
| `team-template/` | app + postgres + code-server + PVC + NetworkPolicy + Ingress |
| `overlays/team-a\|team-b` | team hosts, attacker peer, images |
| `overlays/kind/` | optional aggregate + `standard` StorageClass |
| `overlays/round-roles.yaml` | defender/attacker namespace labels (round 1) |
| `platform/` | scoreboard, checker, planter, metadata, Loki, Alloy, Grafana (5 dashboards) |

## Target cluster (SPEC)

```bash
# On Linux training VM:
curl -sfL https://get.k3s.io | sh -s - --disable traefik
# then install ingress-nginx (ingressClassName: nginx)
./scripts/bootstrap-cluster.sh
./scripts/verify-networkpolicy.sh
```

## Windows host

k3s is not native on Windows. Use:

1. **Preferred:** Linux VM / WSL2 with k3s + `bootstrap-cluster.sh`
2. **Dev stand-in:** Docker Desktop + `kind` + `scripts/bootstrap-cluster.ps1` (Calico for NetworkPolicy)

```powershell
# Validate manifests without cluster:
kubectl kustomize deploy/k8s/base
kubectl kustomize deploy/k8s/platform
kubectl kustomize deploy/k8s/overlays/team-a

# Optional kind bootstrap:
.\scripts\bootstrap-cluster.ps1
```

Build & load images before apply (names expected by manifests):

```powershell
docker build -t hacktraining/app2-billing-vulnerable:local -f apps/app2-billing/vulnerable/Dockerfile .
docker build -t hacktraining/scoreboard:local -f platform/scoreboard/Dockerfile .
docker build -t hacktraining/flag-planter:local -f platform/flag-planter/Dockerfile .
docker build -t hacktraining/checker:local -f platform/checker/Dockerfile .
docker build -t hacktraining/internal-metadata:local -f platform/internal-metadata/Dockerfile .
docker build -t hacktraining/code-server:local -f platform/code-server/Dockerfile .
```

## NetworkPolicy contract

- Default deny ingress+egress in team + platform namespaces
- **Egress** from a team to opponent **app HTTP only** (`allow-egress-to-opponent-app`) — required or attacks hang
- **Ingress** on defender app from attacker namespace HTTP only (`allow-attacker-to-app-http`)
- postgres / code-server / platform scoreboard **not** reachable from attacker
- Platform checker/planter → team apps (+ DB for planter)
- Team app → `internal-metadata` (SSRF lab)

Verify:

```bash
./scripts/verify-networkpolicy.sh
# ATTACKER_NS=team-b DEFENDER_NS=team-a ./scripts/verify-networkpolicy.sh
```

## Team kubeconfigs

`bootstrap-cluster.sh` writes `artifacts/kubeconfigs/team-{a,b}.kubeconfig` scoped via SA `team-user` + Role `team-operator`.

## Phase 7

`reset-round.sh` / `swap-roles.sh` / `collect-logs.sh` — см. [`scripts/README.md`](../../scripts/README.md).
Round role labels: `deploy/k8s/overlays/round-roles.yaml` (rewritten by `swap-roles.sh`).
