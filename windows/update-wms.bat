@echo off
REM ============================================================================
REM  Pull new code from GitHub and restart - right-click "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  This PC is a read-only mirror of GitHub. Never edit files here.
REM  Code flows in from GitHub; real data flows out as backups. Never the
REM  other way round - copying a dev database over this one destroys the
REM  work the staff have done since the cutover.
REM
REM  APP_PORT must match PORT in server\.env
REM ============================================================================
setlocal
set "APP_PORT=5000"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Right-click this file and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

pushd "%~dp0.."
set "ROOT=%CD%"
popd
cd /d "%ROOT%"

REM --------------------------------------------------------------------------
REM  Guards the failure that is hardest to diagnose: somebody edited a file
REM  here. Without this check the pull fails, the script sails on, and the
REM  screen says "done" while the server keeps running the old code.
REM --------------------------------------------------------------------------
set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  echo.
  echo   [!] This machine has locally modified files, so the update stopped.
  echo       It must stay an exact mirror of GitHub.
  echo.
  git status --short
  echo.
  echo   If none of that is worth keeping, run  git reset --hard  and retry.
  echo.
  pause
  exit /b 1
)

REM Remember which dependency sets we are on, so we can reinstall only when
REM they actually changed. A full reinstall costs minutes; most code changes
REM do not touch the lock files at all.
set "LOCK_ROOT_OLD="
set "LOCK_SRV_OLD="
for /f "delims=" %%h in ('git rev-parse HEAD:package-lock.json 2^>nul') do set "LOCK_ROOT_OLD=%%h"
for /f "delims=" %%h in ('git rev-parse HEAD:server/package-lock.json 2^>nul') do set "LOCK_SRV_OLD=%%h"
REM A missing node_modules must always reinstall, whatever the lock files say.
if not exist "%ROOT%\node_modules" set "LOCK_ROOT_OLD=install-needed"
if not exist "%ROOT%\server\node_modules" set "LOCK_SRV_OLD=install-needed"

echo.
echo   [1/5] Stopping WMS...
schtasks /end /tn "WMS" >nul 2>&1
ping -n 4 127.0.0.1 >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%APP_PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1

echo   [2/5] Pulling new code from GitHub...
git pull --ff-only
if errorlevel 1 goto fail

set "LOCK_ROOT_NEW="
set "LOCK_SRV_NEW="
for /f "delims=" %%h in ('git rev-parse HEAD:package-lock.json 2^>nul') do set "LOCK_ROOT_NEW=%%h"
for /f "delims=" %%h in ('git rev-parse HEAD:server/package-lock.json 2^>nul') do set "LOCK_SRV_NEW=%%h"

echo   [3/5] Checking dependencies...
if "%LOCK_ROOT_OLD%"=="%LOCK_ROOT_NEW%" goto skip_root
echo         web dependencies changed - reinstalling, takes several minutes
echo         and looks frozen. That is normal, do not close this window.
call npm ci
if errorlevel 1 goto fail
goto after_root
:skip_root
echo         web dependencies unchanged - skipped
:after_root

if "%LOCK_SRV_OLD%"=="%LOCK_SRV_NEW%" goto skip_srv
echo         server dependencies changed - reinstalling, please wait
pushd server
call npm ci
if errorlevel 1 (popd & goto fail)
popd
goto after_srv
:skip_srv
echo         server dependencies unchanged - skipped
:after_srv

echo   [4/5] Rebuilding the web pages...
call npm run build
if errorlevel 1 goto fail

echo   [5/5] Starting WMS again...
schtasks /run /tn "WMS" >nul
ping -n 13 127.0.0.1 >nul 2>&1

netstat -ano | findstr /C:":%APP_PORT% " | findstr LISTENING >nul
if errorlevel 1 (
  echo.
  echo   [!] Code updated but nothing is listening on port %APP_PORT%.
  echo       Open %ROOT%\wms.log to see what went wrong.
  echo.
  pause
  exit /b 1
)

echo.
echo   [OK] Update finished, WMS is back up.
echo        Tell staff to press Ctrl+Shift+R once to clear the cached old page.
echo.
pause
exit /b 0

:fail
echo.
echo   [!] Update failed and WMS is still stopped.
echo       Read the error above. To bring it back up now, run start-wms.bat
echo.
pause
exit /b 1
