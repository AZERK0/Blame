@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "RUNTIME_HOME=%SCRIPT_DIR%.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RUNTIME_HOME%\scripts\blame-wsl2-runtime.ps1" %*
exit /b %ERRORLEVEL%
