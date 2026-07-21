# check-app1-identical-src.ps1 — Phase 8 / SPEC §11
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$fail = 0
if (Test-Path "$Root\apps\app1-helpdesk\vulnerable\src") {
  Write-Host "FAIL: apps/app1-helpdesk/vulnerable/src must not exist (config-only variant)"
  $fail = 1
}
if (Test-Path "$Root\apps\app1-helpdesk\reference\src") {
  Write-Host "FAIL: apps/app1-helpdesk/reference/src must not exist"
  $fail = 1
}
if (-not (Test-Path "$Root\apps\app1-helpdesk\src")) {
  Write-Host "FAIL: shared apps/app1-helpdesk/src missing"
  $fail = 1
}
if ($fail -eq 0) {
  Write-Host "PASS: app1 uses a single shared src/ (vulnerable≠reference only via config/deps)"
}
exit $fail
