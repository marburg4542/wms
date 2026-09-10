# ============================================================================
#  Registers the daily backup task. Called by install-backup-task.bat -
#  do not run this directly.
#
#  Why PowerShell instead of schtasks: this task needs StartWhenAvailable,
#  which the schtasks command line cannot set. That setting is the whole point
#  here - the production PC is also somebody's work machine and gets shut down,
#  so a plain 02:00 daily task would simply never fire on those days. With
#  StartWhenAvailable, a missed run happens the next time the PC is on.
#
#  ASCII only, same reason as the .bat files.
# ============================================================================
param(
  [Parameter(Mandatory = $true)][string]$BatPath,
  [string]$TaskName = 'WMS Backup',
  [string]$AtTime   = '02:00'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $BatPath)) {
  Write-Output "  Cannot find $BatPath"
  exit 1
}

# cmd.exe /c is needed so the .bat runs; --silent suppresses its pause.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $BatPath + '" --silent')

$trigger = New-ScheduledTaskTrigger -Daily -At $AtTime

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries

# SYSTEM, so the backup runs even when nobody has logged in.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Output "  Registered scheduled task: $TaskName"
Write-Output "  Runs daily at $AtTime, and catches up on the next boot if the PC was off."
exit 0
