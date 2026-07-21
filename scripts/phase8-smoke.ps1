# phase8-smoke.ps1 — run full PoC matrix against compose (or custom bases)
param(
  [switch]$SkipApp1,
  [switch]$SkipApp2,
  [switch]$SkipScoring,
  [switch]$SkipSla
)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$args = @((Join-Path $Root 'tools/attacker-scripts/phase8-smoke.mjs'))
if ($SkipApp1) { $args += '--skip-app1' }
if ($SkipApp2) { $args += '--skip-app2' }
if ($SkipScoring) { $args += '--skip-scoring' }
if ($SkipSla) { $args += '--skip-sla' }
Push-Location $Root
try {
  & node @args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
