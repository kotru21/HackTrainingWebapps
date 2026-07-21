# reset-round.ps1 — Windows wrapper (prefers Git Bash; native fallback)
param(
  [Parameter(Mandatory = $true)][ValidateSet('a', 'b')][string]$Team,
  [ValidateSet('app1', 'app2')][string]$App = 'app2',
  [switch]$DryRun
)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot '_common.ps1')
$bash = Get-HackTrainingBash
if ($bash) {
  $ba = @((Join-Path $Root 'scripts/reset-round.sh'), '--team', $Team, '--app', $App)
  if ($DryRun) { $ba += '--dry-run' }
  & $bash @ba
  exit $LASTEXITCODE
}

Write-Host "==> Native PowerShell reset-round team=$Team app=$App"
$ns = "team-$Team"
$image = if ($App -eq 'app2') { 'hacktraining/app2-billing-vulnerable:local' } else { 'hacktraining/app1-helpdesk-vulnerable:local' }
$sw = [Diagnostics.Stopwatch]::StartNew()
if ($DryRun) {
  Write-Host "DRY-RUN: set image $image and rollout restart in $ns"
  exit 0
}
kubectl -n $ns patch deployment app --type json -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"$image\"}]"
kubectl -n $ns rollout restart deployment/app
kubectl -n $ns rollout status deployment/app --timeout=50s
$sw.Stop()
Write-Host ("PASS: reset in {0:N1}s" -f $sw.Elapsed.TotalSeconds)
if ($sw.Elapsed.TotalSeconds -gt 60) { exit 1 }
