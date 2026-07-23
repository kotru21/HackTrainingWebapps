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

Write-Host '==> Native PowerShell swap-roles (scoreboard is role SoT)'

try {
  $cur = Invoke-RestMethod -Method Get -Uri "$ScoreboardUrl/api/round"
} catch {
  Write-Error "cannot read $ScoreboardUrl/api/round — scoreboard is the role source of truth: $_"
  exit 1
}

Write-Host "Scoreboard round $($cur.n) roles: attacker=$($cur.attacker_team) defender=$($cur.defender_team)"
Write-Host "Swap → attacker=$($cur.defender_team) defender=$($cur.attacker_team)"
if ($DryRun) {
  Write-Host "DRY-RUN: would POST $ScoreboardUrl/api/round/next then label NetPols from response"
  exit 0
}

try {
  $r = Invoke-RestMethod -Method Post -Uri "$ScoreboardUrl/api/round/next" -Headers @{ 'X-Judge-Token' = $JudgeToken }
  Write-Host "scoreboard: $($r | ConvertTo-Json -Compress)"
} catch {
  Write-Error "POST /api/round/next failed — refusing to patch k8s out of sync: $_"
  exit 1
}

$attacker = [string]$r.attacker_team
$defender = [string]$r.defender_team
$n = $r.n
if (-not $attacker -or -not $defender) {
  Write-Error "/api/round/next missing roles"
  exit 1
}

if ($defender -eq 'a') {
  $newA, $newB = 'defender', 'attacker'
} else {
  $newA, $newB = 'attacker', 'defender'
}

Write-Host "Syncing k8s → team-a=$newA team-b=$newB (attacker=$attacker defender=$defender)"

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
