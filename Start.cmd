@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can Node.js 22 tro len de chay ung dung.
  pause
  exit /b 1
)
echo Mo http://127.0.0.1:8787 tren trinh duyet.
node --env-file-if-exists=.env.local scripts/dev.mjs
pause
