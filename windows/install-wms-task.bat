@echo off
REM ============================================================================
REM  ONE-TIME SETUP - right-click and "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  Registers a Windows task that starts WMS at boot as the SYSTEM account,
REM  so the system comes back after a reboot WITHOUT anyone logging in.
REM  A task tied to a person's account leaves the office offline until that
REM  person shows up - the exact problem this machine is meant to solve.
REM
REM  This does NOT touch the Cloudflare tunnel. That is installed separately
REM  as its own Windows service and starts itself. See README.md.
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

REM Derive the project folder from this file's own location, so the whole
REM project can be moved to another drive without editing anything.
pushd "%~dp0.."
set "ROOT=%CD%"
popd
set "RUNNER=%ROOT%\windows\run-wms.bat"

if not exist "%RUNNER%" (
  echo   Cannot find run-wms.bat at %RUNNER%
  pause
  exit /b 1
)
if not exist "%ROOT%\server\.env" (
  echo.
  echo   WARNING: server\.env is missing - the server will not start without it.
  echo   Put the data files in place first, then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Project folder : %ROOT%
echo   Creating scheduled task "WMS" to start at every boot...
echo.

schtasks /create /tn "WMS" /tr "\"%RUNNER%\"" /sc onstart /ru SYSTEM /f
if errorlevel 1 (
  echo.
  echo   FAILED to create the task.
  pause
  exit /b 1
)

echo.
echo   Starting it now, no reboot needed...
schtasks /run /tn "WMS" >nul

REM ping, not timeout: works with or without a console. See run-wms.bat.
ping -n 13 127.0.0.1 >nul 2>&1

netstat -ano | findstr /C:":%APP_PORT% " | findstr LISTENING >nul
if errorlevel 1 (
  echo   [!] Nothing listening on port %APP_PORT% yet.
  echo       Open %ROOT%\wms.log to see what went wrong.
) else (
  echo   [OK] WMS is running - test it at http://localhost:%APP_PORT%
)

echo.
echo   ---------------------------------------------------------------
echo   LAST STEP, DO NOT SKIP: restart this PC once and wait WITHOUT
echo   logging in. If the site opens from your phone while the PC is
echo   still sitting on the lock screen, it really works.
echo   ---------------------------------------------------------------
echo.
pause
