@echo off
REM ============================================================================
REM  Start WMS by hand - right-click and "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  Normally unnecessary: Windows starts it at every boot already.
REM  This is for getting back up after stop-wms.bat without rebooting.
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

echo   Starting WMS...
schtasks /run /tn "WMS" >nul
if errorlevel 1 (
  echo.
  echo   Scheduled task "WMS" not found - run install-wms-task.bat first.
  echo.
  pause
  exit /b 1
)

REM ping, not timeout: works with or without a console. See run-wms.bat.
ping -n 11 127.0.0.1 >nul 2>&1
netstat -ano | findstr /C:":%APP_PORT% " | findstr LISTENING >nul
if errorlevel 1 (
  echo   [!] Nothing listening on port %APP_PORT% yet.
  echo       Open %ROOT%\wms.log to see what went wrong.
) else (
  echo   [OK] WMS is running - staff can use it again.
)
echo.
pause
