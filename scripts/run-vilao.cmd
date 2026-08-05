@echo off
rem Run a ViLao live-check script with the key injected from a local file that is
rem never committed. Usage: scripts\run-vilao.cmd <script.mjs> [port]
rem The key is read from .vilao-key (gitignored), so it never lands in a command line.
setlocal
if not exist "%~dp0..\.vilao-key" (
  echo Missing .vilao-key in the repo root
  exit /b 2
)
for /f "usebackq delims=" %%K in ("%~dp0..\.vilao-key") do set VILAO_API_KEY=%%K
if not "%~2"=="" set VILAO_PORT=%~2
node "%~1"
endlocal
