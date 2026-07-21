# bootstrap-cluster.ps1 — Windows host using kind (Docker Desktop)
# k3s on bare metal/WSL is preferred for production training VMs; this path validates manifests.
param(
  [string]$ClusterName = "hacktraining",
  [switch]$SkipCreate
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$K8s = Join-Path $Root "deploy\k8s"

Write-Host "==> Phase 6 bootstrap via kind ($ClusterName)"

if (-not (Get-Command kind -ErrorAction SilentlyContinue)) {
  throw "kind.exe not found. Install kind or run scripts/bootstrap-cluster.sh on a k3s Linux VM."
}
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
  throw "kubectl not found"
}

if (-not $SkipCreate) {
  $existing = kind get clusters 2>$null
  if ($existing -notcontains $ClusterName) {
    Write-Host "==> Creating kind cluster (disable default CNI for Calico NP)"
    @"
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: $ClusterName
networking:
  disableDefaultCNI: true
  kubeProxyMode: iptables
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 8080
        protocol: TCP
      - containerPort: 443
        hostPort: 8443
        protocol: TCP
"@ | kind create cluster --config=-
    Write-Host "==> Install Calico (NetworkPolicy)"
    kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.29.1/manifests/calico.yaml
    kubectl -n kube-system wait --for=condition=ready pod -l k8s-app=calico-node --timeout=300s
  } else {
    Write-Host "==> kind cluster $ClusterName already exists"
    kind export kubeconfig --name $ClusterName
  }
}

Write-Host "==> Install ingress-nginx (kind)"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=available deploy/ingress-nginx-controller --timeout=300s

Write-Host "==> Optional: load local images (build first with docker compose build)"
$images = @(
  "hacktraining/app2-billing-vulnerable:local",
  "hacktraining/scoreboard:local",
  "hacktraining/flag-planter:local",
  "hacktraining/checker:local",
  "hacktraining/internal-metadata:local"
)
foreach ($img in $images) {
  docker image inspect $img 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "    kind load $img"
    kind load docker-image $img --name $ClusterName
  } else {
    Write-Host "    skip missing image $img"
  }
}

Write-Host "==> Apply kustomize (kind overlay = standard StorageClass)"
kubectl apply -k (Join-Path $K8s "base")
kubectl apply -f (Join-Path $K8s "overlays\round-roles.yaml")
kubectl apply -k (Join-Path $K8s "platform")
# Patch scoreboard-pg storage for kind
kubectl -n platform patch statefulset scoreboard-pg --type json -p "[{\"op\":\"replace\",\"path\":\"/spec/volumeClaimTemplates/0/spec/storageClassName\",\"value\":\"standard\"}]" 2>$null
kubectl apply -k (Join-Path $K8s "overlays\team-a")
kubectl apply -k (Join-Path $K8s "overlays\team-b")
kubectl get pvc -A | ForEach-Object { $_ }

Write-Host @"

Bootstrap applied. Next:
  kubectl get pods -A
  bash scripts/verify-networkpolicy.sh   # from Git Bash / WSL if available
  # Or: kubectl apply -f deploy/k8s/platform/netpol-probe-job.yaml

Note: full k3s with --disable traefik is the SPEC target; kind is a Windows-dev stand-in.
"@
