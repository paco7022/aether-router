#requires -version 5
# Sync the local PC deployment with origin/master.
# - Fetch + check for new commits.
# - If new: pull, install deps, build, reload PM2.
# - All output is appended to logs/sync.log.
#
# Designed to be run from Task Scheduler every few minutes. Idempotent and
# bails out quickly when there is nothing to do (the common case).

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$logDir     = Join-Path $repoRoot "logs"
$logFile    = Join-Path $logDir "sync.log"
$lockFile   = Join-Path $repoRoot ".sync.lock"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }

function Log($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] $msg"
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

# Prevent overlapping runs (build can be slow).
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 30) {
    Log "lock present (age $([int]$lockAge.TotalMinutes)m), skipping"
    exit 0
  }
  Log "stale lock removed"
  Remove-Item $lockFile -Force
}
New-Item $lockFile -ItemType File | Out-Null

try {
  Set-Location $repoRoot

  $before = (git rev-parse HEAD).Trim()
  git fetch origin master --quiet 2>&1 | Out-Null
  $after  = (git rev-parse origin/master).Trim()

  if ($before -eq $after) {
    # No changes — exit silently (no log spam)
    exit 0
  }

  Log "new commits detected: $before -> $after"

  # Only allow ff merges to avoid surprises from local edits.
  $pullOutput = git pull --ff-only origin master 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log "git pull failed: $pullOutput"
    exit 1
  }
  Log "pulled OK"

  # If package-lock.json was touched, install. Otherwise skip.
  $changedFiles = (git diff --name-only "$before" "$after") -split "`n"
  if ($changedFiles -contains "package-lock.json" -or $changedFiles -contains "package.json") {
    Log "deps changed, running npm install"
    $npmOut = npm install --no-audit --no-fund 2>&1
    if ($LASTEXITCODE -ne 0) {
      Log "npm install failed: $npmOut"
      exit 1
    }
  }

  Log "building"
  $buildOut = npm run build 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log "build failed: $buildOut"
    Log "PM2 not reloaded - keeping previous version running"
    exit 1
  }

  Log "reloading pm2"
  $reloadOut = pm2 reload aether-router --update-env 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log "pm2 reload failed: $reloadOut"
    exit 1
  }
  Log "deploy synced to $after"
}
finally {
  if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
}
