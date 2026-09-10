@echo off
REM ============================================================================
REM  ONE-TIME SETUP - right-click and "Run as administrator".
REM
REM  Tells Windows to run backup-now.bat every day by itself.
REM  Read the comments in backup-now.bat first if you need to change the drive.
REM ============================================================================
setlocal
set "TASKNAME=WMS Backup"
set "ATTIME=02:00"

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
set "BKBAT=%ROOT%\windows\backup-now.bat"
set "PS1=%ROOT%\windows\register-backup-task.ps1"

if not exist "%BKBAT%" ( echo   Cannot find backup-now.bat & pause & exit /b 1 )
if not exist "%PS1%"   ( echo   Cannot find register-backup-task.ps1 & pause & exit /b 1 )

echo.
echo   Registering the daily backup task...
echo.

REM -ExecutionPolicy Bypass so this works on machines where running .ps1
REM files is disabled - which is the default on a fresh Windows install.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -BatPath "%BKBAT%" -TaskName "%TASKNAME%" -AtTime "%ATTIME%"
if errorlevel 1 (
  echo.
  echo   FAILED to register the task.
  pause
  exit /b 1
)

echo.
echo   Running one backup now, so you can see it work...
echo.
call "%BKBAT%" --silent

echo.
echo   ---------------------------------------------------------------
echo   Check it any time with check-wms.bat - it shows when the last
echo   backup ran and how big it was.
echo   ---------------------------------------------------------------
echo.
pause
