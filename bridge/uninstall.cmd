@echo off
rem Double-click to remove the IDEXX bridge (asks for admin rights, then waits so you can read the result).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -Pause
