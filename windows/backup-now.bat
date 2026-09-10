@echo off
REM ============================================================================
REM  Back up the database + uploads, and keep a copy of server\.env.
REM  Safe to run while staff are using the system - SQLite's own backup API
REM  produces a consistent snapshot without stopping anything.
REM
REM  Double-click (Run as administrator not required) or let the scheduled
REM  task call it with --silent.
REM
REM  ---- EDIT THESE TWO LINES IF THE DRIVE CHANGES ----
REM  Keep them on a DIFFERENT physical drive than the app, so one dead disk
REM  cannot take the live data and every backup with it.
REM ============================================================================
setlocal
set "BACKUP_DEST=G:\wms-backups"
set "SECRETS_DEST=G:\wms-secrets"
set "KEEP=14"
REM ---------------------------------------------------------------------------

pushd "%~dp0.."
set "ROOT=%CD%"
popd
set "RUNLOG=%ROOT%\backup.log"

set "SILENT="
if /i "%~1"=="--silent" set "SILENT=1"

REM The scheduled task runs as SYSTEM, where node may not be on PATH.
set "NODE=node"
where node >nul 2>&1 || set "NODE=C:\Program Files\nodejs\node.exe"

REM A missing destination drive is the most likely failure, and the one that
REM would otherwise fail silently every night for months. Fail loudly instead.
if not exist "%BACKUP_DEST%\." (
  for %%D in ("%BACKUP_DEST%") do set "DRV=%%~dD"
)
if not exist "%BACKUP_DEST%\." (
  if not exist "%DRV%\" (
    echo [%date% %time%] FAILED - drive %DRV% not found, backup skipped >> "%RUNLOG%"
    echo.
    echo   [!] Drive %DRV% was not found, so nothing was backed up.
    echo       Edit BACKUP_DEST at the top of this file, then run it again.
    echo.
    if not defined SILENT pause
    exit /b 1
  )
  mkdir "%BACKUP_DEST%" 2>nul
)

echo.
echo   Backing up to %BACKUP_DEST% ...
echo   Staff can keep using the system while this runs.
echo.

cd /d "%ROOT%\server"
set "BACKUP_DIR=%BACKUP_DEST%"
set "BACKUP_KEEP=%KEEP%"
"%NODE%" tools\backup.mjs
if errorlevel 1 (
  echo [%date% %time%] FAILED - backup.mjs returned an error >> "%RUNLOG%"
  echo.
  echo   [!] Backup failed. See the message above.
  echo.
  if not defined SILENT pause
  exit /b 1
)

REM server\.env is deliberately NOT part of the backup set - it holds secrets.
REM But losing it means losing the VAPID keys, which would force every member
REM of staff to re-enable notifications and can never be recreated identically.
REM So keep one current copy, outside the project folder and outside the
REM rotated sets, where git can never see it and rotation can never delete it.
if exist "%ROOT%\server\.env" (
  if not exist "%SECRETS_DEST%\." mkdir "%SECRETS_DEST%" 2>nul
  copy /y "%ROOT%\server\.env" "%SECRETS_DEST%\.env" >nul
  if errorlevel 1 (
    echo   [!] Could not copy server\.env to %SECRETS_DEST%
  ) else (
    echo   Copied server\.env to %SECRETS_DEST%
  )
)

echo [%date% %time%] OK - backed up to %BACKUP_DEST% >> "%RUNLOG%"
echo.
echo   [OK] Done. Keeping the newest %KEEP% sets, older ones are removed.
echo.
if not defined SILENT pause
exit /b 0
