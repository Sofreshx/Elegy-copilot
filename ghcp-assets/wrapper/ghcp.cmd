@echo off
REM ghcp — CMD shim for GitHub Copilot CLI wrapper
REM Forwards to the PowerShell script

where pwsh >nul 2>&1
if %errorlevel% equ 0 (
  pwsh -ExecutionPolicy Bypass -File "%~dp0ghcp.ps1" %*
  exit /b %errorlevel%
)

where powershell >nul 2>&1
if %errorlevel% equ 0 (
  powershell -ExecutionPolicy Bypass -File "%~dp0ghcp.ps1" %*
  exit /b %errorlevel%
)

REM Fallback: try bash (Git Bash)
where bash >nul 2>&1
if %errorlevel% equ 0 (
  bash "%~dp0ghcp" %*
  exit /b %errorlevel%
)

echo ghcp: no suitable shell found — install Git Bash, PowerShell, or pwsh
exit /b 1
