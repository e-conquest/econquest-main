@echo off
REM ==============================================================================
REM EconQuest — Sovereign Council Orchestrator
REM One-Click Windows Batch Launcher (delegates to scripts\start-windows.ps1)
REM ==============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
pause
