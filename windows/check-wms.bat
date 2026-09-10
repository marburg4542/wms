@echo off
REM ============================================================================
REM  Status at a glance - read only, changes nothing.
REM  Does NOT need administrator: anyone taking over this machine can run it.
REM
REM  Answers the question "is the system alright?" without needing to know
REM  what a tunnel or a scheduled task is.
REM
REM  APP_PORT / BACKUP_DEST must match backup-now.bat and server\.env
REM ============================================================================
setlocal
set "APP_PORT=5000"
set "BACKUP_DEST=G:\wms-backups"

pushd "%~dp0.."
set "ROOT=%CD%"
popd
set "LOG=%ROOT%\wms.log"

echo.
echo ============================================================
echo   WMS status      %date% %time%
echo   Folder: %ROOT%
echo ============================================================
echo.

echo [1] Server
netstat -ano | findstr /C:":%APP_PORT% " | findstr LISTENING >nul
if errorlevel 1 (
  echo     DOWN - nothing is listening on port %APP_PORT%
  echo     Staff cannot use the system right now.
) else (
  echo     UP - serving on port %APP_PORT%
)
echo.

echo [2] Auto-start task
schtasks /query /tn "WMS" >nul 2>&1
if errorlevel 1 (
  echo     NOT REGISTERED - the system will NOT come back after a reboot.
  echo     Run install-wms-task.bat as administrator to fix.
) else (
  echo     Registered - Windows will start the server at every boot.
)
echo.

echo [3] Cloudflare tunnel
sc query cloudflared >nul 2>&1
if errorlevel 1 (
  echo     Service "cloudflared" not found - the site is unreachable from
  echo     outside even if the server above is UP.
) else (
  for /f "tokens=3" %%S in ('sc query cloudflared ^| findstr /C:"STATE"') do echo     Service state: %%S
)
echo.

echo [4] Daily backup task
powershell -NoProfile -Command "$i = Get-ScheduledTaskInfo -TaskName 'WMS Backup' -ErrorAction SilentlyContinue; if ($i) { '     Last run : ' + $i.LastRunTime + '   (exit code ' + $i.LastTaskResult + ')'; '     Next run : ' + $i.NextRunTime } else { '     NOT REGISTERED - nothing is backing this machine up.'; '     Run install-backup-task.bat as administrator to fix.' }"
echo.

echo [5] Backups on %BACKUP_DEST%
powershell -NoProfile -Command "$d = $env:BACKUP_DEST; if (-not (Test-Path $d)) { '     Destination not reachable - is the drive connected?' } else { $sets = @(Get-ChildItem $d -Directory -ErrorAction SilentlyContinue); if ($sets.Count -eq 0) { '     No backup sets yet.' } else { $b = $sets | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $mb = (Get-ChildItem $b.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB; $age = [int]((Get-Date) - $b.LastWriteTime).TotalHours; '     Newest  : ' + $b.Name + '   ' + ('{0:N0}' -f $mb) + ' MB   ' + $age + ' hours ago'; '     Sets    : ' + $sets.Count; if ($age -gt 48) { '     [!] More than 2 days old - check the backup task.' } } }"
echo.

echo [6] Last 15 lines of wms.log
powershell -NoProfile -Command "if (Test-Path $env:LOG) { Get-Content $env:LOG -Tail 15 | ForEach-Object { '     ' + $_ } } else { '     No log file yet.' }"
echo.

echo ============================================================
echo.
pause
