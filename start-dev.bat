@echo off
setlocal
set "ROOT=%~dp0"

echo 正在啟動前後端...
start "Backend" cmd /k "cd /d %ROOT%server && npm run dev"
start "Frontend" cmd /k "cd /d %ROOT%client && npm run dev"

echo.
echo 前端網址: http://localhost:5173
echo 後端網址: http://localhost:3000
echo.
echo 已開啟兩個終端視窗。
