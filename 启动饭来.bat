@echo off
rem FanLai one-click launcher (portfolio edition)
chcp 65001 >nul
title 饭来 FanLai · 本地服务
cd /d "%~dp0"

echo [饭来] 正在检查运行环境...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [饭来] 未检测到 Node.js，请先安装 Node.js 20 或更高版本：
echo        https://nodejs.org  （下载 LTS 版，一路下一步即可）
  echo.
  pause
  exit /b 1
)

for /f "delims=v. tokens=1,2" %%i in ('node -v') do set V1=%%i& set V2=%%j
echo [饭来] 已检测到 Node.js %V1%.%V2%

if not exist node_modules (
  echo [饭来] 首次启动，正在安装依赖（约 2-5 分钟，请保持网络畅通）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [饭来] 依赖安装失败，请检查网络后重新运行本脚本。
    pause
    exit /b 1
  )
)

echo [饭来] 启动服务中... 浏览器将自动打开 http://localhost:3000
echo [饭来] 关闭本窗口即可停止服务。
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
call npm run dev
echo [饭来] 服务已停止。
pause
