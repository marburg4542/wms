@echo off
REM ============================================================================
REM  Stop WMS - right-click and "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  While stopped, nobody in the company can use the system.
REM
REM  Kills only the process actually serving on the app's port, never every
REM  node.exe on the machine. A dev box can easily have ten unrelated node
REM  processes running, including the editor tooling you are working in.
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

echo   Stopping WMS...

REM End the scheduled task first so its restart loop cannot respawn the server.
schtasks /end /tn "WMS" >nul 2>&1
ping -n 4 127.0.0.1 >nul 2>&1

REM Then clean up the server itself, addressed by the port it is listening on.
REM Two netstat rows (IPv4 + IPv6) can carry the same PID - the second taskkill
REM simply fails silently, which is fine.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%APP_PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1

ping -n 3 127.0.0.1 >nul 2>&1
netstat -ano | findstr /C:":%APP_PORT% " | findstr LISTENING >nul
if errorlevel 1 (
  echo   [OK] Stopped. Staff cannot use the system right now.
) else (
  echo   [!] Something is still on port %APP_PORT% - run this file once more.
)
echo.
echo   Bring it back with start-wms.bat, or just reboot the PC.
echo.
pause
