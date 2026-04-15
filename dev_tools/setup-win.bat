@echo off
REM ============================================================
REM  Biu 依赖一键安装（Windows）
REM  用法：在项目根目录双击或命令行执行 dev_tools\setup-win.bat
REM  作用：配置 Git/pnpm 镜像 -> 清理 node_modules -> 安装依赖
REM        -> 自动校验 Electron 二进制是否就位
REM  幂等：可以反复运行，不会破坏 pnpm-lock.yaml
REM ============================================================

chcp 65001 >nul
setlocal

echo ============================================
echo   Biu Windows 依赖一键安装
echo ============================================
echo.

REM ---- [1/6] 检查前置工具 ----
echo [1/6] 检查 Node / Git / pnpm...
where node >nul 2>nul
if errorlevel 1 (
  echo [X] 未找到 node，请先安装 Node.js 22.17.1
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo [X] 未找到 git
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo     未检测到 pnpm，通过 corepack 启用...
  call corepack enable
  if errorlevel 1 (
    echo [X] corepack enable 失败，请手动 npm i -g pnpm
    exit /b 1
  )
)
echo     node:
node -v
echo     pnpm:
pnpm -v
echo.

REM ---- [2/6] 强制 Git 走 HTTPS（解决 app-builder-bin 等 git+ssh 依赖）----
echo [2/6] 配置 Git 使用 HTTPS 代替 SSH/git 协议...
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://".insteadOf "git://"
echo     OK
echo.

REM ---- [3/6] pnpm 全局镜像和超时 ----
echo [3/6] 配置 pnpm 镜像...
call pnpm config set registry https://registry.npmmirror.com
call pnpm config set fetch-timeout 100000
call pnpm config set fetch-retries 5
echo     OK
echo.

REM ---- [4/6] Electron 镜像环境变量（项目 .npmrc 已有，此处当会话兜底）----
echo [4/6] 设置 Electron 二进制镜像...
set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
echo     OK
echo.

REM ---- [5/6] 清理 node_modules（保留 pnpm-lock.yaml 锁定版本）----
echo [5/6] 清理 node_modules（保留 pnpm-lock.yaml）...
if exist node_modules rmdir /s /q node_modules
echo     OK
echo.

REM ---- [6/6] 安装依赖 ----
echo [6/6] 安装依赖（耗时较长，不要关窗口）...
call pnpm install
if errorlevel 1 (
  echo.
  echo [!] 标准安装失败，回退到 --ignore-scripts 模式...
  call pnpm install --ignore-scripts
  if errorlevel 1 (
    echo [X] 依赖安装彻底失败，请将日志发给 Claude 排查
    exit /b 1
  )
  echo [!] 手动补装 Electron 二进制...
  call node node_modules\electron\install.js
  if errorlevel 1 (
    echo [X] Electron 二进制下载失败
    exit /b 1
  )
)

echo.
echo [校验] 检查关键文件...
if not exist node_modules\electron\dist\electron.exe (
  echo [!] electron.exe 缺失，补装一次...
  call node node_modules\electron\install.js
)
if exist node_modules\electron\dist\electron.exe (
  echo [OK] Electron 二进制就绪
) else (
  echo [X] Electron 二进制始终缺失，pnpm dev 会失败
  exit /b 1
)
if not exist node_modules\@rsbuild\core (
  echo [X] @rsbuild/core 未安装，pnpm dev 会失败
  exit /b 1
)
echo [OK] @rsbuild/core 就绪

echo.
echo ============================================
echo   [OK] 安装完成！下一步：
echo     pnpm dev       启动开发
echo     pnpm build     打包发布
echo ============================================
endlocal
