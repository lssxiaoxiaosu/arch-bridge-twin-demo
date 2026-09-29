@echo off
chcp 65001 >nul
title 拱桥智能建造及智能监测综合实验平台 · 数字孪生监测平台 Demo
cd /d %~dp0
echo ============================================================
echo   拱桥智能建造及智能监测综合实验平台
echo   数字孪生监测与展示系统 Demo  v1.0
echo   （对应《详细设计和建设方案》第 6 章）
echo ============================================================
echo.
echo   正在启动本地演示服务： http://localhost:8099/
echo   浏览器将自动打开；关闭本窗口即停止服务。
echo.
start "" http://localhost:8099/
py -m http.server 8099 2>nul || python -m http.server 8099
