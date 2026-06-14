@echo off
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-VercelQuickTunnel.ps1"
pause
