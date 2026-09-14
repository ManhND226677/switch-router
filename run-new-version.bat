@echo off
setlocal
cd /d "%~dp0"
title Switch Router - Run New Version

echo ============================================================
echo  Switch Router - build moi + khoi dong lai (port 28701)
echo ============================================================
echo.

echo [1/3] Dung ban dang chay tren port 28701 (neu co)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":28701 .*LISTENING"') do (
  echo   Dang dung PID %%a
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 >nul

echo.
echo [2/3] Build production (kiem tra code moi compile duoc)...
call npm run build
if errorlevel 1 (
  echo.
  echo [LOI] Build that bai - xem loi o tren.
  pause
  exit /b 1
)

echo.
echo [3/3] Khoi dong server...
start "Switch Router server" cmd /k npm start

echo Cho server len ^(~8 giay^)...
timeout /t 8 >nul
start http://127.0.0.1:28701/dashboard

echo.
echo Xong. Dashboard da mo trong trinh duyet: http://127.0.0.1:28701/dashboard
echo Cua so "Switch Router server" dang chay log - dong cua so nay se TAT server.
echo.
pause
