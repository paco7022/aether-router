# Auto-check for the Aether Router edge worker "14M" problem.
# Runs unattended (Windows Scheduled Task) every couple of days, queries the
# Cloudflare GraphQL Analytics API for the edge/app worker invocation counts,
# computes the edge subrequests/requests ratio, and appends a verdict line to
# logs/edge-ratio-check.log. Claude reads that log on demand.
#
# Baseline (pre-fix 2026-05-29): ratio 1.9x, ~14.07M edge subrequests/mo.
# Target after the per-isolate circuit breaker (cf-worker version d11d3773): <1.2x.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $repo "logs\edge-ratio-check.log"
$tokenCfg = Join-Path $env:APPDATA "xdg.config\.wrangler\config\default.toml"
$account = "428deed69881812842dffd19183a6d3c"

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Output $line
}

function Get-Token {
  $cfg = Get-Content $tokenCfg -Raw
  return [regex]::Match($cfg, 'oauth_token\s*=\s*"([^"]+)"').Groups[1].Value
}

function Invoke-CfQuery($token) {
  $since = (Get-Date).ToUniversalTime().AddDays(-7).ToString("yyyy-MM-ddTHH:mm:ssZ")
  $until = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $q = @{ query = "query{viewer{accounts(filter:{accountTag:`"$account`"}){workersInvocationsAdaptive(limit:100,filter:{datetime_geq:`"$since`",datetime_leq:`"$until`"}){sum{requests subrequests errors}dimensions{scriptName}}}}}" } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/graphql" -Method Post -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $q
}

try {
  if (-not (Test-Path $logFile)) { New-Item -ItemType File -Path $logFile -Force | Out-Null }

  $token = Get-Token
  $r = $null
  try {
    $r = Invoke-CfQuery $token
  } catch {
    # Token likely expired — refresh via wrangler (uses the stored refresh_token) and retry once.
    Push-Location $repo
    try { & npx wrangler whoami | Out-Null } catch {} finally { Pop-Location }
    $token = Get-Token
    $r = Invoke-CfQuery $token
  }

  if ($r.errors) { Write-Log ("ERROR GraphQL: " + ($r.errors | ConvertTo-Json -Compress)); exit 1 }

  $rows = $r.data.viewer.accounts[0].workersInvocationsAdaptive
  $edge = $rows | Where-Object { $_.dimensions.scriptName -eq "aether-router-edge" } | Select-Object -First 1
  $app  = $rows | Where-Object { $_.dimensions.scriptName -eq "aether-router-app" }  | Select-Object -First 1

  if (-not $edge) { Write-Log "ERROR: no edge worker data returned"; exit 1 }

  $eReq = [double]$edge.sum.requests
  $eSub = [double]$edge.sum.subrequests
  $aReq = if ($app) { [int]$app.sum.requests } else { 0 }
  $ratio = if ($eReq -gt 0) { [math]::Round($eSub / $eReq, 2) } else { 0 }

  $verdict = if ($ratio -lt 1.2) { "OK (objetivo <1.2x cumplido)" }
             elseif ($ratio -lt 1.5) { "PARCIAL - el PC aun cae a veces" }
             else { "ALTO - el PC sigue cayendo; considerar bajar PC_TIMEOUT_MS o acortar la ventana PC" }

  Write-Log ("7d edge req={0:N0} sub={1:N0} ratio={2}x (baseline 1.9x) | app req={3:N0} | {4}" -f $eReq, $eSub, $ratio, $aReq, $verdict)
} catch {
  try { Write-Log ("ERROR: " + $_.Exception.Message) } catch {}
  exit 1
}
