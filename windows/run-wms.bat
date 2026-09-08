@echo off
REM ============================================================================
REM  Launched automatically by Windows at boot - do NOT double-click this.
REM  See README.md in this folder for the Thai explanation.
REM
REM  Restarts the server automatically if it dies, so nobody has to watch it.
REM  The 15s delay keeps a bad config from spinning and bloating the log file.
REM
REM  ASCII only on purpose: cmd.exe misparses UTF-8 batch files, and the
REM  goto-loop below is exactly the construct that breaks first.
REM ============================================================================
setlocal

pushd "%~dp0.."
set "ROOT=%CD%"
popd
set "LOG=%ROOT%\wms.log"

REM When running as SYSTEM, node may not be on PATH - fall back to the default.
set "NODE=node"
where node >nul 2>&1 || set "NODE=C:\Program Files\nodejs\node.exe"

:loop
echo.>> "%LOG%"
echo [%date% %time%] WMS starting >> "%LOG%"
cd /d "%ROOT%\server"
"%NODE%" index.js >> "%LOG%" 2>&1
echo [%date% %time%] WMS stopped (exit %errorlevel%) - restarting in 15s >> "%LOG%"
timeout /t 15 /nobreak >nul
goto loop
