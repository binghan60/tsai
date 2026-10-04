@echo off
rem Double-click to see whether the IDEXX bridge is running and its recent log.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1" -Pause
