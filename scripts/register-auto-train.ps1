# Registers a Windows Scheduled Task that runs the training auto-runner daily.
# The runner is a no-op until a milestone (50M/100M/200M clean tokens) is reached,
# then it exports the dataset (and optionally launches QLoRA training).
#
# Run once, from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts/register-auto-train.ps1
#
# To enable hands-off training (after installing the Unsloth/Python env), set the
# AUTO_TRAIN env var for the task by editing $autoTrain below to "1".

$ErrorActionPreference = "Stop"
$repo   = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runner = Join-Path $repo "scripts\auto-train-runner.mjs"
$node   = (Get-Command node).Source
$autoTrain = "0"   # set to "1" to auto-launch training when a milestone hits

$taskName = "AetherTrainingAutoRunner"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$runner`"" -WorkingDirectory $repo
# Daily at 01:00; the milestone usually trips overnight via organic traffic.
$trigger = New-ScheduledTaskTrigger -Daily -At 1:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 8)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Pass AUTO_TRAIN to the task's environment via a tiny wrapper is overkill; instead
# bake it into the action args by exporting before node. Simplest: use cmd /c.
if ($autoTrain -eq "1") {
  $action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c set AUTO_TRAIN=1 && `"$node`" `"$runner`"" -WorkingDirectory $repo
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Aether: export training dataset (and optional QLoRA train) when a token milestone is reached." | Out-Null

Write-Host "Registered scheduled task '$taskName' (daily 01:00, AUTO_TRAIN=$autoTrain)."
Write-Host "Test it now with:  node scripts/auto-train-runner.mjs --force --dry"
