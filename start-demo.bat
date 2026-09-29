@echo off
chcp 65001 >nul
title 拱桥智能建造及智能监测综合实验平台 · 数字孪生监测平台 Demo
cd /d %~dp0
echo ============================================================
echo   拱桥智能建造及智能监测综合实验平台
echo   数字孪生监测与展示系统 Demo  v1.1
echo   （对应《详细设计和建设方案》第 6 章）
echo ============================================================
echo.
echo   演示地址： http://127.0.0.1:8099/
echo   浏览器将自动打开；关闭本窗口即停止服务。
echo.

start "" http://127.0.0.1:8099/

where node >nul 2>nul
if %errorlevel%==0 (
  echo   [使用 Node 启动：传输 15 MB 模型约 1 秒]
  node "%~dp0server.mjs" 8099
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo   [未检测到 Node，改用 Python：模型下载会明显变慢，请耐心等加载层走完]
  py -m http.server 8099
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo   [未检测到 Node，改用 Python：模型下载会明显变慢，请耐心等加载层走完]
  python -m http.server 8099
  goto :eof
)

echo   未检测到 Node 或 Python，无法启动本地服务。
echo   建议安装 Node.js（https://nodejs.org）后重试。
pause
