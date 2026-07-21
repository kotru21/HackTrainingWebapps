# collect-logs.ps1 — Windows wrapper (prefers Git Bash; native fallback)
param(
  [Parameter(Mandatory = $true)][int]$Round,
  [ValidateSet('a', 'b', 'all')][string]$Team = 'all'
)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot '_common.ps1')
$bash = Get-HackTrainingBash
if ($bash) {
  & $bash (Join-Path $Root 'scripts/collect-logs.sh') --round $Round --team $Team
  exit $LASTEXITCODE
}

$teams = if ($Team -eq 'all') { @('a', 'b') } else { @($Team) }
$art = Join-Path $Root 'artifacts'
New-Item -ItemType Directory -Force -Path $art | Out-Null

foreach ($t in $teams) {
  $ns = "team-$t"
  $dir = Join-Path $art "round-$Round-$t"
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Join-Path $dir 'loki'), (Join-Path $dir 'audit'), (Join-Path $dir 'git'), (Join-Path $dir 'meta') | Out-Null
  Write-Host "==> Collecting $ns"
  kubectl -n $ns logs -l app.kubernetes.io/component=app --tail=5000 --timestamps=true 2>$null |
    Set-Content (Join-Path $dir 'loki\app.log')
  kubectl -n $ns logs -l app.kubernetes.io/component=postgres --tail=5000 --timestamps=true 2>$null |
    Set-Content (Join-Path $dir 'loki\postgres.log')
  @('id,ts,note', '0,,use Git Bash collect-logs.sh for full SQL dump') |
    Set-Content (Join-Path $dir 'audit\security_audit.csv')
  try {
    kubectl -n $ns exec deploy/code-server -- sh -c 'cd /workspace && git diff 2>/dev/null || echo no git' 2>$null |
      Set-Content (Join-Path $dir 'git\workspace.diff')
  } catch {
    'no code-server' | Set-Content (Join-Path $dir 'git\workspace.diff')
  }
  "round=$Round`nteam=$t`ncollected_at=$([DateTime]::UtcNow.ToString('o'))" |
    Set-Content (Join-Path $dir 'meta\info.txt')
  $archive = Join-Path $art "round-$Round-$t.tar.gz"
  if (Get-Command tar -ErrorAction SilentlyContinue) {
    tar -czf $archive -C $art "round-$Round-$t"
    Write-Host "PASS: $archive"
  } else {
    Compress-Archive -Path $dir -DestinationPath ($archive -replace '\.tar\.gz$', '.zip') -Force
    Write-Host "PASS: zip fallback"
  }
}
