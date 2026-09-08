@echo off
REM ============================================================================
REM  Stop WMS - right-click and "Run as administrator".
REM  See README.md in this folder for the Thai explanation.
REM
REM  While stopped, nobody in the company can use the system.
REM
REM  taskkill kills every node.exe on this machine. That is deliberate: this
REM  PC runs WMS and nothing else. If that ever changes, fix this line first.
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

echo   Stopping WMS...
schtasks /end /tn "WMS" >nul 2>&1
timeout /t 3 /nobreak >nul
taskkill /F /IM node.exe >nul 2>&1

timeout /t 2 /nobreak >nul
netstat -ano | findstr ":5000" | findstr LISTENING >nul
if errorlevel 1 (
  echo   [OK] Stopped. Staff cannot use the system right now.
) else (
  echo   [!] Something is still on port 5000 - run this file once more.
)
echo.
echo   Bring it back with start-wms.bat, or just reboot the PC.
echo.
pause
