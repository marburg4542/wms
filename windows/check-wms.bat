@echo off
REM ============================================================================
REM  Status at a glance - read only, changes nothing.
REM  Does NOT need administrator: anyone taking over this machine can run it.
REM
REM  Answers the question "is the system alright?" without needing to know
REM  what a tunnel or a scheduled task is.
REM
REM  These three must match backup-now.bat and server\.env
REM ============================================================================
setlocal
set "APP_PORT=5000"
set "BACKUP_DEST=G:\wms-backups"
set "SECRETS_DEST=G:\wms-secrets"

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
  REM Read the word, not the number: "STATE : 4  RUNNING" splits so that the
  REM third token is the code 4, which tells a human nothing.
  sc query cloudflared | findstr /C:"RUNNING" >nul
  if errorlevel 1 (
    echo     Service exists but is NOT running - the site is unreachable
    echo     from outside. Start it from Services, or reinstall the tunnel.
  ) else (
    echo     Running - the site is reachable from outside.
  )
)
echo.

echo [4] Daily backup task
powershell -NoProfile -Command "$i = Get-ScheduledTaskInfo -TaskName 'WMS Backup' -ErrorAction SilentlyContinue; if ($i) { '     Last run : ' + $i.LastRunTime + '   (exit code ' + $i.LastTaskResult + ')'; '     Next run : ' + $i.NextRunTime } else { '     NOT REGISTERED - nothing is backing this machine up.'; '     Run install-backup-task.bat as administrator to fix.' }"
echo.

echo [5] Backups on %BACKUP_DEST%
REM Count database FILES, never folders. Folders are nested by year/month now,
REM so anything that counts top-level folders sees two ("database", "uploads")
REM and cheerfully reports healthy forever.
powershell -NoProfile -Command "$d = $env:BACKUP_DEST; if (-not (Test-Path $d)) { '     Destination not reachable - is the drive connected?'; exit }; $dbs = @(Get-ChildItem (Join-Path $d 'database') -Recurse -File -Filter 'identifier-*.sqlite' -ErrorAction SilentlyContinue); if ($dbs.Count -eq 0) { '     No database backups yet.' } else { $n = $dbs | Sort-Object Name | Select-Object -Last 1; $age = [int]((Get-Date) - $n.LastWriteTime).TotalHours; '     Database : ' + $n.Name + '   ' + $age + ' hours ago'; '     History  : ' + $dbs.Count + ' daily copies, ' + ('{0:N0}' -f (($dbs | Measure-Object Length -Sum).Sum / 1MB)) + ' MB'; if ($age -gt 48) { '     [!] More than 2 days old - the backup task is not running.' } }; $up = @(Get-ChildItem (Join-Path $d 'uploads') -Recurse -File -ErrorAction SilentlyContinue); if ($up.Count -eq 0) { '     Images   : none mirrored yet.' } else { '     Images   : ' + $up.Count + ' files, ' + ('{0:N0}' -f (($up | Measure-Object Length -Sum).Sum / 1MB)) + ' MB' }; if (Test-Path (Join-Path $env:SECRETS_DEST '.env')) { '     Settings : .env copy present in ' + $env:SECRETS_DEST } else { '     [!] No .env copy in ' + $env:SECRETS_DEST + ' - this machine cannot be rebuilt without it.' }; $old = @(Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '20??-??-??T*' }); if ($old.Count -gt 0) { '     [!] ' + $old.Count + ' old-format backup sets are still here (~230 MB each).' }"
echo.

echo [6] Last 15 lines of wms.log
REM -Encoding UTF8: node writes its startup lines as UTF-8, and without this
REM they come back as garbled characters that look like an error but are not.
powershell -NoProfile -Command "if (Test-Path $env:LOG) { Get-Content $env:LOG -Tail 15 -Encoding UTF8 | ForEach-Object { '     ' + $_ } } else { '     No log file yet.' }"
echo.

echo ============================================================
echo.
pause
