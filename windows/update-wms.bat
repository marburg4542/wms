@echo off
REM ============================================================================
REM  Pull new code from GitHub and restart - right-click "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  This PC is a read-only mirror of GitHub. Never edit files here.
REM  Code flows in from GitHub; real data flows out as backups. Never the
REM  other way round - copying a dev database over this one destroys the
REM  work the staff have done since the cutover.
REM ============================================================================
setlocal

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

echo.
echo   [1/5] Stopping WMS...
schtasks /end /tn "WMS" >nul 2>&1
timeout /t 3 /nobreak >nul
taskkill /F /IM node.exe >nul 2>&1

echo   [2/5] Pulling new code from GitHub...
git pull --ff-only
if errorlevel 1 goto fail

echo   [3/5] Installing dependencies...
echo         This takes several minutes and looks frozen. That is normal.
call npm ci
if errorlevel 1 goto fail
pushd server
call npm ci
if errorlevel 1 (popd & goto fail)
popd

echo   [4/5] Rebuilding the web pages...
call npm run build
if errorlevel 1 goto fail

echo   [5/5] Starting WMS again...
schtasks /run /tn "WMS" >nul
timeout /t 10 /nobreak >nul

netstat -ano | findstr ":5000" | findstr LISTENING >nul
if errorlevel 1 (
  echo.
  echo   [!] Code updated but nothing is listening on port 5000.
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
