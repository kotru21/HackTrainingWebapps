# swap-roles.ps1 — Windows wrapper (prefers Git Bash; native fallback)
param(
  [string]$ScoreboardUrl = 'http://127.0.0.1:3020',
  [string]$JudgeToken = 'judge-token', # INTENTIONALLY WEAK — training only
  [switch]$DryRun
)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot '_common.ps1')
$bash = Get-HackTrainingBash
if ($bash) {
  $ba = @((Join-Path $Root 'scripts/swap-roles.sh'), '--scoreboard-url', $ScoreboardUrl, '--judge-token', $JudgeToken)
  if ($DryRun) { $ba += '--dry-run' }
  & $bash @ba
  exit $LASTEXITCODE
}

Write-Host '==> Native PowerShell swap-roles'
$roleA = kubectl get ns team-a -o jsonpath='{.metadata.labels.role}'
if (-not $roleA) { $roleA = 'defender' }
if ($roleA -eq 'defender') {
  $newA, $newB, $attacker, $defender = 'attacker', 'defender', 'a', 'b'
} else {
  $newA, $newB, $attacker, $defender = 'defender', 'attacker', 'b', 'a'
}
Write-Host "Swap → team-a=$newA team-b=$newB attacker=$attacker defender=$defender"
if ($DryRun) { exit 0 }

kubectl label ns team-a "role=$newA" team=a name=team-a --overwrite
kubectl label ns team-b "role=$newB" team=b name=team-b --overwrite

$patchFrom = {
  param($ns, $team)
  kubectl -n $ns patch networkpolicy allow-attacker-to-app-http --type json `
    -p "[{\"op\":\"replace\",\"path\":\"/spec/ingress/0/from/0/namespaceSelector/matchLabels/team\",\"value\":\"$team\"}]"
}
$patchEgress = {
  param($ns, $team)
  kubectl -n $ns patch networkpolicy allow-egress-to-opponent-app --type json `
    -p "[{\"op\":\"replace\",\"path\":\"/spec/egress/0/to/0/namespaceSelector/matchLabels/team\",\"value\":\"$team\"}]"
}

& $patchFrom "team-$defender" $attacker
& $patchFrom "team-$attacker" 'disabled'
& $patchEgress "team-$attacker" $defender
& $patchEgress "team-$defender" 'disabled'

try {
  $r = Invoke-RestMethod -Method Post -Uri "$ScoreboardUrl/api/round/next" -Headers @{ 'X-Judge-Token' = $JudgeToken }
  Write-Host "scoreboard: $($r | ConvertTo-Json -Compress)"
  $n = $r.n
} catch {
  Write-Warning "scoreboard unreachable: $_"
  $n = 2
}

$stateDir = Join-Path $Root 'artifacts'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
@"
ROUND=$n
ATTACKER_TEAM=$attacker
DEFENDER_TEAM=$defender
ROLE_A=$newA
ROLE_B=$newB
SWAPPED_AT=$([DateTime]::UtcNow.ToString('o'))
"@ | Set-Content (Join-Path $stateDir 'round-state.env')
Write-Host 'PASS: roles swapped'
