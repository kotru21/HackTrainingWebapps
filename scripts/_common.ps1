function Get-HackTrainingBash {
  $candidates = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  # Avoid Windows System32 bash.exe (WSL launcher without distro)
  $cmd = Get-Command bash.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -notmatch '\\System32\\' -and $_.Source -notmatch '\\WindowsApps\\' } |
    Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $null
}
