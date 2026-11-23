@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo Starting Zeez Helmet Shop. Open http://localhost:3000 in your browser.
echo Keep this window open while using the shop.
npm start
pause
